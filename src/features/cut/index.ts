// Cut feature module - Milestone 04

export {
  type BodyRef,
  type ExtrudeCutParams,
  type NormalizedExtrudeCutParams,
  type ExtrudeCutPreviewPlan,
  type ExtrudeCutPreviewPlanResult,
  defaultExtrudeCutParams,
  EXTRUDE_CUT_FEATURE_TYPE,
  migrateExtrudeCutParams,
  validateExtrudeCutParams,
  getExtrudeCutDependencyIds,
  createExtrudeCutPreviewPlan,
  rebuildExtrudeCutWithAdapter,
  rebuildExtrudeCut,
  createExtrudeCutFeature,
  createExtrudeCutFeatureFromParams,
  updateExtrudeCutDistance,
  updateExtrudeCutMode,
  updateExtrudeCutFlip,
  getExtrudeCutParams,
  createBodyRef,
} from './ExtrudeCutFeature';
