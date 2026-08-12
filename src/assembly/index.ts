/**
 * Assembly Module - Milestone 06: Assembly-lite
 *
 * Components, instances, and constraints for parametric assemblies.
 */

// Types
export {
  type Component,
  type ComponentInstance,
  type LockedAxes,
  type MateConstraint,
  type InstanceFaceRef,
  type AssemblyData,
  createComponent,
  createComponentInstance,
  createMateConstraint,
  createInstanceFaceRef,
  createDefaultLockedAxes,
  createIdentityTransform,
  createTranslationTransform,
  createDefaultAssemblyData,
  lockedAxesConflict,
  mergeLockedAxes,
} from './AssemblyTypes';

// Component feature
export {
  CREATE_COMPONENT_FEATURE_TYPE,
  type CreateComponentParams,
  createComponentFeature,
  validateCreateComponentParams,
  rebuildCreateComponent,
} from './CreateComponentFeature';

// Component rebuilder
export {
  ComponentRebuildErrorCodes,
  type ComponentRebuildResult,
  type ComponentSourceBodyOwnership,
  type InstanceBodyCloneResult,
  type InstanceBodyTopologyLineage,
  type AssemblyDataProvider,
  createInstanceBody,
  createInstanceBodyWithLineage,
  rebuildWithComponents,
  createComponentAwareRebuild,
} from './ComponentRebuilder';

// Constraints
export {
  MATE_CONSTRAINT_TYPE,
  type MateConstraintParams,
  MateConstraintErrorCodes,
  validateMateConstraintParams,
  canSolveConstraint,
} from './constraints/MateConstraint';

export {
  type FlushMateResult,
  type FlushMateCheck,
  solveFlushMate,
  checkFlushMate,
} from './constraints/FlushMateSolver';

export {
  type ConstraintRuntimeState,
  type ConstraintRuntimeStatus,
  type ConstraintSolverResult,
  type ConstraintSolverContext,
  solveConstraints,
  checkAllConstraints,
} from './constraints/ConstraintSolver';
