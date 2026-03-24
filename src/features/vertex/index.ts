/**
 * Vertex feature module index (Milestone 07).
 * Provides MoveVertex feature for vertex-level editing.
 */

// Feature exports
export {
  MOVE_VERTEX_FEATURE_TYPE,
  rebuildMoveVertex,
  createMoveVertexFeature,
  validateMoveVertexParams,
  defaultMoveVertexParams,
} from './MoveVertexFeature';

// Type exports
export type {
  MoveVertexParams,
  MoveConstraint,
} from './MoveVertexFeature';
