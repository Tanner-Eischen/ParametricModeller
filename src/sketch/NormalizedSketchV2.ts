import {
  cloneNormalizedSketch,
  normalizeSketchEntities,
  validateNormalizedSketch,
  type NormalizedSketchGeometry,
  type NormalizedSketchIssue,
} from './NormalizedSketch';
import type {
  DrivingDistanceDimension,
  SketchConstraint,
  SketchRelation,
} from './SketchConstraints';
import {
  materializePersistentSketchInferenceRelation,
  type PersistentSketchInferenceInput,
} from './SketchInference';
import type { SketchEntity } from './SketchTypes';

export const NORMALIZED_SKETCH_DATA_SCHEMA_VERSION = 2 as const;

/**
 * Additive persistence envelope for professional sketch data.
 *
 * Geometry remains in the v1-compatible shared-point shape so existing
 * consumers can migrate independently. The envelope makes solver inputs and
 * committed inference intent explicit and serializable.
 */
export interface NormalizedSketchDataV2 {
  schemaVersion: typeof NORMALIZED_SKETCH_DATA_SCHEMA_VERSION;
  geometry: NormalizedSketchGeometry;
  relations: SketchConstraint[];
  drivingDimensions: DrivingDistanceDimension[];
  inferenceInputs: PersistentSketchInferenceInput[];
}

export interface NormalizedSketchDataMigrationInput {
  geometry?: NormalizedSketchGeometry;
  entities?: readonly SketchEntity[];
  relations?: readonly SketchConstraint[];
  drivingDimensions?: readonly DrivingDistanceDimension[];
  inferenceInputs?: readonly PersistentSketchInferenceInput[];
}

export type NormalizedSketchDataV2Issue =
  | NormalizedSketchIssue
  | {
      code: 'DUPLICATE_PERSISTENT_ID';
      message: string;
      entityIds: string[];
    }
  | {
      code: 'INVALID_INFERENCE_INPUT';
      message: string;
      entityIds: string[];
    };

/** Deterministically migrate either legacy entities or existing shared geometry. */
export function migrateNormalizedSketchDataToV2(
  input: NormalizedSketchDataMigrationInput
): NormalizedSketchDataV2 {
  const geometry = input.geometry
    ? cloneNormalizedSketch(input.geometry)
    : normalizeSketchEntities(input.entities ?? []);

  return {
    schemaVersion: NORMALIZED_SKETCH_DATA_SCHEMA_VERSION,
    geometry,
    relations: [...(input.relations ?? [])].map(cloneConstraint).sort(compareById),
    drivingDimensions: [...(input.drivingDimensions ?? [])]
      .map((dimension) => ({ ...dimension }))
      .sort(compareById),
    inferenceInputs: [...(input.inferenceInputs ?? [])]
      .map(cloneInferenceInput)
      .sort(compareById),
  };
}

export function cloneNormalizedSketchDataV2(
  data: NormalizedSketchDataV2
): NormalizedSketchDataV2 {
  return migrateNormalizedSketchDataToV2(data);
}

/**
 * Solver-ready relations, including committed inference relations.
 *
 * Duplicate IDs are retained here so validation can fail closed instead of
 * silently choosing one relation.
 */
export function getNormalizedSketchRelationsV2(
  data: NormalizedSketchDataV2
): SketchRelation[] {
  return [
    ...data.relations.map(cloneConstraint),
    ...data.drivingDimensions.map((dimension) => ({ ...dimension })),
    ...data.inferenceInputs.map(materializePersistentSketchInferenceRelation),
  ].sort(compareById);
}

export function validateNormalizedSketchDataV2(
  data: NormalizedSketchDataV2
): NormalizedSketchDataV2Issue[] {
  const issues: NormalizedSketchDataV2Issue[] = [
    ...validateNormalizedSketch(data.geometry),
  ];
  const persistentRecords: Array<{ id: string }> = [
    ...data.relations,
    ...data.drivingDimensions,
    ...data.inferenceInputs,
  ];
  const ids = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const record of persistentRecords) {
    if (ids.has(record.id)) duplicateIds.add(record.id);
    ids.add(record.id);
  }
  for (const id of [...duplicateIds].sort()) {
    issues.push({
      code: 'DUPLICATE_PERSISTENT_ID',
      message: 'Sketch relation, dimension, and inference IDs must be unique.',
      entityIds: [id],
    });
  }

  const pointIds = new Set(data.geometry.points.map((point) => point.id));
  const segmentIds = new Set(data.geometry.segments.map((segment) => segment.id));
  for (const input of data.inferenceInputs) {
    const missingIds = input.type === 'coincident'
      ? [input.pointId, input.targetPointId].filter((id) => !pointIds.has(id))
      : [input.segmentId].filter((id) => !segmentIds.has(id));
    if (missingIds.length === 0) continue;
    issues.push({
      code: 'INVALID_INFERENCE_INPUT',
      message: 'A persisted inference references sketch topology that no longer exists.',
      entityIds: [input.id, ...missingIds].sort(),
    });
  }

  return issues.sort(
    (left, right) =>
      left.code.localeCompare(right.code)
      || left.entityIds.join('|').localeCompare(right.entityIds.join('|'))
  );
}

function cloneConstraint(relation: SketchConstraint): SketchConstraint {
  return relation.type === 'fixed'
    ? { ...relation, position: [...relation.position] }
    : { ...relation };
}

function cloneInferenceInput(
  input: PersistentSketchInferenceInput
): PersistentSketchInferenceInput {
  return { ...input };
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
