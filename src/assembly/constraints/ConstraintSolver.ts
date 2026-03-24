/**
 * Constraint Solver - Milestone 06: Assembly-lite
 *
 * Sequential constraint solver for assembly constraints.
 * v1: Applies constraints in order, first instance is grounded.
 */

import * as THREE from 'three';
import { createModuleLogger } from '../../core/logger';
import type { Body } from '../../geometry';
import type {
  ComponentInstance,
  MateConstraint,
  LockedAxes,
} from '../AssemblyTypes';
import { createDefaultLockedAxes } from '../AssemblyTypes';
import { solveFlushMate, checkFlushMate } from './FlushMateSolver';

const log = createModuleLogger('ConstraintSolver');

/**
 * Result of constraint solving.
 */
export interface ConstraintSolverResult {
  ok: boolean;
  updatedInstances: Map<string, ComponentInstance>;
  satisfiedConstraints: Set<string>;
  errors: Map<string, string>;  // constraintId -> errorMessage
}

/**
 * Context for constraint solving.
 */
export interface ConstraintSolverContext {
  instances: ComponentInstance[];
  constraints: MateConstraint[];
  instanceBodies: Map<string, Body[]>;  // instanceId -> bodies
}

/**
 * Solve a single constraint and return the updated instance transform.
 */
function solveConstraint(
  constraint: MateConstraint,
  context: ConstraintSolverContext,
  _instanceLocks: Map<string, LockedAxes>
): { ok: true; instanceId: string; newTransform: number[] } | { ok: false; error: string } {
  const { refA, refB, type, offset } = constraint;

  // Get bodies for both instances
  const bodiesA = context.instanceBodies.get(refA.instanceId);
  const bodiesB = context.instanceBodies.get(refB.instanceId);

  if (!bodiesA || bodiesA.length === 0) {
    return { ok: false, error: `Instance ${refA.instanceId} has no bodies` };
  }

  if (!bodiesB || bodiesB.length === 0) {
    return { ok: false, error: `Instance ${refB.instanceId} has no bodies` };
  }

  const bodyA = bodiesA.find(b => b.id === refA.bodyId) ?? bodiesA[0]!;
  const bodyB = bodiesB.find(b => b.id === refB.bodyId) ?? bodiesB[0]!;

  // Determine which instance to move (prefer moving B)
  const instanceA = context.instances.find(i => i.id === refA.instanceId);
  const instanceB = context.instances.find(i => i.id === refB.instanceId);

  if (!instanceA || !instanceB) {
    return { ok: false, error: 'Instance not found' };
  }

  // If instance B is grounded, we need to move instance A instead
  const moveInstanceB = !instanceB.grounded;

  if (type === 'flush' || type === 'offset') {
    const actualOffset = type === 'flush' ? 0 : offset;

    // We need to get the "source" bodies (before instance transform)
    // For v1, we solve relative to the current positions

    if (moveInstanceB) {
      const result = solveFlushMate(bodyA, refA, bodyB, refB, actualOffset);

      if (!result.ok) {
        return { ok: false, error: result.error ?? 'Failed to solve flush mate' };
      }

      // Compose with existing transform
      const existingTransform = new THREE.Matrix4().fromArray(instanceB.transform);
      const constraintTransform = new THREE.Matrix4().fromArray(result.transform!);

      // The constraint transform is relative to current position
      const newTransform = new THREE.Matrix4()
        .multiplyMatrices(constraintTransform, existingTransform);

      return {
        ok: true,
        instanceId: instanceB.id,
        newTransform: Array.from(newTransform.elements),
      };
    } else {
      // Move instance A instead (reverse the constraint)
      const result = solveFlushMate(bodyB, refB, bodyA, refA, actualOffset);

      if (!result.ok) {
        return { ok: false, error: result.error ?? 'Failed to solve flush mate' };
      }

      const existingTransform = new THREE.Matrix4().fromArray(instanceA.transform);
      const constraintTransform = new THREE.Matrix4().fromArray(result.transform!);
      const newTransform = new THREE.Matrix4()
        .multiplyMatrices(constraintTransform, existingTransform);

      return {
        ok: true,
        instanceId: instanceA.id,
        newTransform: Array.from(newTransform.elements),
      };
    }
  }

  return { ok: false, error: `Unknown constraint type: ${type}` };
}

/**
 * Solve all constraints in sequence.
 *
 * v1 Algorithm:
 * 1. First instance is grounded (cannot move)
 * 2. Process constraints in order
 * 3. Move the non-grounded instance to satisfy each constraint
 * 4. Update locked axes after each constraint
 *
 * @param context - Solver context with instances, constraints, and bodies
 * @returns Solver result with updated instances and constraint status
 */
export function solveConstraints(context: ConstraintSolverContext): ConstraintSolverResult {
  log.info('Starting constraint solve', {
    instanceCount: context.instances.length,
    constraintCount: context.constraints.length,
  });

  const updatedInstances = new Map<string, ComponentInstance>();
  const satisfiedConstraints = new Set<string>();
  const errors = new Map<string, string>();

  // Initialize instance locks
  const instanceLocks = new Map<string, LockedAxes>();
  for (const instance of context.instances) {
    instanceLocks.set(instance.id, { ...instance.lockedAxes });
  }

  // Ground the first instance (v1 simplification)
  if (context.instances.length > 0) {
    const firstInstance = context.instances[0]!;
    updatedInstances.set(firstInstance.id, {
      ...firstInstance,
      grounded: true,
    });
    // Lock all axes for the first instance
    instanceLocks.set(firstInstance.id, {
      translateX: true,
      translateY: true,
      translateZ: true,
      rotateX: true,
      rotateY: true,
      rotateZ: true,
    });
    log.debug('Grounded first instance', { id: firstInstance.id });
  }

  // Process constraints in order
  for (const constraint of context.constraints) {
    if (constraint.suppressed) {
      log.debug('Skipping suppressed constraint', { id: constraint.id });
      continue;
    }

    const result = solveConstraint(constraint, context, instanceLocks);

    if (result.ok) {
      // Update instance transform
      const instance = context.instances.find(i => i.id === result.instanceId);
      if (instance) {
        const currentUpdated = updatedInstances.get(instance.id) ?? instance;
        updatedInstances.set(instance.id, {
          ...currentUpdated,
          transform: result.newTransform,
        });

        // Update locked axes for this instance
        // For flush/offset mate, all translation is locked
        const currentLocks = instanceLocks.get(instance.id) ?? createDefaultLockedAxes();
        const newLocks: LockedAxes = {
          ...currentLocks,
          translateX: true,
          translateY: true,
          translateZ: true,
        };
        instanceLocks.set(instance.id, newLocks);

        log.debug('Updated instance transform', {
          instanceId: instance.id,
          constraintId: constraint.id,
        });
      }

      satisfiedConstraints.add(constraint.id);
    } else {
      errors.set(constraint.id, result.error);
      log.warn('Constraint failed', {
        constraintId: constraint.id,
        error: result.error,
      });
    }
  }

  // Copy over any instances that weren't updated
  for (const instance of context.instances) {
    if (!updatedInstances.has(instance.id)) {
      updatedInstances.set(instance.id, instance);
    }
  }

  const ok = errors.size === 0;

  log.info('Constraint solve complete', {
    ok,
    satisfiedCount: satisfiedConstraints.size,
    errorCount: errors.size,
  });

  return {
    ok,
    updatedInstances,
    satisfiedConstraints,
    errors,
  };
}

/**
 * Check if all constraints are satisfied.
 */
export function checkAllConstraints(
  context: ConstraintSolverContext
): Map<string, { satisfied: boolean; distance: number }> {
  const results = new Map<string, { satisfied: boolean; distance: number }>();

  for (const constraint of context.constraints) {
    const { refA, refB } = constraint;

    const bodiesA = context.instanceBodies.get(refA.instanceId);
    const bodiesB = context.instanceBodies.get(refB.instanceId);

    if (!bodiesA || !bodiesB) {
      results.set(constraint.id, { satisfied: false, distance: Infinity });
      continue;
    }

    const bodyA = bodiesA.find(b => b.id === refA.bodyId) ?? bodiesA[0];
    const bodyB = bodiesB.find(b => b.id === refB.bodyId) ?? bodiesB[0];

    if (!bodyA || !bodyB) {
      results.set(constraint.id, { satisfied: false, distance: Infinity });
      continue;
    }

    const check = checkFlushMate(bodyA, refA, bodyB, refB);
    results.set(constraint.id, check);
  }

  return results;
}
