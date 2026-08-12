import * as THREE from 'three';
import { createFeatureRecord, type FeatureRecord } from '../FeatureRecord';
import { error, type Diagnostic } from '../Diagnostics';
import { getAllBodies, type RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getBodyBoundingBox, transformVertexPositions, validateBody } from '../../geometry';
import type { BodyRef } from '../../geometry/SubObjectTypes';
import { createModuleLogger } from '../../core/logger';

const log = createModuleLogger('RotateBodyFeature');

export const ROTATE_BODY_FEATURE_TYPE = 'rotateBody';

export interface RotateBodyParams {
  bodyRef: BodyRef;
  rotationDegrees: [number, number, number];
  pivot: 'bodyCenter' | 'worldOrigin';
}

export const defaultRotateBodyParams: RotateBodyParams = {
  bodyRef: { featureId: '', bodyId: '' },
  rotationDegrees: [0, 0, 0],
  pivot: 'bodyCenter',
};

export function validateRotateBodyParams(params: Partial<RotateBodyParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.bodyRef) {
    diagnostics.push(error('MISSING_BODY_REF', 'Body reference is required'));
  } else {
    if (!params.bodyRef.featureId) {
      diagnostics.push(error('MISSING_FEATURE_ID', 'Feature ID is required in body reference'));
    }
    if (!params.bodyRef.bodyId) {
      diagnostics.push(error('MISSING_BODY_ID', 'Body ID is required in body reference'));
    }
  }

  if (!params.rotationDegrees || params.rotationDegrees.length !== 3) {
    diagnostics.push(error('INVALID_ROTATION', 'Rotation must be [x, y, z] in degrees'));
  } else if (!params.rotationDegrees.every((value) => Number.isFinite(value))) {
    diagnostics.push(error('INVALID_ROTATION', 'Rotation values must be finite numbers'));
  }

  if (params.pivot && params.pivot !== 'bodyCenter' && params.pivot !== 'worldOrigin') {
    diagnostics.push(error('INVALID_PIVOT', 'Pivot must be bodyCenter or worldOrigin'));
  }

  return diagnostics;
}

export function createRotateBodyFeature(
  bodyRef: BodyRef,
  rotationDegrees: [number, number, number] = [0, 0, 0],
  pivot: 'bodyCenter' | 'worldOrigin' = 'bodyCenter',
  name = 'Rotate'
): FeatureRecord {
  return createFeatureRecord(
    ROTATE_BODY_FEATURE_TYPE,
    name,
    {
      bodyRef,
      rotationDegrees,
      pivot,
    } satisfies RotateBodyParams as unknown as Record<string, unknown>,
    {
      refsIn: [bodyRef.featureId],
    }
  );
}

export function rebuildRotateBody(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params: RotateBodyParams = {
    ...defaultRotateBodyParams,
    ...(feature.parameters as Partial<RotateBodyParams>),
  };

  const diagnostics = validateRotateBodyParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid rotate body parameters',
      diagnostics,
    };
  }

  const targetBody = getAllBodies(context).find((body) => body.id === params.bodyRef.bodyId);
  if (!targetBody) {
    return {
      ok: false,
      error: `Body ${params.bodyRef.bodyId} not found`,
      diagnostics: [error('BODY_NOT_FOUND', `Body ${params.bodyRef.bodyId} not found`)],
    };
  }

  const radians = params.rotationDegrees.map((value) => THREE.MathUtils.degToRad(value)) as [number, number, number];
  const pivot = params.pivot === 'worldOrigin'
    ? [0, 0, 0] as [number, number, number]
    : (() => {
        const bounds = getBodyBoundingBox(targetBody);
        return [
          (bounds.min[0] + bounds.max[0]) / 2,
          (bounds.min[1] + bounds.max[1]) / 2,
          (bounds.min[2] + bounds.max[2]) / 2,
        ] as [number, number, number];
      })();

  const toOrigin = new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
  const rotate = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...radians));
  const fromOrigin = new THREE.Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2]);
  const transform = new THREE.Matrix4().multiplyMatrices(fromOrigin, rotate).multiply(toOrigin);

  const rotatedBody = transformVertexPositions(targetBody, transform, targetBody.id);
  const validation = validateBody(rotatedBody);
  if (!validation.ok) {
    return {
      ok: false,
      error: 'Rotate produced invalid body',
      diagnostics: validation.errors.map((item) => error('INVALID_BODY', item.message)),
    };
  }

  log.info('Rotate body complete', {
    featureId: feature.id,
    bodyId: targetBody.id,
    rotationDegrees: params.rotationDegrees,
    pivot: params.pivot,
  });

  return {
    ok: true,
    bodies: [rotatedBody],
    diagnostics: [],
    replacedBodyIds: [targetBody.id],
  };
}
