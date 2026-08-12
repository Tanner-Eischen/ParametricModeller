import type { Body } from '../geometry/Body';
import {
  DEFAULT_TOLERANCE_POLICY,
  quantizeToTolerance,
  type TolerancePolicy,
} from '../geometry/TolerancePolicy';
import { triangulateFace } from '../geometry/Triangulator';

export type OrthographicView = 'front' | 'top' | 'right';

export interface Point2D {
  x: number;
  y: number;
}

export interface ProjectedEdge {
  start: Point2D;
  end: Point2D;
  visibility: 'visible' | 'hidden';
  /** All B-Rep edge IDs collapsing to this projected segment. */
  sourceEdgeIds: string[];
}

export interface OrthographicProjection {
  view: OrthographicView;
  edges: ProjectedEdge[];
  bounds: { min: Point2D; max: Point2D; width: number; height: number };
}

interface ProjectedSourceEdge {
  start: Point2D;
  end: Point2D;
  startDepth: number;
  endDepth: number;
  sourceEdgeId: string;
  breakpoints: number[];
}

interface ProjectedFaceTriangle {
  points: readonly [Point2D, Point2D, Point2D];
  depths: readonly [number, number, number];
  sourceFaceId: string;
}

/**
 * Project linear B-Rep edges into conventional front (XZ), top (XY), or right (YZ) views.
 *
 * Triangulation is used only as an immutable point-in-planar-face query. The emitted
 * geometry and its provenance always come from authoritative B-Rep edges.
 */
export function projectOrthographic(
  bodies: Body | readonly Body[],
  view: OrthographicView,
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): OrthographicProjection {
  const bodyList = (Array.isArray(bodies) ? [...bodies] : [bodies])
    .sort((left, right) => compareText(left.id, right.id));
  if (bodyList.length === 0 || bodyList.every((body) => body.vertices.size === 0)) {
    throw new Error('Cannot project empty geometry');
  }

  const cameraDirection = viewCameraDirection(view);
  const sourceEdges: ProjectedSourceEdge[] = [];
  const faceTriangles: ProjectedFaceTriangle[] = [];
  let minimum: Point2D = { x: Infinity, y: Infinity };
  let maximum: Point2D = { x: -Infinity, y: -Infinity };

  for (const body of bodyList) {
    for (const vertex of [...body.vertices.values()].sort((left, right) =>
      compareText(left.id, right.id)
    )) {
      const point = projectPoint(vertex.position, view);
      assertPoint(point, `Vertex ${vertex.id}`);
      minimum = { x: Math.min(minimum.x, point.x), y: Math.min(minimum.y, point.y) };
      maximum = { x: Math.max(maximum.x, point.x), y: Math.max(maximum.y, point.y) };
    }
    for (const edge of [...body.edges.values()].sort((left, right) =>
      compareText(left.id, right.id)
    )) {
      const first = body.vertices.get(edge.vertexIds[0]);
      const second = body.vertices.get(edge.vertexIds[1]);
      if (!first || !second) {
        throw new Error(`Edge ${edge.id} references a missing vertex`);
      }
      let start = projectPoint(first.position, view);
      let end = projectPoint(second.position, view);
      let startDepth = dot3(first.position, cameraDirection);
      let endDepth = dot3(second.position, cameraDirection);
      if (pointCompare(start, end) > 0) {
        [start, end] = [end, start];
        [startDepth, endDepth] = [endDepth, startDepth];
      }
      if (distance(start, end) <= tolerance.linear) continue;
      start = canonicalPoint(start, tolerance.linear);
      end = canonicalPoint(end, tolerance.linear);
      sourceEdges.push({
        start,
        end,
        startDepth,
        endDepth,
        sourceEdgeId: `${body.id}:${edge.id}`,
        breakpoints: [0, 1],
      });
    }

    for (const [faceId, face] of [...body.faces].sort(([left], [right]) =>
      compareText(left, right)
    )) {
      const triangulation = triangulateFace(body, face, faceId);
      if (!triangulation) {
        throw new Error(`Face ${faceId} cannot be triangulated`);
      }
      for (let index = 0; index < triangulation.indices.length; index += 3) {
        const points = [0, 1, 2].map((offset) => {
          const vertexIndex = triangulation.indices[index + offset]!;
          const positionOffset = vertexIndex * 3;
          const position: [number, number, number] = [
            triangulation.positions[positionOffset]!,
            triangulation.positions[positionOffset + 1]!,
            triangulation.positions[positionOffset + 2]!,
          ];
          return {
            point: projectPoint(position, view),
            depth: dot3(position, cameraDirection),
          };
        });
        const projected = points.map((entry) => entry.point) as [Point2D, Point2D, Point2D];
        if (Math.abs(cross2(subtract2(projected[1], projected[0]), subtract2(projected[2], projected[0])))
          <= tolerance.area) {
          continue;
        }
        faceTriangles.push({
          points: projected,
          depths: points.map((entry) => entry.depth) as [number, number, number],
          sourceFaceId: `${body.id}:${faceId}`,
        });
      }
    }
  }

  if (!Number.isFinite(minimum.x) || !Number.isFinite(maximum.x)) {
    throw new Error('Cannot project empty geometry');
  }
  sourceEdges.sort((left, right) =>
    segmentGeometryCompare(left, right) || compareText(left.sourceEdgeId, right.sourceEdgeId)
  );
  faceTriangles.sort((left, right) =>
    triangleCompare(left, right) || compareText(left.sourceFaceId, right.sourceFaceId)
  );

  splitAtProjectedEdgeIntersections(sourceEdges, tolerance.linear);
  for (const source of sourceEdges) {
    for (const triangle of faceTriangles) {
      addTriangleBoundaryBreakpoints(source, triangle, tolerance.linear);
    }
  }

  const segmentByKey = new Map<string, ProjectedEdge>();
  for (const source of sourceEdges) {
    const breakpoints = canonicalBreakpoints(source.breakpoints, source, tolerance.linear);
    for (let index = 0; index < breakpoints.length - 1; index++) {
      const startParameter = breakpoints[index]!;
      const endParameter = breakpoints[index + 1]!;
      if (endParameter - startParameter <= parameterTolerance(source, tolerance.linear)) continue;
      let start = canonicalPoint(pointAt(source, startParameter), tolerance.linear);
      let end = canonicalPoint(pointAt(source, endParameter), tolerance.linear);
      if (distance(start, end) <= tolerance.linear) continue;
      if (pointCompare(start, end) > 0) [start, end] = [end, start];
      const midpointParameter = (startParameter + endParameter) / 2;
      const midpoint = pointAt(source, midpointParameter);
      const edgeDepth = depthAt(source, midpointParameter);
      const visibility = isOccluded(midpoint, edgeDepth, faceTriangles, tolerance)
        ? 'hidden'
        : 'visible';
      const key = segmentKey(start, end);
      const existing = segmentByKey.get(key);
      if (existing) {
        existing.sourceEdgeIds.push(source.sourceEdgeId);
        if (visibility === 'visible') existing.visibility = 'visible';
      } else {
        segmentByKey.set(key, {
          start,
          end,
          visibility,
          sourceEdgeIds: [source.sourceEdgeId],
        });
      }
    }
  }

  minimum = canonicalPoint(minimum, tolerance.linear);
  maximum = canonicalPoint(maximum, tolerance.linear);
  const fragments = [...segmentByKey.values()]
    .map((edge) => ({
      ...edge,
      sourceEdgeIds: [...new Set(edge.sourceEdgeIds)].sort(compareText),
    }))
    .sort((left, right) => segmentCompare(left, right));
  const edges = mergeCollinearFragments(fragments, tolerance.linear);
  return {
    view,
    edges,
    bounds: {
      min: minimum,
      max: maximum,
      width: canonical(maximum.x - minimum.x, tolerance.linear),
      height: canonical(maximum.y - minimum.y, tolerance.linear),
    },
  };
}

function splitAtProjectedEdgeIntersections(
  edges: ProjectedSourceEdge[],
  tolerance: number
): void {
  for (let leftIndex = 0; leftIndex < edges.length; leftIndex++) {
    const left = edges[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex++) {
      const right = edges[rightIndex]!;
      addSegmentIntersectionBreakpoints(left, right.start, right.end, tolerance);
      addSegmentIntersectionBreakpoints(right, left.start, left.end, tolerance);
    }
  }
}

function addTriangleBoundaryBreakpoints(
  source: ProjectedSourceEdge,
  triangle: ProjectedFaceTriangle,
  tolerance: number
): void {
  for (let index = 0; index < 3; index++) {
    addSegmentIntersectionBreakpoints(
      source,
      triangle.points[index]!,
      triangle.points[(index + 1) % 3]!,
      tolerance
    );
  }
}

function addSegmentIntersectionBreakpoints(
  source: ProjectedSourceEdge,
  otherStart: Point2D,
  otherEnd: Point2D,
  tolerance: number
): void {
  const direction = subtract2(source.end, source.start);
  const otherDirection = subtract2(otherEnd, otherStart);
  const denominator = cross2(direction, otherDirection);
  const relative = subtract2(otherStart, source.start);
  const sourceLength = Math.hypot(direction.x, direction.y);
  const otherLength = Math.hypot(otherDirection.x, otherDirection.y);
  const crossTolerance = tolerance * Math.max(1, sourceLength, otherLength);

  if (Math.abs(denominator) > crossTolerance) {
    const parameter = cross2(relative, otherDirection) / denominator;
    const otherParameter = cross2(relative, direction) / denominator;
    const sourceTolerance = parameterTolerance(source, tolerance);
    const otherTolerance = tolerance / Math.max(otherLength, tolerance);
    if (parameter >= -sourceTolerance && parameter <= 1 + sourceTolerance
      && otherParameter >= -otherTolerance && otherParameter <= 1 + otherTolerance) {
      source.breakpoints.push(clamp01(parameter));
    }
    return;
  }

  if (Math.abs(cross2(relative, direction)) > crossTolerance) return;
  const squaredLength = direction.x * direction.x + direction.y * direction.y;
  if (squaredLength <= tolerance * tolerance) return;
  for (const point of [otherStart, otherEnd]) {
    const offset = subtract2(point, source.start);
    const parameter = (offset.x * direction.x + offset.y * direction.y) / squaredLength;
    const parameterEpsilon = parameterTolerance(source, tolerance);
    if (parameter >= -parameterEpsilon && parameter <= 1 + parameterEpsilon) {
      source.breakpoints.push(clamp01(parameter));
    }
  }
}

function canonicalBreakpoints(
  parameters: readonly number[],
  source: ProjectedSourceEdge,
  tolerance: number
): number[] {
  const parameterEpsilon = parameterTolerance(source, tolerance);
  const sorted = parameters.map(clamp01).sort((left, right) => left - right);
  const unique: number[] = [];
  for (const parameter of sorted) {
    if (unique.length === 0 || parameter - unique[unique.length - 1]! > parameterEpsilon) {
      unique.push(parameter);
    }
  }
  if (unique[0] !== 0) unique.unshift(0);
  if (unique[unique.length - 1] !== 1) unique.push(1);
  return unique;
}

function isOccluded(
  point: Point2D,
  edgeDepth: number,
  triangles: readonly ProjectedFaceTriangle[],
  tolerance: Readonly<TolerancePolicy>
): boolean {
  let nearestDepth = -Infinity;
  for (const triangle of triangles) {
    const depth = triangleDepthAtPoint(triangle, point, tolerance);
    if (depth !== null) nearestDepth = Math.max(nearestDepth, depth);
  }
  return nearestDepth > edgeDepth + tolerance.linear;
}

function triangleDepthAtPoint(
  triangle: ProjectedFaceTriangle,
  point: Point2D,
  tolerance: Readonly<TolerancePolicy>
): number | null {
  const [a, b, c] = triangle.points;
  const area = cross2(subtract2(b, a), subtract2(c, a));
  if (Math.abs(area) <= tolerance.area) return null;
  const first = cross2(subtract2(b, point), subtract2(c, point)) / area;
  const second = cross2(subtract2(c, point), subtract2(a, point)) / area;
  const third = 1 - first - second;
  const longestEdge = Math.max(distance(a, b), distance(b, c), distance(c, a));
  const barycentricTolerance = Math.min(
    0.01,
    (tolerance.area + tolerance.linear * Math.max(1, longestEdge)) / Math.abs(area)
  );
  if (first < -barycentricTolerance || second < -barycentricTolerance
    || third < -barycentricTolerance) {
    return null;
  }
  return first * triangle.depths[0]
    + second * triangle.depths[1]
    + third * triangle.depths[2];
}

function mergeCollinearFragments(
  fragments: readonly ProjectedEdge[],
  tolerance: number
): ProjectedEdge[] {
  const merged = fragments.map((fragment) => ({
    ...fragment,
    sourceEdgeIds: [...fragment.sourceEdgeIds],
  }));
  let changed = true;
  while (changed) {
    changed = false;
    merged.sort(segmentCompare);
    outer: for (let leftIndex = 0; leftIndex < merged.length; leftIndex++) {
      const left = merged[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < merged.length; rightIndex++) {
        const right = merged[rightIndex]!;
        if (!canMerge(left, right, tolerance)) continue;
        const replacement: ProjectedEdge = {
          start: left.start,
          end: right.end,
          visibility: left.visibility,
          sourceEdgeIds: [...left.sourceEdgeIds],
        };
        merged.splice(rightIndex, 1);
        merged.splice(leftIndex, 1, replacement);
        changed = true;
        break outer;
      }
    }
  }
  return merged.sort(segmentCompare);
}

function canMerge(left: ProjectedEdge, right: ProjectedEdge, tolerance: number): boolean {
  if (left.visibility !== right.visibility
    || !sameTextArray(left.sourceEdgeIds, right.sourceEdgeIds)
    || distance(left.end, right.start) > tolerance) {
    return false;
  }
  const leftDirection = subtract2(left.end, left.start);
  const rightDirection = subtract2(right.end, right.start);
  return Math.abs(cross2(leftDirection, rightDirection))
    <= tolerance * Math.max(1, distance(left.start, left.end), distance(right.start, right.end));
}

function sameTextArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function segmentKey(start: Point2D, end: Point2D): string {
  return `${start.x},${start.y}~${end.x},${end.y}`;
}

function pointAt(source: ProjectedSourceEdge, parameter: number): Point2D {
  return {
    x: source.start.x + (source.end.x - source.start.x) * parameter,
    y: source.start.y + (source.end.y - source.start.y) * parameter,
  };
}

function depthAt(source: ProjectedSourceEdge, parameter: number): number {
  return source.startDepth + (source.endDepth - source.startDepth) * parameter;
}

function parameterTolerance(source: ProjectedSourceEdge, tolerance: number): number {
  return tolerance / Math.max(distance(source.start, source.end), tolerance);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function subtract2(left: Point2D, right: Point2D): Point2D {
  return { x: left.x - right.x, y: left.y - right.y };
}

function cross2(left: Point2D, right: Point2D): number {
  return left.x * right.y - left.y * right.x;
}

function dot3(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function segmentGeometryCompare(
  left: Pick<ProjectedSourceEdge, 'start' | 'end'>,
  right: Pick<ProjectedSourceEdge, 'start' | 'end'>
): number {
  return pointCompare(left.start, right.start) || pointCompare(left.end, right.end);
}

function triangleCompare(left: ProjectedFaceTriangle, right: ProjectedFaceTriangle): number {
  for (let index = 0; index < 3; index++) {
    const comparison = pointCompare(left.points[index]!, right.points[index]!);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

/**
 * Deterministically classify sharp B-Rep edges from adjacent planar face normals.
 *
 * This handles convex/silhouette hidden lines and coincident front/back projections.
 * It intentionally does not claim full arbitrary-body occlusion, which requires planar
 * region clipping beyond the v1 renderer-independent export pipeline.
 */
export function classifyOrthographicEdge(
  body: Body,
  faceIds: readonly string[],
  view: OrthographicView,
  tolerance: Readonly<TolerancePolicy> = DEFAULT_TOLERANCE_POLICY
): 'visible' | 'hidden' {
  if (faceIds.length === 0) {
    return 'visible';
  }
  const cameraDirection = viewCameraDirection(view);
  let hasFrontFace = false;
  let hasBackFace = false;
  for (const faceId of faceIds) {
    const face = body.faces.get(faceId);
    if (!face) {
      throw new Error(`Edge references missing face ${faceId}`);
    }
    const plane = body.planes.get(face.planeId);
    if (!plane) {
      throw new Error(`Face ${faceId} references missing plane ${face.planeId}`);
    }
    const magnitude = Math.hypot(...plane.normal);
    if (!Number.isFinite(magnitude) || magnitude <= tolerance.linear) {
      throw new Error(`Face ${faceId} has an invalid normal`);
    }
    const facing = (
      plane.normal[0] * cameraDirection[0]
      + plane.normal[1] * cameraDirection[1]
      + plane.normal[2] * cameraDirection[2]
    ) / magnitude;
    if (facing > tolerance.angular) hasFrontFace = true;
    if (facing < -tolerance.angular) hasBackFace = true;
  }
  return hasFrontFace || !hasBackFace ? 'visible' : 'hidden';
}

/** Direction from the model toward the conventional orthographic camera. */
export function viewCameraDirection(
  view: OrthographicView
): readonly [number, number, number] {
  switch (view) {
    case 'front': return [0, -1, 0];
    case 'top': return [0, 0, 1];
    case 'right': return [1, 0, 0];
  }
}

export function projectPoint(
  point: readonly [number, number, number],
  view: OrthographicView
): Point2D {
  switch (view) {
    case 'front': return { x: point[0], y: point[2] };
    case 'top': return { x: point[0], y: point[1] };
    case 'right': return { x: point[1], y: point[2] };
  }
}

function canonicalPoint(point: Point2D, tolerance: number): Point2D {
  return { x: canonical(point.x, tolerance), y: canonical(point.y, tolerance) };
}

function canonical(value: number, tolerance: number): number {
  const quantized = quantizeToTolerance(value, tolerance);
  return Object.is(quantized, -0) ? 0 : quantized;
}

function assertPoint(point: Point2D, name: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${name} contains a non-finite coordinate`);
  }
}

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function pointCompare(left: Point2D, right: Point2D): number {
  return left.x - right.x || left.y - right.y;
}

function segmentCompare(left: ProjectedEdge, right: ProjectedEdge): number {
  return pointCompare(left.start, right.start) || pointCompare(left.end, right.end);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
