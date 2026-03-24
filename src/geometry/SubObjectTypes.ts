/**
 * Sub-object types for vertex-level editing (Milestone 07).
 * Provides types for selecting and referencing sub-objects within bodies.
 */

/**
 * Selection modes for sub-object selection.
 */
export type SubObjectType = 'body' | 'face' | 'edge' | 'vertex';

/**
 * Reference to a vertex within a body.
 * Provides stable reference for vertex operations across rebuilds.
 */
export interface VertexRef {
  /** Feature ID that owns the body */
  featureId: string;
  /** Body ID containing the vertex */
  bodyId: string;
  /** Vertex ID within the body */
  vertexId: string;
}

/**
 * Reference to an edge within a body.
 */
export interface EdgeRef {
  /** Feature ID that owns the body */
  featureId: string;
  /** Body ID containing the edge */
  bodyId: string;
  /** Edge ID within the body */
  edgeId: string;
}

/**
 * Reference to a face within a body.
 * Re-exported from OffsetFaceFeature for consistency.
 */
export interface FaceRef {
  /** Feature ID that owns the body */
  featureId: string;
  /** Body ID containing the face */
  bodyId: string;
  /** Face ID within the body */
  faceId: string;
}

/**
 * Reference to a body.
 */
export interface BodyRef {
  /** Feature ID that created the body */
  featureId: string;
  /** Body ID */
  bodyId: string;
}

/**
 * Union type for all sub-object references.
 */
export type SubObjectRef = BodyRef | FaceRef | EdgeRef | VertexRef;

/**
 * Selection set for sub-objects.
 * Tracks the current selection mode and selected references.
 */
export interface SubObjectSelection {
  /** Current selection mode */
  mode: SubObjectType;
  /** Selected sub-object references */
  refs: SubObjectRef[];
}

/**
 * Default tolerance for planarity checks (in mm).
 */
export const PLANARITY_TOLERANCE = 0.001;

/**
 * Default tolerance for screen-space picking (in pixels).
 */
export const PICKING_TOLERANCE_PX = 10;

/**
 * Create a vertex reference.
 */
export function createVertexRef(
  featureId: string,
  bodyId: string,
  vertexId: string
): VertexRef {
  return { featureId, bodyId, vertexId };
}

/**
 * Create an edge reference.
 */
export function createEdgeRef(
  featureId: string,
  bodyId: string,
  edgeId: string
): EdgeRef {
  return { featureId, bodyId, edgeId };
}

/**
 * Create a face reference.
 */
export function createFaceRef(
  featureId: string,
  bodyId: string,
  faceId: string
): FaceRef {
  return { featureId, bodyId, faceId };
}

/**
 * Create a body reference.
 */
export function createBodyRef(
  featureId: string,
  bodyId: string
): BodyRef {
  return { featureId, bodyId };
}

/**
 * Create an empty sub-object selection.
 */
export function createEmptySelection(mode: SubObjectType = 'body'): SubObjectSelection {
  return { mode, refs: [] };
}

/**
 * Check if two vertex refs are equal.
 */
export function vertexRefsEqual(a: VertexRef, b: VertexRef): boolean {
  return a.featureId === b.featureId &&
         a.bodyId === b.bodyId &&
         a.vertexId === b.vertexId;
}

/**
 * Check if two edge refs are equal.
 */
export function edgeRefsEqual(a: EdgeRef, b: EdgeRef): boolean {
  return a.featureId === b.featureId &&
         a.bodyId === b.bodyId &&
         a.edgeId === b.edgeId;
}

/**
 * Check if two face refs are equal.
 */
export function faceRefsEqual(a: FaceRef, b: FaceRef): boolean {
  return a.featureId === b.featureId &&
         a.bodyId === b.bodyId &&
         a.faceId === b.faceId;
}

/**
 * Check if two body refs are equal.
 */
export function bodyRefsEqual(a: BodyRef, b: BodyRef): boolean {
  return a.featureId === b.featureId &&
         a.bodyId === b.bodyId;
}

/**
 * Check if a reference is a VertexRef.
 */
export function isVertexRef(ref: SubObjectRef): ref is VertexRef {
  return 'vertexId' in ref;
}

/**
 * Check if a reference is an EdgeRef.
 */
export function isEdgeRef(ref: SubObjectRef): ref is EdgeRef {
  return 'edgeId' in ref;
}

/**
 * Check if a reference is a FaceRef.
 */
export function isFaceRef(ref: SubObjectRef): ref is FaceRef {
  return 'faceId' in ref;
}

/**
 * Check if a reference is a BodyRef.
 */
export function isBodyRef(ref: SubObjectRef): ref is BodyRef {
  return 'bodyId' in ref && !('faceId' in ref) && !('edgeId' in ref) && !('vertexId' in ref);
}

/**
 * Get a unique string key for a vertex ref.
 */
export function getVertexRefKey(ref: VertexRef): string {
  return `${ref.featureId}:${ref.bodyId}:${ref.vertexId}`;
}

/**
 * Get a unique string key for an edge ref.
 */
export function getEdgeRefKey(ref: EdgeRef): string {
  return `${ref.featureId}:${ref.bodyId}:${ref.edgeId}`;
}

/**
 * Get a unique string key for a face ref.
 */
export function getFaceRefKey(ref: FaceRef): string {
  return `${ref.featureId}:${ref.bodyId}:${ref.faceId}`;
}

/**
 * Get a unique string key for a body ref.
 */
export function getBodyRefKey(ref: BodyRef): string {
  return `${ref.featureId}:${ref.bodyId}`;
}

/**
 * Add a sub-object reference to a selection.
 */
export function addToSelection(
  selection: SubObjectSelection,
  ref: SubObjectRef
): SubObjectSelection {
  // Check if already selected
  if (selection.refs.some(r => refsEqual(r, ref))) {
    return selection;
  }
  return {
    ...selection,
    refs: [...selection.refs, ref],
  };
}

/**
 * Remove a sub-object reference from a selection.
 */
export function removeFromSelection(
  selection: SubObjectSelection,
  ref: SubObjectRef
): SubObjectSelection {
  return {
    ...selection,
    refs: selection.refs.filter(r => !refsEqual(r, ref)),
  };
}

/**
 * Clear all selections.
 */
export function clearSelection(selection: SubObjectSelection): SubObjectSelection {
  return {
    ...selection,
    refs: [],
  };
}

/**
 * Change the selection mode.
 */
export function setSelectionMode(
  selection: SubObjectSelection,
  mode: SubObjectType
): SubObjectSelection {
  // Clear selection when changing modes
  return { mode, refs: [] };
}

/**
 * Check if a ref is in the selection.
 */
export function isSelected(selection: SubObjectSelection, ref: SubObjectRef): boolean {
  return selection.refs.some(r => refsEqual(r, ref));
}

/**
 * Check if two sub-object refs are equal.
 */
function refsEqual(a: SubObjectRef, b: SubObjectRef): boolean {
  if (isVertexRef(a) && isVertexRef(b)) return vertexRefsEqual(a, b);
  if (isEdgeRef(a) && isEdgeRef(b)) return edgeRefsEqual(a, b);
  if (isFaceRef(a) && isFaceRef(b)) return faceRefsEqual(a, b);
  if (isBodyRef(a) && isBodyRef(b)) return bodyRefsEqual(a, b);
  return false;
}

// ============================================================================
// Geometry Utilities (Milestone 07)
// ============================================================================

import type { Body } from './Body';
import type { Vertex } from './Vertex';
import type { Edge } from './Edge';
import type { Face } from './Face';

/**
 * Get all vertex IDs for a face.
 * Traverses the face's boundary edges to collect all vertex IDs.
 */
export function getFaceVertexIds(body: Body, faceId: string): string[] {
  const face = body.faces.get(faceId);
  if (!face) return [];

  const vertexIds: string[] = [];
  const visitedVertices = new Set<string>();

  for (const edgeId of face.boundaryEdgeIds) {
    const edge = body.edges.get(edgeId);
    if (!edge) continue;

    for (const vertexId of edge.vertexIds) {
      if (!visitedVertices.has(vertexId)) {
        visitedVertices.add(vertexId);
        vertexIds.push(vertexId);
      }
    }
  }

  return vertexIds;
}

/**
 * Get all face IDs adjacent to a vertex.
 * A face is adjacent to a vertex if the vertex is on the face's boundary.
 */
export function getAdjacentFaceIds(body: Body, vertexId: string): string[] {
  const vertex = body.vertices.get(vertexId);
  if (!vertex) return [];

  const adjacentFaceIds: string[] = [];
  const visitedFaces = new Set<string>();

  // Traverse all edges connected to this vertex
  for (const edgeId of vertex.edgeIds) {
    const edge = body.edges.get(edgeId);
    if (!edge) continue;

    // Each edge may have 1-2 adjacent faces
    for (const faceId of edge.faceIds) {
      if (!visitedFaces.has(faceId)) {
        visitedFaces.add(faceId);
        adjacentFaceIds.push(faceId);
      }
    }
  }

  return adjacentFaceIds;
}

/**
 * Compute the plane equation from 3 non-collinear points.
 * Returns the normal vector (a, b, c) and the d coefficient (ax + by + cz + d = 0).
 */
export function computePlaneEquation(
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): { normal: [number, number, number]; d: number } {
  // Compute two vectors on the plane
  const v1: [number, number, number] = [
    p2[0] - p1[0],
    p2[1] - p1[1],
    p2[2] - p1[2],
  ];
  const v2: [number, number, number] = [
    p3[0] - p1[0],
    p3[1] - p1[1],
    p3[2] - p1[2],
  ];

  // Cross product to get normal
  const normal: [number, number, number] = [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0],
  ];

  // Normalize
  const length = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
  if (length > 0) {
    normal[0] /= length;
    normal[1] /= length;
    normal[2] /= length;
  }

  // d = -(ax + by + cz) for any point on the plane
  const d = -(normal[0] * p1[0] + normal[1] * p1[1] + normal[2] * p1[2]);

  return { normal, d };
}

/**
 * Check if a point lies on a plane within tolerance.
 */
function pointOnPlane(
  point: [number, number, number],
  normal: [number, number, number],
  d: number,
  tolerance: number
): boolean {
  const distance = Math.abs(normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + d);
  return distance < tolerance;
}

/**
 * Check if moving a vertex would preserve planarity of adjacent faces.
 * Returns ok: true if the move is valid, or ok: false with list of violating faces.
 */
export function checkPlanarityPreservation(
  body: Body,
  vertexId: string,
  newPosition: [number, number, number]
): { ok: true } | { ok: false; violatingFaces: string[] } {
  const adjacentFaceIds = getAdjacentFaceIds(body, vertexId);
  const violatingFaces: string[] = [];

  // Create a temporary body clone with the moved vertex for checking
  const tempVertices = new Map(body.vertices);
  const originalVertex = tempVertices.get(vertexId);
  if (originalVertex) {
    tempVertices.set(vertexId, {
      ...originalVertex,
      position: newPosition,
    });
  }

  for (const faceId of adjacentFaceIds) {
    const vertexIds = getFaceVertexIds(body, faceId);

    // Need at least 3 vertices to define a plane
    if (vertexIds.length < 3) continue;

    // Get all vertex positions (with the moved vertex)
    const positions: [number, number, number][] = vertexIds.map(vid => {
      const v = tempVertices.get(vid);
      return v ? v.position : [0, 0, 0];
    });

    // Compute plane from first 3 vertices
    const { normal, d } = computePlaneEquation(
      positions[0]!,
      positions[1]!,
      positions[2]!
    );

    // Check if all other vertices lie on this plane
    let isPlanar = true;
    for (let i = 3; i < positions.length; i++) {
      if (!pointOnPlane(positions[i]!, normal, d, PLANARITY_TOLERANCE)) {
        isPlanar = false;
        break;
      }
    }

    if (!isPlanar) {
      violatingFaces.push(faceId);
    }
  }

  if (violatingFaces.length > 0) {
    return { ok: false, violatingFaces };
  }

  return { ok: true };
}
