// Features module - Feature System v1

export {
  type FeatureRecord,
  createFeatureRecord,
  updateFeatureParameters,
  setFeatureSuppressed,
  addOutputRef,
  isBaseFeature,
  serializeFeature,
  deserializeFeature,
} from './FeatureRecord';

export {
  type FeatureReference,
  type FeatureOutput,
  normalizeFeatureReference,
  getReferencedFeatureId,
  createSketchOutput,
  createBodyOutput,
  getFeatureOutputId,
} from './FeatureReferences';

export {
  type DependencyGraph,
  createDependencyGraph,
} from './DependencyGraph';

export {
  type FeatureDependencyOperation,
  type FeatureDependencyPlanOptions,
  type FeatureDependencyOperationPlan,
  planFeatureDependencyOperation,
  planFeatureRemoval,
  planFeatureSuppression,
} from './FeatureDependencyOperations';

export {
  type RebuildContext,
  createRebuildContext,
  setCurrentFeature,
  registerBodies,
  registerFeatureOutputs,
  getFeatureById,
  getFeatureOutputs,
  resolveSketch,
  getBodiesByFeature,
  getBodyByFeature,
  getAllBodies,
} from './RebuildContext';

export {
  type RebuildHandlerResult,
  type FeatureRebuildHandler,
  type RebuildResult,
  createRebuildEngine,
} from './RebuildEngine';

export {
  type Diagnostic,
  type DiagnosticSeverity,
  error,
  warning,
  info,
  hasErrors,
  getErrors,
  getWarnings,
  formatDiagnostic,
} from './Diagnostics';

// Primitive features
export * from './primitives';

// Sketch feature (Milestone 02)
export * from './sketch';

// Extrude feature (Milestone 02)
export * from './extrude';

// OffsetFace feature (Milestone 03)
export * from './offsetFace';

// ExtrudeCut feature (Milestone 04)
export * from './cut';

// Pattern features (Milestone 05)
export * from './pattern';

// Fillet feature
export * from './fillet';

// Assembly module (Milestone 06)
export * from '../assembly';

// Vertex feature (Milestone 07)
export * from './vertex';

// Transform features
export * from './transform';

// Angled cut / end trim feature
export * from './miter';

// Explicit solid Boolean features
export * from './boolean';

// Stable reference-based rigid body placement
export * from './placement';

// Guarded, history-based woodworking joints and manufacturing intent
export * from './joints';

// Independent baked-body snapshot (first-class body with no source dependency)
export * from './bake';

// Guarded direct resize using exact world-axis dimensions
export * from './resize';
