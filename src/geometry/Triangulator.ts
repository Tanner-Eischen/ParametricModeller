import * as THREE from 'three';
import type { Body } from './Body';
import type { Face } from './Face';
import type { Plane } from './Plane';
import type { Vertex } from './Vertex';
import { distanceToPoint } from './Plane';
import { DEFAULT_TOLERANCE_POLICY } from './TolerancePolicy';
import { normalizePlanarRegion, triangulatePlanarRegion, type PlanarPoint } from './PlanarRegion';

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

  const outerVertices = getOrderedLoopVertices(body, face.boundaryEdgeIds);
  const holeVertices = (face.innerBoundaryEdgeIds ?? []).map((loop) =>
    getOrderedLoopVertices(body, loop)
  );
  if (outerVertices.length < 3 || holeVertices.some((loop) => loop.length < 3)) {
    return null;
  }

  // Verify vertices are planar
  for (const vertex of [...outerVertices, ...holeVertices.flat()]) {
    if (!isVertexOnPlane(plane, vertex.position, DEFAULT_TOLERANCE_POLICY.linear)) {
      return null;
    }
  }

  const projectedOuter = projectVerticesToPlanePoints(plane, outerVertices);
  const projectedHoles = holeVertices.map((vertices) =>
    projectVerticesToPlanePoints(plane, vertices)
  );
  const normalized = normalizePlanarRegion({ outer: projectedOuter, holes: projectedHoles });
  if (!normalized.ok) return null;
  const triangulation = triangulatePlanarRegion(normalized.region);
  if (!triangulation) return null;

  const positions: number[] = [];
  const indices = [...triangulation.indices];
  const normals: number[] = [];
  const faceIds: number[] = [];

  // Convert face ID to a numeric hash for GPU attribute
  const faceIdNumeric = hashFaceId(faceId);

  for (const point of triangulation.points) {
    const position = planePointToWorld(plane, point);
    positions.push(...position);
    normals.push(...plane.normal);
    faceIds.push(faceIdNumeric);
  }

  orientTrianglesToNormal(positions, indices, plane.normal);

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
      new THREE.Uint32BufferAttribute(result.faceIds, 1)
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
export function getOrderedLoopVertices(body: Body, boundaryEdgeIds: readonly string[]): Vertex[] {
  if (boundaryEdgeIds.length === 0) {
    return [];
  }

  const edgeMap = new Map<string, { v1: string; v2: string }>();

  // Build edge lookup
  for (const edgeId of boundaryEdgeIds) {
    const edge = body.edges.get(edgeId);
    if (edge) {
      edgeMap.set(edgeId, { v1: edge.vertexIds[0], v2: edge.vertexIds[1] });
    }
  }

  const firstEdgeId = boundaryEdgeIds[0] as string;
  const firstEdge = edgeMap.get(firstEdgeId);
  if (!firstEdge) return [];
  const orderedVertexIds = [firstEdge.v1, firstEdge.v2]
    .map((start) => traverseEdgeLoop(boundaryEdgeIds, edgeMap, firstEdgeId, start))
    .find((ordered) => ordered !== null);
  if (!orderedVertexIds) return [];
  return orderedVertexIds
    .map((id) => body.vertices.get(id as string))
    .filter((v): v is Vertex => v !== undefined);
}

function traverseEdgeLoop(
  edgeIds: readonly string[],
  edgeMap: Map<string, { v1: string; v2: string }>,
  firstEdgeId: string,
  startVertexId: string
): string[] | null {
  const first = edgeMap.get(firstEdgeId)!;
  const ordered = [startVertexId];
  const visited = new Set([firstEdgeId]);
  let current = first.v1 === startVertexId ? first.v2 : first.v1;
  while (visited.size < edgeIds.length) {
    ordered.push(current);
    const nextId = edgeIds.find((edgeId) => {
      if (visited.has(edgeId)) return false;
      const edge = edgeMap.get(edgeId);
      return edge?.v1 === current || edge?.v2 === current;
    });
    if (!nextId) return null;
    const next = edgeMap.get(nextId)!;
    visited.add(nextId);
    current = next.v1 === current ? next.v2 : next.v1;
  }
  return current === startVertexId && ordered.length === edgeIds.length ? ordered : null;
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

function projectVerticesToPlanePoints(plane: Plane, vertices: readonly Vertex[]): PlanarPoint[] {
  const origin = new THREE.Vector3(...plane.origin);
  const u = new THREE.Vector3(...plane.uAxis);
  const v = new THREE.Vector3(...plane.vAxis);
  return vertices.map((vertex) => {
    const point = new THREE.Vector3(...vertex.position).sub(origin);
    return [point.dot(u), point.dot(v)];
  });
}

function planePointToWorld(plane: Plane, point: PlanarPoint): [number, number, number] {
  return [
    plane.origin[0] + plane.uAxis[0] * point[0] + plane.vAxis[0] * point[1],
    plane.origin[1] + plane.uAxis[1] * point[0] + plane.vAxis[1] * point[1],
    plane.origin[2] + plane.uAxis[2] * point[0] + plane.vAxis[2] * point[1],
  ];
}

function orientTrianglesToNormal(
  positions: readonly number[],
  indices: number[],
  normal: [number, number, number]
): void {
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index]! * 3;
    const b = indices[index + 1]! * 3;
    const c = indices[index + 2]! * 3;
    const ab: [number, number, number] = [
      positions[b]! - positions[a]!,
      positions[b + 1]! - positions[a + 1]!,
      positions[b + 2]! - positions[a + 2]!,
    ];
    const ac: [number, number, number] = [
      positions[c]! - positions[a]!,
      positions[c + 1]! - positions[a + 1]!,
      positions[c + 2]! - positions[a + 2]!,
    ];
    const dot = (ab[1] * ac[2] - ab[2] * ac[1]) * normal[0]
      + (ab[2] * ac[0] - ab[0] * ac[2]) * normal[1]
      + (ab[0] * ac[1] - ab[1] * ac[0]) * normal[2];
    if (dot < 0) [indices[index + 1], indices[index + 2]] = [indices[index + 2]!, indices[index + 1]!];
  }
}
