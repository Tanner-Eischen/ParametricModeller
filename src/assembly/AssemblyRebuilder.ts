import type { RebuildResult } from '../features/RebuildEngine';
import { error, type Diagnostic } from '../features/Diagnostics';
import type { Component, ComponentInstance, MateConstraint } from './AssemblyTypes';
import {
  createInstanceBody,
  rebuildWithComponents,
  type ComponentRebuildResult,
  type ComponentSourceBodyOwnership,
} from './ComponentRebuilder';
import {
  solveConstraints,
  type ConstraintRuntimeStatus,
} from './constraints/ConstraintSolver';

export interface AssemblyRebuildResult extends ComponentRebuildResult {
  /** Proposed state. Publish only when ok is true; failures retain input state. */
  instances: ComponentInstance[];
  constraints: MateConstraint[];
  constraintStatuses: Map<string, ConstraintRuntimeStatus>;
}

/** Reconstruct and validate an assembly transactionally from current feature outputs. */
export function rebuildAssembly(
  baseResult: RebuildResult,
  components: Component[],
  instances: ComponentInstance[],
  constraints: MateConstraint[],
  sourceBodyOwnership?: ComponentSourceBodyOwnership
): AssemblyRebuildResult {
  const originalInstances = structuredClone(instances);
  const originalConstraints = structuredClone(constraints);
  const initial = rebuildWithComponents(baseResult, components, instances, sourceBodyOwnership);
  const constraintStatuses = new Map<string, ConstraintRuntimeStatus>();
  if (!initial.ok) {
    for (const constraint of constraints) {
      if (!constraint.suppressed) constraintStatuses.set(constraint.id, {
        state: 'broken',
        message: initial.error ?? 'Assembly geometry is unavailable for constraint validation',
      });
    }
  }
  if (!initial.ok || constraints.every((constraint) => constraint.suppressed)) {
    return {
      ...initial,
      instances: originalInstances,
      constraints: originalConstraints,
      constraintStatuses,
    };
  }

  const solved = solveConstraints({
    instances: originalInstances,
    constraints: originalConstraints,
    instanceBodies: initial.instanceBodies,
    regenerateInstanceBodies: (instance) =>
      (initial.componentBodies.get(instance.componentId) ?? []).map((source) =>
        createInstanceBody(source, instance.id, instance.transform)
      ),
  });
  const diagnostics: Diagnostic[] = [...initial.diagnostics];
  for (const constraint of constraints) {
    if (constraint.suppressed) continue;
    const status = solved.constraintStatuses.get(constraint.id);
    if (status?.state === 'satisfied') continue;
    const state = status?.state ?? 'broken';
    diagnostics.push(error(
      `ASSEMBLY_CONSTRAINT_${state.toUpperCase()}`,
      status?.message ?? `Constraint ${constraint.name} could not be validated`,
      undefined,
      constraint.id
    ));
  }
  if (!solved.ok || !solved.committed || diagnostics.some((item) => item.severity === 'error')) {
    return failedAssembly(
      diagnostics,
      originalInstances,
      originalConstraints,
      solved.constraintStatuses
    );
  }

  const proposedInstances = instances.map((instance) => solved.updatedInstances.get(instance.id)!);
  // Recreate all output maps and lineage using solved transforms, rather than
  // publishing geometry or metadata from the pre-solve reconstruction.
  const rebuilt = rebuildWithComponents(baseResult, components, proposedInstances, sourceBodyOwnership);
  if (!rebuilt.ok) {
    return failedAssembly(rebuilt.diagnostics, originalInstances, originalConstraints, solved.constraintStatuses);
  }
  const proposedConstraints = originalConstraints.map((constraint) => {
    const status = solved.constraintStatuses.get(constraint.id);
    if (!status) return constraint;
    const updated = { ...constraint, satisfied: status.state === 'satisfied', status: status.state };
    if (status.message) updated.errorMessage = status.message;
    else delete updated.errorMessage;
    return updated;
  });
  return {
    ...rebuilt,
    instances: proposedInstances,
    constraints: proposedConstraints,
    constraintStatuses: solved.constraintStatuses,
  };
}

function failedAssembly(
  diagnostics: Diagnostic[],
  instances: ComponentInstance[],
  constraints: MateConstraint[],
  constraintStatuses: Map<string, ConstraintRuntimeStatus>
): AssemblyRebuildResult {
  return {
    ok: false,
    bodies: [],
    componentBodies: new Map(),
    instanceBodies: new Map(),
    instanceBodySourceIds: new Map(),
    componentSourceBodyIds: new Map(),
    topologyLineageByInstanceBodyId: new Map(),
    sourceIdByInstanceTopologyId: new Map(),
    diagnostics,
    error: diagnostics.find((item) => item.severity === 'error')?.message ?? 'Assembly constraints could not be solved',
    instances,
    constraints,
    constraintStatuses,
  };
}
