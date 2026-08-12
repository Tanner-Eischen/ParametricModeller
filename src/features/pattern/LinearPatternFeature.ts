/**
 * Linear Pattern Feature - Creates multiple translated copies of source geometry.
 * Milestone 05: Patterning
 */

import { generateId } from '../../core/id';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getBodyByFeature } from '../RebuildContext';
import { translateBody, type Body } from '../../geometry';
import { createModuleLogger } from '../../core/logger';
import type { BodyRef } from '../../geometry/SubObjectTypes';

const log = createModuleLogger('LinearPatternFeature');

/**
 * Parameters for the Linear Pattern feature.
 */
export interface LinearPatternParams {
  /** ID of the source feature to pattern */
  sourceFeatureId: string;
  /** Exact source body. Optional only for legacy documents. */
  sourceBodyRef?: BodyRef;
  /** Number of instances to create (including original) */
  count: number;
  /** Spacing between instances */
  spacing: number;
  /** Direction vector (unit vector) */
  direction: [number, number, number];
  /** Whether to pattern symmetrically around the source */
  symmetric: boolean;
}

/**
 * Default linear pattern parameters.
 */
export const defaultLinearPatternParams: LinearPatternParams = {
  sourceFeatureId: '',
  count: 3,
  spacing: 1,
  direction: [1, 0, 0],
  symmetric: false,
};

/**
 * Feature type identifier for linear pattern.
 */
export const LINEAR_PATTERN_FEATURE_TYPE = 'linearPattern';

/**
 * Validate linear pattern parameters.
 */
export function validateLinearPatternParams(params: Partial<LinearPatternParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.sourceFeatureId) {
    diagnostics.push(error('MISSING_SOURCE_FEATURE', 'Source feature ID is required'));
  }

  if (params.count === undefined || params.count < 2) {
    diagnostics.push(error('INVALID_COUNT', 'Count must be >= 2'));
  }

  if (params.spacing === undefined || params.spacing <= 0) {
    diagnostics.push(error('INVALID_SPACING', 'Spacing must be > 0'));
  }

  if (params.direction) {
    const [dx, dy, dz] = params.direction;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-6) {
      diagnostics.push(error('INVALID_DIRECTION', 'Direction vector must be non-zero'));
    }
  } else {
    diagnostics.push(error('INVALID_DIRECTION', 'Direction vector is required'));
  }

  if (params.sourceBodyRef && (
    !params.sourceBodyRef.featureId
    || !params.sourceBodyRef.bodyId
    || params.sourceBodyRef.featureId !== params.sourceFeatureId
  )) {
    diagnostics.push(error(
      'INVALID_SOURCE_REF',
      'Source body reference must contain the same feature ID and a body ID'
    ));
  }

  return diagnostics;
}

/**
 * Normalize a direction vector to unit length.
 */
function normalizeDirection(dir: [number, number, number]): [number, number, number] {
  const [dx, dy, dz] = dir;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-6) {
    return [1, 0, 0]; // Default to X axis
  }
  return [dx / length, dy / length, dz / length];
}

/**
 * Rebuild handler for the linear pattern feature.
 */
export function rebuildLinearPattern(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params = migrateLinearPatternParams(feature.parameters as Partial<LinearPatternParams>);

  // Validate parameters
  const diagnostics = validateLinearPatternParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid linear pattern parameters',
      diagnostics,
    };
  }

  // Get the source body
  const sourceBody = params.sourceBodyRef
    ? context.bodiesByFeature
      .get(params.sourceBodyRef.featureId)
      ?.find((body) => body.id === params.sourceBodyRef!.bodyId)
    : getBodyByFeature(context, params.sourceFeatureId);

  if (!sourceBody) {
    return {
      ok: false,
      error: `Source feature ${params.sourceFeatureId} not found or has no bodies`,
      diagnostics: [error('SOURCE_NOT_FOUND', `Source feature ${params.sourceFeatureId} not found`)],
    };
  }

  // Normalize direction
  const direction = normalizeDirection(params.direction);

  // Create instances
  const bodies: Body[] = [];
  const count = params.count;
  const spacing = params.spacing;

  // Calculate offsets based on symmetric flag
  // If symmetric, we create instances on both sides of the source
  // If not symmetric, we create instances in one direction only

  if (params.symmetric) {
    // Count includes the source. Odd counts are perfectly balanced; even
    // counts place the one extra occurrence on the positive side.
    const copyCount = count - 1;
    const negativeCount = Math.floor(copyCount / 2);
    const positiveCount = copyCount - negativeCount;
    let instanceIndex = 0;

    const positions = [
      ...Array.from({ length: negativeCount }, (_, index) => index - negativeCount),
      ...Array.from({ length: positiveCount }, (_, index) => index + 1),
    ];
    for (const i of positions) {

      const offset: [number, number, number] = [
        i * spacing * direction[0],
        i * spacing * direction[1],
        i * spacing * direction[2],
      ];

      const instanceId = `${sourceBody.id}_${feature.id}_lp_${instanceIndex}`;
      const instance = translateBody(sourceBody, offset, instanceId);
      instance.name = `${sourceBody.name}_lp_${instanceIndex}`;
      bodies.push(instance);
      instanceIndex++;
    }
  } else {
    // Non-symmetric: create instances in positive direction only
    for (let i = 1; i < count; i++) {
      const offset: [number, number, number] = [
        i * spacing * direction[0],
        i * spacing * direction[1],
        i * spacing * direction[2],
      ];

      const instanceId = `${sourceBody.id}_${feature.id}_lp_${i - 1}`;
      const instance = translateBody(sourceBody, offset, instanceId);
      instance.name = `${sourceBody.name}_lp_${i - 1}`;
      bodies.push(instance);
    }
  }

  log.info('Linear pattern complete', {
    featureId: feature.id,
    sourceFeatureId: params.sourceFeatureId,
    instanceCount: bodies.length,
    spacing,
    direction,
  });

  return {
    ok: true,
    bodies,
    diagnostics: [],
  };
}

/**
 * Create a linear pattern feature record.
 */
export function createLinearPatternFeature(
  source: string | BodyRef,
  count = 3,
  spacing = 1,
  direction: [number, number, number] = [1, 0, 0],
  symmetric = false,
  name = 'Linear Pattern'
): FeatureRecord {
  const sourceFeatureId = typeof source === 'string' ? source : source.featureId;
  const params: LinearPatternParams = {
    sourceFeatureId,
    ...(typeof source === 'string' ? {} : { sourceBodyRef: { ...source } }),
    count,
    spacing,
    direction: normalizeDirection(direction),
    symmetric,
  };

  return {
    id: generateId(),
    type: LINEAR_PATTERN_FEATURE_TYPE,
    name,
    parameters: params as unknown as Record<string, unknown>,
    refsIn: [sourceFeatureId],
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Update linear pattern count.
 */
export function updateLinearPatternCount(
  feature: FeatureRecord,
  count: number
): FeatureRecord {
  if (feature.type !== LINEAR_PATTERN_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as LinearPatternParams;
  return {
    ...feature,
    parameters: {
      ...params,
      count,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Update linear pattern spacing.
 */
export function updateLinearPatternSpacing(
  feature: FeatureRecord,
  spacing: number
): FeatureRecord {
  if (feature.type !== LINEAR_PATTERN_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as LinearPatternParams;
  return {
    ...feature,
    parameters: {
      ...params,
      spacing,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Update linear pattern direction.
 */
export function updateLinearPatternDirection(
  feature: FeatureRecord,
  direction: [number, number, number]
): FeatureRecord {
  if (feature.type !== LINEAR_PATTERN_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as LinearPatternParams;
  return {
    ...feature,
    parameters: {
      ...params,
      direction: normalizeDirection(direction),
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Update linear pattern symmetric flag.
 */
export function updateLinearPatternSymmetric(
  feature: FeatureRecord,
  symmetric: boolean
): FeatureRecord {
  if (feature.type !== LINEAR_PATTERN_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as LinearPatternParams;
  return {
    ...feature,
    parameters: {
      ...params,
      symmetric,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Get linear pattern parameters from a feature.
 */
export function getLinearPatternParams(feature: FeatureRecord): LinearPatternParams | null {
  if (feature.type !== LINEAR_PATTERN_FEATURE_TYPE) return null;
  return migrateLinearPatternParams(feature.parameters as Partial<LinearPatternParams>);
}

/** Preserve legacy sourceFeatureId-only documents while preferring exact body refs. */
export function migrateLinearPatternParams(
  params: Partial<LinearPatternParams>
): LinearPatternParams {
  const sourceFeatureId = params.sourceBodyRef?.featureId
    ?? params.sourceFeatureId
    ?? defaultLinearPatternParams.sourceFeatureId;
  return {
    sourceFeatureId,
    ...(params.sourceBodyRef ? { sourceBodyRef: { ...params.sourceBodyRef } } : {}),
    count: params.count ?? defaultLinearPatternParams.count,
    spacing: params.spacing ?? defaultLinearPatternParams.spacing,
    direction: params.direction
      ? [...params.direction] as [number, number, number]
      : [...defaultLinearPatternParams.direction],
    symmetric: params.symmetric ?? defaultLinearPatternParams.symmetric,
  };
}
