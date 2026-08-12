import { DEFAULT_TOLERANCE_POLICY } from '../geometry/TolerancePolicy';
import {
  getRectangleCorners,
  type LineEntity,
  type Point2D,
  type SketchEntity,
} from './SketchTypes';
import type { ProfileSegment } from './ProfileAnalyzer';

export const NORMALIZED_SKETCH_SCHEMA_VERSION = 1 as const;

export interface SketchPoint {
  id: string;
  position: Point2D;
}

/** Stable topology reference retained by construction geometry projected from a model edge. */
export interface ProjectedModelEdgeSourceRef {
  kind: 'model-edge';
  featureId: string;
  bodyId: string;
  edgeId: string;
  vertexIds: [string, string];
}

export interface SketchSegmentReference {
  id: string;
  type: 'line';
  startPointId: string;
  endPointId: string;
  construction: boolean;
  sourceRef?: ProjectedModelEdgeSourceRef;
}

export interface NormalizedSketchGeometry {
  schemaVersion: typeof NORMALIZED_SKETCH_SCHEMA_VERSION;
  points: SketchPoint[];
  segments: SketchSegmentReference[];
}

/** Points whose coordinates are owned by referenced model topology, not the solver. */
export function getExternallyDrivenPointIds(
  geometry: NormalizedSketchGeometry
): string[] {
  return [...new Set(geometry.segments.flatMap((segment) =>
    segment.sourceRef?.kind === 'model-edge'
      ? [segment.startPointId, segment.endPointId]
      : []
  ))].sort();
}

export interface NormalizeLineOptions {
  pointTolerance?: number;
}

export type NormalizedSketchIssueCode =
  | 'DUPLICATE_ID'
  | 'MISSING_POINT_REFERENCE'
  | 'DEGENERATE_SEGMENT'
  | 'NON_FINITE_POINT';

export interface NormalizedSketchIssue {
  code: NormalizedSketchIssueCode;
  message: string;
  entityIds: string[];
}

interface MigrationEndpoint {
  key: string;
  position: Point2D;
}

/**
 * One-time deterministic migration from tuple-based lines to persistent points.
 * Connected endpoints share one point ID; existing line IDs are preserved.
 */
export function normalizeLineEntities(
  lines: readonly LineEntity[],
  options: NormalizeLineOptions = {}
): NormalizedSketchGeometry {
  const tolerance = validTolerance(options.pointTolerance)
    ? options.pointTolerance
    : DEFAULT_TOLERANCE_POLICY.profile;
  const sortedLines = [...lines].sort((a, b) => a.id.localeCompare(b.id));
  const endpoints: MigrationEndpoint[] = sortedLines.flatMap((line) => [
    { key: endpointKey(line.id, 'start'), position: copyPoint(line.start) },
    { key: endpointKey(line.id, 'end'), position: copyPoint(line.end) },
  ]).sort(compareEndpoints);
  const parents = endpoints.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) {
      root = parents[root]!;
    }
    while (parents[index] !== index) {
      const next = parents[index]!;
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    }
  };

  for (let left = 0; left < endpoints.length; left++) {
    for (let right = left + 1; right < endpoints.length; right++) {
      const a = endpoints[left]!;
      const b = endpoints[right]!;
      if (b.position[0] - a.position[0] > tolerance) {
        break;
      }
      if (pointDistance(a.position, b.position) <= tolerance) {
        union(left, right);
      }
    }
  }

  const endpointGroups = new Map<number, MigrationEndpoint[]>();
  endpoints.forEach((endpoint, index) => {
    const root = find(index);
    const group = endpointGroups.get(root) ?? [];
    group.push(endpoint);
    endpointGroups.set(root, group);
  });

  const pointIdByEndpoint = new Map<string, string>();
  const points = [...endpointGroups.values()].map((group): SketchPoint => {
    group.sort(compareEndpoints);
    const canonicalEndpointKey = [...group].sort((a, b) => a.key.localeCompare(b.key))[0]!.key;
    const point: SketchPoint = {
      id: `point:${canonicalEndpointKey}`,
      position: copyPoint(group[0]!.position),
    };
    for (const endpoint of group) {
      pointIdByEndpoint.set(endpoint.key, point.id);
    }
    return point;
  }).sort((a, b) => a.id.localeCompare(b.id));

  const segments = sortedLines.map((line): SketchSegmentReference => ({
    id: line.id,
    type: 'line',
    startPointId: pointIdByEndpoint.get(endpointKey(line.id, 'start'))!,
    endPointId: pointIdByEndpoint.get(endpointKey(line.id, 'end'))!,
    construction: false,
  }));

  return {
    schemaVersion: NORMALIZED_SKETCH_SCHEMA_VERSION,
    points,
    segments,
  };
}

/** Expand legacy rectangle primitives and tuple lines into shared-point geometry. */
export function normalizeSketchEntities(
  entities: readonly SketchEntity[],
  options: NormalizeLineOptions = {}
): NormalizedSketchGeometry {
  const lines = [...entities]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((entity): LineEntity[] => {
      if (entity.type === 'line') {
        return [{
          id: entity.id,
          type: 'line',
          start: copyPoint(entity.start),
          end: copyPoint(entity.end),
        }];
      }
      const corners = getRectangleCorners(entity);
      return corners.map((corner, index) => ({
        id: legacyRectangleEdgeId(entity.id, index),
        type: 'line',
        start: copyPoint(corner),
        end: copyPoint(corners[(index + 1) % corners.length]!),
      }));
    });
  return normalizeLineEntities(lines, options);
}

export function legacyRectangleEdgeId(rectangleId: string, edgeIndex: number): string {
  return `${rectangleId}:edge:${edgeIndex}`;
}

export function validateNormalizedSketch(
  geometry: NormalizedSketchGeometry,
  pointTolerance = DEFAULT_TOLERANCE_POLICY.profile
): NormalizedSketchIssue[] {
  const issues: NormalizedSketchIssue[] = [];
  const pointIds = new Set<string>();
  const duplicatePointIds = new Set<string>();
  for (const point of geometry.points) {
    if (pointIds.has(point.id)) {
      duplicatePointIds.add(point.id);
    }
    pointIds.add(point.id);
    if (!Number.isFinite(point.position[0]) || !Number.isFinite(point.position[1])) {
      issues.push({
        code: 'NON_FINITE_POINT',
        message: 'Sketch point coordinates must be finite.',
        entityIds: [point.id],
      });
    }
  }
  for (const pointId of [...duplicatePointIds].sort()) {
    issues.push({
      code: 'DUPLICATE_ID',
      message: 'Sketch point IDs must be unique.',
      entityIds: [pointId],
    });
  }

  const segmentIds = new Set<string>();
  for (const segment of [...geometry.segments].sort((a, b) => a.id.localeCompare(b.id))) {
    if (segmentIds.has(segment.id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        message: 'Sketch segment IDs must be unique.',
        entityIds: [segment.id],
      });
    }
    segmentIds.add(segment.id);
    const start = geometry.points.find((point) => point.id === segment.startPointId);
    const end = geometry.points.find((point) => point.id === segment.endPointId);
    if (!start || !end) {
      issues.push({
        code: 'MISSING_POINT_REFERENCE',
        message: 'Sketch segment references a point that does not exist.',
        entityIds: [segment.id, ...[segment.startPointId, segment.endPointId].filter((id) => !pointIds.has(id))].sort(),
      });
    } else if (pointDistance(start.position, end.position) <= pointTolerance) {
      issues.push({
        code: 'DEGENERATE_SEGMENT',
        message: 'Sketch segment endpoints must be distinct.',
        entityIds: [segment.id, start.id, end.id].sort(),
      });
    }
  }

  return issues.sort((a, b) =>
    a.code.localeCompare(b.code) || a.entityIds.join('|').localeCompare(b.entityIds.join('|'))
  );
}

export function materializeLineEntities(
  geometry: NormalizedSketchGeometry
): LineEntity[] {
  const pointById = new Map(geometry.points.map((point) => [point.id, point]));
  return [...geometry.segments]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((segment): LineEntity[] => {
      const start = pointById.get(segment.startPointId);
      const end = pointById.get(segment.endPointId);
      if (!start || !end) {
        return [];
      }
      return [{
        id: segment.id,
        type: 'line',
        start: copyPoint(start.position),
        end: copyPoint(end.position),
      }];
    });
}

export function toProfileSegments(
  geometry: NormalizedSketchGeometry,
  includeConstruction = false
): ProfileSegment[] {
  const pointById = new Map(geometry.points.map((point) => [point.id, point]));
  return [...geometry.segments]
    .filter((segment) => includeConstruction || !segment.construction)
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((segment): ProfileSegment[] => {
      const start = pointById.get(segment.startPointId);
      const end = pointById.get(segment.endPointId);
      return start && end
        ? [{ id: segment.id, start: copyPoint(start.position), end: copyPoint(end.position) }]
        : [];
    });
}

export function cloneNormalizedSketch(
  geometry: NormalizedSketchGeometry
): NormalizedSketchGeometry {
  return {
    schemaVersion: NORMALIZED_SKETCH_SCHEMA_VERSION,
    points: geometry.points.map((point) => ({ ...point, position: copyPoint(point.position) })),
    segments: geometry.segments.map((segment) => ({
      ...segment,
      ...(segment.sourceRef
        ? {
            sourceRef: {
              ...segment.sourceRef,
              vertexIds: [...segment.sourceRef.vertexIds],
            },
          }
        : {}),
    })),
  };
}

function endpointKey(lineId: string, endpoint: 'start' | 'end'): string {
  return `${lineId}:${endpoint}`;
}

function compareEndpoints(left: MigrationEndpoint, right: MigrationEndpoint): number {
  return left.position[0] - right.position[0]
    || left.position[1] - right.position[1]
    || left.key.localeCompare(right.key);
}

function pointDistance(left: Point2D, right: Point2D): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function validTolerance(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function copyPoint(point: Point2D): Point2D {
  return [point[0], point[1]];
}
