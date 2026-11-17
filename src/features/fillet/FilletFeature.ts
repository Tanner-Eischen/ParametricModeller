/**
 * Persisted fillet feature schema. Curved fillet geometry is unsupported by the
 * planar kernel; retain the handler to report this explicitly on load/rebuild.
 */

import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
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
 * Fail closed instead of reporting an unchanged, duplicated body as a fillet.
 */
export function rebuildFillet(
  feature: FeatureRecord,
  _context: RebuildContext,
): RebuildHandlerResult {
  const message = 'Fillet geometry is unsupported by the planar kernel. Suppress or remove this feature to rebuild.';
  return {
    ok: false,
    error: message,
    diagnostics: [error('UNSUPPORTED_FILLET', message, feature.id)],
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
