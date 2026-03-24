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
} from './Validation';

// Triangulator
export type { TriangulationResult } from './Triangulator';
export {
  triangulateFace,
  triangulateBody,
  createBufferGeometry,
  createWireframeGeometry,
} from './Triangulator';

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
