import { DEFAULT_TOLERANCE_POLICY } from '../geometry/TolerancePolicy';
import {
  cloneNormalizedSketch,
  type NormalizedSketchGeometry,
  type SketchPoint,
  type SketchSegmentReference,
} from './NormalizedSketch';
import {
  validateSketchRelations,
} from './SketchConstraintSolver';
import type {
  DrivingDistanceDimension,
  SketchRelation,
} from './SketchConstraints';
import {
  createCenterRectangle,
  createRegularPolygon,
} from './SketchPrimitives';
import type { Point2D } from './SketchTypes';

export type SketchEditErrorCode =
  | 'INVALID_POINT'
  | 'INVALID_SHAPE'
  | 'ID_COLLISION'
  | 'POINT_NOT_FOUND'
  | 'SEGMENT_NOT_FOUND'
  | 'INVALID_RELATION'
  | 'NO_INTERSECTION'
  | 'INTERSECTION_OUTSIDE_TARGET'
  | 'WRONG_EXTENSION_DIRECTION';

export interface SketchEditError {
  code: SketchEditErrorCode;
  message: string;
  entityIds: string[];
}

export type SketchGeometryEditResult =
  | {
      ok: true;
      geometry: NormalizedSketchGeometry;
      createdPointIds: string[];
      createdSegmentIds: string[];
    }
  | { ok: false; error: SketchEditError };

export type SketchRelationEditResult =
  | { ok: true; relations: SketchRelation[] }
  | { ok: false; error: SketchEditError };

export interface PolylineOptions {
  closed?: boolean;
  construction?: boolean;
  tolerance?: number;
}

export type TrimSegmentSide = 'start' | 'end';

export interface TrimStraightSegmentOptions {
  /**
   * Side discarded by the trim. This is the preferred UI-facing form because
   * it maps directly to the side of the target that the user picked.
   */
  removeSide: TrimSegmentSide;
  tolerance?: number;
}

/** Add a corner rectangle whose four segments share persistent point IDs. */
export function appendSharedPointRectangle(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  firstCorner: Point2D,
  oppositeCorner: Point2D,
  tolerance = DEFAULT_TOLERANCE_POLICY.profile
): SketchGeometryEditResult {
  const center: Point2D = [
    (firstCorner[0] + oppositeCorner[0]) / 2,
    (firstCorner[1] + oppositeCorner[1]) / 2,
  ];
  const primitive = createCenterRectangle(center, oppositeCorner, { minimumSize: tolerance });
  return primitive.ok
    ? appendSharedPointPolyline(geometry, operationId, primitive.points, { closed: true, tolerance })
    : editFailure('INVALID_SHAPE', primitive.error.message, []);
}

/** Add a center rectangle while preserving one shared point per corner. */
export function appendCenterRectangle(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  center: Point2D,
  corner: Point2D,
  tolerance = DEFAULT_TOLERANCE_POLICY.profile
): SketchGeometryEditResult {
  const primitive = createCenterRectangle(center, corner, { minimumSize: tolerance });
  return primitive.ok
    ? appendSharedPointPolyline(geometry, operationId, primitive.points, { closed: true, tolerance })
    : editFailure('INVALID_SHAPE', primitive.error.message, []);
}

/** Add a regular polygon with deterministic first vertex and counter-clockwise segments. */
export function appendRegularPolygon(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  center: Point2D,
  vertex: Point2D,
  sides: number,
  tolerance = DEFAULT_TOLERANCE_POLICY.profile
): SketchGeometryEditResult {
  const primitive = createRegularPolygon(center, vertex, sides, { minimumSize: tolerance });
  return primitive.ok
    ? appendSharedPointPolyline(geometry, operationId, primitive.points, { closed: true, tolerance })
    : editFailure('INVALID_SHAPE', primitive.error.message, []);
}

/**
 * Add an open or closed shared-point polyline. L- and U-shaped profiles use
 * this same API with their ordered boundary points and `closed: true`.
 */
export function appendSharedPointPolyline(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  points: readonly Point2D[],
  options: PolylineOptions = {}
): SketchGeometryEditResult {
  const tolerance = positiveTolerance(options.tolerance);
  if (!operationId.trim() || points.length < 2 || (options.closed && points.length < 3)) {
    return editFailure(
      'INVALID_SHAPE',
      'Polyline needs a stable operation ID and enough ordered points.',
      []
    );
  }
  if (points.some((point) => !isFinitePoint(point))) {
    return editFailure('INVALID_POINT', 'Polyline points must be finite.', []);
  }
  for (let index = 0; index < points.length - 1; index++) {
    if (pointDistance(points[index]!, points[index + 1]!) <= tolerance) {
      return editFailure('INVALID_SHAPE', 'Adjacent polyline points must be distinct.', []);
    }
  }
  if (options.closed && pointDistance(points[0]!, points[points.length - 1]!) <= tolerance) {
    return editFailure(
      'INVALID_SHAPE',
      'Closed polylines must omit the repeated first point; closure is created automatically.',
      []
    );
  }

  const pointIds = points.map((_, index) => `${operationId}:point:${index}`);
  const segmentCount = options.closed ? points.length : points.length - 1;
  const segmentIds = Array.from({ length: segmentCount }, (_, index) =>
    `${operationId}:segment:${index}`
  );
  const collision = firstCollision(geometry, pointIds, segmentIds);
  if (collision) {
    return editFailure(
      'ID_COLLISION',
      'The operation ID is already used in this sketch; use a new stable operation ID.',
      [collision]
    );
  }

  const next = cloneNormalizedSketch(geometry);
  next.points.push(...points.map((position, index): SketchPoint => ({
    id: pointIds[index]!,
    position: copyPoint(position),
  })));
  next.segments.push(...segmentIds.map((id, index): SketchSegmentReference => ({
    id,
    type: 'line',
    startPointId: pointIds[index]!,
    endPointId: pointIds[(index + 1) % pointIds.length]!,
    construction: options.construction ?? false,
  })));
  sortGeometry(next);
  return {
    ok: true,
    geometry: next,
    createdPointIds: pointIds,
    createdSegmentIds: segmentIds,
  };
}

/** Move one editable point without changing any persistent IDs. */
export function moveSketchPoint(
  geometry: NormalizedSketchGeometry,
  pointId: string,
  position: Point2D
): SketchGeometryEditResult {
  if (!isFinitePoint(position)) {
    return editFailure('INVALID_POINT', 'Point coordinates must be finite.', [pointId]);
  }
  if (!geometry.points.some((point) => point.id === pointId)) {
    return editFailure('POINT_NOT_FOUND', 'The point to move no longer exists.', [pointId]);
  }
  const next = cloneNormalizedSketch(geometry);
  next.points = next.points.map((point) =>
    point.id === pointId ? { ...point, position: copyPoint(position) } : point
  );
  return {
    ok: true,
    geometry: next,
    createdPointIds: [],
    createdSegmentIds: [],
  };
}

/** Add and validate any supported geometric relation immutably. */
export function addSketchRelation(
  geometry: NormalizedSketchGeometry,
  relations: readonly SketchRelation[],
  relation: SketchRelation
): SketchRelationEditResult {
  const next = [...relations.map(cloneRelation), cloneRelation(relation)]
    .sort((a, b) => a.id.localeCompare(b.id));
  const issues = validateSketchRelations(geometry, next);
  if (issues.length > 0) {
    const issue = issues[0]!;
    return relationFailure(
      'INVALID_RELATION',
      issue.message,
      [...issue.relationIds, ...issue.entityIds].sort()
    );
  }
  return { ok: true, relations: next };
}

/** Create and validate a driving distance between two persistent points. */
export function addDrivingDistanceDimension(
  geometry: NormalizedSketchGeometry,
  relations: readonly SketchRelation[],
  id: string,
  pointAId: string,
  pointBId: string,
  value: number,
  name?: string
): SketchRelationEditResult {
  const dimension: DrivingDistanceDimension = {
    id,
    type: 'distance',
    pointAId,
    pointBId,
    value,
    ...(name !== undefined ? { name } : {}),
  };
  return addSketchRelation(geometry, relations, dimension);
}

/** Trim a target segment to its strict interior intersection with a cutter. */
export function trimStraightSegment(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  targetSegmentId: string,
  cutterSegmentId: string,
  /** @deprecated Pass `{ removeSide }` for new integrations. */
  keep: TrimSegmentSide,
  tolerance?: number
): SketchGeometryEditResult;
export function trimStraightSegment(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  targetSegmentId: string,
  cutterSegmentId: string,
  options: TrimStraightSegmentOptions
): SketchGeometryEditResult;
export function trimStraightSegment(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  targetSegmentId: string,
  cutterSegmentId: string,
  sideOrOptions: TrimSegmentSide | TrimStraightSegmentOptions,
  legacyTolerance = DEFAULT_TOLERANCE_POLICY.profile
): SketchGeometryEditResult {
  const removeSide = typeof sideOrOptions === 'string'
    ? oppositeSide(sideOrOptions)
    : sideOrOptions.removeSide;
  const tolerance = typeof sideOrOptions === 'string'
    ? positiveTolerance(legacyTolerance)
    : positiveTolerance(sideOrOptions.tolerance);
  const records = resolveTwoSegments(geometry, targetSegmentId, cutterSegmentId);
  if (!records.ok) return records;
  const intersection = lineIntersection(records.target.start, records.target.end, records.cutter.start, records.cutter.end);
  if (!intersection || !withinSegment(intersection.point, records.cutter.start, records.cutter.end, tolerance)) {
    return editFailure('NO_INTERSECTION', 'Target and cutter do not intersect.', [targetSegmentId, cutterSegmentId]);
  }
  if (intersection.targetParameter <= tolerance || intersection.targetParameter >= 1 - tolerance) {
    return editFailure(
      'INTERSECTION_OUTSIDE_TARGET',
      'Trim requires an intersection strictly inside the target segment.',
      [targetSegmentId]
    );
  }
  return replaceSegmentEndpoint(
    geometry,
    operationId,
    records.target.segment,
    removeSide,
    intersection.point
  );
}

/** Extend one target endpoint to the finite boundary segment. */
export function extendStraightSegment(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  targetSegmentId: string,
  boundarySegmentId: string,
  endpoint: 'start' | 'end',
  tolerance = DEFAULT_TOLERANCE_POLICY.profile
): SketchGeometryEditResult {
  const records = resolveTwoSegments(geometry, targetSegmentId, boundarySegmentId);
  if (!records.ok) return records;
  const intersection = lineIntersection(records.target.start, records.target.end, records.cutter.start, records.cutter.end);
  if (!intersection || !withinSegment(intersection.point, records.cutter.start, records.cutter.end, tolerance)) {
    return editFailure('NO_INTERSECTION', 'The target line does not meet the finite boundary.', [targetSegmentId, boundarySegmentId]);
  }
  const extendsStart = intersection.targetParameter < -tolerance;
  const extendsEnd = intersection.targetParameter > 1 + tolerance;
  if ((endpoint === 'start' && !extendsStart) || (endpoint === 'end' && !extendsEnd)) {
    return editFailure(
      'WRONG_EXTENSION_DIRECTION',
      `Intersection does not extend the target ${endpoint} endpoint.`,
      [targetSegmentId]
    );
  }
  return replaceSegmentEndpoint(geometry, operationId, records.target.segment, endpoint, intersection.point);
}

/** Project selected straight segments as construction geometry with stable IDs. */
export function projectStraightSegments(
  target: NormalizedSketchGeometry,
  source: NormalizedSketchGeometry,
  sourceSegmentIds: readonly string[],
  operationId: string
): SketchGeometryEditResult {
  const sourcePointById = new Map(source.points.map((point) => [point.id, point]));
  const sourceSegmentById = new Map(source.segments.map((segment) => [segment.id, segment]));
  const selected = [...new Set(sourceSegmentIds)].sort().map((id) => sourceSegmentById.get(id));
  if (selected.some((segment) => !segment)) {
    const missing = [...new Set(sourceSegmentIds)].filter((id) => !sourceSegmentById.has(id)).sort();
    return editFailure('SEGMENT_NOT_FOUND', 'A projected source segment no longer exists.', missing);
  }
  const sourcePointIds = [...new Set(selected.flatMap((segment) => [
    segment!.startPointId,
    segment!.endPointId,
  ]))].sort();
  const pointIds = sourcePointIds.map((id) => `${operationId}:point:${id}`);
  const segmentIds = selected.map((segment) => `${operationId}:segment:${segment!.id}`);
  const collision = firstCollision(target, pointIds, segmentIds);
  if (collision) {
    return editFailure('ID_COLLISION', 'Projected geometry operation ID is already in use.', [collision]);
  }
  const projectedPointId = new Map(sourcePointIds.map((id, index) => [id, pointIds[index]!]));
  const next = cloneNormalizedSketch(target);
  next.points.push(...sourcePointIds.map((sourcePointId, index): SketchPoint => ({
    id: pointIds[index]!,
    position: copyPoint(sourcePointById.get(sourcePointId)!.position),
  })));
  next.segments.push(...selected.map((sourceSegment, index): SketchSegmentReference => ({
    id: segmentIds[index]!,
    type: 'line',
    startPointId: projectedPointId.get(sourceSegment!.startPointId)!,
    endPointId: projectedPointId.get(sourceSegment!.endPointId)!,
    construction: true,
  })));
  sortGeometry(next);
  return { ok: true, geometry: next, createdPointIds: pointIds, createdSegmentIds: segmentIds };
}

interface ResolvedSegment {
  segment: SketchSegmentReference;
  start: Point2D;
  end: Point2D;
}

function resolveTwoSegments(
  geometry: NormalizedSketchGeometry,
  targetId: string,
  cutterId: string
): { ok: true; target: ResolvedSegment; cutter: ResolvedSegment } | { ok: false; error: SketchEditError } {
  const pointById = new Map(geometry.points.map((point) => [point.id, point]));
  const resolve = (id: string): ResolvedSegment | null => {
    const segment = geometry.segments.find((candidate) => candidate.id === id);
    if (!segment) return null;
    const start = pointById.get(segment.startPointId);
    const end = pointById.get(segment.endPointId);
    return start && end
      ? { segment, start: start.position, end: end.position }
      : null;
  };
  const target = resolve(targetId);
  const cutter = resolve(cutterId);
  return target && cutter
    ? { ok: true, target, cutter }
    : editFailure('SEGMENT_NOT_FOUND', 'A required segment or endpoint no longer exists.', [
      ...(!target ? [targetId] : []),
      ...(!cutter ? [cutterId] : []),
    ]);
}

function replaceSegmentEndpoint(
  geometry: NormalizedSketchGeometry,
  operationId: string,
  segment: SketchSegmentReference,
  endpoint: 'start' | 'end',
  position: Point2D
): SketchGeometryEditResult {
  const pointId = `${operationId}:point:intersection`;
  if (geometry.points.some((point) => point.id === pointId)) {
    return editFailure('ID_COLLISION', 'Edit operation ID is already in use.', [pointId]);
  }
  const next = cloneNormalizedSketch(geometry);
  const replacedPointId = endpoint === 'start' ? segment.startPointId : segment.endPointId;
  next.points.push({ id: pointId, position: copyPoint(position) });
  next.segments = next.segments.map((candidate) => candidate.id === segment.id
    ? {
        ...candidate,
        ...(endpoint === 'start' ? { startPointId: pointId } : { endPointId: pointId }),
      }
    : candidate);
  removePointIfUnreferenced(next, replacedPointId);
  sortGeometry(next);
  return { ok: true, geometry: next, createdPointIds: [pointId], createdSegmentIds: [] };
}

function lineIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): {
  point: Point2D;
  targetParameter: number;
} | null {
  const r: Point2D = [b[0] - a[0], b[1] - a[1]];
  const s: Point2D = [d[0] - c[0], d[1] - c[1]];
  const denominator = cross(r, s);
  if (Math.abs(denominator) <= DEFAULT_TOLERANCE_POLICY.angular) return null;
  const delta: Point2D = [c[0] - a[0], c[1] - a[1]];
  const targetParameter = cross(delta, s) / denominator;
  return {
    point: [a[0] + targetParameter * r[0], a[1] + targetParameter * r[1]],
    targetParameter,
  };
}

function withinSegment(point: Point2D, start: Point2D, end: Point2D, tolerance: number): boolean {
  const length = pointDistance(start, end);
  return Math.abs(pointDistance(start, point) + pointDistance(point, end) - length) <= tolerance;
}

function removePointIfUnreferenced(
  geometry: NormalizedSketchGeometry,
  pointId: string
): void {
  const referenced = new Set(geometry.segments.flatMap((segment) => [segment.startPointId, segment.endPointId]));
  if (!referenced.has(pointId)) {
    geometry.points = geometry.points.filter((point) => point.id !== pointId);
  }
}

function firstCollision(
  geometry: NormalizedSketchGeometry,
  pointIds: readonly string[],
  segmentIds: readonly string[]
): string | null {
  const existing = new Set([
    ...geometry.points.map((point) => point.id),
    ...geometry.segments.map((segment) => segment.id),
  ]);
  return [...pointIds, ...segmentIds].find((id) => existing.has(id)) ?? null;
}

function sortGeometry(geometry: NormalizedSketchGeometry): void {
  geometry.points.sort((a, b) => a.id.localeCompare(b.id));
  geometry.segments.sort((a, b) => a.id.localeCompare(b.id));
}

function cloneRelation(relation: SketchRelation): SketchRelation {
  return relation.type === 'fixed'
    ? { ...relation, position: copyPoint(relation.position) }
    : { ...relation };
}

function positiveTolerance(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TOLERANCE_POLICY.profile;
}

function isFinitePoint(point: Point2D): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function pointDistance(left: Point2D, right: Point2D): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function cross(left: Point2D, right: Point2D): number {
  return left[0] * right[1] - left[1] * right[0];
}

function copyPoint(point: Point2D): Point2D {
  return [point[0], point[1]];
}

function oppositeSide(side: TrimSegmentSide): TrimSegmentSide {
  return side === 'start' ? 'end' : 'start';
}

function editFailure(
  code: SketchEditErrorCode,
  message: string,
  entityIds: string[]
): { ok: false; error: SketchEditError } {
  return { ok: false, error: { code, message, entityIds: [...entityIds].sort() } };
}

function relationFailure(
  code: SketchEditErrorCode,
  message: string,
  entityIds: string[]
): SketchRelationEditResult {
  return { ok: false, error: { code, message, entityIds: [...entityIds].sort() } };
}
