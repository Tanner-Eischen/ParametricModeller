import { generateId } from '../../core/id';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getAllBodies } from '../RebuildContext';
import {
  type Sketch,
  getProfileByIndex,
} from '../../sketch';
import { getConstructionPlaneFromRef } from '../../geometry/ConstructionPlane';
import { performCut, validateCutOperation, computeThroughCutDepth } from '../../geometry/CutBuilder';
import { cloneBody } from '../../geometry/Body';
import { validateBody } from '../../geometry/Validation';
import type { SketchParams } from '../sketch';
import { createModuleLogger } from '../../core/logger';

const log = createModuleLogger('ExtrudeCutFeature');

/**
 * Reference to a body for cut operations.
 */
export interface BodyRef {
  /** ID of the body to cut */
  bodyId: string;
  /** ID of the feature that created the body */
  featureId: string;
}

/**
 * Parameters for the Extrude Cut feature.
 */
export interface ExtrudeCutParams {
  /** Reference to the target body to cut */
  targetBodyRef: BodyRef;
  /** ID of the sketch feature containing the cut profile */
  sketchId: string;
  /** Index of the profile in the sketch (0 = first profile) */
  profileIndex: number;
  /** Cut mode - distance or through-all */
  mode: 'distance' | 'through';
  /** Cut distance (required when mode is 'distance') */
  distance?: number;
  /** Whether to flip cut direction (opposite to plane normal) */
  flip: boolean;
  /** Cached sketch data for rebuild (same pattern as ExtrudeFeature) */
  sketchData?: SketchParams;
}

/**
 * Default extrude cut parameters.
 */
export const defaultExtrudeCutParams: ExtrudeCutParams = {
  targetBodyRef: {
    bodyId: '',
    featureId: '',
  },
  sketchId: '',
  profileIndex: 0,
  mode: 'distance',
  distance: 0.5,
  flip: false,
};

/**
 * Feature type identifier for extrude cut.
 */
export const EXTRUDE_CUT_FEATURE_TYPE = 'extrudeCut';

/**
 * Validate extrude cut parameters.
 */
export function validateExtrudeCutParams(params: Partial<ExtrudeCutParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Target body validation
  if (!params.targetBodyRef) {
    diagnostics.push(error('MISSING_TARGET_BODY', 'Target body reference is required'));
  } else {
    if (!params.targetBodyRef.bodyId) {
      diagnostics.push(error('MISSING_TARGET_BODY', 'Target body ID is required'));
    }
    if (!params.targetBodyRef.featureId) {
      diagnostics.push(error('MISSING_TARGET_BODY', 'Target body feature ID is required'));
    }
  }

  // Sketch validation
  if (!params.sketchId) {
    diagnostics.push(error('MISSING_SKETCH_ID', 'Sketch ID is required'));
  }

  if (params.profileIndex !== undefined && params.profileIndex < 0) {
    diagnostics.push(error('INVALID_PROFILE_INDEX', 'Profile index must be >= 0'));
  }

  // Mode validation
  if (params.mode && !['distance', 'through'].includes(params.mode)) {
    diagnostics.push(error('UNSUPPORTED_MODE', 'Only distance and through modes are supported'));
  }

  // Distance validation for distance mode
  if (params.mode === 'distance') {
    if (params.distance === undefined || params.distance <= 0) {
      diagnostics.push(error('INVALID_DISTANCE', 'Distance must be greater than 0 for distance mode'));
    }
  }

  return diagnostics;
}

/**
 * Rebuild handler for the extrude cut feature.
 */
export function rebuildExtrudeCut(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params: ExtrudeCutParams = {
    ...defaultExtrudeCutParams,
    ...(feature.parameters as Partial<ExtrudeCutParams>),
  };

  // Validate parameters
  const diagnostics = validateExtrudeCutParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid extrude cut parameters',
      diagnostics,
    };
  }

  // Get the target body
  const allBodies = getAllBodies(context);
  const targetBody = allBodies.find(b => b.id === params.targetBodyRef.bodyId);

  if (!targetBody) {
    return {
      ok: false,
      error: `Target body ${params.targetBodyRef.bodyId} not found`,
      diagnostics: [error('TARGET_BODY_NOT_FOUND', `Target body ${params.targetBodyRef.bodyId} not found`)],
    };
  }

  // Get sketch data from cached params
  if (!params.sketchId) {
    return {
      ok: false,
      error: 'Sketch ID is required',
      diagnostics: [error('MISSING_SKETCH_ID', 'Sketch ID is required')],
    };
  }

  const sketchData = params.sketchData;
  if (!sketchData) {
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
    planeRef: sketchData.planeRef,
    entities: sketchData.entities,
    dimensions: sketchData.dimensions,
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
  const plane = getConstructionPlaneFromRef(sketch.planeRef, allBodies);

  if (!plane) {
    return {
      ok: false,
      error: 'Could not resolve sketch plane',
      diagnostics: [error('PLANE_NOT_FOUND', 'Could not resolve sketch plane reference')],
    };
  }

  // Determine cut distance
  let cutDistance: number;
  if (params.mode === 'through') {
    // For through cuts, compute the depth needed to go through the body
    const throughDepth = computeThroughCutDepth(targetBody, plane, params.flip);
    if (throughDepth === null) {
      return {
        ok: false,
        error: 'No exit face found for through cut',
        diagnostics: [error('NO_EXIT_FACE', 'No exit face found for through cut')],
      };
    }
    cutDistance = throughDepth;
  } else {
    cutDistance = params.distance ?? 0.5;
  }

  // Validate the cut operation
  const cutValidation = validateCutOperation(targetBody, plane, profile, cutDistance, params.flip);
  if (!cutValidation.valid) {
    return {
      ok: false,
      error: cutValidation.error ?? 'Invalid cut operation',
      diagnostics: [error('INVALID_CUT', cutValidation.error ?? 'Invalid cut operation')],
    };
  }

  // Clone the body for modification
  const clonedBody = cloneBody(targetBody);

  // Perform the cut
  const result = performCut(clonedBody, plane, profile, cutDistance, params.flip);

  if (!result) {
    return {
      ok: false,
      error: 'Cut operation failed',
      diagnostics: [error('CUT_FAILED', 'Cut operation failed to produce valid geometry')],
    };
  }

  // Validate the result
  const validationResult = validateBody(result);
  if (!validationResult.ok) {
    return {
      ok: false,
      error: 'Cut produced invalid body',
      diagnostics: validationResult.errors.map(e => error('INVALID_BODY', e.message)),
    };
  }

  log.info('Extrude cut complete', {
    featureId: feature.id,
    targetBodyId: params.targetBodyRef.bodyId,
    mode: params.mode,
    distance: cutDistance,
  });

  return {
    ok: true,
    bodies: [result],
    diagnostics: [],
  };
}

/**
 * Create an extrude cut feature record.
 */
export function createExtrudeCutFeature(
  targetBodyRef: BodyRef,
  sketchFeature: FeatureRecord,
  mode: 'distance' | 'through' = 'distance',
  distance: number | undefined = undefined,
  flip = false,
  name = 'Extrude Cut'
): FeatureRecord {
  // Get sketch data from the feature
  const sketchParams = sketchFeature.parameters as unknown as SketchParams;

  const params: ExtrudeCutParams & { distance?: number } = {
    targetBodyRef,
    sketchId: sketchFeature.id,
    profileIndex: 0,
    mode,
    flip,
    // Store sketch data for rebuild
    sketchData: sketchParams,
  };

  // Only include distance if provided or mode is distance
  if (distance !== undefined) {
    params.distance = distance;
  }

  return {
    id: generateId(),
    type: EXTRUDE_CUT_FEATURE_TYPE,
    name,
    parameters: params as unknown as Record<string, unknown>,
    refsIn: [targetBodyRef.featureId, sketchFeature.id],
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Update extrude cut distance.
 */
export function updateExtrudeCutDistance(
  feature: FeatureRecord,
  distance: number
): FeatureRecord {
  if (feature.type !== EXTRUDE_CUT_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as ExtrudeCutParams;
  return {
    ...feature,
    parameters: {
      ...params,
      distance,
      mode: 'distance',
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Update extrude cut mode.
 */
export function updateExtrudeCutMode(
  feature: FeatureRecord,
  mode: 'distance' | 'through'
): FeatureRecord {
  if (feature.type !== EXTRUDE_CUT_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as ExtrudeCutParams;
  return {
    ...feature,
    parameters: {
      ...params,
      mode,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Update extrude cut flip direction.
 */
export function updateExtrudeCutFlip(
  feature: FeatureRecord,
  flip: boolean
): FeatureRecord {
  if (feature.type !== EXTRUDE_CUT_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as ExtrudeCutParams;
  return {
    ...feature,
    parameters: {
      ...params,
      flip,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Get extrude cut parameters from a feature.
 */
export function getExtrudeCutParams(feature: FeatureRecord): ExtrudeCutParams | null {
  if (feature.type !== EXTRUDE_CUT_FEATURE_TYPE) return null;
  return feature.parameters as unknown as ExtrudeCutParams;
}

/**
 * Create a BodyRef from body and feature IDs.
 */
export function createBodyRef(
  bodyId: string,
  featureId: string
): BodyRef {
  return {
    bodyId,
    featureId,
  };
}
