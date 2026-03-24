/**
 * Transform utilities for body operations.
 * Used by pattern features (linear pattern, mirror) for creating transformed copies.
 */

import * as THREE from 'three';
import { createBody, addVertex, addEdge, addFace, addPlane, type Body } from './Body';
import type { Vertex } from './Vertex';
import type { Edge } from './Edge';
import type { Face } from './Face';
import type { Plane } from './Plane';
import { createVertex } from './Vertex';
import { createEdge } from './Edge';
import { createFace } from './Face';
import { createPlane } from './Plane';
import { generateId } from '../core/id';

/**
 * Apply a 4x4 transformation matrix to a 3D point.
 */
function transformPoint(
  point: [number, number, number],
  matrix: THREE.Matrix4
): [number, number, number] {
  const v = new THREE.Vector3(...point);
  v.applyMatrix4(matrix);
  return [v.x, v.y, v.z];
}

/**
 * Apply a 4x4 transformation matrix to a direction vector (no translation).
 */
function transformDirection(
  direction: [number, number, number],
  matrix: THREE.Matrix4
): [number, number, number] {
  const v = new THREE.Vector3(...direction);
  v.transformDirection(matrix);
  return [v.x, v.y, v.z];
}

/**
 * Create a translated copy of a body.
 * All vertices are offset by the translation vector.
 *
 * @param body - The source body to translate
 * @param offset - The translation vector [dx, dy, dz]
 * @param newId - Optional new ID for the translated body
 * @returns A new body with translated geometry
 */
export function translateBody(
  body: Body,
  offset: [number, number, number],
  newId?: string
): Body {
  const translatedBody = createBody(newId ?? `${body.id}_translated`, body.name);

  // Create translation matrix
  const matrix = new THREE.Matrix4().makeTranslation(...offset);

  // Build vertex ID mapping (old -> new)
  const vertexIdMap = new Map<string, string>();

  // Translate vertices
  for (const [oldId, vertex] of body.vertices) {
    const newVertexId = generateId();
    vertexIdMap.set(oldId, newVertexId);

    const newPosition = transformPoint(vertex.position, matrix);
    const newVertex = createVertex(newPosition, newVertexId);
    addVertex(translatedBody, newVertex);
  }

  // Copy edges with new vertex references
  for (const [oldId, edge] of body.edges) {
    const newEdgeId = generateId();
    const newVertexIds = edge.vertexIds.map(vid => vertexIdMap.get(vid) ?? vid);

    const newEdge = createEdge(newVertexIds, newEdgeId);
    addEdge(translatedBody, newEdge);
  }

  // Copy faces with same edge IDs (edges were added with same IDs conceptually)
  // We need to track edge ID mapping too
  const edgeIdMap = new Map<string, string>();
  let edgeIndex = 0;
  for (const oldId of body.edges.keys()) {
    const newEdges = Array.from(translatedBody.edges.values());
    if (newEdges[edgeIndex]) {
      edgeIdMap.set(oldId, newEdges[edgeIndex].id);
    }
    edgeIndex++;
  }

  // Actually rebuild faces with correct edge IDs
  translatedBody.faces.clear();
  translatedBody.edges.clear();

  // Rebuild with correct mappings
  const freshBody = createBody(newId ?? `${body.id}_translated`, body.name);

  // Map for vertex IDs
  const freshVertexIdMap = new Map<string, string>();

  // Add translated vertices
  for (const [oldId, vertex] of body.vertices) {
    const newVertexId = generateId();
    freshVertexIdMap.set(oldId, newVertexId);

    const newPosition = transformPoint(vertex.position, matrix);
    const newVertex = createVertex(newPosition, newVertexId);
    addVertex(freshBody, newVertex);
  }

  // Map for edge IDs
  const freshEdgeIdMap = new Map<string, string>();

  // Add edges with remapped vertex IDs
  for (const [oldId, edge] of body.edges) {
    const newEdgeId = generateId();
    freshEdgeIdMap.set(oldId, newEdgeId);

    const newVertexIds = edge.vertexIds.map(vid => freshVertexIdMap.get(vid) ?? vid);
    const newEdge = createEdge(newVertexIds, newEdgeId);
    addEdge(freshBody, newEdge);
  }

  // Add faces with remapped edge IDs
  for (const [oldId, face] of body.faces) {
    const newFaceId = generateId();
    const newBoundaryEdgeIds = face.boundaryEdgeIds.map(eid => freshEdgeIdMap.get(eid) ?? eid);

    const newFace = createFace(face.planeId, newBoundaryEdgeIds, newFaceId, face.name);
    addFace(freshBody, newFace);
  }

  // Copy planes (translated - planes maintain their orientation, just origin moves)
  for (const [planeId, plane] of body.planes) {
    const newOrigin = transformPoint(plane.origin, matrix);
    const newPlane = createPlane(newOrigin, plane.normal);
    addPlane(freshBody, newPlane, planeId);
  }

  return freshBody;
}

/**
 * Create a mirrored copy of a body across a plane.
 * For proper mirroring:
 * - Vertices are reflected across the mirror plane
 * - Face normals are flipped (by reversing boundary edge order)
 * - Plane normals are flipped
 *
 * @param body - The source body to mirror
 * @param mirrorPlane - The plane to mirror across
 * @param newId - Optional new ID for the mirrored body
 * @returns A new body with mirrored geometry
 */
export function mirrorBody(
  body: Body,
  mirrorPlane: Plane,
  newId?: string
): Body {
  const mirroredBody = createBody(newId ?? `${body.id}_mirror`, body.name);

  // Create reflection matrix across the plane
  // Reflection: P' = P - 2 * (P - origin) . normal * normal
  const origin = new THREE.Vector3(...mirrorPlane.origin);
  const normal = new THREE.Vector3(...mirrorPlane.normal);

  // Map for vertex IDs
  const vertexIdMap = new Map<string, string>();

  // Mirror vertices
  for (const [oldId, vertex] of body.vertices) {
    const newVertexId = generateId();
    vertexIdMap.set(oldId, newVertexId);

    const p = new THREE.Vector3(...vertex.position);
    // Reflect: p' = p - 2 * dot(p - origin, normal) * normal
    const reflected = p.clone().sub(
      normal.clone().multiplyScalar(2 * p.clone().sub(origin).dot(normal))
    );

    const newVertex = createVertex([reflected.x, reflected.y, reflected.z], newVertexId);
    addVertex(mirroredBody, newVertex);
  }

  // Map for edge IDs
  const edgeIdMap = new Map<string, string>();

  // Add edges with remapped vertex IDs
  for (const [oldId, edge] of body.edges) {
    const newEdgeId = generateId();
    edgeIdMap.set(oldId, newEdgeId);

    const newVertexIds = edge.vertexIds.map(vid => vertexIdMap.get(vid) ?? vid);
    const newEdge = createEdge(newVertexIds, newEdgeId);
    addEdge(mirroredBody, newEdge);
  }

  // Add faces with REVERSED edge order to flip normals
  // When mirroring, the face orientation is reversed
  for (const [oldId, face] of body.faces) {
    const newFaceId = generateId();
    // Reverse the boundary edge order to flip the face normal
    const reversedBoundaryEdgeIds = [...face.boundaryEdgeIds].reverse().map(
      eid => edgeIdMap.get(eid) ?? eid
    );

    // Face plane ID will be remapped below
    const newFace = createFace(face.planeId, reversedBoundaryEdgeIds, newFaceId, face.name);
    addFace(mirroredBody, newFace);
  }

  // Mirror planes with flipped normals
  for (const [planeId, plane] of body.planes) {
    const p = new THREE.Vector3(...plane.origin);
    // Reflect origin
    const reflectedOrigin = p.clone().sub(
      normal.clone().multiplyScalar(2 * p.clone().sub(origin).dot(normal))
    );

    // Reflect normal
    const n = new THREE.Vector3(...plane.normal);
    const reflectedNormal = n.clone().sub(
      normal.clone().multiplyScalar(2 * n.dot(normal))
    );

    // Create new plane with reflected origin and normal
    // The uAxis and vAxis also need to be reflected
    const u = new THREE.Vector3(...plane.uAxis);
    const reflectedU = u.clone().sub(
      normal.clone().multiplyScalar(2 * u.dot(normal))
    );

    const newPlane = createPlane(
      [reflectedOrigin.x, reflectedOrigin.y, reflectedOrigin.z],
      [reflectedNormal.x, reflectedNormal.y, reflectedNormal.z]
    );

    // Override the uAxis with the reflected one
    const finalPlane: Plane = {
      origin: [reflectedOrigin.x, reflectedOrigin.y, reflectedOrigin.z],
      normal: [reflectedNormal.x, reflectedNormal.y, reflectedNormal.z],
      uAxis: [reflectedU.x, reflectedU.y, reflectedU.z],
      // vAxis is computed as normal cross uAxis, which should be correct
      vAxis: new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3(reflectedNormal.x, reflectedNormal.y, reflectedNormal.z),
          new THREE.Vector3(reflectedU.x, reflectedU.y, reflectedU.z)
        )
        .normalize()
        .toArray() as [number, number, number],
    };

    addPlane(mirroredBody, finalPlane, planeId);
  }

  return mirroredBody;
}

/**
 * Apply a 4x4 transformation matrix to all vertices in a body.
 * Creates a new body with transformed vertices.
 *
 * @param body - The source body to transform
 * @param matrix - The 4x4 transformation matrix
 * @param newId - Optional new ID for the transformed body
 * @returns A new body with transformed geometry
 */
export function transformVertexPositions(
  body: Body,
  matrix: THREE.Matrix4,
  newId?: string
): Body {
  const transformedBody = createBody(newId ?? `${body.id}_transformed`, body.name);

  // Map for vertex IDs
  const vertexIdMap = new Map<string, string>();

  // Transform vertices
  for (const [oldId, vertex] of body.vertices) {
    const newVertexId = generateId();
    vertexIdMap.set(oldId, newVertexId);

    const newPosition = transformPoint(vertex.position, matrix);
    const newVertex = createVertex(newPosition, newVertexId);
    addVertex(transformedBody, newVertex);
  }

  // Map for edge IDs
  const edgeIdMap = new Map<string, string>();

  // Add edges with remapped vertex IDs
  for (const [oldId, edge] of body.edges) {
    const newEdgeId = generateId();
    edgeIdMap.set(oldId, newEdgeId);

    const newVertexIds = edge.vertexIds.map(vid => vertexIdMap.get(vid) ?? vid);
    const newEdge = createEdge(newVertexIds, newEdgeId);
    addEdge(transformedBody, newEdge);
  }

  // Add faces with remapped edge IDs
  for (const [oldId, face] of body.faces) {
    const newFaceId = generateId();
    const newBoundaryEdgeIds = face.boundaryEdgeIds.map(eid => edgeIdMap.get(eid) ?? eid);

    const newFace = createFace(face.planeId, newBoundaryEdgeIds, newFaceId, face.name);
    addFace(transformedBody, newFace);
  }

  // Transform planes
  for (const [planeId, plane] of body.planes) {
    const newOrigin = transformPoint(plane.origin, matrix);
    const newNormal = transformDirection(plane.normal, matrix);
    const newUAxis = transformDirection(plane.uAxis, matrix);
    const newVAxis = transformDirection(plane.vAxis, matrix);

    const newPlane: Plane = {
      origin: newOrigin,
      normal: newNormal,
      uAxis: newUAxis,
      vAxis: newVAxis,
    };

    addPlane(transformedBody, newPlane, planeId);
  }

  return transformedBody;
}

/**
 * Compose (multiply) two 4x4 transformation matrices.
 * Result is matrix A * matrix B (A applied after B).
 *
 * @param a - First matrix (4x4 column-major flat array)
 * @param b - Second matrix (4x4 column-major flat array)
 * @returns Composed matrix (4x4 column-major flat array)
 */
export function composeTransforms(a: number[], b: number[]): number[] {
  const matrixA = new THREE.Matrix4().fromArray(a);
  const matrixB = new THREE.Matrix4().fromArray(b);
  matrixA.multiply(matrixB);
  return Array.from(matrixA.elements);
}

/**
 * Decompose a 4x4 transformation matrix into translation, rotation, and scale.
 *
 * @param matrix - 4x4 column-major flat array
 * @returns Object with translation, rotation (euler angles), and scale
 */
export function decomposeTransform(matrix: number[]): {
  translation: [number, number, number];
  rotation: [number, number, number];  // Euler angles in radians
  scale: [number, number, number];
} {
  const m = new THREE.Matrix4().fromArray(matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  m.decompose(position, quaternion, scale);

  const euler = new THREE.Euler().setFromQuaternion(quaternion);

  return {
    translation: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z],
  };
}

/**
 * Create a 4x4 transformation matrix from translation, rotation, and scale.
 *
 * @param translation - [x, y, z] translation
 * @param rotation - [x, y, z] euler angles in radians (optional)
 * @param scale - [x, y, z] scale (optional)
 * @returns 4x4 column-major flat array
 */
export function createTransform(
  translation: [number, number, number],
  rotation?: [number, number, number],
  scale?: [number, number, number]
): number[] {
  const matrix = new THREE.Matrix4();

  if (rotation) {
    const euler = new THREE.Euler(rotation[0], rotation[1], rotation[2]);
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    matrix.makeRotationFromQuaternion(quaternion);
  }

  if (scale) {
    matrix.scale(new THREE.Vector3(...scale));
  }

  matrix.setPosition(new THREE.Vector3(...translation));

  return Array.from(matrix.elements);
}

/**
 * Invert a 4x4 transformation matrix.
 *
 * @param matrix - 4x4 column-major flat array
 * @returns Inverted matrix
 */
export function invertTransform(matrix: number[]): number[] {
  const m = new THREE.Matrix4().fromArray(matrix);
  m.invert();
  return Array.from(m.elements);
}
