import type { Body } from '../geometry/Body';
import {
  DEFAULT_TOLERANCE_POLICY,
  quantizeToTolerance,
  type TolerancePolicy,
} from '../geometry/TolerancePolicy';
import type { BoardMetadata, Material, StockAllowance } from './Materials';
import { validateBoardMetadata } from './Materials';
import {
  convertLength,
  measureBRepBody,
  measureOrientedBoard,
  type LengthUnit,
  type OrientedBoardDimensions,
  type Vector3,
} from './Measurements';

export interface CutListPart {
  body: Body;
  metadata: BoardMetadata;
  name?: string;
}

export interface CutListGroup {
  key: string;
  quantity: number;
  material: BoardMetadata['material'];
  grainPattern?: BoardMetadata['grainPattern'];
  dimensions: OrientedBoardDimensions;
  stockAllowance: StockAllowance;
  stockDimensions: Pick<OrientedBoardDimensions, 'length' | 'width' | 'thickness'>;
  partIds: string[];
  partNames: string[];
  notes: string[];
}

export interface CutListCsvOptions {
  unit?: LengthUnit;
  precision?: number;
}

export const CUT_LIST_DOCUMENT_VERSION = 1 as const;

export interface CutListDocumentRow {
  key: string;
  label: string;
  quantity: number;
  material: Material;
  grainPattern: BoardMetadata['grainPattern'] | null;
  finishedDimensions: Pick<OrientedBoardDimensions, 'length' | 'width' | 'thickness'>;
  stockAllowance: StockAllowance;
  stockDimensions: Pick<OrientedBoardDimensions, 'length' | 'width' | 'thickness'>;
  partIds: string[];
  partNames: string[];
  notes: string[];
  boardFeet: number;
}

export interface CutListDocument {
  version: typeof CUT_LIST_DOCUMENT_VERSION;
  title: string;
  unit: LengthUnit;
  generatedAt: string | null;
  rows: CutListDocumentRow[];
  summary: {
    groupCount: number;
    partCount: number;
    totalBoardFeet: number;
  };
}

export interface CutListDocumentOptions extends CutListCsvOptions {
  title?: string;
  /** Caller-supplied timestamp keeps the core deterministic and testable. */
  generatedAt?: string;
}

/**
 * Group equivalent parts by material, grain and board-local B-Rep topology.
 * IDs, map insertion order and world translation are deliberately ignored.
 */
export function groupCutList(
  parts: readonly CutListPart[],
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): CutListGroup[] {
  const groups = new Map<string, CutListGroup>();
  for (const part of parts) {
    validateBoardMetadata(part.metadata);
    measureBRepBody(part.body, tolerance);
    const dimensions = measureOrientedBoard(part.body, part.metadata, tolerance);
    const stockAllowance = resolveStockAllowance(part.metadata.stockAllowance);
    const stockDimensions = applyStockAllowance(dimensions, stockAllowance, tolerance);
    const geometrySignature = createLocalGeometrySignature(part.body, dimensions.axes, tolerance);
    const materialSignature = stableStringify({
      id: part.metadata.material.id,
      species: part.metadata.material.species,
      grade: part.metadata.material.grade ?? '',
      stockCode: part.metadata.material.stockCode ?? '',
      densityKgM3: part.metadata.material.densityKgM3 ?? null,
      grainPattern: part.metadata.grainPattern ?? '',
      stockAllowance,
    });
    const key = `${materialSignature}|${geometrySignature}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.partIds.push(part.body.id);
      existing.partNames.push(part.name ?? part.metadata.partNumber ?? part.body.name);
      if (part.metadata.notes?.trim()) existing.notes.push(part.metadata.notes.trim());
    } else {
      groups.set(key, {
        key,
        quantity: 1,
        material: { ...part.metadata.material },
        ...(part.metadata.grainPattern ? { grainPattern: part.metadata.grainPattern } : {}),
        dimensions,
        stockAllowance,
        stockDimensions,
        partIds: [part.body.id],
        partNames: [part.name ?? part.metadata.partNumber ?? part.body.name],
        notes: part.metadata.notes?.trim() ? [part.metadata.notes.trim()] : [],
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      partIds: [...group.partIds].sort(compareText),
      partNames: [...group.partNames].sort(compareText),
      notes: [...new Set(group.notes)].sort(compareText),
    }))
    .sort((left, right) => compareText(left.key, right.key));
}

/** Build a renderer-independent, versioned manufacturing cut-list document. */
export function buildCutListDocument(
  parts: readonly CutListPart[],
  options: CutListDocumentOptions = {},
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): CutListDocument {
  const unit = options.unit ?? 'in';
  assertUnit(unit);
  const title = options.title?.trim() || 'Cut List';
  const generatedAt = options.generatedAt ?? null;
  if (generatedAt !== null && !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('generatedAt must be a valid date string');
  }

  const rows: CutListDocumentRow[] = groupCutList(parts, tolerance).map((group) => {
    const boardFeet = canonicalNumberValue(
      (
        group.stockDimensions.length
        * group.stockDimensions.width
        * group.stockDimensions.thickness
        * group.quantity
      ) / 144,
      tolerance.linear
    );
    return {
      key: group.key,
      label: group.partNames.join('; '),
      quantity: group.quantity,
      material: { ...group.material },
      grainPattern: group.grainPattern ?? null,
      finishedDimensions: {
        length: group.dimensions.length,
        width: group.dimensions.width,
        thickness: group.dimensions.thickness,
      },
      stockAllowance: { ...group.stockAllowance },
      stockDimensions: { ...group.stockDimensions },
      partIds: [...group.partIds],
      partNames: [...group.partNames],
      notes: [...group.notes],
      boardFeet,
    };
  });

  return {
    version: CUT_LIST_DOCUMENT_VERSION,
    title,
    unit,
    generatedAt,
    rows,
    summary: {
      groupCount: rows.length,
      partCount: rows.reduce((sum, row) => sum + row.quantity, 0),
      totalBoardFeet: canonicalNumberValue(
        rows.reduce((sum, row) => sum + row.boardFeet, 0),
        tolerance.linear
      ),
    },
  };
}

/** Render the richer versioned cut-list document as RFC 4180 CSV. */
export function cutListDocumentToCsv(
  document: CutListDocument,
  options: CutListCsvOptions = {}
): string {
  if (document.version !== CUT_LIST_DOCUMENT_VERSION) {
    throw new Error(`Unsupported cut-list document version: ${String(document.version)}`);
  }
  const unit = options.unit ?? document.unit;
  assertUnit(unit);
  const precision = options.precision ?? 3;
  validatePrecision(precision);
  const rows: string[][] = [[
    'Part names',
    'Quantity',
    'Material',
    'Grade',
    'Stock code',
    'Finished length',
    'Finished width',
    'Finished thickness',
    'Stock length',
    'Stock width',
    'Stock thickness',
    'Unit',
    'Grain',
    'Board feet',
    'Notes',
  ]];
  for (const row of [...document.rows].sort((left, right) => compareText(left.key, right.key))) {
    rows.push([
      row.partNames.join('; '),
      String(row.quantity),
      row.material.species,
      row.material.grade ?? '',
      row.material.stockCode ?? '',
      decimal(convertLength(row.finishedDimensions.length, 'in', unit), precision),
      decimal(convertLength(row.finishedDimensions.width, 'in', unit), precision),
      decimal(convertLength(row.finishedDimensions.thickness, 'in', unit), precision),
      decimal(convertLength(row.stockDimensions.length, 'in', unit), precision),
      decimal(convertLength(row.stockDimensions.width, 'in', unit), precision),
      decimal(convertLength(row.stockDimensions.thickness, 'in', unit), precision),
      unit,
      row.grainPattern ?? '',
      decimal(row.boardFeet, precision),
      row.notes.join('; '),
    ]);
  }
  return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** Generate an RFC 4180-safe cut-list CSV with CRLF line endings. */
export function cutListToCsv(
  groups: readonly CutListGroup[],
  options: CutListCsvOptions = {}
): string {
  const unit = options.unit ?? 'in';
  assertUnit(unit);
  const precision = options.precision ?? 3;
  validatePrecision(precision);
  const rows: string[][] = [[
    'Part names', 'Quantity', 'Material', 'Grade', 'Length', 'Width', 'Thickness', 'Unit', 'Grain',
  ]];
  for (const group of [...groups].sort((left, right) => compareText(left.key, right.key))) {
    rows.push([
      group.partNames.join('; '),
      String(group.quantity),
      group.material.species,
      group.material.grade ?? '',
      decimal(convertLength(group.dimensions.length, 'in', unit), precision),
      decimal(convertLength(group.dimensions.width, 'in', unit), precision),
      decimal(convertLength(group.dimensions.thickness, 'in', unit), precision),
      unit,
      group.grainPattern ?? '',
    ]);
  }
  return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

function resolveStockAllowance(
  allowance: Partial<StockAllowance> | undefined
): StockAllowance {
  return {
    length: allowance?.length ?? 0,
    width: allowance?.width ?? 0,
    thickness: allowance?.thickness ?? 0,
  };
}

function applyStockAllowance(
  dimensions: OrientedBoardDimensions,
  allowance: StockAllowance,
  tolerance: Readonly<TolerancePolicy>
): Pick<OrientedBoardDimensions, 'length' | 'width' | 'thickness'> {
  return {
    length: canonicalNumberValue(dimensions.length + allowance.length, tolerance.linear),
    width: canonicalNumberValue(dimensions.width + allowance.width, tolerance.linear),
    thickness: canonicalNumberValue(dimensions.thickness + allowance.thickness, tolerance.linear),
  };
}

function canonicalNumberValue(value: number, tolerance: number): number {
  const quantized = quantizeToTolerance(value, tolerance);
  return Object.is(quantized, -0) ? 0 : quantized;
}

function createLocalGeometrySignature(
  body: Body,
  axes: OrientedBoardDimensions['axes'],
  tolerance: Readonly<TolerancePolicy>
): string {
  const vertexCoordinates = new Map<string, [number, number, number]>();
  let minima: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const [id, vertex] of body.vertices) {
    const local: [number, number, number] = [
      dot(vertex.position, axes.length),
      dot(vertex.position, axes.width),
      dot(vertex.position, axes.thickness),
    ];
    vertexCoordinates.set(id, local);
    minima = minima.map((minimum, index) => Math.min(minimum, local[index]!)) as [number, number, number];
  }

  const normalized = new Map<string, string>();
  for (const [id, coordinate] of vertexCoordinates) {
    normalized.set(id, coordinate.map((value, index) =>
      canonicalNumber(value - minima[index]!, tolerance.linear)
    ).join(','));
  }
  const normalizedVertex = (id: string): string => {
    const value = normalized.get(id);
    if (value === undefined) {
      throw new Error(`Geometry references missing vertex ${id}`);
    }
    return value;
  };
  const vertices = [...normalized.values()].sort(compareText);
  const edges = [...body.edges.values()].map((edge) => {
    const ends = edge.vertexIds.map(normalizedVertex).sort(compareText);
    return ends.join('~');
  }).sort(compareText);
  const edgeSignature = (id: string): string => {
      const edge = body.edges.get(id);
      if (!edge) throw new Error(`Geometry references missing edge ${id}`);
      return edge.vertexIds.map(normalizedVertex)
        .sort(compareText).join('~');
  };
  const faces = [...body.faces.values()].map((face) => {
    const boundary = face.boundaryEdgeIds.map(edgeSignature).sort(compareText);
    const holes = (face.innerBoundaryEdgeIds ?? [])
      .map((loop) => loop.map(edgeSignature).sort(compareText).join('|'))
      .sort(compareText);
    return stableStringify({ boundary, holes });
  }).sort(compareText);
  return stableStringify({ vertices, edges, faces });
}

function canonicalNumber(value: number, tolerance: number): string {
  if (!Number.isFinite(value)) throw new Error('Geometry contains a non-finite coordinate');
  const quantized = quantizeToTolerance(value, tolerance);
  return String(Object.is(quantized, -0) ? 0 : quantized);
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function decimal(value: number, precision: number): string {
  return value.toFixed(precision).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function validatePrecision(precision: number): void {
  if (!Number.isInteger(precision) || precision < 0 || precision > 9) {
    throw new Error('Precision must be an integer from 0 to 9');
  }
}

function assertUnit(unit: string): asserts unit is LengthUnit {
  if (unit !== 'in' && unit !== 'mm') {
    throw new Error(`Unsupported length unit: ${unit}`);
  }
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
