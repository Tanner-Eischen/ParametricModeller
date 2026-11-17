/** Circular patterns of planar solids, with deterministic occurrence topology. */
import * as THREE from 'three';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getBodyByFeature } from '../RebuildContext';
import { transformVertexPositions } from '../../geometry';
import type { BodyRef } from '../../geometry/SubObjectTypes';
import { generateId } from '../../core/id';

export interface CircularPatternParams {
  sourceFeatureId: string;
  /** Exact source body; omitted only by legacy feature records. */
  sourceBodyRef?: BodyRef;
  axis: 'X' | 'Y' | 'Z';
  center: [number, number, number];
  /** Includes the unchanged source occurrence. */
  count: number;
  /** Signed total arc, or +/-360 for a complete circle. */
  angle: number;
  /** Even counts put the extra occurrence in the signed angle direction. */
  symmetric: boolean;
}

export const defaultCircularPatternParams: CircularPatternParams = {
  sourceFeatureId: '', axis: 'Z', center: [0, 0, 0], count: 6, angle: 360, symmetric: false,
};
export const CIRCULAR_PATTERN_FEATURE_TYPE = 'circularPattern';
/** Bound synchronous geometry allocation during a single rebuild. */
export const MAX_CIRCULAR_PATTERN_COUNT = 1000;

export function validateCircularPatternParams(params: Partial<CircularPatternParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!params || typeof params !== 'object') {
    return [error('INVALID_PARAMETERS', 'Circular pattern parameters must be an object')];
  }
  if (typeof params.sourceFeatureId !== 'string' || !params.sourceFeatureId) {
    diagnostics.push(error('MISSING_SOURCE_FEATURE', 'Source feature ID is required'));
  }
  if (params.sourceBodyRef !== undefined && (
    !params.sourceBodyRef
    || typeof params.sourceBodyRef.bodyId !== 'string' || !params.sourceBodyRef.bodyId
    || params.sourceBodyRef.featureId !== params.sourceFeatureId
  )) {
    diagnostics.push(error('INVALID_SOURCE_REF', 'Source body reference must contain a body ID and the same feature ID'));
  }
  if (!Number.isInteger(params.count) || params.count! < 2 || params.count! > MAX_CIRCULAR_PATTERN_COUNT) {
    diagnostics.push(error('INVALID_COUNT', `Count must be an integer from 2 to ${MAX_CIRCULAR_PATTERN_COUNT}`));
  }
  if (!Number.isFinite(params.angle) || params.angle === 0 || Math.abs(params.angle!) > 360) {
    diagnostics.push(error('INVALID_ANGLE', 'Angle must be finite, non-zero, and between -360 and 360 degrees'));
  }
  if (!['X', 'Y', 'Z'].includes(params.axis ?? '')) {
    diagnostics.push(error('INVALID_AXIS', 'Rotation axis must be X, Y, or Z'));
  }
  if (!Array.isArray(params.center) || params.center.length !== 3 || !params.center.every(Number.isFinite)) {
    diagnostics.push(error('INVALID_CENTER', 'Center must contain three finite coordinates'));
  }
  if (typeof params.symmetric !== 'boolean') {
    diagnostics.push(error('INVALID_SYMMETRIC', 'Symmetric must be a boolean'));
  }
  return diagnostics;
}

export function createCircularPatternFeature(params: Partial<CircularPatternParams>): FeatureRecord {
  const fullParams: CircularPatternParams = {
    ...defaultCircularPatternParams,
    ...params,
    sourceFeatureId: params.sourceFeatureId ?? params.sourceBodyRef?.featureId ?? '',
    center: params.center ? [...params.center] : [...defaultCircularPatternParams.center],
    ...(params.sourceBodyRef ? { sourceBodyRef: { ...params.sourceBodyRef } } : {}),
  };
  return {
    id: generateId(), type: CIRCULAR_PATTERN_FEATURE_TYPE, name: 'Circular Pattern',
    parameters: fullParams as unknown as Record<string, unknown>,
    refsIn: fullParams.sourceFeatureId ? [fullParams.sourceFeatureId] : [],
    refsOut: [], suppressed: false,
  };
}

export interface CircularPatternInstanceTransform {
  index: number;
  angleDegrees: number;
  transform: THREE.Matrix4;
}

/**
 * Shared geometry/metadata transforms, in the same order as rebuild outputs.
 * Partial arcs include their end occurrence; full circles exclude the repeated
 * endpoint. Symmetric patterns retain the source at zero, with odd counts
 * balanced and even counts having one extra on the signed-angle side.
 */
export function getCircularPatternInstanceTransforms(
  params: CircularPatternParams,
): CircularPatternInstanceTransform[] {
  const diagnostics = validateCircularPatternParams(params);
  if (diagnostics.length > 0) throw new Error(diagnostics.map(item => item.message).join('; '));
  const copyCount = params.count - 1;
  const negativeCount = params.symmetric ? Math.floor(copyCount / 2) : 0;
  const positiveCount = copyCount - negativeCount;
  const positions = [
    ...Array.from({ length: negativeCount }, (_, index) => index - negativeCount),
    ...Array.from({ length: positiveCount }, (_, index) => index + 1),
  ];
  const step = params.angle / (Math.abs(params.angle) === 360 ? params.count : copyCount);
  return positions.map((position, index) => {
    const angleDegrees = position * step;
    const radians = THREE.MathUtils.degToRad(angleDegrees);
    const rotation = params.axis === 'X'
      ? new THREE.Matrix4().makeRotationX(radians)
      : params.axis === 'Y'
        ? new THREE.Matrix4().makeRotationY(radians)
        : new THREE.Matrix4().makeRotationZ(radians);
    const [x, y, z] = params.center;
    const transform = new THREE.Matrix4().makeTranslation(x, y, z)
      .multiply(rotation)
      .multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z));
    return { index, angleDegrees, transform };
  });
}

export function rebuildCircularPattern(feature: FeatureRecord, context: RebuildContext): RebuildHandlerResult {
  const params = feature.parameters as unknown as CircularPatternParams;
  const diagnostics = validateCircularPatternParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false, error: 'Invalid circular pattern parameters',
      diagnostics: diagnostics.map(item => ({ ...item, featureId: feature.id })),
    };
  }
  const sourceBody = params.sourceBodyRef
    ? context.bodiesByFeature.get(params.sourceBodyRef.featureId)?.find(body => body.id === params.sourceBodyRef!.bodyId)
    : getBodyByFeature(context, params.sourceFeatureId);
  if (!sourceBody) {
    const message = 'Circular pattern source body was not found; restore the source or repair its reference';
    return { ok: false, error: message, diagnostics: [error('SOURCE_NOT_FOUND', message, feature.id)] };
  }
  const bodies = getCircularPatternInstanceTransforms(params).map(({ index, transform }) => {
    const instanceId = `${sourceBody.id}_${feature.id}_cp_${index}`;
    const body = transformVertexPositions(sourceBody, transform, instanceId);
    body.name = `${sourceBody.name}_cp_${index}`;
    return body;
  });
  return { ok: true, bodies, diagnostics: [] };
}

export function getCircularPatternDependencyIds(feature: FeatureRecord): string[] {
  const params = feature.parameters as unknown as CircularPatternParams;
  return params.sourceFeatureId ? [params.sourceFeatureId] : [];
}

export function validateCircularPatternFeature(feature: FeatureRecord): boolean {
  return feature.type === CIRCULAR_PATTERN_FEATURE_TYPE;
}
