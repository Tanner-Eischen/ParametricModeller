import type { Body } from '../geometry/Body';
import { normalizePlanarRegion } from '../geometry/PlanarRegion';
import {
  DEFAULT_TOLERANCE_POLICY,
  quantizeToTolerance,
  type TolerancePolicy,
} from '../geometry/TolerancePolicy';
import { validateClosedManifoldBody } from '../geometry/Validation';

export type Vector3 = readonly [number, number, number];
export type LengthUnit = 'in' | 'mm';

export interface BoardOrientation {
  /** Direction along the board's grain and nominal length. */
  grainAxis: Vector3;
  /** Direction through the board's stock thickness. */
  thicknessAxis: Vector3;
}

export interface OrientedBoardDimensions {
  /** Extent along grainAxis, in document base units (inches). */
  length: number;
  /** Extent perpendicular to grainAxis and thicknessAxis, in inches. */
  width: number;
  /** Extent along thicknessAxis, in inches. */
  thickness: number;
  /** Deterministic right-handed basis used for the measurement. */
  axes: {
    length: [number, number, number];
    width: [number, number, number];
    thickness: [number, number, number];
  };
}

export interface AxisProjectionRange {
  min: number;
  max: number;
  extent: number;
}

export interface BRepFaceMeasurement {
  faceId: string;
  area: number;
  perimeter: number;
  centroid: [number, number, number];
  normal: [number, number, number];
}

export interface BRepBodyMeasurements {
  bodyId: string;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  totalEdgeLength: number;
  surfaceArea: number;
  volume: number;
  faces: BRepFaceMeasurement[];
}

const MILLIMETERS_PER_INCH = 25.4;

/** Convert a length without rounding. Document/model values use inches. */
export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  assertFinite(value, 'Length');
  if (from === to) return value;
  return from === 'in' ? value * MILLIMETERS_PER_INCH : value / MILLIMETERS_PER_INCH;
}

/**
 * Measure a planar B-Rep in a board-local orientation. Axes may be translated or
 * rotated, but must be finite, non-zero and perpendicular. Invalid inputs fail closed.
 */
export function measureOrientedBoard(
  body: Body,
  orientation: BoardOrientation,
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): OrientedBoardDimensions {
  if (body.vertices.size === 0) {
    throw new Error('Cannot measure an empty body');
  }
  assertManufacturableSolid(body);

  const lengthAxis = normalizeAxis(orientation.grainAxis, 'grainAxis', tolerance);
  const requestedThicknessAxis = normalizeAxis(
    orientation.thicknessAxis,
    'thicknessAxis',
    tolerance
  );
  const axialComponent = dot(lengthAxis, requestedThicknessAxis);
  if (Math.abs(axialComponent) > tolerance.angular) {
    throw new Error('grainAxis and thicknessAxis must be perpendicular');
  }
  // Remove tolerated floating-point drift so all downstream dimensions use an
  // exactly orthonormal board basis.
  const thicknessAxis = normalizeAxis([
    requestedThicknessAxis[0] - axialComponent * lengthAxis[0],
    requestedThicknessAxis[1] - axialComponent * lengthAxis[1],
    requestedThicknessAxis[2] - axialComponent * lengthAxis[2],
  ], 'thicknessAxis', tolerance);
  const widthAxis = normalizeAxis(cross(thicknessAxis, lengthAxis), 'widthAxis', tolerance);

  const length = extentAlong(body, lengthAxis, tolerance);
  const width = extentAlong(body, widthAxis, tolerance);
  const thickness = extentAlong(body, thicknessAxis, tolerance);
  if (length <= tolerance.linear || width <= tolerance.linear || thickness <= tolerance.linear) {
    throw new Error('Board dimensions must be greater than the linear tolerance');
  }

  return {
    length,
    width,
    thickness,
    axes: { length: lengthAxis, width: widthAxis, thickness: thicknessAxis },
  };
}

/** Return the exact projected extent of all B-Rep vertices along a unit direction. */
export function extentAlong(
  body: Body,
  direction: Vector3,
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): number {
  return projectedRangeAlong(body, direction, tolerance).extent;
}

/** Return the tolerance-canonicalized minimum, maximum and extent along an axis. */
export function projectedRangeAlong(
  body: Body,
  direction: Vector3,
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): AxisProjectionRange {
  const axis = normalizeAxis(direction, 'direction', tolerance);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const vertex of body.vertices.values()) {
    assertVector(vertex.position, `Vertex ${vertex.id}`);
    const projection = dot(vertex.position, axis);
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new Error('Cannot measure an empty body');
  }
  const canonicalMinimum = canonicalLength(minimum, tolerance.linear);
  const canonicalMaximum = canonicalLength(maximum, tolerance.linear);
  return {
    min: canonicalMinimum,
    max: canonicalMaximum,
    extent: canonicalLength(canonicalMaximum - canonicalMinimum, tolerance.linear),
  };
}

/**
 * Measure exact linear planar B-Rep invariants without using render triangles.
 *
 * Invalid references, open face loops, non-finite geometry and degenerate faces
 * fail closed because manufacturing output must not silently describe damaged geometry.
 */
export function measureBRepBody(
  body: Body,
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): BRepBodyMeasurements {
  if (body.vertices.size === 0) {
    throw new Error('Cannot measure an empty body');
  }
  assertManufacturableSolid(body);

  const positions = [...body.vertices.values()].map((vertex) => {
    assertVector(vertex.position, `Vertex ${vertex.id}`);
    return vertex.position;
  });
  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const position of positions) {
    for (let axis = 0; axis < 3; axis++) {
      boundsMin[axis] = Math.min(boundsMin[axis]!, position[axis]!);
      boundsMax[axis] = Math.max(boundsMax[axis]!, position[axis]!);
    }
  }

  let totalEdgeLength = 0;
  for (const edge of body.edges.values()) {
    const start = body.vertices.get(edge.vertexIds[0]);
    const end = body.vertices.get(edge.vertexIds[1]);
    if (!start || !end) {
      throw new Error(`Edge ${edge.id} references a missing vertex`);
    }
    const length = vectorDistance(start.position, end.position);
    if (length <= tolerance.linear) {
      throw new Error(`Edge ${edge.id} is shorter than the linear tolerance`);
    }
    totalEdgeLength += length;
  }

  const bodyReference = mean(positions);
  const faces: BRepFaceMeasurement[] = [];
  let surfaceArea = 0;
  let signedVolume = 0;
  for (const face of body.faces.values()) {
    const plane = body.planes.get(face.planeId);
    if (!plane) {
      throw new Error(`Face ${face.id} references missing plane ${face.planeId}`);
    }
    const planeNormal = normalizeAxis(plane.normal, `Face ${face.id} normal`, tolerance);
    const edgeLoops = [face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds ?? [])];
    for (const edgeId of edgeLoops.flat()) {
      if (!body.edges.get(edgeId)?.faceIds.includes(face.id)) {
        throw new Error(`Face ${face.id} and edge ${edgeId} are not bidirectionally linked`);
      }
    }
    const outerPositions = orderedLoopPositions(body, face.id, face.boundaryEdgeIds);
    const holePositions = (face.innerBoundaryEdgeIds ?? []).map((loop) =>
      orderedLoopPositions(body, face.id, loop)
    );
    const allPositions = [outerPositions, ...holePositions].flat();
    if (allPositions.some((position) => (
      Math.abs(dot(planeNormal, subtractVector(position, plane.origin))) > tolerance.planarity
    ))) {
      throw new Error(`Face ${face.id} has a vertex outside its supporting plane`);
    }
    validateFaceRegion(face.id, outerPositions, holePositions, planeNormal, tolerance);
    const outer = measurePolygon(outerPositions, planeNormal, tolerance);
    const holes = holePositions.map((positions) =>
      measurePolygon(positions, planeNormal, tolerance)
    );
    const area = outer.area - holes.reduce((sum, hole) => sum + hole.area, 0);
    if (area <= tolerance.area) {
      throw new Error(`Face ${face.id} has no measurable area`);
    }
    const weightedCentroid = scaleVector(outer.centroid, outer.area);
    let perimeter = outer.perimeter;
    for (const hole of holes) {
      weightedCentroid[0] -= hole.centroid[0] * hole.area;
      weightedCentroid[1] -= hole.centroid[1] * hole.area;
      weightedCentroid[2] -= hole.centroid[2] * hole.area;
      perimeter += hole.perimeter;
    }
    const centroid = scaleVector(weightedCentroid, 1 / area);
    const outwardNormal = dot(planeNormal, subtractVector(centroid, bodyReference)) < 0
      ? scaleVector(planeNormal, -1)
      : planeNormal;
    const canonicalArea = canonicalLength(area, tolerance.area);
    const measurement: BRepFaceMeasurement = {
      faceId: face.id,
      area: canonicalArea,
      perimeter: canonicalLength(perimeter, tolerance.linear),
      centroid: canonicalVector(centroid, tolerance.linear),
      normal: canonicalVector(outwardNormal, tolerance.angular),
    };
    faces.push(measurement);
    surfaceArea += area;
    signedVolume += area * dot(outwardNormal, centroid) / 3;
  }

  faces.sort((left, right) => compareText(left.faceId, right.faceId));
  return {
    bodyId: body.id,
    bounds: {
      min: canonicalVector(boundsMin, tolerance.linear),
      max: canonicalVector(boundsMax, tolerance.linear),
      size: canonicalVector([
        boundsMax[0] - boundsMin[0],
        boundsMax[1] - boundsMin[1],
        boundsMax[2] - boundsMin[2],
      ], tolerance.linear),
    },
    vertexCount: body.vertices.size,
    edgeCount: body.edges.size,
    faceCount: body.faces.size,
    totalEdgeLength: canonicalLength(totalEdgeLength, tolerance.linear),
    surfaceArea: canonicalLength(surfaceArea, tolerance.area),
    volume: canonicalLength(
      Math.abs(signedVolume),
      Math.max(tolerance.area * tolerance.linear, Number.EPSILON)
    ),
    faces,
  };
}

/** Stable decimal formatting for dimensions and exports. */
export function formatLength(valueInInches: number, unit: LengthUnit, precision = 3): string {
  if (!Number.isInteger(precision) || precision < 0 || precision > 9) {
    throw new Error('Precision must be an integer from 0 to 9');
  }
  const converted = convertLength(valueInInches, 'in', unit);
  const rounded = converted.toFixed(precision).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return `${rounded} ${unit}`;
}

export function normalizeAxis(
  axis: Vector3,
  name: string,
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): [number, number, number] {
  assertVector(axis, name);
  const magnitude = Math.hypot(axis[0], axis[1], axis[2]);
  if (magnitude <= tolerance.linear) {
    throw new Error(`${name} must be a non-zero vector`);
  }
  return [axis[0] / magnitude, axis[1] / magnitude, axis[2] / magnitude];
}

function canonicalLength(value: number, tolerance: number): number {
  const quantized = quantizeToTolerance(value, tolerance);
  return Object.is(quantized, -0) ? 0 : quantized;
}

function assertVector(value: Vector3, name: string): void {
  if (value.length !== 3 || value.some((component) => !Number.isFinite(component))) {
    throw new Error(`${name} must contain three finite numbers`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector3, right: Vector3): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function orderedLoopPositions(
  body: Body,
  faceId: string,
  edgeIds: readonly string[]
): [number, number, number][] {
  if (edgeIds.length < 3) {
    throw new Error(`Face ${faceId} boundary must contain at least three edges`);
  }
  const edges = edgeIds.map((edgeId) => {
    const edge = body.edges.get(edgeId);
    if (!edge) {
      throw new Error(`Face ${faceId} references missing edge ${edgeId}`);
    }
    return edge;
  });

  for (const startId of edges[0]!.vertexIds) {
    const vertexIds: string[] = [startId];
    let current = edges[0]!.vertexIds[0] === startId
      ? edges[0]!.vertexIds[1]
      : edges[0]!.vertexIds[0];
    for (let index = 1; index < edges.length; index++) {
      vertexIds.push(current);
      const edge = edges[index]!;
      if (edge.vertexIds[0] === current) {
        current = edge.vertexIds[1];
      } else if (edge.vertexIds[1] === current) {
        current = edge.vertexIds[0];
      } else {
        break;
      }
    }
    if (vertexIds.length === edges.length && current === startId) {
      return vertexIds.map((vertexId) => {
        const vertex = body.vertices.get(vertexId);
        if (!vertex) {
          throw new Error(`Face ${faceId} references missing vertex ${vertexId}`);
        }
        return vertex.position;
      });
    }
  }
  throw new Error(`Face ${faceId} boundary is not a closed ordered loop`);
}

function measurePolygon(
  points: readonly [number, number, number][],
  normal: Vector3,
  tolerance: Readonly<TolerancePolicy>
): { area: number; perimeter: number; centroid: [number, number, number] } {
  const origin = points[0]!;
  let signedDoubleArea = 0;
  let perimeter = 0;
  const weightedCentroid: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < points.length; index++) {
    perimeter += vectorDistance(points[index]!, points[(index + 1) % points.length]!);
  }
  for (let index = 1; index < points.length - 1; index++) {
    const left = points[index]!;
    const right = points[index + 1]!;
    const triangleWeight = dot(
      cross(subtractVector(left, origin), subtractVector(right, origin)),
      normal
    );
    signedDoubleArea += triangleWeight;
    for (let axis = 0; axis < 3; axis++) {
      weightedCentroid[axis] = weightedCentroid[axis]! + (
        triangleWeight * (origin[axis]! + left[axis]! + right[axis]!) / 3
      );
    }
  }
  if (Math.abs(signedDoubleArea) <= tolerance.area * 2) {
    throw new Error('Face boundary has no measurable area');
  }
  return {
    area: Math.abs(signedDoubleArea) / 2,
    perimeter,
    centroid: weightedCentroid.map((value) =>
      value / signedDoubleArea
    ) as [number, number, number],
  };
}

function mean(
  points: readonly [number, number, number][]
): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (const point of points) {
    result[0] += point[0];
    result[1] += point[1];
    result[2] += point[2];
  }
  return scaleVector(result, 1 / points.length);
}

function vectorDistance(left: Vector3, right: Vector3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function subtractVector(left: Vector3, right: Vector3): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scaleVector(value: Vector3, multiplier: number): [number, number, number] {
  return [value[0] * multiplier, value[1] * multiplier, value[2] * multiplier];
}

function canonicalVector(
  value: Vector3,
  tolerance: number
): [number, number, number] {
  return value.map((component) =>
    canonicalLength(component, tolerance)
  ) as [number, number, number];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertManufacturableSolid(body: Body): void {
  if (body.edges.size === 0 || body.faces.size === 0 || body.planes.size === 0) {
    throw new Error(`Body ${body.id} is not a closed planar solid`);
  }
  const shellValidation = validateClosedManifoldBody(body);
  if (!shellValidation.ok) {
    throw new Error(
      `Body ${body.id} is not a closed planar solid: ${shellValidation.errors[0]!.message}`
    );
  }
}

function validateFaceRegion(
  faceId: string,
  outer: readonly [number, number, number][],
  holes: readonly (readonly [number, number, number][])[],
  normal: Vector3,
  tolerance: Readonly<TolerancePolicy>
): void {
  const helper: Vector3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const uAxis = normalizeAxis(cross(normal, helper), 'face uAxis', tolerance);
  const vAxis = cross(normal, uAxis);
  const project = (point: Vector3): [number, number] => [
    dot(point, uAxis),
    dot(point, vAxis),
  ];
  const validation = normalizePlanarRegion({
    outer: outer.map(project),
    holes: holes.map((loop) => loop.map(project)),
  }, tolerance);
  if (!validation.ok) {
    throw new Error(
      `Face ${faceId} has an invalid planar region: ${validation.diagnostics[0]!.message}`
    );
  }
}
