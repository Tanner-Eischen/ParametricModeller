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
