/**
 * Circular Pattern Feature - Creates multiple rotated copies of source geometry.
 * Milestone 05: Patterning (extension)
 */

import * as THREE from 'three';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getBodyByFeature } from '../RebuildContext';
import { transformVertexPositions, type Body } from '../../geometry';
import { generateId } from '../../core/id';

/**
 * Parameters for the Circular Pattern feature.
 */
export interface CircularPatternParams {
  /** ID of the source feature to pattern */
  sourceFeatureId: string;
  /** Axis of rotation (world axis: 'X' | 'Y' | 'Z') */
  axis: 'X' | 'Y' | 'Z';
  /** Center point of rotation */
  center: [number, number, number];
  /** Number of instances to create (including original) */
  count: number;
  /** Total angle to distribute instances over (degrees) */
  angle: number;
  /** Whether to pattern symmetrically around the source */
  symmetric: boolean;
}

/**
 * Default circular pattern parameters.
 */
export const defaultCircularPatternParams: CircularPatternParams = {
  sourceFeatureId: '',
  axis: 'Z',
  center: [0, 0, 0],
  count: 6,
  angle: 360,
  symmetric: false,
};

/**
 * Feature type identifier for circular pattern.
 */
export const CIRCULAR_PATTERN_FEATURE_TYPE = 'circularPattern';

/**
 * Validate circular pattern parameters.
 */
export function validateCircularPatternParams(params: Partial<CircularPatternParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.sourceFeatureId) {
    diagnostics.push(error('MISSING_SOURCE_FEATURE', 'Source feature ID is required'));
  }

  if (params.count === undefined || params.count < 2) {
    diagnostics.push(error('INVALID_COUNT', 'Count must be >= 2'));
  }

  if (params.angle === undefined || params.angle === 0) {
    diagnostics.push(error('INVALID_ANGLE', 'Angle must be non-zero'));
  }

  if (!params.axis) {
    diagnostics.push(error('INVALID_AXIS', 'Rotation axis is required'));
  }

  if (params.center && params.center.length !== 3) {
    diagnostics.push(error('INVALID_CENTER', 'Center point must have 3 coordinates'));
  }

  return diagnostics;
}

/**
 * Default circular pattern parameters.
 */
export function createCircularPatternFeature(params: Partial<CircularPatternParams>): FeatureRecord {
  const { sourceFeatureId } = params;
  const refsIn = sourceFeatureId ? [sourceFeatureId] : [];

  return {
    id: generateId(),
    type: CIRCULAR_PATTERN_FEATURE_TYPE,
    name: 'Circular Pattern',
    parameters: params as Record<string, unknown>,
    refsIn,
    refsOut: [],
    suppressed: false,
  };
}

/**
 * Rebuild circular pattern feature.
 */
export function rebuildCircularPattern(
  feature: FeatureRecord,
  context: RebuildContext,
): RebuildHandlerResult {
  const params = feature.parameters as unknown as CircularPatternParams;
  const { sourceFeatureId, axis, center, count, angle, symmetric } = params;

  // Validate required params
  if (!sourceFeatureId || !axis || !center || count < 2 || angle === 0) {
    return {
      ok: false,
      error: 'Invalid circular pattern parameters',
      diagnostics: validateCircularPatternParams(params),
    };
  }

  // Get source body
  const sourceBody = getBodyByFeature(context, sourceFeatureId);
  if (!sourceBody) {
    return {
      ok: false,
      error: `Source feature ${sourceFeatureId} not found`,
      diagnostics: [error('SOURCE_NOT_FOUND', `Source feature ${sourceFeatureId} not found`)],
    };
  }

  // Generate N-1 additional instances (source not included)
  const instances: Body[] = [];
  const stepAngle = angle / (count - 1);

  for (let i = 1; i < count; i++) {
    const rotationAngle = symmetric ? (i - (count - 1) / 2) * stepAngle : i * stepAngle;
    const rotationRad = rotationAngle * Math.PI / 180;

    // Create rotation matrix
    let matrix: THREE.Matrix4;
    if (axis === 'Z') {
      matrix = new THREE.Matrix4().makeRotationZ(rotationRad);
    } else if (axis === 'X') {
      matrix = new THREE.Matrix4().makeRotationX(rotationRad);
    } else {
      matrix = new THREE.Matrix4().makeRotationY(rotationRad);
    }

    // Apply transform to body
    const transformedBody = transformVertexPositions(sourceBody, matrix);

    // Create instance ID
    const instanceIndex = symmetric ? `${i - (count - 1) / 2}` : `${i}`;
    transformedBody.id = `${sourceBody.id}_cp_${instanceIndex}`;

    // Create unique IDs for all topology elements
    const idMap = new Map<string, string>();
    for (const [vid] of transformedBody.vertices) {
      idMap.set(vid, `${sourceBody.id}_cp_${instanceIndex}_v_${vid}`);
    }
    for (const [eid] of transformedBody.edges) {
      idMap.set(eid, `${sourceBody.id}_cp_${instanceIndex}_e_${eid}`);
    }
    for (const [fid] of transformedBody.faces) {
      idMap.set(fid, `${sourceBody.id}_cp_${instanceIndex}_f_${fid}`);
    }

    instances.push(transformedBody);
  }

  return {
    ok: true,
    bodies: instances,
    diagnostics: [],
    outputs: [],
  };
}

/**
 * Get dependency IDs for circular pattern.
 */
export function getCircularPatternDependencyIds(feature: FeatureRecord): string[] {
  const params = feature.parameters as unknown as CircularPatternParams;
  const refs: string[] = [];

  if (params.sourceFeatureId) {
    refs.push(params.sourceFeatureId);
  }

  return refs;
}

/**
 * Validate circular pattern feature.
 */
export function validateCircularPatternFeature(feature: FeatureRecord): boolean {
  return feature.type === CIRCULAR_PATTERN_FEATURE_TYPE;
}
