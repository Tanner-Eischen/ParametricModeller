/**
 * Transform utilities for body operations.
 * Used by pattern features (linear pattern, mirror) for creating transformed copies.
 */

import * as THREE from 'three';
import { createBody, addVertex, addEdge, addFace, addPlane, type Body } from './Body';
import { createVertex } from './Vertex';
import { createEdge } from './Edge';
import { createFace } from './Face';
import type { Plane } from './Plane';
import { createTopologyIdAllocator } from './TopologyIdAllocator';
import { DEFAULT_TOLERANCE_POLICY } from './TolerancePolicy';

const JOIN_TOLERANCE = DEFAULT_TOLERANCE_POLICY.linear;

function transformPoint(
  point: [number, number, number],
  matrix: THREE.Matrix4
): [number, number, number] {
  const v = new THREE.Vector3(...point);
  v.applyMatrix4(matrix);
  return [v.x, v.y, v.z];
}

function transformPlane(plane: Plane, matrix: THREE.Matrix4): Plane {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const normal = new THREE.Vector3(...plane.normal).applyMatrix3(normalMatrix).normalize();
  const transformedU = new THREE.Vector3(...plane.uAxis).transformDirection(matrix);
  const uAxis = transformedU
    .addScaledVector(normal, -transformedU.dot(normal))
    .normalize();
  const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();
  return {
    origin: transformPoint(plane.origin, matrix),
    normal: normal.toArray() as [number, number, number],
    uAxis: uAxis.toArray() as [number, number, number],
    vAxis: vAxis.toArray() as [number, number, number],
  };
}

function copyBodyTopology(
  body: Body,
  newId: string,
  transformVertex: (position: [number, number, number]) => [number, number, number],
  transformPlane?: (plane: Plane) => Plane
): Body {
  const clonedBody = createBody(newId, body.name);
  const allocator = createTopologyIdAllocator(newId);
  const vertexIdMap = new Map<string, string>();
  const edgeIdMap = new Map<string, string>();
  const planeIdMap = new Map<string, string>();

  for (const [oldId, vertex] of body.vertices) {
    const newVertexId = allocator.vertex(oldId);
    vertexIdMap.set(oldId, newVertexId);
    addVertex(clonedBody, createVertex(transformVertex(vertex.position), newVertexId));
  }

  for (const [oldId, edge] of body.edges) {
    const newEdgeId = allocator.edge(oldId);
    edgeIdMap.set(oldId, newEdgeId);
    addEdge(
      clonedBody,
      createEdge(
        vertexIdMap.get(edge.vertexIds[0]) ?? edge.vertexIds[0],
        vertexIdMap.get(edge.vertexIds[1]) ?? edge.vertexIds[1],
        newEdgeId
      )
    );
  }

  for (const [planeId, plane] of body.planes) {
    const newPlaneId = allocator.plane(planeId);
    planeIdMap.set(planeId, newPlaneId);
    const transformedPlane = transformPlane ? transformPlane(plane) : plane;
    addPlane(clonedBody, transformedPlane, newPlaneId);
  }

  for (const [oldId, face] of body.faces) {
    const newFaceId = allocator.face(oldId);
    const newBoundaryEdgeIds = face.boundaryEdgeIds.map((edgeId) => edgeIdMap.get(edgeId) ?? edgeId);
    const newInnerBoundaryEdgeIds = face.innerBoundaryEdgeIds?.map((loop) =>
      loop.map((edgeId) => edgeIdMap.get(edgeId) ?? edgeId)
    );
    const newPlaneId = planeIdMap.get(face.planeId) ?? face.planeId;
    addFace(clonedBody, {
      ...createFace(newPlaneId, newBoundaryEdgeIds, newFaceId, face.name),
      ...(newInnerBoundaryEdgeIds ? { innerBoundaryEdgeIds: newInnerBoundaryEdgeIds } : {}),
    });
  }

  return clonedBody;
}

/**
 * Create a translated copy of a body.
 */
export function translateBody(
  body: Body,
  offset: [number, number, number],
  newId?: string
): Body {
  const matrix = new THREE.Matrix4().makeTranslation(...offset);
  return copyBodyTopology(
    body,
    newId ?? `${body.id}_translated`,
    (position) => transformPoint(position, matrix),
    (plane) => ({
      ...plane,
      origin: transformPoint(plane.origin, matrix),
    })
  );
}

/**
 * Create a mirrored copy of a body across a plane.
 */
export function mirrorBody(
  body: Body,
  mirrorPlane: Plane,
  newId?: string
): Body {
  const origin = new THREE.Vector3(...mirrorPlane.origin);
  const normal = new THREE.Vector3(...mirrorPlane.normal);

  const reflectPoint = (point: [number, number, number]): [number, number, number] => {
    const p = new THREE.Vector3(...point);
    const reflected = p.clone().sub(normal.clone().multiplyScalar(2 * p.clone().sub(origin).dot(normal)));
    return [reflected.x, reflected.y, reflected.z];
  };

  const reflectedBody = copyBodyTopology(
    body,
    newId ?? `${body.id}_mirror`,
    reflectPoint,
    (plane) => {
      const planeOrigin = new THREE.Vector3(...plane.origin);
      const planeNormal = new THREE.Vector3(...plane.normal);
      const planeUAxis = new THREE.Vector3(...plane.uAxis);

      const reflectedOrigin = planeOrigin.clone().sub(
        normal.clone().multiplyScalar(2 * planeOrigin.clone().sub(origin).dot(normal))
      );
      const reflectedNormal = planeNormal.clone().sub(normal.clone().multiplyScalar(2 * planeNormal.dot(normal)));
      const reflectedU = planeUAxis.clone().sub(normal.clone().multiplyScalar(2 * planeUAxis.dot(normal)));

      return {
        origin: [reflectedOrigin.x, reflectedOrigin.y, reflectedOrigin.z],
        normal: [reflectedNormal.x, reflectedNormal.y, reflectedNormal.z],
        uAxis: [reflectedU.x, reflectedU.y, reflectedU.z],
        vAxis: new THREE.Vector3()
          .crossVectors(reflectedNormal, reflectedU)
          .normalize()
          .toArray() as [number, number, number],
      };
    }
  );

  return reflectedBody;
}

/**
 * Apply a 4x4 transformation matrix to all vertices in a body.
 */
export function transformVertexPositions(
  body: Body,
  matrix: THREE.Matrix4,
  newId?: string
): Body {
  return copyBodyTopology(
    body,
    newId ?? `${body.id}_transformed`,
    (position) => transformPoint(position, matrix),
    (plane) => transformPlane(plane, matrix)
  );
}

/**
 * Resize a solid to exact world-axis dimensions while keeping its minimum
 * bounding-box corner fixed. Positive non-uniform scaling preserves planar
 * faces and sharp edges.
 */
export function resizeBodyToDimensions(
  body: Body,
  dimensions: [number, number, number],
  newId?: string
): Body {
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const vertex of body.vertices.values()) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis]!, vertex.position[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, vertex.position[axis]!);
    }
  }
  const current = maximum.map((value, axis) => value - minimum[axis]!) as [number, number, number];
  if (current.some((value) => !Number.isFinite(value) || value <= JOIN_TOLERANCE)) {
    throw new Error('Resize requires a solid with non-zero width, height, and depth.');
  }
  if (dimensions.some((value) => !Number.isFinite(value) || value <= JOIN_TOLERANCE)) {
    throw new Error('Resize dimensions must be finite and greater than zero.');
  }

  const scale = dimensions.map((value, axis) => value / current[axis]!) as [number, number, number];
  const matrix = new THREE.Matrix4().makeScale(...scale);
  matrix.setPosition(
    minimum[0] * (1 - scale[0]),
    minimum[1] * (1 - scale[1]),
    minimum[2] * (1 - scale[2])
  );
  return transformVertexPositions(body, matrix, newId ?? body.id);
}

/**
 * Combine multiple bodies into a single body by copying their topology into one container.
 * v1 preserves interior faces when bodies touch or overlap.
 */
export function combineBodies(
  bodies: Body[],
  newId?: string,
  name?: string
): Body {
  if (bodies.length === 0) {
    throw new Error('combineBodies requires at least one body');
  }

  const combinedBodyId = newId ?? `${bodies[0]!.id}_combined`;
  const allocator = createTopologyIdAllocator(combinedBodyId);

  type FaceDraft = {
    name: string | undefined;
    plane: Plane;
    planeSignature: string;
    signature: string;
    normal: [number, number, number];
    boundaryEdgeIds: string[];
  };

  const mergedVertices = new Map<string, { id: string; position: [number, number, number] }>();
  const mergedEdges = new Map<string, { id: string; vertexIds: [string, string] }>();
  const faceDrafts: FaceDraft[] = [];

  for (const sourceBody of bodies) {
    const vertexIdMap = new Map<string, string>();
    const edgeIdMap = new Map<string, string>();

    for (const [sourceVertexId, vertex] of sourceBody.vertices) {
      const key = getPointKey(vertex.position);
      const existing = mergedVertices.get(key);
      if (existing) {
        vertexIdMap.set(sourceVertexId, existing.id);
        continue;
      }

      const nextVertexId = allocator.vertex(key);
      mergedVertices.set(key, {
        id: nextVertexId,
        position: [...vertex.position] as [number, number, number],
      });
      vertexIdMap.set(sourceVertexId, nextVertexId);
    }

    for (const [sourceEdgeId, edge] of sourceBody.edges) {
      const mappedVertexIds: [string, string] = [
        vertexIdMap.get(edge.vertexIds[0]) ?? edge.vertexIds[0],
        vertexIdMap.get(edge.vertexIds[1]) ?? edge.vertexIds[1],
      ];
      const key = getEdgeKey(mappedVertexIds);
      const existing = mergedEdges.get(key);
      if (existing) {
        edgeIdMap.set(sourceEdgeId, existing.id);
        continue;
      }

      const nextEdgeId = allocator.edge(key);
      mergedEdges.set(key, { id: nextEdgeId, vertexIds: mappedVertexIds });
      edgeIdMap.set(sourceEdgeId, nextEdgeId);
    }

    for (const [, face] of sourceBody.faces) {
      const plane = sourceBody.planes.get(face.planeId);
      if (!plane) {
        continue;
      }

      const boundaryEdgeIds = face.boundaryEdgeIds.map((edgeId) => edgeIdMap.get(edgeId) ?? edgeId);
      const faceVertexKeys = new Set<string>();
      for (const boundaryEdgeId of boundaryEdgeIds) {
        const edgeRecord = Array.from(mergedEdges.values()).find((edge) => edge.id === boundaryEdgeId);
        if (!edgeRecord) {
          continue;
        }
        for (const vertexId of edgeRecord.vertexIds) {
          const mergedVertex = Array.from(mergedVertices.values()).find((vertex) => vertex.id === vertexId);
          if (mergedVertex) {
            faceVertexKeys.add(getPointKey(mergedVertex.position));
          }
        }
      }

      faceDrafts.push({
        name: face.name,
        plane: {
          origin: [...plane.origin] as [number, number, number],
          normal: [...plane.normal] as [number, number, number],
          uAxis: [...plane.uAxis] as [number, number, number],
          vAxis: [...plane.vAxis] as [number, number, number],
        },
        planeSignature: getCanonicalPlaneSignature(plane),
        signature: `${getCanonicalPlaneSignature(plane)}|${Array.from(faceVertexKeys).sort().join('|')}`,
        normal: [...plane.normal] as [number, number, number],
        boundaryEdgeIds,
      });
    }
  }

  const droppedFaceIndexes = new Set<number>();
  const signatureToFaceIndexes = new Map<string, number[]>();
  faceDrafts.forEach((draft, index) => {
    const existing = signatureToFaceIndexes.get(draft.signature) ?? [];
    signatureToFaceIndexes.set(draft.signature, [...existing, index]);
  });

  for (const indexes of signatureToFaceIndexes.values()) {
    if (indexes.length < 2) {
      continue;
    }

    for (let i = 0; i < indexes.length; i++) {
      const leftIndex = indexes[i]!;
      const left = faceDrafts[leftIndex]!;
      for (let j = i + 1; j < indexes.length; j++) {
        const rightIndex = indexes[j]!;
        const right = faceDrafts[rightIndex]!;
        if (dotProduct(left.normal, right.normal) < -0.999) {
          droppedFaceIndexes.add(leftIndex);
          droppedFaceIndexes.add(rightIndex);
        }
      }
    }
  }

  const combinedBody = createBody(
    combinedBodyId,
    name ?? `${bodies[0]!.name} Join`
  );

  for (const vertex of mergedVertices.values()) {
    addVertex(
      combinedBody,
      createVertex([...vertex.position] as [number, number, number], vertex.id)
    );
  }

  const keptFaces = faceDrafts.filter((_, index) => !droppedFaceIndexes.has(index));
  const usedEdgeIds = new Set<string>(keptFaces.flatMap((face) => face.boundaryEdgeIds));
  const keepAllEdges = keptFaces.length === 0;
  for (const edge of mergedEdges.values()) {
    if (!keepAllEdges && !usedEdgeIds.has(edge.id)) {
      continue;
    }
    addEdge(
      combinedBody,
      createEdge(edge.vertexIds[0], edge.vertexIds[1], edge.id)
    );
  }

  const planeIdBySignature = new Map<string, string>();
  for (const face of keptFaces) {
    let planeId = planeIdBySignature.get(face.planeSignature);
    if (!planeId) {
      planeId = allocator.plane(face.planeSignature);
      planeIdBySignature.set(face.planeSignature, planeId);
      addPlane(combinedBody, face.plane, planeId);
    }

    addFace(
      combinedBody,
      createFace(planeId, face.boundaryEdgeIds, allocator.face(`${face.signature}:${keptFaces.indexOf(face)}`), face.name)
    );
  }

  return combinedBody;
}

function getPointKey(point: [number, number, number]): string {
  return point.map((value) => value.toFixed(6)).join(',');
}

function getEdgeKey(vertexIds: [string, string]): string {
  return [...vertexIds].sort().join('|');
}

function getCanonicalPlaneSignature(plane: Plane): string {
  const normal = new THREE.Vector3(...plane.normal).normalize();
  const origin = new THREE.Vector3(...plane.origin);

  if (
    normal.x < -JOIN_TOLERANCE ||
    (Math.abs(normal.x) <= JOIN_TOLERANCE && normal.y < -JOIN_TOLERANCE) ||
    (Math.abs(normal.x) <= JOIN_TOLERANCE && Math.abs(normal.y) <= JOIN_TOLERANCE && normal.z < -JOIN_TOLERANCE)
  ) {
    normal.negate();
  }

  const distance = normal.dot(origin);
  return [
    normal.x.toFixed(6),
    normal.y.toFixed(6),
    normal.z.toFixed(6),
    distance.toFixed(6),
  ].join('|');
}

function dotProduct(
  left: [number, number, number],
  right: [number, number, number]
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * Compose (multiply) two 4x4 transformation matrices.
 */
export function composeTransforms(a: number[], b: number[]): number[] {
  const matrixA = new THREE.Matrix4().fromArray(a);
  const matrixB = new THREE.Matrix4().fromArray(b);
  matrixA.multiply(matrixB);
  return Array.from(matrixA.elements);
}

/**
 * Decompose a 4x4 transformation matrix into translation, rotation, and scale.
 */
export function decomposeTransform(matrix: number[]): {
  translation: [number, number, number];
  rotation: [number, number, number];
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
 */
export function invertTransform(matrix: number[]): number[] {
  const m = new THREE.Matrix4().fromArray(matrix);
  m.invert();
  return Array.from(m.elements);
}
