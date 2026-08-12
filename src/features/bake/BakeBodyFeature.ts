/**
 * Bake Body Feature - snapshots a body's current geometry into a first-class,
 * fully independent body with NO rebuild dependency on its source.
 *
 * This is the primitive that makes duplicates/copies independent: a baked body
 * survives deletion of its origin and is editable with every tool, because its
 * rebuild emits the stored geometry directly instead of re-reading a source.
 */

import { generateId } from '../../core/id';
import { createModuleLogger } from '../../core/logger';
import { deserializeBody, serializeBody, type Body } from '../../geometry';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';

const log = createModuleLogger('BakeBodyFeature');

export const BAKE_BODY_FEATURE_TYPE = 'bakeBody';

/** JSON shape of a serialized body; round-trips via serializeBody/deserializeBody. */
export type SerializedBodySnapshot = Parameters<typeof deserializeBody>[0];

export interface BakeBodyParams {
  snapshot: SerializedBodySnapshot;
  /** Provenance only — NOT a rebuild dependency (refsIn stays empty). */
  sourceFeatureId?: string;
}

/**
 * Deep-clone a serialized body so the snapshot is immune to later mutation of
 * the source object graph. Vertices/edges/faces/planes are plain JSON data.
 */
function deepCloneSnapshot(snapshot: SerializedBodySnapshot): SerializedBodySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as SerializedBodySnapshot;
}

export function validateBakeBodyParams(params: Partial<BakeBodyParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const snapshot = params.snapshot as Partial<SerializedBodySnapshot> | undefined;
  if (!snapshot) {
    diagnostics.push(error('MISSING_SNAPSHOT', 'Bake body requires a geometry snapshot'));
    return diagnostics;
  }
  if (
    typeof snapshot.id !== 'string'
    || typeof snapshot.name !== 'string'
    || !Array.isArray(snapshot.vertices)
    || !Array.isArray(snapshot.edges)
    || !Array.isArray(snapshot.faces)
    || !Array.isArray(snapshot.planes)
  ) {
    diagnostics.push(error('INVALID_SNAPSHOT', 'Bake body snapshot is malformed'));
  }
  return diagnostics;
}

/**
 * Create a bake-body feature that captures `sourceBody`'s current geometry.
 * The resulting feature has empty refsIn: it does not depend on the source at
 * rebuild time, so editing or deleting the source never affects the baked copy.
 */
export function createBakeBodyFeature(
  sourceBody: Body,
  name?: string,
  sourceFeatureId?: string,
): FeatureRecord {
  const snapshot = deepCloneSnapshot(serializeBody(sourceBody) as SerializedBodySnapshot);
  const params: BakeBodyParams = {
    snapshot,
    ...(sourceFeatureId ? { sourceFeatureId } : {}),
  };

  return {
    id: generateId(),
    type: BAKE_BODY_FEATURE_TYPE,
    name: name ?? `${sourceBody.name} copy`,
    parameters: params as unknown as Record<string, unknown>,
    refsIn: [],
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Rebuild handler for the bake-body feature. Emits the stored geometry as-is —
 * it never reads the source — so the body is independent and stable.
 */
export function rebuildBakeBody(
  feature: FeatureRecord,
  _context: RebuildContext,
): RebuildHandlerResult {
  const params = feature.parameters as unknown as BakeBodyParams;
  const diagnostics = validateBakeBodyParams(params);
  if (diagnostics.length > 0) {
    return { ok: false, error: 'Invalid bake body parameters', diagnostics };
  }

  const body = deserializeBody(params.snapshot);
  // Deterministic, source-independent body id: stable across rebuilds, distinct
  // from the origin body so the two never collide.
  body.id = `${feature.id}:bake`;
  body.name = feature.name;
  log.info('Bake body rebuilt', { featureId: feature.id, bodyId: body.id });
  return { ok: true, bodies: [body], diagnostics: [] };
}

export function getBakeBodyParams(feature: FeatureRecord): BakeBodyParams | null {
  if (feature.type !== BAKE_BODY_FEATURE_TYPE) return null;
  return feature.parameters as unknown as BakeBodyParams;
}
