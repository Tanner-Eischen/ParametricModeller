import { generateId } from '../core/id';
import { DEFAULT_TOLERANCE_POLICY } from './TolerancePolicy';

/**
 * A vertex in the B-Rep structure.
 * Represents a point in 3D space with references to connected edges.
 */
export interface Vertex {
  /** Unique identifier for this vertex */
  id: string;
  /** 3D position of the vertex */
  position: [number, number, number];
  /** IDs of edges connected to this vertex */
  edgeIds: string[];
}

/**
 * Create a new vertex at the given position.
 */
export function createVertex(
  position: [number, number, number],
  id?: string
): Vertex {
  return {
    id: id ?? generateId(),
    position: [...position],
    edgeIds: [],
  };
}

/**
 * Add an edge reference to a vertex.
 * Returns a new vertex with the edge added.
 */
export function addEdgeToVertex(vertex: Vertex, edgeId: string): Vertex {
  if (vertex.edgeIds.includes(edgeId)) {
    return vertex;
  }
  return {
    ...vertex,
    edgeIds: [...vertex.edgeIds, edgeId],
  };
}

/**
 * Remove an edge reference from a vertex.
 * Returns a new vertex with the edge removed.
 */
export function removeEdgeFromVertex(vertex: Vertex, edgeId: string): Vertex {
  return {
    ...vertex,
    edgeIds: vertex.edgeIds.filter((id) => id !== edgeId),
  };
}

/**
 * Check if two vertices are at the same position within tolerance.
 */
export function verticesEqual(
  a: Vertex,
  b: Vertex,
  tolerance = DEFAULT_TOLERANCE_POLICY.linear
): boolean {
  return (
    Math.abs(a.position[0] - b.position[0]) < tolerance &&
    Math.abs(a.position[1] - b.position[1]) < tolerance &&
    Math.abs(a.position[2] - b.position[2]) < tolerance
  );
}

/**
 * Get the position as a tuple (for serialization).
 */
export function getVertexPosition(vertex: Vertex): [number, number, number] {
  return [...vertex.position];
}
