import { generateId } from '../core/id';
import type { Vertex } from './Vertex';
import type { Edge } from './Edge';
import type { Face } from './Face';
import type { Plane } from './Plane';

/**
 * A solid body in the B-Rep structure.
 * Contains all vertices, edges, faces, and planes.
 */
export interface Body {
  /** Unique identifier for this body */
  id: string;
  /** Name for display purposes */
  name: string;
  /** All vertices in this body, keyed by ID */
  vertices: Map<string, Vertex>;
  /** All edges in this body, keyed by ID */
  edges: Map<string, Edge>;
  /** All faces in this body, keyed by ID */
  faces: Map<string, Face>;
  /** All planes used by faces, keyed by ID */
  planes: Map<string, Plane>;
}

/**
 * Create an empty body.
 */
export function createBody(id?: string, name = 'Body'): Body {
  return {
    id: id ?? generateId(),
    name,
    vertices: new Map(),
    edges: new Map(),
    faces: new Map(),
    planes: new Map(),
  };
}

/**
 * Add a vertex to the body.
 * Returns the vertex ID.
 */
export function addVertex(body: Body, vertex: Vertex): string {
  body.vertices.set(vertex.id, vertex);
  return vertex.id;
}

/**
 * Add an edge to the body and update vertex edge references.
 */
export function addEdge(body: Body, edge: Edge): string {
  body.edges.set(edge.id, edge);

  // Update vertex edge references
  for (const vertexId of edge.vertexIds) {
    const vertex = body.vertices.get(vertexId);
    if (vertex) {
      body.vertices.set(vertexId, {
        ...vertex,
        edgeIds: [...vertex.edgeIds, edge.id],
      });
    }
  }

  return edge.id;
}

/**
 * Add a face to the body and update edge face references.
 */
export function addFace(body: Body, face: Face): string {
  body.faces.set(face.id, face);

  // Update edge face references
  for (const edgeId of face.boundaryEdgeIds) {
    const edge = body.edges.get(edgeId);
    if (edge) {
      body.edges.set(edgeId, {
        ...edge,
        faceIds: [...edge.faceIds, face.id],
      });
    }
  }

  return face.id;
}

/**
 * Add a plane to the body.
 */
export function addPlane(body: Body, plane: Plane, planeId: string): string {
  body.planes.set(planeId, plane);
  return planeId;
}

/**
 * Get a vertex by ID.
 */
export function getVertex(body: Body, vertexId: string): Vertex | undefined {
  return body.vertices.get(vertexId);
}

/**
 * Get an edge by ID.
 */
export function getEdge(body: Body, edgeId: string): Edge | undefined {
  return body.edges.get(edgeId);
}

/**
 * Get a face by ID.
 */
export function getFace(body: Body, faceId: string): Face | undefined {
  return body.faces.get(faceId);
}

/**
 * Get a plane by ID.
 */
export function getPlane(body: Body, planeId: string): Plane | undefined {
  return body.planes.get(planeId);
}

/**
 * Get all vertex positions as a flat array.
 */
export function getVertexPositions(body: Body): number[] {
  const positions: number[] = [];
  for (const vertex of body.vertices.values()) {
    positions.push(...vertex.position);
  }
  return positions;
}

/**
 * Get the bounding box of the body.
 */
export function getBodyBoundingBox(
  body: Body
): { min: [number, number, number]; max: [number, number, number] } {
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const vertex of body.vertices.values()) {
    min[0] = Math.min(min[0], vertex.position[0]);
    min[1] = Math.min(min[1], vertex.position[1]);
    min[2] = Math.min(min[2], vertex.position[2]);
    max[0] = Math.max(max[0], vertex.position[0]);
    max[1] = Math.max(max[1], vertex.position[1]);
    max[2] = Math.max(max[2], vertex.position[2]);
  }

  return { min, max };
}

/**
 * Clone a body with a new ID.
 */
export function cloneBody(body: Body, newId?: string): Body {
  return {
    id: newId ?? generateId(),
    name: body.name,
    vertices: new Map(body.vertices),
    edges: new Map(body.edges),
    faces: new Map(body.faces),
    planes: new Map(body.planes),
  };
}

/**
 * Serialize body to JSON-compatible format.
 */
export function serializeBody(body: Body): object {
  return {
    id: body.id,
    name: body.name,
    vertices: Array.from(body.vertices.entries()),
    edges: Array.from(body.edges.entries()),
    faces: Array.from(body.faces.entries()),
    planes: Array.from(body.planes.entries()),
  };
}

/**
 * Deserialize body from JSON format.
 */
export function deserializeBody(data: {
  id: string;
  name: string;
  vertices: [string, Vertex][];
  edges: [string, Edge][];
  faces: [string, Face][];
  planes: [string, Plane][];
}): Body {
  return {
    id: data.id,
    name: data.name,
    vertices: new Map(data.vertices),
    edges: new Map(data.edges),
    faces: new Map(data.faces),
    planes: new Map(data.planes),
  };
}
