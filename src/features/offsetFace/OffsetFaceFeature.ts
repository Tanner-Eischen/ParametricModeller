import { generateId } from '../../core/id';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getAllBodies } from '../RebuildContext';
import { offsetFace, validateOffsetFace } from '../../geometry/FaceOffset';
import { validateBody } from '../../geometry/Validation';
import { DEFAULT_TOLERANCE_POLICY } from '../../geometry/TolerancePolicy';
import { createModuleLogger } from '../../core/logger';

const log = createModuleLogger('OffsetFaceFeature');

/**
 * Reference to a face for offset operations.
 * Similar to PlaneRef but specifically for face selection.
 */
export interface FaceRef {
  /** Face ID to offset */
  faceId: string;
  /** Body ID containing the face */
  bodyId: string;
  /** Feature ID that created the body */
  featureId: string;
}

/**
 * Parameters for the OffsetFace feature.
 */
export interface OffsetFaceParams {
  /** Reference to the target face */
  faceRef: FaceRef;
  /** Signed offset distance (positive = outward, negative = inward) */
  distance: number;
  /** Legacy persistence value; the distance sign determines direction. */
  mode: 'addMaterial';
}

/**
 * Default offset face parameters.
 */
export const defaultOffsetFaceParams: OffsetFaceParams = {
  faceRef: {
    faceId: '',
    bodyId: '',
    featureId: '',
  },
  distance: 0.5,
  mode: 'addMaterial',
};

/**
 * Feature type identifier for offset face.
 */
export const OFFSET_FACE_FEATURE_TYPE = 'offsetFace';

/**
 * Validate offset face parameters.
 */
export function validateOffsetFaceParams(params: Partial<OffsetFaceParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.faceRef) {
    diagnostics.push(error('MISSING_FACE_REF', 'Face reference is required'));
  } else {
    if (!params.faceRef.faceId) {
      diagnostics.push(error('MISSING_FACE_ID', 'Face ID is required'));
    }
    if (!params.faceRef.bodyId) {
      diagnostics.push(error('MISSING_BODY_ID', 'Body ID is required'));
    }
    if (!params.faceRef.featureId) {
      diagnostics.push(error('MISSING_FEATURE_ID', 'Feature ID is required'));
    }
  }

  if (params.distance !== undefined) {
    if (!Number.isFinite(params.distance) || Math.abs(params.distance) <= DEFAULT_TOLERANCE_POLICY.linear) {
      diagnostics.push(error('INVALID_DISTANCE', 'Distance must be a finite, non-zero value'));
    }
  }

  if (params.mode && params.mode !== 'addMaterial') {
    diagnostics.push(error('UNSUPPORTED_MODE', 'Only addMaterial mode is supported in v1'));
  }

  return diagnostics;
}

/**
 * Rebuild handler for the offset face feature.
 */
export function rebuildOffsetFace(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params: OffsetFaceParams = {
    ...defaultOffsetFaceParams,
    ...(feature.parameters as Partial<OffsetFaceParams>),
  };

  // Validate parameters
  const diagnostics = validateOffsetFaceParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid offset face parameters',
      diagnostics,
    };
  }

  // Get the body to modify from the feature reference
  const allBodies = getAllBodies(context);
  const targetBody = allBodies.find(b => b.id === params.faceRef.bodyId);

  if (!targetBody) {
    return {
      ok: false,
      error: `Body ${params.faceRef.bodyId} not found`,
      diagnostics: [error('BODY_NOT_FOUND', `Body ${params.faceRef.bodyId} not found`)],
    };
  }

  // Verify the face exists in the body
  const targetFace = targetBody.faces.get(params.faceRef.faceId);
  if (!targetFace) {
    return {
      ok: false,
      error: `Face ${params.faceRef.faceId} not found in body`,
      diagnostics: [error('FACE_NOT_FOUND', `Face ${params.faceRef.faceId} not found in body`)],
    };
  }

  // Validate the offset operation
  const validation = validateOffsetFace(targetBody, params.faceRef.faceId, params.distance);
  if (!validation.valid) {
    return {
      ok: false,
      error: validation.error ?? 'Invalid offset operation',
      diagnostics: [error('INVALID_OFFSET', validation.error ?? 'Invalid offset operation')],
    };
  }

  // Perform the offset
  const result = offsetFace(targetBody, params.faceRef.faceId, params.distance);
  if (!result) {
    return {
      ok: false,
      error: 'Offset operation failed',
      diagnostics: [error('OFFSET_FAILED', 'Offset operation failed to produce valid geometry')],
    };
  }

  // Validate the result
  const validationResult = validateBody(result);
  if (!validationResult.ok) {
    return {
      ok: false,
      error: 'Offset produced invalid body',
      diagnostics: validationResult.errors.map(e => error('INVALID_BODY', e.message)),
    };
  }

  log.info('Offset face complete', {
    featureId: feature.id,
    faceId: params.faceRef.faceId,
    distance: params.distance,
  });

  return {
    ok: true,
    bodies: [result],
    diagnostics: [],
    replacedBodyIds: [targetBody.id],
  };
}

/**
 * Create an offset face feature record.
 */
export function createOffsetFaceFeature(
  faceRef: FaceRef,
  distance: number,
  name = 'Push/Pull'
): FeatureRecord {
  const params: OffsetFaceParams = {
    faceRef,
    distance,
    mode: 'addMaterial',
  };

  return {
    id: generateId(),
    type: OFFSET_FACE_FEATURE_TYPE,
    name,
    parameters: params as unknown as Record<string, unknown>,
    refsIn: [faceRef.featureId],
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Update offset face distance.
 */
export function updateOffsetFaceDistance(
  feature: FeatureRecord,
  distance: number
): FeatureRecord {
  if (feature.type !== OFFSET_FACE_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as OffsetFaceParams;
  return {
    ...feature,
    parameters: {
      ...params,
      distance,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Get offset face parameters from a feature.
 */
export function getOffsetFaceParams(feature: FeatureRecord): OffsetFaceParams | null {
  if (feature.type !== OFFSET_FACE_FEATURE_TYPE) return null;
  return feature.parameters as unknown as OffsetFaceParams;
}

/**
 * Create a FaceRef from face selection.
 */
export function createFaceRef(
  faceId: string,
  bodyId: string,
  featureId: string
): FaceRef {
  return {
    faceId,
    bodyId,
    featureId,
  };
}
