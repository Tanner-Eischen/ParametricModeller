/**
 * Deterministic, transactional Gauss-Seidel solver for assembly face mates.
 *
 * Constraint order is history order. The bounded solver revisits earlier
 * constraints after later moves and rolls back all transforms if the system
 * conflicts or does not converge. Geometry is refreshed after every candidate
 * move, so residuals never inspect stale planes.
 */

import * as THREE from 'three';
import { createModuleLogger } from '../../core/logger';
import {
  addEdge,
  addFace,
  addPlane,
  addVertex,
  createBody,
  type Body,
} from '../../geometry';
import { createEdge } from '../../geometry/Edge';
import { createFace } from '../../geometry/Face';
import { createPlane } from '../../geometry/Plane';
import { createVertex } from '../../geometry/Vertex';
import { DEFAULT_TOLERANCE_POLICY } from '../../geometry/TolerancePolicy';
import type {
  ComponentInstance,
  LockedAxes,
  MateConstraint,
} from '../AssemblyTypes';
import {
  createDefaultLockedAxes,
  mergeLockedAxes,
} from '../AssemblyTypes';
import {
  checkFlushMate,
  solveFlushMate,
  type FlushMateCheck,
} from './FlushMateSolver';

const log = createModuleLogger('ConstraintSolver');
const MAX_SOLVER_PASSES = 20;
const AXIS_TOLERANCE = 1e-8;

export type ConstraintRuntimeState =
  | 'satisfied'
  | 'unsatisfied'
  | 'conflicting'
  | 'broken';

export interface ConstraintRuntimeStatus {
  state: ConstraintRuntimeState;
  residual?: FlushMateCheck;
  movedInstanceId?: string;
  message?: string;
}

/**
 * Result of constraint solving.
 *
 * `committed` is false whenever one unsuppressed constraint fails. In that
 * case updatedInstances and updatedInstanceBodies contain the pre-solve state.
 */
export interface ConstraintSolverResult {
  ok: boolean;
  committed: boolean;
  updatedInstances: Map<string, ComponentInstance>;
  updatedInstanceBodies: Map<string, Body[]>;
  groundedInstanceIds: Set<string>;
  satisfiedConstraints: Set<string>;
  constraintStatuses: Map<string, ConstraintRuntimeStatus>;
  residuals: Map<string, FlushMateCheck>;
  errors: Map<string, string>;  // constraintId -> errorMessage
}

/**
 * Context for constraint solving.
 */
export interface ConstraintSolverContext {
  instances: ComponentInstance[];
  constraints: MateConstraint[];
  instanceBodies: Map<string, Body[]>;  // instanceId -> current generated bodies
  /**
   * Optional pure regeneration hook. It must return geometry at the supplied
   * transform without mutating document state. When omitted, the solver creates
   * a fresh transformed topology clone while retaining existing IDs.
   */
  regenerateInstanceBodies?: (instance: ComponentInstance) => Body[];
  tolerance?: number;
}

type SolveAttempt =
  | {
      ok: true;
      instance: ComponentInstance;
      bodies: Body[];
      residual: FlushMateCheck;
      locks: LockedAxes;
    }
  | {
      ok: false;
      state: Exclude<ConstraintRuntimeState, 'satisfied'>;
      message: string;
      residual?: FlushMateCheck;
    };

/**
 * Solve all constraints as one transaction.
 */
export function solveConstraints(context: ConstraintSolverContext): ConstraintSolverResult {
  log.info('Starting constraint solve', {
    instanceCount: context.instances.length,
    constraintCount: context.constraints.length,
  });

  const linearTolerance = context.tolerance ?? DEFAULT_TOLERANCE_POLICY.linear;
  const angularTolerance = context.tolerance ?? DEFAULT_TOLERANCE_POLICY.angular;
  const originalInstances = new Map(
    context.instances.map((instance) => [instance.id, cloneInstance(instance)])
  );
  const duplicateInstanceId = findDuplicate(context.instances.map((instance) => instance.id));
  const errors = new Map<string, string>();
  const constraintStatuses = new Map<string, ConstraintRuntimeStatus>();
  const residuals = new Map<string, FlushMateCheck>();
  const satisfiedConstraints = new Set<string>();

  if (duplicateInstanceId) {
    const message = `Duplicate instance ID ${duplicateInstanceId}`;
    errors.set('solver', message);
    return {
      ok: false,
      committed: false,
      updatedInstances: originalInstances,
      updatedInstanceBodies: cloneBodyMap(context.instanceBodies),
      groundedInstanceIds: new Set(),
      satisfiedConstraints,
      constraintStatuses,
      residuals,
      errors,
    };
  }

  const groundedInstanceIds = selectGroundedInstances(context.instances);
  const workingInstances = new Map<string, ComponentInstance>();
  const authoredLocks = new Map<string, LockedAxes>();
  const instanceLocks = new Map<string, LockedAxes>();
  for (const instance of context.instances) {
    const grounded = groundedInstanceIds.has(instance.id);
    authoredLocks.set(
      instance.id,
      grounded ? allAxesLocked() : { ...instance.lockedAxes }
    );
    const locks = grounded ? allAxesLocked() : { ...instance.lockedAxes };
    workingInstances.set(instance.id, {
      ...cloneInstance(instance),
      grounded,
      lockedAxes: locks,
    });
    instanceLocks.set(instance.id, locks);
  }
  const initialInstances = cloneInstanceMap(workingInstances);
  const workingBodies = cloneBodyMap(context.instanceBodies);
  let failedConstraintId: string | null = null;
  const orderedConstraints = context.constraints
    .map((constraint, persistedIndex) => ({ constraint, persistedIndex }))
    .filter(({ constraint }) => !constraint.suppressed)
    .sort((left, right) =>
      left.persistedIndex - right.persistedIndex
      || left.constraint.id.localeCompare(right.constraint.id)
    )
    .map(({ constraint }) => constraint);

  // Validate every reference before applying the first candidate transform.
  // This keeps the solve transactional even when a broken constraint appears
  // late in history.
  for (const constraint of orderedConstraints) {
    const validationError = validateConstraintReferences(
      constraint,
      workingInstances,
      workingBodies
    );
    if (validationError) {
      recordFailure(
        constraint,
        'broken',
        validationError,
        constraintStatuses,
        errors
      );
      failedConstraintId = constraint.id;
      break;
    }
  }

  if (!failedConstraintId) {
    const movedByConstraint = new Map<string, string>();
    let converged = false;

    for (let pass = 0; pass < MAX_SOLVER_PASSES; pass += 1) {
      for (const constraint of orderedConstraints) {
        if (constraint.driving === false) continue;

        const currentResidual = getConstraintResidual(
          constraint,
          workingBodies,
          linearTolerance,
          angularTolerance
        );
        if (!currentResidual) {
          recordFailure(
            constraint,
            'broken',
            `Constraint ${constraint.id} references missing geometry`,
            constraintStatuses,
            errors
          );
          failedConstraintId = constraint.id;
          break;
        }
        residuals.set(constraint.id, currentResidual);
        if (currentResidual.satisfied) continue;

        const instanceA = workingInstances.get(constraint.refA.instanceId)!;
        const instanceB = workingInstances.get(constraint.refB.instanceId)!;
        if (instanceA.grounded && instanceB.grounded) {
          recordFailure(
            constraint,
            'conflicting',
            `Constraint ${constraint.id} cannot move two grounded instances`,
            constraintStatuses,
            errors,
            currentResidual
          );
          failedConstraintId = constraint.id;
          break;
        }

        // Grounding determines authority. With no grounded side, reference B
        // is always the moving member. A locked B is a conflict; reference A
        // is never moved as an implicit fallback.
        const moving = instanceA.grounded ? instanceB : instanceB.grounded
          ? instanceA
          : instanceB;
        const reverse = instanceB.grounded;
        const attempt = attemptConstraintMove(
          constraint,
          moving,
          reverse,
          workingBodies,
          authoredLocks.get(moving.id) ?? createDefaultLockedAxes(),
          instanceLocks.get(moving.id) ?? createDefaultLockedAxes(),
          context.regenerateInstanceBodies,
          linearTolerance,
          angularTolerance
        );

        if (!attempt.ok) {
          recordFailure(
            constraint,
            attempt.state,
            attempt.message,
            constraintStatuses,
            errors,
            attempt.residual
          );
          if (attempt.residual) residuals.set(constraint.id, attempt.residual);
          failedConstraintId = constraint.id;
          break;
        }

        workingInstances.set(attempt.instance.id, attempt.instance);
        workingBodies.set(attempt.instance.id, attempt.bodies);
        instanceLocks.set(attempt.instance.id, attempt.locks);
        movedByConstraint.set(constraint.id, attempt.instance.id);
        residuals.set(constraint.id, attempt.residual);
      }
      if (failedConstraintId) break;

      const unsatisfied = findFirstUnsatisfiedDrivingConstraint(
        orderedConstraints,
        workingBodies,
        linearTolerance,
        angularTolerance
      );
      if (!unsatisfied) {
        converged = true;
        break;
      }
      if (pass === MAX_SOLVER_PASSES - 1) {
        const currentResidual = getConstraintResidual(
          unsatisfied,
          workingBodies,
          linearTolerance,
          angularTolerance
        );
        recordFailure(
          unsatisfied,
          'conflicting',
          `Constraint system did not converge after ${MAX_SOLVER_PASSES} passes`,
          constraintStatuses,
          errors,
          currentResidual ?? undefined
        );
        failedConstraintId = unsatisfied.id;
      }
    }

    if (converged && !failedConstraintId) {
      // Runtime residuals, rather than stored status flags, are authoritative.
      // Revalidate every active constraint against the final regenerated
      // geometry before committing the transaction.
      satisfiedConstraints.clear();
      for (const constraint of orderedConstraints) {
        const currentResidual = getConstraintResidual(
          constraint,
          workingBodies,
          linearTolerance,
          angularTolerance
        );
        if (!currentResidual) {
          recordFailure(
            constraint,
            'broken',
            `Constraint ${constraint.id} references missing final geometry`,
            constraintStatuses,
            errors
          );
          failedConstraintId = constraint.id;
          break;
        }
        residuals.set(constraint.id, currentResidual);
        if (constraint.driving !== false && !currentResidual.satisfied) {
          recordFailure(
            constraint,
            'unsatisfied',
            `Constraint ${constraint.id} exceeds final residual tolerance`,
            constraintStatuses,
            errors,
            currentResidual
          );
          failedConstraintId = constraint.id;
          break;
        }
        if (currentResidual.satisfied) satisfiedConstraints.add(constraint.id);
        const movedInstanceId = movedByConstraint.get(constraint.id);
        constraintStatuses.set(constraint.id, {
          state: currentResidual.satisfied ? 'satisfied' : 'unsatisfied',
          residual: currentResidual,
          ...(movedInstanceId ? { movedInstanceId } : {}),
          ...(constraint.driving === false && !currentResidual.satisfied
            ? { message: 'Legacy validate-only constraint is not satisfied' }
            : {}),
        });
      }
    }
  }

  if (failedConstraintId) {
    // Recompute prior runtime states against the actual rolled-back geometry.
    satisfiedConstraints.clear();
    for (const constraint of orderedConstraints) {
      if (constraint.suppressed || constraint.id === failedConstraintId) continue;
      const check = getConstraintResidual(
        constraint,
        context.instanceBodies,
        linearTolerance,
        angularTolerance
      );
      if (!check) {
        constraintStatuses.set(constraint.id, {
          state: 'broken',
          message: 'Constraint references missing pre-solve geometry',
        });
        continue;
      }
      residuals.set(constraint.id, check);
      constraintStatuses.set(constraint.id, {
        state: check.satisfied ? 'satisfied' : 'unsatisfied',
        residual: check,
        message: 'Solver transaction was rolled back',
      });
      if (check.satisfied) satisfiedConstraints.add(constraint.id);
    }

    log.warn('Constraint solve rolled back', {
      constraintId: failedConstraintId,
      error: errors.get(failedConstraintId),
    });
    return {
      ok: false,
      committed: false,
      updatedInstances: initialInstances,
      updatedInstanceBodies: cloneBodyMap(context.instanceBodies),
      groundedInstanceIds,
      satisfiedConstraints,
      constraintStatuses,
      residuals,
      errors,
    };
  }

  log.info('Constraint solve complete', {
    ok: true,
    satisfiedCount: satisfiedConstraints.size,
  });
  return {
    ok: true,
    committed: true,
    updatedInstances: cloneInstanceMap(workingInstances),
    updatedInstanceBodies: workingBodies,
    groundedInstanceIds,
    satisfiedConstraints,
    constraintStatuses,
    residuals,
    errors,
  };
}

function attemptConstraintMove(
  constraint: MateConstraint,
  moving: ComponentInstance,
  reverse: boolean,
  bodiesByInstance: Map<string, Body[]>,
  authoredLocks: LockedAxes,
  accumulatedLocks: LockedAxes,
  regenerate: ConstraintSolverContext['regenerateInstanceBodies'],
  linearTolerance: number,
  angularTolerance: number
): SolveAttempt {
  if (moving.grounded) {
    return {
      ok: false,
      state: 'conflicting',
      message: `Instance ${moving.id} is grounded`,
    };
  }

  const fixedRef = reverse ? constraint.refB : constraint.refA;
  const movingRef = reverse ? constraint.refA : constraint.refB;
  const fixedBody = findExactBody(bodiesByInstance, fixedRef.instanceId, fixedRef.bodyId);
  const movingBody = findExactBody(bodiesByInstance, movingRef.instanceId, movingRef.bodyId);
  if (!fixedBody || !movingBody) {
    return {
      ok: false,
      state: 'broken',
      message: `Constraint ${constraint.id} references missing body geometry`,
    };
  }

  const offset = constraint.type === 'flush' ? 0 : constraint.offset;
  const solve = solveFlushMate(
    fixedBody,
    fixedRef,
    movingBody,
    movingRef,
    offset
  );
  if (!solve.ok || !solve.transform) {
    return {
      ok: false,
      state: 'broken',
      message: solve.error ?? `Constraint ${constraint.id} could not be solved`,
    };
  }

  const violatedAxes = getViolatedLockedAxes(solve.transform, authoredLocks);
  if (violatedAxes.length > 0) {
    return {
      ok: false,
      state: 'conflicting',
      message: `Constraint ${constraint.id} conflicts with locked axes: ${violatedAxes.join(', ')}`,
    };
  }

  const delta = new THREE.Matrix4().fromArray(solve.transform);
  const existing = new THREE.Matrix4().fromArray(moving.transform);
  const newTransform = new THREE.Matrix4().multiplyMatrices(delta, existing);
  const nextInstance: ComponentInstance = {
    ...cloneInstance(moving),
    transform: Array.from(newTransform.elements),
  };

  let nextBodies: Body[];
  try {
    if (regenerate) {
      const regenerated = regenerate(nextInstance);
      if (!Array.isArray(regenerated)) {
        throw new Error('Regeneration hook did not return a body array');
      }
      nextBodies = regenerated.map((body) => cloneBodyPreservingTopology(body));
    } else {
      nextBodies = (bodiesByInstance.get(moving.id) ?? []).map(
        (body) => transformBodyPreservingTopology(body, delta)
      );
    }
  } catch (caught) {
    return {
      ok: false,
      state: 'broken',
      message: `Failed to regenerate instance ${moving.id}: ${
        caught instanceof Error ? caught.message : String(caught)
      }`,
    };
  }

  const candidateBodies = new Map(bodiesByInstance);
  candidateBodies.set(moving.id, nextBodies);
  const residual = getConstraintResidual(
    constraint,
    candidateBodies,
    linearTolerance,
    angularTolerance
  );
  if (!residual) {
    return {
      ok: false,
      state: 'broken',
      message: `Regenerated geometry for ${moving.id} no longer contains the referenced topology`,
    };
  }
  if (!residual.satisfied) {
    return {
      ok: false,
      state: 'unsatisfied',
      message: `Constraint ${constraint.id} residual exceeds tolerance`,
      residual,
    };
  }

  const mateLocks = getMateLocks(fixedBody, fixedRef.faceId);
  const nextLocks = mergeLockedAxes(accumulatedLocks, mateLocks);
  nextInstance.lockedAxes = nextLocks;
  return {
    ok: true,
    instance: nextInstance,
    bodies: nextBodies,
    residual,
    locks: nextLocks,
  };
}

function validateConstraintReferences(
  constraint: MateConstraint,
  instances: Map<string, ComponentInstance>,
  bodies: Map<string, Body[]>
): string | null {
  if (constraint.refA.instanceId === constraint.refB.instanceId) {
    return `Constraint ${constraint.id} cannot reference the same instance twice`;
  }
  for (const ref of [constraint.refA, constraint.refB]) {
    if (!instances.has(ref.instanceId)) {
      return `Constraint ${constraint.id} references missing instance ${ref.instanceId}`;
    }
    const body = findExactBody(bodies, ref.instanceId, ref.bodyId);
    if (!body) {
      return `Constraint ${constraint.id} references missing body ${ref.bodyId}`;
    }
    if (!body.faces.has(ref.faceId)) {
      return `Constraint ${constraint.id} references missing face ${ref.faceId}`;
    }
  }
  if (!Number.isFinite(constraint.offset)) {
    return `Constraint ${constraint.id} has a non-finite offset`;
  }
  return null;
}

function getConstraintResidual(
  constraint: MateConstraint,
  bodies: Map<string, Body[]>,
  linearTolerance: number,
  angularTolerance: number
): FlushMateCheck | null {
  const bodyA = findExactBody(
    bodies,
    constraint.refA.instanceId,
    constraint.refA.bodyId
  );
  const bodyB = findExactBody(
    bodies,
    constraint.refB.instanceId,
    constraint.refB.bodyId
  );
  if (
    !bodyA
    || !bodyB
    || !bodyA.faces.has(constraint.refA.faceId)
    || !bodyB.faces.has(constraint.refB.faceId)
  ) {
    return null;
  }
  const check = checkFlushMate(
    bodyA,
    constraint.refA,
    bodyB,
    constraint.refB,
    Math.max(linearTolerance, angularTolerance),
    constraint.type === 'flush' ? 0 : constraint.offset
  );
  return {
    ...check,
    satisfied:
      check.offsetError <= linearTolerance
      && check.angularError <= angularTolerance,
  };
}

function findFirstUnsatisfiedDrivingConstraint(
  constraints: readonly MateConstraint[],
  bodies: Map<string, Body[]>,
  linearTolerance: number,
  angularTolerance: number
): MateConstraint | null {
  for (const constraint of constraints) {
    if (constraint.driving === false) continue;
    const residual = getConstraintResidual(
      constraint,
      bodies,
      linearTolerance,
      angularTolerance
    );
    if (!residual?.satisfied) return constraint;
  }
  return null;
}

function findExactBody(
  bodies: Map<string, Body[]>,
  instanceId: string,
  bodyId: string
): Body | undefined {
  return bodies.get(instanceId)?.find((body) => body.id === bodyId);
}

function selectGroundedInstances(instances: ComponentInstance[]): Set<string> {
  return new Set(instances
    .filter((instance) => instance.grounded)
    .map((instance) => instance.id)
    .sort());
}

function getViolatedLockedAxes(transform: number[], locks: LockedAxes): string[] {
  const matrix = new THREE.Matrix4().fromArray(transform);
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
  const candidates: Array<[keyof LockedAxes, number]> = [
    ['translateX', position.x],
    ['translateY', position.y],
    ['translateZ', position.z],
    ['rotateX', euler.x],
    ['rotateY', euler.y],
    ['rotateZ', euler.z],
  ];
  return candidates
    .filter(([axis, delta]) => locks[axis] && Math.abs(delta) > AXIS_TOLERANCE)
    .map(([axis]) => axis);
}

function getMateLocks(body: Body, faceId: string): LockedAxes {
  const face = body.faces.get(faceId);
  const plane = face ? body.planes.get(face.planeId) : undefined;
  if (!plane) return allAxesLocked();
  const normal = new THREE.Vector3(...plane.normal).normalize();
  const components = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const dominant = components.indexOf(Math.max(...components));
  if (components[dominant]! < 1 - 1e-6) {
    // Boolean axis locks cannot represent an oblique mate safely.
    return allAxesLocked();
  }
  return {
    translateX: dominant === 0,
    translateY: dominant === 1,
    translateZ: dominant === 2,
    rotateX: dominant !== 0,
    rotateY: dominant !== 1,
    rotateZ: dominant !== 2,
  };
}

function allAxesLocked(): LockedAxes {
  return {
    translateX: true,
    translateY: true,
    translateZ: true,
    rotateX: true,
    rotateY: true,
    rotateZ: true,
  };
}

function recordFailure(
  constraint: MateConstraint,
  state: Exclude<ConstraintRuntimeState, 'satisfied'>,
  message: string,
  statuses: Map<string, ConstraintRuntimeStatus>,
  errors: Map<string, string>,
  residual?: FlushMateCheck
): void {
  statuses.set(constraint.id, {
    state,
    ...(residual ? { residual } : {}),
    message,
  });
  errors.set(constraint.id, message);
}

function findDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function cloneInstance(instance: ComponentInstance): ComponentInstance {
  return {
    ...instance,
    transform: [...instance.transform],
    lockedAxes: { ...instance.lockedAxes },
  };
}

function cloneInstanceMap(
  instances: Map<string, ComponentInstance>
): Map<string, ComponentInstance> {
  return new Map(
    [...instances].map(([instanceId, instance]) => [
      instanceId,
      cloneInstance(instance),
    ])
  );
}

function cloneBodyMap(bodies: Map<string, Body[]>): Map<string, Body[]> {
  return new Map(
    [...bodies].map(([instanceId, instanceBodies]) => [
      instanceId,
      instanceBodies.map((body) => cloneBodyPreservingTopology(body)),
    ])
  );
}

function cloneBodyPreservingTopology(body: Body): Body {
  return transformBodyPreservingTopology(body, new THREE.Matrix4().identity());
}

function transformBodyPreservingTopology(body: Body, matrix: THREE.Matrix4): Body {
  const result = createBody(body.id, body.name);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const directionMatrix = new THREE.Matrix3().setFromMatrix4(matrix);

  for (const [vertexId, vertex] of body.vertices) {
    const position = new THREE.Vector3(...vertex.position).applyMatrix4(matrix);
    addVertex(
      result,
      createVertex([position.x, position.y, position.z], vertexId)
    );
  }
  for (const [edgeId, edge] of body.edges) {
    addEdge(
      result,
      createEdge(edge.vertexIds[0], edge.vertexIds[1], edgeId)
    );
  }
  for (const [planeId, plane] of body.planes) {
    const origin = new THREE.Vector3(...plane.origin).applyMatrix4(matrix);
    const normal = new THREE.Vector3(...plane.normal)
      .applyMatrix3(normalMatrix)
      .normalize();
    const uAxis = new THREE.Vector3(...plane.uAxis)
      .applyMatrix3(directionMatrix)
      .normalize();
    const vAxis = new THREE.Vector3(...plane.vAxis)
      .applyMatrix3(directionMatrix)
      .normalize();
    const transformed = createPlane(
      [origin.x, origin.y, origin.z],
      [normal.x, normal.y, normal.z]
    );
    transformed.uAxis = [uAxis.x, uAxis.y, uAxis.z];
    transformed.vAxis = [vAxis.x, vAxis.y, vAxis.z];
    addPlane(result, transformed, planeId);
  }
  for (const [faceId, face] of body.faces) {
    addFace(result, {
      ...createFace(
        face.planeId,
        face.boundaryEdgeIds,
        faceId,
        face.name
      ),
      ...(face.innerBoundaryEdgeIds
        ? {
            innerBoundaryEdgeIds: face.innerBoundaryEdgeIds.map((loop) => [
              ...loop,
            ]),
          }
        : {}),
    });
  }
  return result;
}

/**
 * Check all unsuppressed constraints against the supplied geometry.
 */
export function checkAllConstraints(
  context: ConstraintSolverContext
): Map<string, FlushMateCheck> {
  const results = new Map<string, FlushMateCheck>();
  const linearTolerance = context.tolerance ?? DEFAULT_TOLERANCE_POLICY.linear;
  const angularTolerance = context.tolerance ?? DEFAULT_TOLERANCE_POLICY.angular;

  for (const constraint of context.constraints) {
    if (constraint.suppressed) continue;
    const check = getConstraintResidual(
      constraint,
      context.instanceBodies,
      linearTolerance,
      angularTolerance
    );
    results.set(constraint.id, check ?? {
      satisfied: false,
      distance: Infinity,
      offsetError: Infinity,
      angularError: Infinity,
    });
  }

  return results;
}
