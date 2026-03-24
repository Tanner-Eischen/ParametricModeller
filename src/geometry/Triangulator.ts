import * as THREE from 'three';
import type { Body } from './Body';
import type { Face } from './Face';
import type { Plane } from './Plane';
import type { Vertex } from './Vertex';
import { distanceToPoint } from './Plane';

/**
 * Result of face triangulation.
 */
export interface TriangulationResult {
  /** Vertex positions (x, y, z for each vertex) */
  positions: number[];
  /** Triangle indices (3 indices per triangle) */
  indices: number[];
  /** Vertex normals (same as face normal for planar faces) */
  normals: number[];
  /** Face ID for each vertex (for picking) */
  faceIds: number[];
}

/**
 * Triangulate a convex planar face using fan triangulation.
 * Assumes the face boundary vertices form a convex polygon in CCW order.
 */
export function triangulateFace(
  body: Body,
  face: Face,
  faceId: string
): TriangulationResult | null {
  const plane = body.planes.get(face.planeId);
  if (!plane) {
    return null;
  }

  // Get ordered vertices from boundary edges
  const vertices = getOrderedFaceVertices(body, face);
  if (vertices.length < 3) {
    return null;
  }

  // Verify vertices are planar
  for (const vertex of vertices) {
    if (!isVertexOnPlane(plane, vertex.position, 1e-6)) {
      return null;
    }
  }

  // Project vertices to 2D plane for triangulation
  // (Used for future non-convex polygon support)
  // const points2D = projectVerticesToPlane(plane, vertices);

  // Fan triangulation (works for convex polygons)
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const faceIds: number[] = [];

  // Convert face ID to a numeric hash for GPU attribute
  const faceIdNumeric = hashFaceId(faceId);

  // Add vertex positions and normals
  for (const vertex of vertices) {
    positions.push(...vertex.position);
    normals.push(...plane.normal);
    faceIds.push(faceIdNumeric);
  }

  // Create triangles (fan from first vertex)
  for (let i = 1; i < vertices.length - 1; i++) {
    indices.push(0, i, i + 1);
  }

  return { positions, indices, normals, faceIds };
}

/**
 * Triangulate all faces in a body and return combined geometry.
 */
export function triangulateBody(body: Body): TriangulationResult {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const faceIds: number[] = [];

  let vertexOffset = 0;

  for (const [faceId, face] of body.faces) {
    const result = triangulateFace(body, face, faceId);
    if (result) {
      positions.push(...result.positions);
      normals.push(...result.normals);
      faceIds.push(...result.faceIds);

      // Offset indices for this face
      for (const index of result.indices) {
        indices.push(index + vertexOffset);
      }

      vertexOffset += result.positions.length / 3;
    }
  }

  return { positions, indices, normals, faceIds };
}

/**
 * Hash a face ID string to a numeric value for GPU attributes.
 */
function hashFaceId(faceId: string): number {
  let hash = 0;
  for (let i = 0; i < faceId.length; i++) {
    const char = faceId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Create a Three.js BufferGeometry from triangulation result.
 */
export function createBufferGeometry(result: TriangulationResult): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(result.positions, 3)
  );

  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(result.normals, 3)
  );

  // Add face ID attribute for picking
  if (result.faceIds.length > 0) {
    geometry.setAttribute(
      'faceId',
      new THREE.Float32BufferAttribute(result.faceIds, 1)
    );
  }

  geometry.setIndex(result.indices);

  return geometry;
}

/**
 * Create a wireframe geometry from body edges.
 */
export function createWireframeGeometry(body: Body): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const edge of body.edges.values()) {
    const v1 = body.vertices.get(edge.vertexIds[0]);
    const v2 = body.vertices.get(edge.vertexIds[1]);

    if (v1 && v2) {
      positions.push(...v1.position);
      positions.push(...v2.position);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );

  return geometry;
}

/**
 * Get vertices of a face in order around the boundary.
 * Follows edges to build ordered vertex list.
 */
function getOrderedFaceVertices(body: Body, face: Face): Vertex[] {
  if (face.boundaryEdgeIds.length === 0) {
    return [];
  }

  const edgeMap = new Map<string, { v1: string; v2: string }>();

  // Build edge lookup
  for (const edgeId of face.boundaryEdgeIds) {
    const edge = body.edges.get(edgeId);
    if (edge) {
      edgeMap.set(edgeId, { v1: edge.vertexIds[0], v2: edge.vertexIds[1] });
    }
  }

  // Start with first edge and traverse
  const visited = new Set<string>();
  const orderedVertexIds: string[] = [];

  const firstEdgeId = face.boundaryEdgeIds[0] as string;
  const firstEdge = edgeMap.get(firstEdgeId);
  if (!firstEdge) return [];

  orderedVertexIds.push(firstEdge.v1, firstEdge.v2);
  visited.add(firstEdgeId);

  // Traverse remaining edges
  while (visited.size < face.boundaryEdgeIds.length) {
    const lastVertexId = orderedVertexIds[orderedVertexIds.length - 1];
    let foundNext = false;

    for (const edgeId of face.boundaryEdgeIds) {
      if (visited.has(edgeId)) continue;

      const edge = edgeMap.get(edgeId);
      if (!edge) continue;

      if (edge.v1 === lastVertexId) {
        orderedVertexIds.push(edge.v2);
        visited.add(edgeId);
        foundNext = true;
        break;
      } else if (edge.v2 === lastVertexId) {
        orderedVertexIds.push(edge.v1);
        visited.add(edgeId);
        foundNext = true;
        break;
      }
    }

    if (!foundNext) break;
  }

  // Resolve vertex IDs to Vertex objects
  return orderedVertexIds
    .map((id) => body.vertices.get(id as string))
    .filter((v): v is Vertex => v !== undefined);
}

/**
 * Check if a vertex lies on a plane within tolerance.
 */
function isVertexOnPlane(
  plane: Plane,
  position: [number, number, number],
  tolerance: number
): boolean {
  return Math.abs(distanceToPoint(plane, position)) < tolerance;
}

/**
 * Project 3D vertices onto a 2D plane coordinate system.
 * Used for ear-clipping or other non-convex polygon triangulation.
 * Note: Currently unused but kept for future non-convex support.
 */
export function _projectVerticesToPlane(
  plane: Plane,
  vertices: Vertex[]
): Array<{ x: number; y: number }> {
  const origin = new THREE.Vector3(...plane.origin);
  const u = new THREE.Vector3(...plane.uAxis);
  const v = new THREE.Vector3(...plane.vAxis);

  return vertices.map((vertex) => {
    const p = new THREE.Vector3(...vertex.position).sub(origin);
    return {
      x: p.dot(u),
      y: p.dot(v),
    };
  });
}
