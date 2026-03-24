import { generateId } from '../core/id';

/**
 * A face in the B-Rep structure.
 * Represents a planar region bounded by edges.
 */
export interface Face {
  /** Unique identifier for this face */
  id: string;
  /** ID of the plane this face lies on */
  planeId: string;
  /** IDs of edges forming the outer boundary (ordered, CCW when viewed from outside) */
  boundaryEdgeIds: string[];
  /** Stable name for deterministic topology (e.g., "+X", "-Z") */
  name?: string;
}

/**
 * Create a new face on the given plane with boundary edges.
 */
export function createFace(
  planeId: string,
  boundaryEdgeIds: string[],
  id?: string,
  name?: string
): Face {
  const face: Face = {
    id: id ?? generateId(),
    planeId,
    boundaryEdgeIds: [...boundaryEdgeIds],
  };
  if (name !== undefined) {
    face.name = name;
  }
  return face;
}

/**
 * Get the number of edges in the face boundary.
 */
export function getFaceEdgeCount(face: Face): number {
  return face.boundaryEdgeIds.length;
}

/**
 * Check if a face contains a specific edge.
 */
export function faceHasEdge(face: Face, edgeId: string): boolean {
  return face.boundaryEdgeIds.includes(edgeId);
}

/**
 * Replace an edge ID in the face boundary.
 */
export function replaceEdgeInFace(face: Face, oldEdgeId: string, newEdgeId: string): Face {
  return {
    ...face,
    boundaryEdgeIds: face.boundaryEdgeIds.map((id) =>
      id === oldEdgeId ? newEdgeId : id
    ),
  };
}
