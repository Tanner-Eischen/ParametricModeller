import { generateId } from '../core/id';

/**
 * An edge in the B-Rep structure.
 * Represents a line segment between two vertices.
 * Can be shared by 1 (boundary) or 2 (interior) faces for manifold solids.
 */
export interface Edge {
  /** Unique identifier for this edge */
  id: string;
  /** IDs of the two endpoint vertices (ordered) */
  vertexIds: [string, string];
  /** IDs of adjacent faces (1 or 2 for manifold) */
  faceIds: string[];
}

/**
 * Create a new edge between two vertices.
 * Vertex IDs are stored in consistent order for hashing.
 */
export function createEdge(
  vertexId1: string,
  vertexId2: string,
  id?: string
): Edge {
  // Ensure consistent ordering for edge comparison
  const ordered: [string, string] = vertexId1 < vertexId2
    ? [vertexId1, vertexId2]
    : [vertexId2, vertexId1];

  return {
    id: id ?? generateId(),
    vertexIds: ordered,
    faceIds: [],
  };
}

/**
 * Add a face reference to an edge.
 * Returns a new edge with the face added.
 */
export function addFaceToEdge(edge: Edge, faceId: string): Edge {
  if (edge.faceIds.includes(faceId)) {
    return edge;
  }
  return {
    ...edge,
    faceIds: [...edge.faceIds, faceId],
  };
}

/**
 * Remove a face reference from an edge.
 * Returns a new edge with the face removed.
 */
export function removeFaceFromEdge(edge: Edge, faceId: string): Edge {
  return {
    ...edge,
    faceIds: edge.faceIds.filter((id) => id !== faceId),
  };
}

/**
 * Check if this edge is a boundary edge (only one adjacent face).
 */
export function isBoundaryEdge(edge: Edge): boolean {
  return edge.faceIds.length === 1;
}

/**
 * Check if this edge is a manifold edge (one or two adjacent faces).
 */
export function isManifoldEdge(edge: Edge): boolean {
  return edge.faceIds.length >= 1 && edge.faceIds.length <= 2;
}

/**
 * Check if the edge connects to a given vertex.
 */
export function edgeHasVertex(edge: Edge, vertexId: string): boolean {
  return edge.vertexIds[0] === vertexId || edge.vertexIds[1] === vertexId;
}

/**
 * Get the other vertex ID given one vertex ID.
 */
export function getOtherVertex(edge: Edge, vertexId: string): string | null {
  if (edge.vertexIds[0] === vertexId) return edge.vertexIds[1];
  if (edge.vertexIds[1] === vertexId) return edge.vertexIds[0];
  return null;
}

/**
 * Create a unique key for edge lookup by vertex pair.
 */
export function getEdgeKey(vertexId1: string, vertexId2: string): string {
  return vertexId1 < vertexId2
    ? `${vertexId1}:${vertexId2}`
    : `${vertexId2}:${vertexId1}`;
}
