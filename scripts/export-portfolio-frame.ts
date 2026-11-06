/** Headless exports of the bounded four-board example through production APIs. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  PORTFOLIO_FRAME_TIMESTAMP,
  bodyMetadataForPortfolioFrame,
  createPortfolioFrameDocument,
  editPortfolioFrameLength,
  rebuildPortfolioFrameDocument,
} from '../src/examples/portfolioFrame';
import { hashBodyGeometry } from '../src/geometry/GeometryHash';
import { deserialize, serialize } from '../src/persistence/serializer';
import type { Document } from '../src/types';
import { buildCutListDocument, cutListDocumentToCsv } from '../src/woodworking/CutList';
import { convertLength, measureBRepBody, measureOrientedBoard, type LengthUnit } from '../src/woodworking/Measurements';
import { createShopDrawing } from '../src/woodworking/ShopDrawing';
import { renderDrawingDxfR12 } from '../src/woodworking/ShopDrawingDxf';
import { renderDrawingPdf } from '../src/woodworking/ShopDrawingPdf';
import { renderDrawingSvg } from '../src/woodworking/ShopDrawingSvg';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TOLERANCE = 1e-7;
export const FRAME_EXPORT_DATE = PORTFOLIO_FRAME_TIMESTAMP;

export function assertFrame(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(actual: number, expected: number, label: string): void {
  assertFrame(Number.isFinite(actual) && Math.abs(actual - expected) <= TOLERANCE,
    `${label}: ${actual} differs from independent expectation ${expected}`);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Read actual content streams, not merely the PDF signature or metadata title. */
export async function pdfDrawingText(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const text: string[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const operators = new TextDecoder().decode(decodePDFRawStream(object).decode());
    for (const match of operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      text.push(Buffer.from(match[1]!, 'hex').toString('latin1'));
    }
  }
  return text.join('\n');
}

export function analyzeFrame(document: Document, length: number) {
  const rebuilt = rebuildPortfolioFrameDocument(document);
  assertFrame(rebuilt.ok, `Frame rebuild failed: ${JSON.stringify(rebuilt.diagnostics)}`);
  assertFrame(rebuilt.bodies.length === 4, 'Source definition must not be counted as a fifth part');
  const metadata = bodyMetadataForPortfolioFrame(document, rebuilt);
  const bodies = [...rebuilt.bodies].sort((a, b) => a.id.localeCompare(b.id));
  const parts = bodies.map(body => ({ body, metadata: metadata[body.id]!, name: metadata[body.id]!.label }));
  const measured = parts.map(part => {
    const solid = measureBRepBody(part.body);
    const board = measureOrientedBoard(part.body, part.metadata);
    close(board.length, length, `${part.name} length`);
    close(board.width, 3, `${part.name} width`);
    close(board.thickness, 0.75, `${part.name} thickness`);
    close(solid.volume, length * 3 * 0.75, `${part.name} volume`);
    return { id: part.body.id, name: part.name, solid, board,
      geometry_hash: hashBodyGeometry(part.body), grain_axis: part.metadata.grainAxis };
  });
  const min = [0, 1, 2].map(axis => Math.min(...measured.map(part => part.solid.bounds.min[axis]!)));
  const max = [0, 1, 2].map(axis => Math.max(...measured.map(part => part.solid.bounds.max[axis]!)));
  const outer = max.map((value, axis) => value - min[axis]!);
  [length + 6, length, 0.75].forEach((expected, axis) => close(outer[axis]!, expected, `Outer axis ${axis}`));
  const horizontal = measured.filter(part => Math.abs(part.grain_axis[0]) > 0.9)
    .sort((a, b) => a.solid.bounds.min[1] - b.solid.bounds.min[1]);
  const vertical = measured.filter(part => Math.abs(part.grain_axis[1]) > 0.9)
    .sort((a, b) => a.solid.bounds.min[0] - b.solid.bounds.min[0]);
  assertFrame(horizontal.length === 2 && vertical.length === 2, 'Expected two boards along each grain direction');
  const opening = [vertical[1]!.solid.bounds.min[0] - vertical[0]!.solid.bounds.max[0],
    horizontal[1]!.solid.bounds.min[1] - horizontal[0]!.solid.bounds.max[1]];
  close(opening[0]!, length, 'Opening width');
  close(opening[1]!, length - 6, 'Opening height');
  const volume = measured.reduce((sum, part) => sum + part.solid.volume, 0);
  const surface = measured.reduce((sum, part) => sum + part.solid.surfaceArea, 0);
  const projectedArea = measured.reduce((sum, part) => sum + part.solid.faces
    .filter(face => face.normal[2] > 0.99).reduce((area, face) => area + face.area, 0), 0);
  close(volume, length * 9, 'Four-board volume');
  close(surface, 4 * (7.5 * length + 4.5), 'Sum of individual board surface areas');
  close(projectedArea, length * 12, 'Top projected material area');
  const centroid = [0, 1, 2].map(axis => measured.reduce((sum, part) => sum
    + (part.solid.bounds.min[axis]! + part.solid.bounds.max[axis]!) / 2 * part.solid.volume, 0) / volume);
  [(length + 6) / 2, length / 2, 0.375].forEach((expected, axis) => close(centroid[axis]!, expected, `Centroid ${axis}`));
  return { bodies, parts, measured, outer, opening, volume, surface, projectedArea, centroid };
}

function drawingFor(analysis: ReturnType<typeof analyzeFrame>, length: number, unit: LengthUnit) {
  const numeric = (value: number) => Number(convertLength(value, 'in', unit).toFixed(3));
  return createShopDrawing(analysis.bodies, {
    title: `White oak frame - ${length} in source boards - ${unit}`,
    unit, scale: 0.2, views: ['top', 'front', 'right'], dimensionPrecision: 3,
    includeDimensions: true, includeHiddenLines: true,
    grainMarks: analysis.measured.map(part => {
      const center = part.solid.bounds.min.map((minimum, axis) =>
        (minimum + part.solid.bounds.max[axis]!) / 2);
      return { id: part.id, view: 'top',
        start: { x: center[0]! - part.grain_axis[0] * length * 0.2,
          y: center[1]! - part.grain_axis[1] * length * 0.2 },
        end: { x: center[0]! + part.grain_axis[0] * length * 0.2,
          y: center[1]! + part.grain_axis[1] * length * 0.2 } };
    }),
    annotationMarks: [
      { id: 'opening', view: 'top', position: [0.5, 0.35],
        label: `Opening ${numeric(length)} x ${numeric(length - 6)} ${unit}` },
      { id: 'finished', view: 'top', position: [0.5, 0.5],
        label: `4 white oak boards: ${numeric(length)} x ${numeric(3)} x ${numeric(0.75)} ${unit}` },
      { id: 'stock', view: 'top', position: [0.5, 0.65],
        label: `Stock: ${numeric(length + 0.5)} x ${numeric(3.25)} x ${numeric(0.875)} ${unit}` },
    ],
  });
}

/** Four finished dimensions/volume controls are independent arithmetic, not hashes. */
export async function createFrameExportArtifacts(document: Document, length: number) {
  const analysis = analyzeFrame(document, length);
  const saved = serialize(document);
  assertFrame(saved.ok, `Scene serialization failed: ${saved.ok ? '' : saved.error}`);
  const loaded = deserialize(saved.json);
  assertFrame(loaded.ok, `Scene reopen failed: ${loaded.ok ? '' : loaded.error}`);
  const reopened = analyzeFrame(loaded.document, length);
  assertFrame(JSON.stringify(analysis.measured) === JSON.stringify(reopened.measured),
    'Saved history/component rebuild changed geometry, identities, or measurements');
  assertFrame(JSON.stringify(document.features) === JSON.stringify(loaded.document.features),
    'Saved feature history differs after reopening');
  const cutList = buildCutListDocument(analysis.parts, {
    title: `White oak frame - ${length} in boards`, unit: 'in', generatedAt: FRAME_EXPORT_DATE,
  });
  assertFrame(cutList.summary.groupCount === 1 && cutList.summary.partCount === 4, 'Expected one four-part cut group');
  const row = cutList.rows[0]!;
  close(row.finishedDimensions.length, length, 'Cut-list finished length');
  close(row.finishedDimensions.width, 3, 'Cut-list finished width');
  close(row.finishedDimensions.thickness, 0.75, 'Cut-list finished thickness');
  close(row.stockDimensions.length, length + 0.5, 'Stock length');
  close(row.stockDimensions.width, 3.25, 'Stock width');
  close(row.stockDimensions.thickness, 0.875, 'Stock thickness');
  close(row.stockAllowance.length, 0.5, 'Declared length allowance');
  close(row.stockAllowance.width, 0.25, 'Declared width allowance');
  close(row.stockAllowance.thickness, 0.125, 'Declared thickness allowance');
  const stockBoardFeet = (length + 0.5) * 3.25 * 0.875 * 4 / 144;
  assertFrame(Math.abs(row.boardFeet - stockBoardFeet) <= 1e-6,
    'Cut-list board feet differ from independently calculated rough-stock volume');
  const files = new Map<string, string | Uint8Array>([
    ['frame.json', saved.json], ['cut-list.json', json(cutList)],
    ['cut-list.csv', cutListDocumentToCsv(cutList)],
    ['cut-list-mm.csv', cutListDocumentToCsv(cutList, { unit: 'mm', precision: 3 })],
  ]);
  const drawingEvidence: Record<string, unknown> = {};
  for (const unit of ['in', 'mm'] as const) {
    const drawing = drawingFor(analysis, length, unit);
    const svg = renderDrawingSvg(drawing);
    const dxf = renderDrawingDxfR12(drawing);
    const pdf = await renderDrawingPdf(drawing, { metadataDate: new Date(FRAME_EXPORT_DATE) });
    const parsed = await PDFDocument.load(pdf, { updateMetadata: false });
    assertFrame(parsed.getPageCount() === 1, 'Shop drawing must have exactly one page');
    close(parsed.getPage(0).getWidth(), drawing.page.width * 72, 'PDF physical page width');
    close(parsed.getPage(0).getHeight(), drawing.page.height * 72, 'PDF physical page height');
    const text = await pdfDrawingText(pdf);
    const expectedLabels = [length + 6, length, 0.75].map(value =>
      `${Number(convertLength(value, 'in', unit).toFixed(3))} ${unit}`);
    for (const label of expectedLabels) {
      assertFrame(text.includes(label) && svg.includes(label) && dxf.includes(label),
        `Actual PDF/SVG/DXF missing independently expected dimension ${label}`);
    }
    for (const [extension, bytes] of [['json', json(drawing)], ['svg', svg], ['dxf', dxf], ['pdf', pdf]] as const) {
      files.set(`drawing-${unit}.${extension}`, bytes);
    }
    drawingEvidence[unit] = { physical_page_inches: drawing.page,
      pdf_pages: parsed.getPageCount(), expected_dimension_labels: expectedLabels,
      pdf_text: text, dxf_units: unit === 'mm' ? 4 : 1, scale: drawing.scale };
  }
  const evidence = { schema_version: 1, status: 'passed',
    measurement_type: 'analytic_geometry_and_actual_export_controls',
    expected: { physical_parts: 4, board_inches: [length, 3, 0.75],
      outer_inches: [length + 6, length, 0.75], opening_inches: [length, length - 6],
      volume_cubic_inches: length * 9, individual_surface_square_inches: 4 * (7.5 * length + 4.5),
      finished_mm: [length * 25.4, 76.2, 19.05], stock_inches: [length + 0.5, 3.25, 0.875],
      stock_board_feet: stockBoardFeet, stock_board_feet_absolute_tolerance: 1e-6 },
    observed: { physical_parts: analysis.bodies.length, outer_inches: analysis.outer,
      opening_inches: analysis.opening, volume_cubic_inches: analysis.volume,
      individual_surface_square_inches: analysis.surface, top_material_area_square_inches: analysis.projectedArea,
      centroid_inches: analysis.centroid, cut_list: cutList, parts: analysis.measured },
    persistence: { saved_feature_history_matches: true, reopened_geometry_and_ids_match: true },
    drawings: drawingEvidence,
    limitations: ['Planar/prismatic square-butt example; no curved CAD, joinery or structural rating.',
      'Example edits explicitly recompute four placements; general assembly constraint propagation is outside this profile.',
      'Geometry hashes establish repeatability; independent arithmetic supplies numerical expectations.',
      'Surface area is the sum over four boards, not a fused-union exterior.'] };
  files.set('evidence.json', json(evidence));
  return { files, evidence };
}

async function sourceSnapshot(): Promise<Record<string, string>> {
  const names: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(path.join(ROOT, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      assertFrame(!entry.isSymbolicLink(), `Source symlink is unsupported: ${relative}`);
      if (entry.isDirectory()) await walk(relative);
      else if (/\.(?:ts|css|json)$/.test(entry.name)) names.push(relative);
    }
  }
  await walk('src');
  await walk('tests');
  names.push('scripts/export-portfolio-frame.ts', 'examples/white-oak-frame.scene.json',
    'scripts/package-web-release.mjs', 'scripts/write-third-party-notices.mjs', 'index.html',
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
    'eslint.config.js', 'vitest.config.ts', 'vite.config.ts', 'release/web-release.json');
  return Object.fromEntries(await Promise.all(names.sort().map(async name =>
    [name, sha256((await readFile(path.join(ROOT, name), 'utf8')).replace(/\r\n/g, '\n'))] as const)));
}

export async function writeArtifact(target: string, bytes: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    assertFrame(sha256(await readFile(target)) === sha256(bytes), `Refusing to replace different artifact: ${target}`);
  }
}

export async function exportPortfolioFrame(output: string) {
  const defaultDocument = createPortfolioFrameDocument(18);
  const documents = { default18: defaultDocument, edited20: editPortfolioFrameLength(defaultDocument, 20) };
  const artifacts: Record<string, string> = {};
  const variants: Record<string, unknown> = {};
  const sources = await sourceSnapshot();
  for (const [name, document] of Object.entries(documents)) {
    const result = await createFrameExportArtifacts(document, name === 'default18' ? 18 : 20);
    variants[name] = result.evidence;
    for (const [relative, bytes] of result.files) {
      const filename = path.posix.join(name, relative);
      await writeArtifact(path.join(output, filename), bytes);
      artifacts[filename] = sha256(bytes);
    }
  }
  const evidence = { schema_version: 1, status: 'passed', kind: 'parametric_modeler_release_controls',
    fixed_metadata_date: FRAME_EXPORT_DATE, node_version: process.version,
    source_hash_definition: 'SHA256 of LF-canonicalized source, tests and build configuration; exported artifact hashes use raw bytes',
    source_files_sha256: sources, artifacts_sha256: artifacts, variants,
    browser_interaction_tested: false, webgl_used: false, paid_provider_calls: false };
  await writeArtifact(path.join(output, 'evidence.json'), json(evidence));
  return evidence;
}

async function main() {
  const args = process.argv.slice(2);
  assertFrame(args.length === 0 || (args.length === 2 && args[0] === '--out' && args[1]),
    'Usage: export:portfolio-frame [--out DIRECTORY]');
  const output = path.resolve(args[1] ?? path.join(ROOT, 'release/artifacts/sample-frame'));
  const evidence = await exportPortfolioFrame(output);
  console.log(JSON.stringify({ status: evidence.status, artifacts: Object.keys(evidence.artifacts_sha256).length, output }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
