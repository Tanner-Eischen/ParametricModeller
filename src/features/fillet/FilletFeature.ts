/**
 * Fillet Feature - Creates constant-radius fillets on convex edges.
 * Per the project constraint (planar/prismatic only), v1 fillets are:
 * - Edge-only (body edges only, not sketch edges)
 * - Constant radius
 * - Inserts new planar faces tangent to the original faces
 */

import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getBodyByFeature } from '../RebuildContext';
import { generateId } from '../../core/id';

/**
 * Feature type identifier for fillet.
 */
export const FILLET_FEATURE_TYPE = 'fillet';

/**
 * Parameters for the fillet feature.
 */
export interface FilletParams {
  /** ID of the source feature (body) to fillet */
  sourceFeatureId: string;
  /** Edge IDs to fillet */
  edgeIds: string[];
  /** Fillet radius */
  radius: number;
}

/**
 * Default fillet parameters.
 */
export const defaultFilletParams: FilletParams = {
  sourceFeatureId: '',
  edgeIds: [],
  radius: 5,
};

/**
 * Validate fillet parameters.
 */
export function validateFilletParams(params: Partial<FilletParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.sourceFeatureId) {
    diagnostics.push(error('MISSING_SOURCE_FEATURE', 'Source feature ID is required'));
  }

  if (!params.edgeIds || params.edgeIds.length === 0) {
    diagnostics.push(error('MISSING_EDGE_IDS', 'At least one edge ID is required'));
  }

  if (params.radius === undefined || params.radius <= 0) {
    diagnostics.push(error('INVALID_RADIUS', 'Radius must be positive'));
  }

  return diagnostics;
}

/**
 * Create a fillet feature.
 */
export function createFilletFeature(params: Partial<FilletParams>): FeatureRecord {
  const { sourceFeatureId } = params;
  const refsIn = sourceFeatureId ? [sourceFeatureId] : [];

  return {
    id: generateId(),
    type: FILLET_FEATURE_TYPE,
    name: 'Fillet',
    parameters: params as unknown as Record<string, unknown>,
    refsIn,
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Rebuild fillet feature.
 * For v1, this is a placeholder that returns the original body unchanged.
 * Real fillet geometry would require:
 * 1. Identifying the edges to fillet
 * 2. Computing offset faces tangent to adjacent faces
 * 3. Creating new planar faces at the fillet radius
 * 4. Updating topology accordingly
 */
export function rebuildFillet(
  feature: FeatureRecord,
  context: RebuildContext,
): RebuildHandlerResult {
  const params = feature.parameters as unknown as FilletParams;
  const { sourceFeatureId, edgeIds, radius } = params;

  // Validate required params
  if (!sourceFeatureId || !edgeIds || edgeIds.length === 0 || radius <= 0) {
    return {
      ok: false,
      error: 'Invalid fillet parameters',
      diagnostics: validateFilletParams(params),
    };
  }

  // Get source body
  const sourceBody = getBodyByFeature(context, sourceFeatureId);
  if (!sourceBody) {
    return {
      ok: false,
      error: `Source feature ${sourceFeatureId} not found`,
      diagnostics: [error('SOURCE_NOT_FOUND', `Source feature ${sourceFeatureId} not found`)],
    };
  }

  // v1: Return the original body unchanged
  // A full implementation would:
  // 1. For each edge to fillet, find adjacent faces
  // 2. Compute the offset distance based on radius and face angle
  // 3. Create new planar faces tangent to the original faces
  // 4. Update edge/vertex topology to close the gaps

  return {
    ok: true,
    bodies: [sourceBody],
    diagnostics: [],
    outputs: [],
  };
}

/**
 * Get dependency IDs for fillet.
 */
export function getFilletDependencyIds(feature: FeatureRecord): string[] {
  const params = feature.parameters as unknown as FilletParams;
  const refs: string[] = [];

  if (params.sourceFeatureId) {
    refs.push(params.sourceFeatureId);
  }

  return refs;
}

/**
 * Validate fillet feature.
 */
export function validateFilletFeature(feature: FeatureRecord): boolean {
  return feature.type === FILLET_FEATURE_TYPE;
}
