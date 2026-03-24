/**
 * Duplicate Feature - Creates a copy of an existing body with optional offset.
 * Simple duplication for quick copying of geometry.
 */

import { generateId } from '../../core/id';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getBodyByFeature } from '../RebuildContext';
import { translateBody, type Body } from '../../geometry';
import { createModuleLogger } from '../../core/logger';

const log = createModuleLogger('DuplicateFeature');

/**
 * Parameters for the Duplicate feature.
 */
export interface DuplicateParams {
  /** ID of the source feature to duplicate */
  sourceFeatureId: string;
  /** Translation offset for the duplicate */
  translation: [number, number, number];
}

/**
 * Default duplicate parameters.
 */
export const defaultDuplicateParams: DuplicateParams = {
  sourceFeatureId: '',
  translation: [0, 0, 0],
};

/**
 * Feature type identifier for duplicate.
 */
export const DUPLICATE_FEATURE_TYPE = 'duplicate';

/**
 * Validate duplicate parameters.
 */
export function validateDuplicateParams(params: Partial<DuplicateParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.sourceFeatureId) {
    diagnostics.push(error('MISSING_SOURCE_FEATURE', 'Source feature ID is required'));
  }

  if (!params.translation || params.translation.length !== 3) {
    diagnostics.push(error('INVALID_TRANSLATION', 'Translation must be [x, y, z]'));
  }

  return diagnostics;
}

/**
 * Rebuild handler for the duplicate feature.
 */
export function rebuildDuplicate(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params: DuplicateParams = {
    ...defaultDuplicateParams,
    ...(feature.parameters as Partial<DuplicateParams>),
  };

  // Validate parameters
  const diagnostics = validateDuplicateParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid duplicate parameters',
      diagnostics,
    };
  }

  // Get the source body
  const sourceBody = getBodyByFeature(context, params.sourceFeatureId);

  if (!sourceBody) {
    return {
      ok: false,
      error: `Source feature ${params.sourceFeatureId} not found or has no bodies`,
      diagnostics: [error('SOURCE_NOT_FOUND', `Source feature ${params.sourceFeatureId} not found`)],
    };
  }

  // Create translated copy
  const [tx, ty, tz] = params.translation;
  const instanceId = `${sourceBody.id}_dup`;
  const duplicatedBody = translateBody(sourceBody, [tx, ty, tz], instanceId);
  duplicatedBody.name = `${sourceBody.name} (copy)`;

  log.info('Duplicate complete', {
    featureId: feature.id,
    sourceFeatureId: params.sourceFeatureId,
    translation: params.translation,
  });

  return {
    ok: true,
    bodies: [duplicatedBody],
    diagnostics: [],
  };
}

/**
 * Create a duplicate feature record.
 */
export function createDuplicateFeature(
  sourceFeatureId: string,
  translation: [number, number, number] = [0, 0, 0],
  name = 'Duplicate'
): FeatureRecord {
  const params: DuplicateParams = {
    sourceFeatureId,
    translation,
  };

  return {
    id: generateId(),
    type: DUPLICATE_FEATURE_TYPE,
    name,
    parameters: params as unknown as Record<string, unknown>,
    refsIn: [sourceFeatureId],
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Update duplicate translation.
 */
export function updateDuplicateTranslation(
  feature: FeatureRecord,
  translation: [number, number, number]
): FeatureRecord {
  if (feature.type !== DUPLICATE_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as DuplicateParams;
  return {
    ...feature,
    parameters: {
      ...params,
      translation,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Get duplicate parameters from a feature.
 */
export function getDuplicateParams(feature: FeatureRecord): DuplicateParams | null {
  if (feature.type !== DUPLICATE_FEATURE_TYPE) return null;
  return feature.parameters as unknown as DuplicateParams;
}
