// Geometry module - Planar B-Rep Core (Milestone 01)

// Plane
export type { Plane } from './Plane';
export {
  createPlane,
  createXYPlane,
  createXZPlane,
  createYZPlane,
  distanceToPoint,
  projectPoint,
  pointOnPlane,
} from './Plane';

// Vertex
export type { Vertex } from './Vertex';
export {
  createVertex,
  addEdgeToVertex,
  removeEdgeFromVertex,
  verticesEqual,
  getVertexPosition,
} from './Vertex';

// Edge
export type { Edge } from './Edge';
export {
  createEdge,
  addFaceToEdge,
  removeFaceFromEdge,
  isBoundaryEdge,
  isManifoldEdge,
  edgeHasVertex,
  getOtherVertex,
  getEdgeKey,
} from './Edge';

// Face
export type { Face } from './Face';
export {
  createFace,
  getFaceEdgeCount,
  faceHasEdge,
  replaceEdgeInFace,
} from './Face';

// Body
export type { Body } from './Body';
export {
  createBody,
  addVertex,
  addEdge,
  addFace,
  addPlane,
  getVertex,
  getEdge,
  getFace,
  getPlane,
  getVertexPositions,
  getBodyBoundingBox,
  cloneBody,
  serializeBody,
  deserializeBody,
} from './Body';

// Validation
export type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './Validation';
export {
  validateBody,
  isManifoldEdge as validateManifoldEdge,
  validateUniqueVertices,
  validateClosedManifoldBody,
} from './Validation';

// Triangulator
export type { TriangulationResult } from './Triangulator';
export {
  triangulateFace,
  triangulateBody,
  createBufferGeometry,
  createWireframeGeometry,
  getOrderedLoopVertices,
} from './Triangulator';

// Deterministic planar regions and restricted same-frame prismatic booleans
export type {
  PlanarPoint,
  PlanarLoop,
  PlanarRegion,
  PlanarRegionDiagnosticCode,
  PlanarRegionDiagnostic,
  PlanarRegionResult,
  PlanarTriangulation,
} from './PlanarRegion';
export {
  normalizePlanarRegion,
  triangulatePlanarRegion,
  signedPlanarArea,
  isPointStrictlyInsideRegion,
  loopsContact,
} from './PlanarRegion';
export type {
  PrismaticFrame,
  PrismaticBodyDefinition,
  PrismaticBooleanDiagnosticCode,
  PrismaticBooleanDiagnostic,
  PrismaticBooleanResult,
  PrismaticDifferenceRequest,
  PrismaticUnionRequest,
} from './PrismaticBoolean';
export {
  createPrismaticBody,
  differencePrismatic,
  unionPrismatic,
  planarRegionArea,
} from './PrismaticBoolean';
export type {
  PlanarBooleanOperation,
  PlanarBooleanRequest,
  PlanarBooleanResult,
  BooleanDiagnosticCode,
  BooleanDiagnostic,
  TopologyProvenance,
} from './PlanarBooleanKernel';
export { executePlanarBoolean } from './PlanarBooleanKernel';

// Construction Plane (Milestone 02)
export type { ConstructionPlane } from './ConstructionPlane';
export {
  createWorldConstructionPlane,
  createFaceConstructionPlane,
  getConstructionPlaneFromRef,
  sketchToWorld,
  worldToSketch,
  sketchPointsToWorld,
  worldPointsToSketch,
  getSketchToWorldMatrix,
  planesAreEquivalent,
  getDefaultSketchPlane,
  getStandardWorldPlanes,
  offsetConstructionPlane,
  flipConstructionPlane,
} from './ConstructionPlane';

// Face Offset (Milestone 03)
export type { OffsetFaceResult } from './FaceOffset';
export {
  validateOffsetFace,
  offsetFace,
} from './FaceOffset';

// Deterministic convex planar-body splitting for miter/cross cuts
export type {
  PlanarBodySplitDiagnosticCode,
  PlanarBodySplitFailure,
  PlanarBodySplitSuccess,
  PlanarBodySplitResult,
  PlanarBodySplitOptions,
} from './PlanarBodySplit';
export { splitConvexBodyByPlane } from './PlanarBodySplit';

// Cut Builder (Milestone 04)
export type { CutValidationResult } from './CutBuilder';
export {
  validateCutOperation,
  computeThroughCutDepth,
  performCut,
} from './CutBuilder';

// Transform Utils (Milestone 05)
export {
  translateBody,
  mirrorBody,
  transformVertexPositions,
  combineBodies,
} from './TransformUtils';

// Sub-object Types (Milestone 07)
export type {
  SubObjectType,
  VertexRef,
  EdgeRef,
  FaceRef,
  BodyRef,
  SubObjectRef,
  SubObjectSelection,
} from './SubObjectTypes';
export {
  PLANARITY_TOLERANCE,
  PICKING_TOLERANCE_PX,
  createVertexRef,
  createEdgeRef,
  createFaceRef,
  createBodyRef,
  createEmptySelection,
  vertexRefsEqual,
  edgeRefsEqual,
  faceRefsEqual,
  bodyRefsEqual,
  isVertexRef,
  isEdgeRef,
  isFaceRef,
  isBodyRef,
  getVertexRefKey,
  getEdgeRefKey,
  getFaceRefKey,
  getBodyRefKey,
  addToSelection,
  removeFromSelection,
  clearSelection,
  setSelectionMode,
  isSelected,
  getAdjacentFaceIds,
  getFaceVertexIds,
  checkPlanarityPreservation,
  computePlaneEquation,
} from './SubObjectTypes';

// Planarity Guard (Milestone 07)
export {
  isPolygonPlanar,
  distanceFromPlane,
} from './PlanarityGuard';

// Deterministic geometry snapshots (Phase 0 regression infrastructure)
export type { GeometryHashOptions, BodyMeasurements } from './GeometryHash';
export {
  canonicalizeGeometry,
  hashGeometry,
  hashBodyGeometry,
  measureBody,
} from './GeometryHash';

// Central numeric policy and deterministic topology allocation (Phase 1)
export type { TolerancePolicy } from './TolerancePolicy';
export {
  DEFAULT_TOLERANCE_POLICY,
  createTolerancePolicy,
  approximatelyEqual,
  quantizeToTolerance,
} from './TolerancePolicy';
export type { TopologyEntityKind } from './TopologyIdAllocator';
export {
  TopologyIdAllocator,
  createTopologyId,
  createTopologyIdAllocator,
} from './TopologyIdAllocator';

// Right-handed rigid coordinate frames for reference-based placement
export type {
  Vector3Tuple,
  Matrix4Tuple,
  CoordinateFrame3D,
} from './CoordinateFrame3D';
export {
  createCoordinateFrame3D,
  createCoordinateFrameFromZAxis,
  createCoordinateFrameFromXAxis,
  isRightHandedCoordinateFrame,
  coordinateFrameToMatrix,
  coordinateFrameToMatrixTuple,
  coordinateFrameFromMatrix,
  transformCoordinateFrame,
} from './CoordinateFrame3D';
