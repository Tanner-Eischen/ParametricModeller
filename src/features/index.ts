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
  type RebuildContext,
  createRebuildContext,
  setCurrentFeature,
  registerBodies,
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

// Assembly module (Milestone 06)
export * from '../assembly';

// Vertex feature (Milestone 07)
export * from './vertex';
