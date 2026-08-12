export type {
  PlacementReferenceBase,
  BodyPlacementRef,
  FacePlacementRef,
  EdgePlacementRef,
  VertexPlacementRef,
  EdgePointPlacementRef,
  FaceCenterPlacementRef,
  PlacementReference,
  PlacementDatumRef,
  PlacementPointRef,
  PlacementFrameRef,
  PlacementResolution,
} from './PlacementReferences';
export {
  createBodyPlacementRef,
  createFacePlacementRef,
  createEdgePlacementRef,
  createVertexPlacementRef,
  createEdgePointPlacementRef,
  createFaceCenterPlacementRef,
  createPlacementBodyRef,
  createPlacementFaceRef,
  createPlacementEdgeRef,
  createPlacementVertexRef,
  createPlacementEdgePointRef,
  createPlacementFaceCenterRef,
  getPlacementReferenceFeatureIds,
  resolvePlacementBody,
  deriveBodyCoordinateFrame,
  deriveFaceCoordinateFrame,
  deriveEdgeCoordinateFrame,
  resolvePlacementFrame,
  resolvePlacementPoint,
} from './PlacementReferences';

export type {
  PointToPointPlacement,
  AlignPlacement,
  AxisAnglePlacement,
  FreePlacement,
  FixedMatrixPlacement,
  Placement,
  PlacementSolveResult,
} from './PlacementSolver';
export {
  createPointToPointPlacement,
  createAlignPlacement,
  createAxisAnglePlacement,
  createFreePlacement,
  createFixedMatrixPlacement,
  validatePlacementDefinition,
  getPlacementReferences,
  solvePlacementMatrix,
  solvePlacement,
} from './PlacementSolver';

export type {
  TransformBodiesMode,
  TransformBodiesParams,
} from './TransformBodiesFeature';
export {
  TRANSFORM_BODIES_FEATURE_TYPE,
  validateTransformBodiesParams,
  createTransformBodiesFeature,
  rebuildTransformBodies,
  normalizeTransformBodiesParams,
  collectTransformBodiesDependencyIds,
} from './TransformBodiesFeature';
