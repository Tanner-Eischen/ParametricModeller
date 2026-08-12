// Sketch module - 2D Sketch Entities and Profile Extraction (Milestone 02)

// Types
export type {
  PlaneRef,
  Point2D,
  SketchEntityBase,
  RectangleEntity,
  LineEntity,
  SketchEntity,
  SketchDimension,
  Sketch,
  Profile2D,
} from './SketchTypes';

// Factory functions
export {
  createWorldPlaneRef,
  createFacePlaneRef,
  createRectangleEntity,
  createLineEntity,
  createSketchDimension,
  createSketch,
  addEntityToSketch,
  addDimensionToSketch,
  updateEntityInSketch,
  getEntityById,
  getRectangles,
  validateRectangle,
  getRectangleCorners,
  serializePlaneRef,
  deserializePlaneRef,
  serializeSketchEntity,
  deserializeSketchEntity,
  serializeSketch,
  deserializeSketch,
} from './SketchTypes';

// Profile extraction
export {
  extractProfiles,
  getProfileForEntity,
  getProfileByIndex,
  isProfileValidForExtrude,
  calculateProfileArea,
  getProfileCentroid,
  getProfileBounds,
  isPointInProfile,
} from './ProfileExtractor';

// Professional shared-point sketch model and immutable editing operations
export type {
  SketchPoint,
  SketchSegmentReference,
  ProjectedModelEdgeSourceRef,
  NormalizedSketchGeometry,
  NormalizeLineOptions,
  NormalizedSketchIssue,
  NormalizedSketchIssueCode,
} from './NormalizedSketch';
export type {
  ModelEdgeProjectionErrorCode,
  ModelEdgeProjectionError,
  ModelEdgeProjectionOptions,
  ModelEdgeProjectionResult,
  ProjectedModelEdgeRefreshResult,
} from './ModelEdgeProjection';
export {
  getProjectedModelEdgeSourceFeatureIds,
  projectModelEdgeToSketch,
  refreshProjectedModelEdges,
} from './ModelEdgeProjection';
export {
  NORMALIZED_SKETCH_SCHEMA_VERSION,
  normalizeLineEntities,
  normalizeSketchEntities,
  validateNormalizedSketch,
  materializeLineEntities,
  toProfileSegments,
  cloneNormalizedSketch,
  legacyRectangleEdgeId,
} from './NormalizedSketch';
export type {
  SketchConstraint,
  SketchRelation,
  DrivingDistanceDimension,
} from './SketchConstraints';
export type {
  SketchEditErrorCode,
  SketchEditError,
  SketchGeometryEditResult,
  SketchRelationEditResult,
  PolylineOptions,
  TrimSegmentSide,
  TrimStraightSegmentOptions,
} from './SketchEditing';
export {
  appendSharedPointRectangle,
  appendCenterRectangle,
  appendRegularPolygon,
  appendSharedPointPolyline,
  moveSketchPoint,
  addSketchRelation,
  addDrivingDistanceDimension,
  trimStraightSegment,
  extendStraightSegment,
  projectStraightSegments,
} from './SketchEditing';

// Professional sketch foundations (Phase 3)
export * from './ProfileAnalyzer';
export * from './SketchInference';
export * from './SketchPrimitives';
export * from './NormalizedSketch';
export * from './SketchConstraints';
export * from './SketchConstraintSolver';
export * from './SketchSelection';
export * from './SketchRegions';
export * from './NormalizedSketchV2';
