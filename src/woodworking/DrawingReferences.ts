import type {
  DrawingDimension,
  DrawingReference,
  ShopDrawingDefinition,
} from '../types';
import type { OrthographicView } from './Orthographic';
import {
  evaluateMeasurement,
  validateMeasurementReference,
  type MeasurementEvaluationContext,
  type MeasurementReference,
  type MeasurementReferenceKind,
  type MeasurementResult,
} from './MeasurementToolSession';

export const PINNED_MEASUREMENT_SOURCE = 'pinned-measurement' as const;

/** Persisted extension that remains structurally compatible with DrawingDimension. */
export interface PinnedMeasurementDimension extends DrawingDimension {
  source: typeof PINNED_MEASUREMENT_SOURCE;
  measurement: MeasurementResult;
}

export interface PinMeasurementOptions {
  dimensionId: string;
  view: OrthographicView;
  position: readonly [number, number];
  prefix?: string;
  suffix?: string;
}

export type DrawingReferenceIssueAction =
  | {
      kind: 'repair';
      label: 'Repair';
      expectedReferenceKind: MeasurementReferenceKind;
      referenceIndex: number;
    }
  | { kind: 'repair-feature'; label: 'Repair'; featureId: string }
  | { kind: 'delete-dimension'; label: 'Delete'; dimensionId: string }
  | { kind: 'delete-note'; label: 'Delete'; noteId: string };

export interface DrawingReferenceIssue {
  id: string;
  code: 'BROKEN_DIMENSION_REFERENCE' | 'BROKEN_NOTE_REFERENCE';
  target: { kind: 'dimension' | 'note'; id: string };
  message: string;
  blocking: true;
  actions: DrawingReferenceIssueAction[];
}

export interface DrawingReferenceValidationOptions extends MeasurementEvaluationContext {
  featureIds?: ReadonlySet<string>;
}

export type DrawingReferenceRepairRequest =
  | {
      target: 'dimension';
      dimensionId: string;
      referenceIndex: number;
      replacement: MeasurementReference;
    }
  | {
      target: 'note';
      noteId: string;
      replacementFeatureId: string;
    };

export type DrawingReferenceRepairResult =
  | { ok: true; definition: ShopDrawingDefinition }
  | { ok: false; message: string };

/** Pin a completed exact measurement without mutating the drawing definition. */
export function pinMeasurementIntoDrawing(
  definition: ShopDrawingDefinition,
  measurement: MeasurementResult,
  options: PinMeasurementOptions
): ShopDrawingDefinition {
  if (definition.dimensions.some((dimension) => dimension.id === options.dimensionId)) {
    throw new Error(`Drawing dimension id must be unique: ${options.dimensionId}`);
  }
  if (!definition.views.includes(options.view)) {
    throw new Error(`Drawing view is not enabled: ${options.view}`);
  }
  if (!Number.isFinite(options.position[0]) || !Number.isFinite(options.position[1])) {
    throw new Error('Pinned measurement position must contain two finite values');
  }
  const pinned: PinnedMeasurementDimension = {
    id: options.dimensionId,
    kind: measurement.kind === 'edgeAngle' || measurement.kind === 'faceAngle'
      ? 'angular'
      : 'linear',
    references: measurement.references.flatMap(toDrawingReference),
    view: options.view,
    position: [...options.position],
    ...(options.prefix ? { prefix: options.prefix } : {}),
    ...(options.suffix ? { suffix: options.suffix } : {}),
    source: PINNED_MEASUREMENT_SOURCE,
    measurement: cloneMeasurement(measurement),
  };
  return cloneDefinition(definition, [...definition.dimensions, pinned]);
}

export function isPinnedMeasurementDimension(
  dimension: DrawingDimension
): dimension is PinnedMeasurementDimension {
  const candidate = dimension as Partial<PinnedMeasurementDimension>;
  return candidate.source === PINNED_MEASUREMENT_SOURCE
    && typeof candidate.measurement === 'object'
    && candidate.measurement !== null;
}

/**
 * Resolve every persisted reference by exact ID. Broken references are not
 * similarity-matched; callers receive explicit Repair/Delete actions instead.
 */
export function validateDrawingReferences(
  definition: ShopDrawingDefinition,
  options: DrawingReferenceValidationOptions
): DrawingReferenceIssue[] {
  const issues: DrawingReferenceIssue[] = [];
  for (const dimension of [...definition.dimensions].sort((left, right) =>
    compareText(left.id, right.id)
  )) {
    if (isPinnedMeasurementDimension(dimension)) {
      const result = evaluateMeasurement(
        dimension.measurement.id,
        dimension.measurement.kind,
        dimension.measurement.references,
        options
      );
      if (!result.ok) {
        const diagnostic = result.diagnostics[0]!;
        const referenceIndex = diagnostic.referenceIndex ?? firstBrokenReferenceIndex(
          dimension.measurement.references,
          options
        );
        const reference = dimension.measurement.references[referenceIndex];
        issues.push(dimensionIssue(
          dimension.id,
          referenceIndex,
          reference?.kind ?? expectedPinnedKind(dimension, referenceIndex),
          diagnostic.message
        ));
      }
      continue;
    }
    for (let index = 0; index < dimension.references.length; index++) {
      const reference = dimension.references[index]!;
      if (!drawingReferenceExists(reference, options)) {
        issues.push(dimensionIssue(
          dimension.id,
          index,
          reference.kind,
          `Drawing reference ${index + 1} no longer resolves to its exact ${reference.kind}.`
        ));
      }
    }
  }

  if (options.featureIds) {
    for (const note of [...definition.notes].sort((left, right) => compareText(left.id, right.id))) {
      if (note.featureId && !options.featureIds.has(note.featureId)) {
        issues.push({
          id: `note:${note.id}:feature`,
          code: 'BROKEN_NOTE_REFERENCE',
          target: { kind: 'note', id: note.id },
          message: 'The manufacturing callout feature no longer exists.',
          blocking: true,
          actions: [
            { kind: 'repair-feature', label: 'Repair', featureId: note.featureId },
            { kind: 'delete-note', label: 'Delete', noteId: note.id },
          ],
        });
      }
    }
  }
  return issues.sort((left, right) => compareText(left.id, right.id));
}

export function canExportDrawingDefinition(
  definition: ShopDrawingDefinition,
  options: DrawingReferenceValidationOptions
): { allowed: boolean; issues: DrawingReferenceIssue[] } {
  const issues = validateDrawingReferences(definition, options);
  return { allowed: issues.length === 0, issues };
}

export function assertDrawingReferencesExportable(
  definition: ShopDrawingDefinition,
  options: DrawingReferenceValidationOptions
): void {
  const issues = validateDrawingReferences(definition, options);
  if (issues.length > 0) {
    throw new Error(`Drawing export blocked: ${issues[0]!.message} Use Repair or Delete.`);
  }
}

/** Apply only the explicitly supplied typed replacement. */
export function repairDrawingReference(
  definition: ShopDrawingDefinition,
  request: DrawingReferenceRepairRequest,
  options: DrawingReferenceValidationOptions
): DrawingReferenceRepairResult {
  if (request.target === 'note') {
    const note = definition.notes.find((candidate) => candidate.id === request.noteId);
    if (!note) return { ok: false, message: `Drawing note was not found: ${request.noteId}` };
    if (!options.featureIds?.has(request.replacementFeatureId)) {
      return { ok: false, message: 'Choose an existing feature for the callout.' };
    }
    return {
      ok: true,
      definition: {
        ...cloneDefinition(definition),
        notes: definition.notes.map((candidate) => candidate.id === request.noteId
          ? { ...candidate, featureId: request.replacementFeatureId, position: [...candidate.position] }
          : { ...candidate, position: [...candidate.position] }),
      },
    };
  }

  const dimension = definition.dimensions.find((candidate) => candidate.id === request.dimensionId);
  if (!dimension) return { ok: false, message: `Drawing dimension was not found: ${request.dimensionId}` };
  const referenceDiagnostic = validateMeasurementReference(request.replacement, options);
  if (referenceDiagnostic) return { ok: false, message: referenceDiagnostic.message };

  const dimensions = definition.dimensions.map((candidate): DrawingDimension => {
    if (candidate.id !== request.dimensionId) return cloneDimension(candidate);
    if (isPinnedMeasurementDimension(candidate)) {
      const existing = candidate.measurement.references[request.referenceIndex];
      if (!existing) return candidate;
      if (existing.kind !== request.replacement.kind) return candidate;
      const references = candidate.measurement.references.map((reference, index) =>
        index === request.referenceIndex ? { ...request.replacement } : { ...reference }
      );
      return {
        ...cloneDimension(candidate),
        source: PINNED_MEASUREMENT_SOURCE,
        measurement: { ...cloneMeasurement(candidate.measurement), references },
        references: references.flatMap(toDrawingReference),
      } as PinnedMeasurementDimension;
    }
    const existing = candidate.references[request.referenceIndex];
    if (!existing || existing.kind !== request.replacement.kind) {
      return candidate;
    }
    return {
      ...cloneDimension(candidate),
      references: candidate.references.map((reference, index) => index === request.referenceIndex
        ? toDrawingReference(request.replacement)[0]!
        : { ...reference }),
    };
  });

  const repaired = dimensions.find((candidate) => candidate.id === request.dimensionId)!;
  const replacementApplied = isPinnedMeasurementDimension(repaired)
    ? referenceEquals(
        repaired.measurement.references[request.referenceIndex],
        request.replacement
      )
    : request.replacement.kind !== 'body'
      && drawingReferenceEquals(
        repaired.references[request.referenceIndex],
        toDrawingReference(request.replacement)[0]
      );
  if (!replacementApplied) {
    return { ok: false, message: 'Replacement type must match the broken drawing reference.' };
  }
  const repairedDefinition = refreshPinnedDrawingMeasurements(
    cloneDefinition(definition, dimensions),
    options
  );
  const remainingIssue = validateDrawingReferences(repairedDefinition, options)
    .find((issue) => issue.target.kind === 'dimension' && issue.target.id === request.dimensionId);
  return remainingIssue
    ? { ok: false, message: remainingIssue.message }
    : { ok: true, definition: repairedDefinition };
}

export function deleteDrawingReferenceTarget(
  definition: ShopDrawingDefinition,
  target: { kind: 'dimension' | 'note'; id: string }
): ShopDrawingDefinition {
  return {
    ...cloneDefinition(definition),
    dimensions: target.kind === 'dimension'
      ? definition.dimensions.filter((dimension) => dimension.id !== target.id).map(cloneDimension)
      : definition.dimensions.map(cloneDimension),
    notes: target.kind === 'note'
      ? definition.notes.filter((note) => note.id !== target.id)
        .map((note) => ({ ...note, position: [...note.position] }))
      : definition.notes.map((note) => ({ ...note, position: [...note.position] })),
  };
}

/** Recompute all healthy pinned values after a rebuild, leaving broken pins untouched. */
export function refreshPinnedDrawingMeasurements(
  definition: ShopDrawingDefinition,
  options: DrawingReferenceValidationOptions
): ShopDrawingDefinition {
  const dimensions = definition.dimensions.map((dimension): DrawingDimension => {
    if (!isPinnedMeasurementDimension(dimension)) return cloneDimension(dimension);
    const refreshed = evaluateMeasurement(
      dimension.measurement.id,
      dimension.measurement.kind,
      dimension.measurement.references,
      options
    );
    return refreshed.ok
      ? ({
          ...cloneDimension(dimension),
          source: PINNED_MEASUREMENT_SOURCE,
          measurement: refreshed.result,
        } as PinnedMeasurementDimension)
      : cloneDimension(dimension);
  });
  return cloneDefinition(definition, dimensions);
}

function dimensionIssue(
  dimensionId: string,
  referenceIndex: number,
  expectedReferenceKind: MeasurementReferenceKind,
  message: string
): DrawingReferenceIssue {
  return {
    id: `dimension:${dimensionId}:reference:${referenceIndex}`,
    code: 'BROKEN_DIMENSION_REFERENCE',
    target: { kind: 'dimension', id: dimensionId },
    message,
    blocking: true,
    actions: [
      { kind: 'repair', label: 'Repair', expectedReferenceKind, referenceIndex },
      { kind: 'delete-dimension', label: 'Delete', dimensionId },
    ],
  };
}

function firstBrokenReferenceIndex(
  references: readonly MeasurementReference[],
  options: DrawingReferenceValidationOptions
): number {
  const index = references.findIndex((reference) =>
    validateMeasurementReference(reference, options) !== null
  );
  return index < 0 ? 0 : index;
}

function expectedPinnedKind(
  dimension: PinnedMeasurementDimension,
  index: number
): MeasurementReferenceKind {
  return dimension.measurement.references[index]?.kind ?? 'body';
}

function drawingReferenceExists(
  reference: DrawingReference,
  options: DrawingReferenceValidationOptions
): boolean {
  const body = Array.isArray(options.bodies)
    ? (options.bodies as readonly import('../geometry/Body').Body[])
      .find((candidate) => candidate.id === reference.bodyId)
    : (options.bodies as ReadonlyMap<string, import('../geometry/Body').Body>)
      .get(reference.bodyId);
  if (!body) return false;
  if (reference.kind === 'vertex') return body.vertices.has(reference.topologyId);
  if (reference.kind === 'edge') return body.edges.has(reference.topologyId);
  return body.faces.has(reference.topologyId);
}

function toDrawingReference(reference: MeasurementReference): DrawingReference[] {
  if (reference.kind === 'body') return [];
  return [{
    bodyId: reference.bodyId,
    topologyId: reference.kind === 'vertex'
      ? reference.vertexId
      : reference.kind === 'edge'
        ? reference.edgeId
        : reference.faceId,
    kind: reference.kind,
  }];
}

function cloneDefinition(
  definition: ShopDrawingDefinition,
  dimensions = definition.dimensions.map(cloneDimension)
): ShopDrawingDefinition {
  return {
    ...definition,
    scope: definition.scope.type === 'bodies'
      ? { type: 'bodies', bodyIds: [...definition.scope.bodyIds] }
      : { ...definition.scope },
    views: [...definition.views],
    sheet: { ...definition.sheet },
    dimensions,
    notes: definition.notes.map((note) => ({ ...note, position: [...note.position] })),
  };
}

function cloneDimension(dimension: DrawingDimension): DrawingDimension {
  const clone: DrawingDimension = {
    ...dimension,
    position: [...dimension.position],
    references: dimension.references.map((reference) => ({ ...reference })),
  };
  if (isPinnedMeasurementDimension(dimension)) {
    return {
      ...clone,
      source: PINNED_MEASUREMENT_SOURCE,
      measurement: cloneMeasurement(dimension.measurement),
    } as PinnedMeasurementDimension;
  }
  return clone;
}

function cloneMeasurement(measurement: MeasurementResult): MeasurementResult {
  return {
    ...measurement,
    references: measurement.references.map((reference) => ({ ...reference })),
    ...(measurement.kind === 'vertexToVertex'
      ? { delta: [...measurement.delta] as [number, number, number] }
      : {}),
  } as MeasurementResult;
}

function referenceEquals(
  left: MeasurementReference | undefined,
  right: MeasurementReference
): boolean {
  if (!left || left.kind !== right.kind || left.featureId !== right.featureId
    || left.bodyId !== right.bodyId) return false;
  if (left.kind === 'body') return true;
  if (left.kind === 'vertex' && right.kind === 'vertex') return left.vertexId === right.vertexId;
  if (left.kind === 'edge' && right.kind === 'edge') return left.edgeId === right.edgeId;
  return left.kind === 'face' && right.kind === 'face' && left.faceId === right.faceId;
}

function drawingReferenceEquals(
  left: DrawingReference | undefined,
  right: DrawingReference | undefined
): boolean {
  return Boolean(left && right && left.kind === right.kind
    && left.bodyId === right.bodyId && left.topologyId === right.topologyId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
