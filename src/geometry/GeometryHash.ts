import type { Body } from './Body';
import type { Face } from './Face';
import type { Plane } from './Plane';

const DEFAULT_PRECISION = 9;
const FNV_1A_64_OFFSET = 0xcbf29ce484222325n;
const FNV_1A_64_PRIME = 0x100000001b3n;
const UINT_64_MASK = 0xffffffffffffffffn;

export interface GeometryHashOptions {
  /** Decimal places retained before canonicalization. Defaults to 9. */
  precision?: number;
}

export interface BodyMeasurements {
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  } | null;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  totalEdgeLength: number;
  surfaceArea: number;
  volume: number;
}

type CanonicalPlane = {
  normal: [string, string, string];
  distance: string;
};

type CanonicalFace = {
  plane: CanonicalPlane | null;
  boundaryEdges: string[];
  innerBoundaryEdges?: string[][];
};

type CanonicalBody = {
  vertices: string[];
  edges: string[];
  faces: CanonicalFace[];
  planes: CanonicalPlane[];
};

/**
 * Produce an ID-free, insertion-order-independent representation of B-Rep geometry.
 * Entity IDs and display names are deliberately omitted so equivalent rebuilds with
 * freshly allocated topology IDs have the same representation.
 */
export function canonicalizeGeometry(
  bodies: readonly Body[],
  options: GeometryHashOptions = {}
): string {
  const precision = validatePrecision(options.precision);
  const canonicalBodies = bodies
    .map((body) => canonicalizeBody(body, precision))
    .sort((left, right) => compareText(stableStringify(left), stableStringify(right)));

  return stableStringify({ version: 1, bodies: canonicalBodies });
}

/** Hash one or more bodies using a deterministic, non-cryptographic FNV-1a 64-bit hash. */
export function hashGeometry(
  bodies: readonly Body[],
  options: GeometryHashOptions = {}
): string {
  const canonical = canonicalizeGeometry(bodies, options);
  let hash = FNV_1A_64_OFFSET;

  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_1A_64_PRIME) & UINT_64_MASK;
  }

  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

/** Convenience wrapper for hashing a single body. */
export function hashBodyGeometry(body: Body, options: GeometryHashOptions = {}): string {
  return hashGeometry([body], options);
}

/**
 * Compute measurement invariants used by golden-scene regression tests.
 * Volume is calculated with the divergence theorem. Face normals are oriented away
 * from the mean vertex position so legacy bodies with inconsistently directed plane
 * normals still produce useful measurements for closed prismatic solids.
 */
export function measureBody(
  body: Body,
  options: GeometryHashOptions = {}
): BodyMeasurements {
  const precision = validatePrecision(options.precision);
  const positions = Array.from(body.vertices.values(), (vertex) => vertex.position);

  let boundingBox: BodyMeasurements['boundingBox'] = null;
  if (positions.length > 0) {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const position of positions) {
      min[0] = Math.min(min[0], position[0]);
      min[1] = Math.min(min[1], position[1]);
      min[2] = Math.min(min[2], position[2]);
      max[0] = Math.max(max[0], position[0]);
      max[1] = Math.max(max[1], position[1]);
      max[2] = Math.max(max[2], position[2]);
    }
    boundingBox = {
      min: roundVector(min, precision),
      max: roundVector(max, precision),
      size: roundVector([
        max[0] - min[0],
        max[1] - min[1],
        max[2] - min[2],
      ], precision),
    };
  }

  let totalEdgeLength = 0;
  for (const edge of body.edges.values()) {
    const start = body.vertices.get(edge.vertexIds[0]);
    const end = body.vertices.get(edge.vertexIds[1]);
    if (start && end) {
      totalEdgeLength += distance(start.position, end.position);
    }
  }

  let surfaceArea = 0;
  let signedVolume = 0;
  const bodyReference = meanPosition(positions);
  const hasOrientedInnerLoops = [...body.faces.values()].some((face) =>
    (face.innerBoundaryEdgeIds?.length ?? 0) > 0
  );
  const hasMultipleClosedShells = countFaceShells(body) > 1;
  for (const face of body.faces.values()) {
    const plane = body.planes.get(face.planeId);
    if (!plane) {
      continue;
    }
    const measurement = measureFaceRegion(body, face, plane.normal);
    const planeNormal = normalize(plane.normal);
    const outwardNormal = hasOrientedInnerLoops || hasMultipleClosedShells
      ? planeNormal
      : dot(planeNormal, subtract(measurement.centroid, bodyReference)) < 0
        ? scale(planeNormal, -1)
        : planeNormal;
    surfaceArea += measurement.area;
    signedVolume += measurement.area
      * dot(outwardNormal, subtract(measurement.centroid, bodyReference)) / 3;
  }

  return {
    boundingBox,
    vertexCount: body.vertices.size,
    edgeCount: body.edges.size,
    faceCount: body.faces.size,
    totalEdgeLength: roundNumber(totalEdgeLength, precision),
    surfaceArea: roundNumber(surfaceArea, precision),
    volume: roundNumber(Math.abs(signedVolume), precision),
  };
}

function countFaceShells(body: Body): number {
  const remaining = new Set(body.faces.keys());
  let shellCount = 0;
  while (remaining.size > 0) {
    shellCount += 1;
    const start = remaining.values().next().value as string;
    const queue = [start];
    remaining.delete(start);
    while (queue.length > 0) {
      const face = body.faces.get(queue.shift()!);
      if (!face) continue;
      for (const edgeId of [...face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds?.flat() ?? [])]) {
        for (const adjacentFaceId of body.edges.get(edgeId)?.faceIds ?? []) {
          if (!remaining.delete(adjacentFaceId)) continue;
          queue.push(adjacentFaceId);
        }
      }
    }
  }
  return shellCount;
}

function measureFaceRegion(
  body: Body,
  face: Face,
  normal: [number, number, number]
): { area: number; centroid: [number, number, number] } {
  const outer = measurePlanarPolygon(getOrderedFacePositions(body, face.boundaryEdgeIds), normal);
  const holes = (face.innerBoundaryEdgeIds ?? []).map((loop) =>
    measurePlanarPolygon(getOrderedFacePositions(body, loop), normal)
  );
  const area = outer.area - holes.reduce((sum, hole) => sum + hole.area, 0);
  if (area <= Number.EPSILON) return { area: 0, centroid: [0, 0, 0] };
  const weighted = scale(outer.centroid, outer.area);
  for (const hole of holes) {
    weighted[0] -= hole.centroid[0] * hole.area;
    weighted[1] -= hole.centroid[1] * hole.area;
    weighted[2] -= hole.centroid[2] * hole.area;
  }
  return { area, centroid: scale(weighted, 1 / area) };
}

function canonicalizeBody(body: Body, precision: number): CanonicalBody {
  const vertexSignatureById = new Map(
    Array.from(body.vertices, ([id, vertex]) => [id, vectorSignature(vertex.position, precision)])
  );

  const edgeSignatureById = new Map<string, string>();
  for (const [id, edge] of body.edges) {
    const endpoints = edge.vertexIds
      .map((vertexId) => vertexSignatureById.get(vertexId) ?? `missing:${vertexId}`)
      .sort();
    edgeSignatureById.set(id, endpoints.join('~'));
  }

  const faces = Array.from(body.faces.values(), (face): CanonicalFace => {
    const innerBoundaryEdges = (face.innerBoundaryEdgeIds ?? [])
      .map((loop) => loop
        .map((edgeId) => edgeSignatureById.get(edgeId) ?? `missing:${edgeId}`)
        .sort()
      )
      .sort((left, right) => compareText(stableStringify(left), stableStringify(right)));
    return {
      plane: body.planes.has(face.planeId)
        ? canonicalizePlane(body.planes.get(face.planeId)!, precision)
        : null,
      boundaryEdges: face.boundaryEdgeIds
        .map((edgeId) => edgeSignatureById.get(edgeId) ?? `missing:${edgeId}`)
        .sort(),
      ...(innerBoundaryEdges.length > 0 ? { innerBoundaryEdges } : {}),
    };
  }).sort((left, right) => compareText(stableStringify(left), stableStringify(right)));

  return {
    vertices: Array.from(vertexSignatureById.values()).sort(),
    edges: Array.from(edgeSignatureById.values()).sort(),
    faces,
    planes: Array.from(body.planes.values(), (plane) => canonicalizePlane(plane, precision))
      .sort((left, right) => compareText(stableStringify(left), stableStringify(right))),
  };
}

function canonicalizePlane(plane: Plane, precision: number): CanonicalPlane {
  const normal = normalize(plane.normal);
  return {
    normal: normal.map((value) => canonicalNumber(value, precision)) as [string, string, string],
    distance: canonicalNumber(dot(normal, plane.origin), precision),
  };
}

function getOrderedFacePositions(body: Body, edgeIds: readonly string[]): [number, number, number][] {
  const edges = edgeIds.map((edgeId) => body.edges.get(edgeId));
  if (edges.length < 3 || edges.some((edge) => !edge)) {
    return [];
  }

  const first = edges[0]!;
  for (const startVertexId of first!.vertexIds) {
    const orderedIds = [startVertexId];
    let currentVertexId = first!.vertexIds[0] === startVertexId
      ? first!.vertexIds[1]
      : first!.vertexIds[0];

    for (let index = 1; index < edges.length; index++) {
      orderedIds.push(currentVertexId);
      const edge = edges[index]!;
      if (edge!.vertexIds[0] === currentVertexId) {
        currentVertexId = edge!.vertexIds[1];
      } else if (edge!.vertexIds[1] === currentVertexId) {
        currentVertexId = edge!.vertexIds[0];
      } else {
        break;
      }
    }

    if (orderedIds.length === edges.length && currentVertexId === startVertexId) {
      return orderedIds.flatMap((vertexId) => {
        const vertex = body.vertices.get(vertexId);
        return vertex ? [vertex.position] : [];
      });
    }
  }

  return [];
}

function measurePlanarPolygon(
  points: readonly [number, number, number][],
  normal: [number, number, number]
): { area: number; centroid: [number, number, number] } {
  if (points.length < 3) {
    return { area: 0, centroid: [0, 0, 0] };
  }

  const unitNormal = normalize(normal);
  const origin = points[0]!;
  let signedDoubleArea = 0;
  const weightedCentroid: [number, number, number] = [0, 0, 0];

  for (let index = 1; index < points.length - 1; index++) {
    const left = points[index]!;
    const right = points[index + 1]!;
    const triangleWeight = dot(cross(subtract(left, origin), subtract(right, origin)), unitNormal);
    signedDoubleArea += triangleWeight;
    for (let axis = 0; axis < 3; axis++) {
      weightedCentroid[axis] = weightedCentroid[axis]!
        + triangleWeight * (origin[axis]! + left[axis]! + right[axis]!) / 3;
    }
  }

  if (Math.abs(signedDoubleArea) < Number.EPSILON) {
    return { area: 0, centroid: [0, 0, 0] };
  }

  return {
    area: Math.abs(signedDoubleArea) / 2,
    centroid: weightedCentroid.map((value) => value / signedDoubleArea) as [number, number, number],
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function vectorSignature(vector: [number, number, number], precision: number): string {
  return vector.map((value) => canonicalNumber(value, precision)).join(',');
}

function canonicalNumber(value: number, precision: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Geometry contains a non-finite number: ${value}`);
  }
  const rounded = roundNumber(value, precision);
  return Object.is(rounded, -0) || rounded === 0 ? '0' : rounded.toFixed(precision);
}

function validatePrecision(precision: number | undefined): number {
  const resolved = precision ?? DEFAULT_PRECISION;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 15) {
    throw new Error('Geometry hash precision must be an integer from 0 to 15');
  }
  return resolved;
}

function roundNumber(value: number, precision: number): number {
  const factor = 10 ** precision;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function roundVector(
  value: [number, number, number],
  precision: number
): [number, number, number] {
  return value.map((component) => roundNumber(component, precision)) as [number, number, number];
}

function normalize(value: [number, number, number]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

function distance(left: [number, number, number], right: [number, number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function meanPosition(
  positions: readonly [number, number, number][]
): [number, number, number] {
  if (positions.length === 0) {
    return [0, 0, 0];
  }
  const total: [number, number, number] = [0, 0, 0];
  for (const position of positions) {
    total[0] += position[0];
    total[1] += position[1];
    total[2] += position[2];
  }
  return scale(total, 1 / positions.length);
}

function scale(
  value: [number, number, number],
  multiplier: number
): [number, number, number] {
  return [value[0] * multiplier, value[1] * multiplier, value[2] * multiplier];
}

function subtract(
  left: [number, number, number],
  right: [number, number, number]
): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(
  left: [number, number, number],
  right: [number, number, number]
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: [number, number, number], right: [number, number, number]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
