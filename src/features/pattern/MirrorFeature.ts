/**
 * Mirror Feature - Creates a mirrored copy of source geometry.
 * Milestone 05: Patterning
 */

import { generateId } from '../../core/id';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getBodyByFeature } from '../RebuildContext';
import { mirrorBody, type Plane, createXYPlane, createXZPlane, createYZPlane } from '../../geometry';
import { createWorldPlaneRef, type PlaneRef } from '../../sketch';
import { getConstructionPlaneFromRef } from '../../geometry/ConstructionPlane';
import { createModuleLogger } from '../../core/logger';
import type { BodyRef } from '../../geometry/SubObjectTypes';

const log = createModuleLogger('MirrorFeature');

/**
 * Parameters for the Mirror feature.
 */
export interface MirrorParams {
  /** ID of the source feature to mirror */
  sourceFeatureId: string;
  /** Exact source body. Optional only for legacy documents. */
  sourceBodyRef?: BodyRef;
  /** Mirror plane reference (world or face-based) */
  planeRef: PlaneRef;
}

/**
 * Default mirror parameters.
 */
export const defaultMirrorParams: MirrorParams = {
  sourceFeatureId: '',
  planeRef: createWorldPlaneRef('yz', 0),
};

/**
 * Feature type identifier for mirror.
 */
export const MIRROR_FEATURE_TYPE = 'mirror';

/**
 * Validate mirror parameters.
 */
export function validateMirrorParams(params: Partial<MirrorParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.sourceFeatureId) {
    diagnostics.push(error('MISSING_SOURCE_FEATURE', 'Source feature ID is required'));
  }

  if (!params.planeRef) {
    diagnostics.push(error('MISSING_PLANE_REF', 'Mirror plane reference is required'));
  } else {
    if (params.planeRef.type === 'world' && !params.planeRef.worldPlane) {
      diagnostics.push(error('INVALID_PLANE_REF', 'World plane type is required'));
    }
    if (params.planeRef.type === 'face' && (!params.planeRef.faceId || !params.planeRef.bodyId)) {
      diagnostics.push(error('INVALID_PLANE_REF', 'Face reference requires faceId and bodyId'));
    }
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
 * Get a world plane by name.
 */
function getWorldPlane(planeName: string, offset: number): Plane {
  switch (planeName) {
    case 'xy':
      return createXYPlane(offset);
    case 'xz':
      return createXZPlane(offset);
    case 'yz':
      return createYZPlane(offset);
    default:
      return createYZPlane(offset); // Default to YZ plane
  }
}

/**
 * Rebuild handler for the mirror feature.
 */
export function rebuildMirror(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params = migrateMirrorParams(feature.parameters as Partial<MirrorParams>);

  // Validate parameters
  const diagnostics = validateMirrorParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid mirror parameters',
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

  // Get all bodies for plane resolution
  const allBodies = context.allBodies;

  // Resolve the mirror plane
  let mirrorPlane: Plane;

  if (params.planeRef.type === 'world') {
    mirrorPlane = getWorldPlane(
      params.planeRef.worldPlane ?? 'yz',
      params.planeRef.offset ?? 0
    );
  } else {
    // Face-based plane
    const resolvedPlane = getConstructionPlaneFromRef(
      params.planeRef,
      allBodies,
      context.bodiesByFeature
    );
    if (!resolvedPlane) {
      return {
        ok: false,
        error: 'Could not resolve mirror plane',
        diagnostics: [error('PLANE_NOT_FOUND', 'Could not resolve face-based mirror plane')],
      };
    }
    mirrorPlane = resolvedPlane;
  }

  // Create mirrored instance
  const instanceId = `${sourceBody.id}_${feature.id}_mirror`;
  const mirroredInstance = mirrorBody(sourceBody, mirrorPlane, instanceId);
  mirroredInstance.name = `${sourceBody.name}_mirror`;

  log.info('Mirror complete', {
    featureId: feature.id,
    sourceFeatureId: params.sourceFeatureId,
    planeRef: params.planeRef,
  });

  return {
    ok: true,
    bodies: [mirroredInstance],
    diagnostics: [],
  };
}

/**
 * Create a mirror feature record.
 */
export function createMirrorFeature(
  source: string | BodyRef,
  planeRef: PlaneRef,
  name = 'Mirror'
): FeatureRecord {
  const sourceFeatureId = typeof source === 'string' ? source : source.featureId;
  const params: MirrorParams = {
    sourceFeatureId,
    ...(typeof source === 'string' ? {} : { sourceBodyRef: { ...source } }),
    planeRef,
  };

  return {
    id: generateId(),
    type: MIRROR_FEATURE_TYPE,
    name,
    parameters: params as unknown as Record<string, unknown>,
    refsIn: [...new Set([
      sourceFeatureId,
      ...(planeRef.type === 'face' && planeRef.featureId ? [planeRef.featureId] : []),
    ])],
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Update mirror plane reference.
 */
export function updateMirrorPlaneRef(
  feature: FeatureRecord,
  planeRef: PlaneRef
): FeatureRecord {
  if (feature.type !== MIRROR_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as MirrorParams;
  return {
    ...feature,
    parameters: {
      ...params,
      planeRef,
    } as unknown as Record<string, unknown>,
  };
}

/**
 * Get mirror parameters from a feature.
 */
export function getMirrorParams(feature: FeatureRecord): MirrorParams | null {
  if (feature.type !== MIRROR_FEATURE_TYPE) return null;
  return migrateMirrorParams(feature.parameters as Partial<MirrorParams>);
}

/** Preserve legacy sourceFeatureId-only documents while preferring exact body refs. */
export function migrateMirrorParams(params: Partial<MirrorParams>): MirrorParams {
  const sourceFeatureId = params.sourceBodyRef?.featureId
    ?? params.sourceFeatureId
    ?? defaultMirrorParams.sourceFeatureId;
  return {
    sourceFeatureId,
    ...(params.sourceBodyRef ? { sourceBodyRef: { ...params.sourceBodyRef } } : {}),
    planeRef: params.planeRef
      ? { ...params.planeRef }
      : { ...defaultMirrorParams.planeRef },
  };
}
