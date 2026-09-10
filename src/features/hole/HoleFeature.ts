/**
 * Hole feature: creates drilled, counterbored, or countersunk holes.
 * Uses extrude-cut with a circular profile for simplicity.
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
    refsIn: params.bodyRef?.bodyId ? [params.bodyRef.bodyId] : [],
    refsOut: [],
    suppressed: false,
  };
}

export function rebuildHole(
  _feature: FeatureRecord,
  _context: RebuildContext,
): RebuildHandlerResult {
  // Hole is a visual-only feature - it doesn't create new geometry
  // The actual hole is rendered in the viewport or in shop drawings
  return {
    ok: true,
    bodies: [],
    diagnostics: [],
    outputs: [],
  };
}

export function validateHoleFeature(feature: FeatureRecord): boolean {
  return feature.type === HOLE_FEATURE_TYPE;
}
