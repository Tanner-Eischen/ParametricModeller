// Extrude Feature module (Milestone 02)

export {
  EXTRUDE_FEATURE_TYPE,
  defaultExtrudeParams,
  migrateExtrudeParams,
  validateExtrudeParams,
  getExtrudeDependencyIds,
  createExtrudePreviewPlan,
  executeExtrudePlan,
  rebuildExtrudeWithAdapter,
  rebuildExtrude,
  createExtrudeFeature,
  createExtrudeFeatureFromParams,
  updateExtrudeDistance,
  updateExtrudeFlip,
  getExtrudeParams,
  type ExtrudeOperation,
  type ExtrudeParams,
  type NormalizedExtrudeParams,
  type ExtrudePreviewPlan,
  type ExtrudePreviewPlanResult,
  type ExtrudeExecutionResult,
} from './ExtrudeFeature';

export {
  buildPrism,
  validatePrismParams,
  buildRectangularPrism,
  type PrismParams,
} from './PrismBuilder';

export {
  migrateExtrudeExtent,
  resolveExtrudeExtent,
  type ExtrudeExtentDirection,
  type ExtrudeExtentLimit,
  type ExtrudeExtentDefinition,
  type ResolvedExtrudeExtent,
  type ExtentResolutionError,
  type ExtentResolutionResult,
  type ExtentResolutionContext,
} from './ExtentResolver';

export {
  unavailableSolidBooleanAdapter,
  type SolidBooleanOperation,
  type SolidBooleanRequest,
  type SolidBooleanAdapterResult,
  type SolidBooleanAdapter,
} from './SolidBooleanAdapter';

export { prismaticSolidBooleanAdapter } from './PrismaticSolidBooleanAdapter';
