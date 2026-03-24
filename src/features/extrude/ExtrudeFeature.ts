import { generateId } from '../../core/id';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getBodiesByFeature } from '../RebuildContext';
import {
  type Sketch,
  getProfileByIndex,
} from '../../sketch';
import { getConstructionPlaneFromRef } from '../../geometry/ConstructionPlane';
import { buildPrism, validatePrismParams } from './PrismBuilder';
import type { SketchParams } from '../sketch';

/**
 * Parameters for the Extrude feature.
 */
export interface ExtrudeParams {
  /** ID of the sketch feature to extrude */
  sketchId: string;
  /** Index of the profile in the sketch (0 = first profile) */
  profileIndex: number;
  /** Extrusion distance */
  distance: number;
  /** Whether to flip extrusion direction (opposite to plane normal) */
  flip: boolean;
  /** Extrude mode - v1 only supports new body */
  mode: 'newBody';
}

/**
 * Default extrude parameters.
 */
export const defaultExtrudeParams: ExtrudeParams = {
  sketchId: '',
  profileIndex: 0,
  distance: 1,
  flip: false,
  mode: 'newBody',
};

/**
 * Feature type identifier for extrude.
 */
export const EXTRUDE_FEATURE_TYPE = 'extrude';

/**
 * Validate extrude parameters.
 */
export function validateExtrudeParams(params: Partial<ExtrudeParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.sketchId) {
    diagnostics.push(error('MISSING_SKETCH_ID', 'Sketch ID is required'));
  }

  if (params.profileIndex !== undefined && params.profileIndex < 0) {
    diagnostics.push(error('INVALID_PROFILE_INDEX', 'Profile index must be >= 0'));
  }

  if (params.distance !== undefined && params.distance <= 0) {
    diagnostics.push(error('INVALID_DISTANCE', 'Distance must be greater than 0'));
  }

  if (params.mode && params.mode !== 'newBody') {
    diagnostics.push(error('UNSUPPORTED_MODE', 'Only newBody mode is supported in v1'));
  }

  return diagnostics;
}

/**
 * Rebuild handler for the extrude feature.
 */
export function rebuildExtrude(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params: ExtrudeParams = {
    ...defaultExtrudeParams,
    ...(feature.parameters as Partial<ExtrudeParams>),
  };

  // Validate parameters
  const diagnostics = validateExtrudeParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid extrude parameters',
      diagnostics,
    };
  }

  // Get all features from context to find the sketch
  // Note: We need to find the sketch feature by ID
  // The rebuild engine should provide access to feature lookup
  // For now, we'll need to store sketch data in the parameters

  // Get sketch data from the feature's refsIn
  if (!params.sketchId) {
    return {
      ok: false,
      error: 'Sketch ID is required',
      diagnostics: [error('MISSING_SKETCH_ID', 'Sketch ID is required')],
    };
  }

  // Get sketch data from the extrude feature's cached sketch data
  // (stored during feature creation or update)
  const sketchData = feature.parameters as unknown as ExtrudeParams & { sketchData?: SketchParams };
  if (!sketchData.sketchData) {
    return {
      ok: false,
      error: 'Sketch data not found',
      diagnostics: [error('SKETCH_NOT_FOUND', `Sketch ${params.sketchId} not found`)],
    };
  }

  // Reconstruct sketch from stored data
  const sketch: Sketch = {
    id: params.sketchId,
    name: 'Sketch',
    planeRef: sketchData.sketchData.planeRef,
    entities: sketchData.sketchData.entities,
    dimensions: sketchData.sketchData.dimensions,
  };

  // Get the profile
  const profile = getProfileByIndex(sketch, params.profileIndex);
  if (!profile) {
    return {
      ok: false,
      error: `Profile index ${params.profileIndex} not found`,
      diagnostics: [error('PROFILE_NOT_FOUND', `Profile ${params.profileIndex} not found in sketch`)],
    };
  }

  // Get construction plane from sketch
  const allBodies = getBodiesByFeature(context, params.sketchId) ?? [];
  const plane = getConstructionPlaneFromRef(sketch.planeRef, allBodies);

  if (!plane) {
    return {
      ok: false,
      error: 'Could not resolve sketch plane',
      diagnostics: [error('PLANE_NOT_FOUND', 'Could not resolve sketch plane reference')],
    };
  }

  // Validate prism params
  const prismErrors = validatePrismParams({ plane, profile, distance: params.distance, flip: params.flip });
  if (prismErrors.length > 0) {
    return {
      ok: false,
      error: prismErrors[0] ?? 'Invalid prism parameters',
      diagnostics: prismErrors.map((msg) => error('INVALID_PRISM', msg)),
    };
  }

  // Build the prism
  const body = buildPrism(
    { plane, profile, distance: params.distance, flip: params.flip },
    `${feature.id}_body`
  );

  return {
    ok: true,
    bodies: [body],
    diagnostics: [],
  };
}

/**
 * Create an extrude feature record.
 */
export function createExtrudeFeature(
  sketchFeature: FeatureRecord,
  profileIndex = 0,
  distance = 1,
  flip = false,
  name = 'Extrude'
): FeatureRecord {
  // Get sketch data from the feature
  const sketchParams = sketchFeature.parameters as unknown as SketchParams;

  const params: ExtrudeParams & { sketchData?: SketchParams } = {
    sketchId: sketchFeature.id,
    profileIndex,
    distance,
    flip,
    mode: 'newBody',
    // Store sketch data for rebuild (avoiding feature lookup in context)
    sketchData: sketchParams,
  };

  return {
    id: generateId(),
    type: EXTRUDE_FEATURE_TYPE,
    name,
    parameters: params as unknown as Record<string, unknown>,
    refsIn: [sketchFeature.id],
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Update extrude distance.
 */
export function updateExtrudeDistance(
  feature: FeatureRecord,
  distance: number
): FeatureRecord {
  if (feature.type !== EXTRUDE_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as ExtrudeParams;
  return {
    ...feature,
    parameters: {
      ...params,
      distance,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Update extrude flip direction.
 */
export function updateExtrudeFlip(
  feature: FeatureRecord,
  flip: boolean
): FeatureRecord {
  if (feature.type !== EXTRUDE_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as ExtrudeParams;
  return {
    ...feature,
    parameters: {
      ...params,
      flip,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Get extrude parameters from a feature.
 */
export function getExtrudeParams(feature: FeatureRecord): ExtrudeParams | null {
  if (feature.type !== EXTRUDE_FEATURE_TYPE) return null;
  return feature.parameters as unknown as ExtrudeParams;
}
