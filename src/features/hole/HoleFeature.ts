/**
 * Persisted hole feature schema. Curved hole geometry is unsupported by the
 * planar kernel; retain the handler to report this explicitly on load/rebuild.
 */

import {
  type RebuildContext,
  type RebuildHandlerResult,
} from '../../features';
import { error } from '../../features/Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';

export const HOLE_FEATURE_TYPE = 'hole';

export interface HoleParams {
  bodyRef: { bodyId: string; featureId: string };
  position: [number, number]; // Position on the face in face-local coordinates
  faceId: string; // Face to drill into
  holeType: 'through' | 'blind' | 'counterbored' | 'countersunk';
  diameter: number;
  depth?: number; // For blind holes
  counterboreDiameter?: number; // For counterbored
  counterboreDepth?: number; // For counterbored
  countersinkAngle?: number; // For countersunk (degrees)
}

export function validateHoleParams(params: HoleParams): { valid: true } | { valid: false; diagnostics: Array<{ code: string; message: string }> } {
  const diagnostics: Array<{ code: string; message: string }> = [];

  if (!params.bodyRef?.bodyId) {
    diagnostics.push(error('MISSING_BODY_REF', 'Body reference is required'));
  }
  if (!params.faceId) {
    diagnostics.push(error('MISSING_FACE_ID', 'Face ID is required'));
  }
  if (!params.diameter || params.diameter <= 0) {
    diagnostics.push(error('INVALID_DIAMETER', 'Diameter must be positive'));
  }

  if (params.holeType === 'blind' && params.depth && params.depth <= 0) {
    diagnostics.push(error('INVALID_DEPTH', 'Depth must be positive for blind holes'));
  }

  if (params.holeType === 'counterbored') {
    if (!params.counterboreDiameter || params.counterboreDiameter <= 0) {
      diagnostics.push(error('INVALID_COUNTERBORE_DIAMETER', 'Counterbore diameter is required'));
    }
    if (!params.counterboreDepth || params.counterboreDepth <= 0) {
      diagnostics.push(error('INVALID_COUNTERBORE_DEPTH', 'Counterbore depth is required'));
    }
  }

  if (params.holeType === 'countersunk') {
    if (params.countersinkAngle === undefined || params.countersinkAngle <= 0 || params.countersinkAngle >= 180) {
      diagnostics.push(error('INVALID_COUNTERSINK_ANGLE', 'Countersink angle must be between 0 and 180'));
    }
  }

  return diagnostics.length === 0 ? { valid: true } : { valid: false, diagnostics };
}

export function createHoleFeature(params: HoleParams): FeatureRecord {
  return {
    id: crypto.randomUUID(),
    type: HOLE_FEATURE_TYPE,
    name: 'Hole',
    parameters: params as unknown as Record<string, unknown>,
    refsIn: params.bodyRef?.featureId ? [params.bodyRef.featureId] : [],
    refsOut: [],
    suppressed: false,
  };
}

export function rebuildHole(
  feature: FeatureRecord,
  _context: RebuildContext,
): RebuildHandlerResult {
  const message = 'Hole geometry is unsupported by the planar kernel. Suppress or remove this feature to rebuild.';
  return {
    ok: false,
    error: message,
    diagnostics: [error('UNSUPPORTED_HOLE', message, feature.id)],
  };
}

export function validateHoleFeature(feature: FeatureRecord): boolean {
  return feature.type === HOLE_FEATURE_TYPE;
}
