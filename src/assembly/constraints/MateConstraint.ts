/**
 * Mate Constraint - Milestone 06: Assembly-lite
 *
 * Constraint types and validation for assembly mates.
 */

import { error, type Diagnostic } from '../../features/Diagnostics';
import type { InstanceFaceRef } from '../AssemblyTypes';

export const MATE_CONSTRAINT_TYPE = 'mate';

/**
 * Parameters for creating a mate constraint.
 */
export interface MateConstraintParams {
  type: 'flush' | 'offset';
  refA: InstanceFaceRef;
  refB: InstanceFaceRef;
  offset: number;
  name?: string;
}

/**
 * Error codes for mate constraint validation.
 */
export const MateConstraintErrorCodes = {
  MISSING_REF_A: 'MISSING_REF_A',
  MISSING_REF_B: 'MISSING_REF_B',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_OFFSET: 'INVALID_OFFSET',
  SAME_INSTANCE: 'SAME_INSTANCE',
  MISSING_FACE: 'MISSING_FACE',
} as const;

/**
 * Validate mate constraint parameters.
 */
export function validateMateConstraintParams(
  params: Record<string, unknown>
): { ok: true; data: MateConstraintParams } | { ok: false; errors: Diagnostic[] } {
  const errors: Diagnostic[] = [];

  // Validate type
  const type = params.type;
  if (type !== 'flush' && type !== 'offset') {
    errors.push(error(
      MateConstraintErrorCodes.INVALID_TYPE,
      'Constraint type must be "flush" or "offset"'
    ));
  }

  // Validate refA
  const refA = params.refA as InstanceFaceRef | undefined;
  if (!refA || !refA.instanceId || !refA.faceId || !refA.bodyId) {
    errors.push(error(
      MateConstraintErrorCodes.MISSING_REF_A,
      'Reference A must include instanceId, faceId, and bodyId'
    ));
  }

  // Validate refB
  const refB = params.refB as InstanceFaceRef | undefined;
  if (!refB || !refB.instanceId || !refB.faceId || !refB.bodyId) {
    errors.push(error(
      MateConstraintErrorCodes.MISSING_REF_B,
      'Reference B must include instanceId, faceId, and bodyId'
    ));
  }

  // Check that refs are from different instances
  if (refA && refB && refA.instanceId === refB.instanceId) {
    errors.push(error(
      MateConstraintErrorCodes.SAME_INSTANCE,
      'Cannot create constraint between faces on the same instance'
    ));
  }

  // Validate offset
  const offset = params.offset;
  if (typeof offset !== 'number' || !isFinite(offset)) {
    errors.push(error(
      MateConstraintErrorCodes.INVALID_OFFSET,
      'Offset must be a finite number'
    ));
  }

  // Flush constraints should have zero offset
  if (type === 'flush' && typeof offset === 'number' && offset !== 0) {
    // Auto-correct offset for flush constraints
    params = { ...params, offset: 0 };
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const result: MateConstraintParams = {
    type: type as 'flush' | 'offset',
    refA: refA!,
    refB: refB!,
    offset: offset as number,
  };

  // Only add name if it's defined
  if (typeof params.name === 'string') {
    result.name = params.name;
  }

  return { ok: true, data: result };
}

/**
 * Check if a constraint can be solved (basic feasibility check).
 */
export function canSolveConstraint(
  params: MateConstraintParams,
  instanceIds: string[]
): { ok: true } | { ok: false; reason: string } {
  // Check that both instances exist
  if (!instanceIds.includes(params.refA.instanceId)) {
    return { ok: false, reason: `Instance ${params.refA.instanceId} not found` };
  }

  if (!instanceIds.includes(params.refB.instanceId)) {
    return { ok: false, reason: `Instance ${params.refB.instanceId} not found` };
  }

  // Offset must be non-negative for offset constraints
  if (params.type === 'offset' && params.offset < 0) {
    return { ok: false, reason: 'Offset must be non-negative' };
  }

  return { ok: true };
}
