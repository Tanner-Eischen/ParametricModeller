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

const log = createModuleLogger('LinearPatternFeature');

/**
 * Parameters for the Linear Pattern feature.
 */
export interface LinearPatternParams {
  /** ID of the source feature to pattern */
  sourceFeatureId: string;
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
  const params: LinearPatternParams = {
    ...defaultLinearPatternParams,
    ...(feature.parameters as Partial<LinearPatternParams>),
  };

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
  const sourceBody = getBodyByFeature(context, params.sourceFeatureId);

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
    // For symmetric, create instances on both sides
    // Example: count=3, spacing=1
    //   index -1: offset -1
    //   source (at 0)
    //   index +1: offset +1
    const halfCount = Math.floor(count / 2);
    let instanceIndex = 0;

    for (let i = -halfCount; i <= halfCount; i++) {
      if (i === 0) {
        // Skip the source position (source body itself is not included)
        continue;
      }

      const offset: [number, number, number] = [
        i * spacing * direction[0],
        i * spacing * direction[1],
        i * spacing * direction[2],
      ];

      const instanceId = `${sourceBody.id}_lp_${instanceIndex}`;
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

      const instanceId = `${sourceBody.id}_lp_${i - 1}`;
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
  sourceFeatureId: string,
  count = 3,
  spacing = 1,
  direction: [number, number, number] = [1, 0, 0],
  symmetric = false,
  name = 'Linear Pattern'
): FeatureRecord {
  const params: LinearPatternParams = {
    sourceFeatureId,
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
  return feature.parameters as unknown as LinearPatternParams;
}
