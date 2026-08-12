import { DEFAULT_TOLERANCE_POLICY } from '../geometry/TolerancePolicy';
import type { Body } from '../geometry/Body';
import type { ConstructionPlane } from '../geometry/ConstructionPlane';
import type { EdgeRef } from '../geometry/SubObjectTypes';
import {
  cloneNormalizedSketch,
  validateNormalizedSketch,
  type NormalizedSketchGeometry,
  type ProjectedModelEdgeSourceRef,
} from './NormalizedSketch';
import type { Point2D } from './SketchTypes';

export type ModelEdgeProjectionErrorCode =
  | 'INVALID_REFERENCE'
  | 'BODY_REFERENCE_MISMATCH'
  | 'EDGE_NOT_FOUND'
  | 'VERTEX_NOT_FOUND'
  | 'UNSUPPORTED_EDGE_GEOMETRY'
  | 'INVALID_PLANE'
  | 'NON_FINITE_VERTEX'
  | 'EDGE_OFF_PLANE'
  | 'DEGENERATE_EDGE'
  | 'INVALID_TARGET_GEOMETRY'
  | 'SOURCE_BODY_NOT_FOUND'
  | 'SOURCE_TOPOLOGY_CHANGED'
  | 'ID_COLLISION';

export interface ModelEdgeProjectionError {
  code: ModelEdgeProjectionErrorCode;
  message: string;
  sourceIds: string[];
}

export interface ModelEdgeProjectionOptions {
  planarityTolerance?: number;
  pointTolerance?: number;
  namespace?: string;
}

export type ModelEdgeProjectionResult =
  | {
      ok: true;
      geometry: NormalizedSketchGeometry;
      sourceRef: ProjectedModelEdgeSourceRef;
      createdPointIds: [string, string];
      createdSegmentId: string;
    }
  | { ok: false; error: ModelEdgeProjectionError };

export type ProjectedModelEdgeRefreshResult =
  | { ok: true; geometry: NormalizedSketchGeometry }
  | {
      ok: false;
      segmentId: string;
      error: ModelEdgeProjectionError;
    };

/** Return the sorted, unique feature dependencies required by projected model edges. */
export function getProjectedModelEdgeSourceFeatureIds(
  geometry: NormalizedSketchGeometry
): string[] {
  return [...new Set(geometry.segments.flatMap((segment) =>
    segment.sourceRef?.kind === 'model-edge' ? [segment.sourceRef.featureId] : []
  ))].sort();
}

/**
 * Re-resolve persisted projected edges against the bodies produced earlier in
 * the current rebuild. Stored point IDs remain stable; only their coordinates
 * are refreshed from the authoritative model topology.
 */
export function refreshProjectedModelEdges(
  target: NormalizedSketchGeometry,
  plane: ConstructionPlane,
  bodiesByFeature: ReadonlyMap<string, readonly Body[]>,
  options: Pick<ModelEdgeProjectionOptions, 'planarityTolerance' | 'pointTolerance'> = {}
): ProjectedModelEdgeRefreshResult {
  const planarityTolerance = positiveTolerance(
    options.planarityTolerance,
    DEFAULT_TOLERANCE_POLICY.planarity
  );
  const pointTolerance = positiveTolerance(
    options.pointTolerance,
    DEFAULT_TOLERANCE_POLICY.profile
  );
  if (!planarityTolerance || !pointTolerance || !validPlane(plane)) {
    return refreshFailure(
      '',
      'INVALID_PLANE',
      'Projected model edges require a valid active sketch plane and positive tolerances.',
      [plane.id]
    );
  }

  const targetIssues = validateNormalizedSketch(target, pointTolerance);
  if (targetIssues.length > 0) {
    return refreshFailure(
      '',
      'INVALID_TARGET_GEOMETRY',
      'Projected model edges cannot be refreshed in an invalid sketch.',
      targetIssues.flatMap((issue) => issue.entityIds)
    );
  }

  const geometry = cloneNormalizedSketch(target);
  const pointById = new Map(geometry.points.map((point) => [point.id, point]));
  const projectedSegments = [...geometry.segments]
    .filter((segment) => segment.sourceRef?.kind === 'model-edge')
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const segment of projectedSegments) {
    const sourceRef = segment.sourceRef!;
    const body = bodiesByFeature
      .get(sourceRef.featureId)
      ?.find((candidate) => candidate.id === sourceRef.bodyId);
    if (!body) {
      return refreshFailure(
        segment.id,
        'SOURCE_BODY_NOT_FOUND',
        `Projected edge source body '${sourceRef.bodyId}' from feature '${sourceRef.featureId}' is unavailable; restore the source or replace the projection.`,
        [sourceRef.featureId, sourceRef.bodyId, sourceRef.edgeId]
      );
    }

    const resolved = resolveProjection(
      {
        featureId: sourceRef.featureId,
        bodyId: sourceRef.bodyId,
        edgeId: sourceRef.edgeId,
      },
      body,
      plane,
      planarityTolerance,
      pointTolerance
    );
    if (!resolved.ok) {
      return { ok: false, segmentId: segment.id, error: resolved.error };
    }

    const currentVertexIds = new Set(resolved.vertexIds);
    if (sourceRef.vertexIds.some((vertexId) => !currentVertexIds.has(vertexId))) {
      return refreshFailure(
        segment.id,
        'SOURCE_TOPOLOGY_CHANGED',
        'Projected edge topology changed and its stored endpoints can no longer be matched; replace the projection.',
        [sourceRef.edgeId, ...sourceRef.vertexIds, ...resolved.vertexIds]
      );
    }

    const startPoint = pointById.get(segment.startPointId);
    const endPoint = pointById.get(segment.endPointId);
    if (!startPoint || !endPoint) {
      return refreshFailure(
        segment.id,
        'INVALID_TARGET_GEOMETRY',
        'Projected edge endpoint references are missing from the sketch.',
        [segment.id, segment.startPointId, segment.endPointId]
      );
    }
    const projectedByVertexId = new Map(
      resolved.vertexIds.map((vertexId, index) => [vertexId, resolved.projected[index]!] as const)
    );
    startPoint.position = [...projectedByVertexId.get(sourceRef.vertexIds[0])!];
    endPoint.position = [...projectedByVertexId.get(sourceRef.vertexIds[1])!];
  }

  return { ok: true, geometry };
}

/**
 * Project one straight planar B-Rep edge into sketch space as deterministic
 * construction geometry. The source topology reference is retained for rebuilds.
 */
export function projectModelEdgeToSketch(
  target: NormalizedSketchGeometry,
  edgeRef: EdgeRef,
  body: Body,
  plane: ConstructionPlane,
  options: ModelEdgeProjectionOptions = {}
): ModelEdgeProjectionResult {
  const planarityTolerance = positiveTolerance(
    options.planarityTolerance,
    DEFAULT_TOLERANCE_POLICY.planarity
  );
  const pointTolerance = positiveTolerance(
    options.pointTolerance,
    DEFAULT_TOLERANCE_POLICY.profile
  );
  if (!planarityTolerance || !pointTolerance) {
    return failure('INVALID_PLANE', 'Projection tolerances must be finite and positive.', []);
  }
  if (!validReference(edgeRef)) {
    return failure('INVALID_REFERENCE', 'Model edge projection requires complete stable references.', []);
  }
  if (edgeRef.bodyId !== body.id) {
    return failure(
      'BODY_REFERENCE_MISMATCH',
      'The selected edge reference does not belong to the supplied body.',
      [edgeRef.bodyId, body.id, edgeRef.edgeId]
    );
  }
  if (!validPlane(plane)) {
    return failure('INVALID_PLANE', 'The active sketch plane has an invalid basis.', [plane.id]);
  }
  const targetIssues = validateNormalizedSketch(target, pointTolerance);
  if (targetIssues.length > 0) {
    return failure(
      'INVALID_TARGET_GEOMETRY',
      'Model edges cannot be projected into an invalid sketch.',
      targetIssues.flatMap((issue) => issue.entityIds)
    );
  }

  const resolved = resolveProjection(
    edgeRef,
    body,
    plane,
    planarityTolerance,
    pointTolerance
  );
  if (!resolved.ok) return resolved;
  const { vertexIds, projected } = resolved;

  const namespace = options.namespace?.trim() || 'projected-model-edge';
  const stableBase = [
    namespace,
    stablePart(edgeRef.featureId),
    stablePart(edgeRef.bodyId),
    stablePart(edgeRef.edgeId),
  ].join(':');
  const pointIds: [string, string] = [
    `${stableBase}:vertex:${stablePart(vertexIds[0])}`,
    `${stableBase}:vertex:${stablePart(vertexIds[1])}`,
  ];
  const segmentId = `${stableBase}:segment`;
  const existingIds = new Set([
    ...target.points.map((point) => point.id),
    ...target.segments.map((segment) => segment.id),
  ]);
  const collision = [...pointIds, segmentId].find((id) => existingIds.has(id));
  if (collision) {
    return failure(
      'ID_COLLISION',
      'This model edge is already projected into the sketch.',
      [collision, edgeRef.edgeId]
    );
  }

  const sourceRef: ProjectedModelEdgeSourceRef = {
    kind: 'model-edge',
    featureId: edgeRef.featureId,
    bodyId: edgeRef.bodyId,
    edgeId: edgeRef.edgeId,
    vertexIds,
  };
  const geometry = cloneNormalizedSketch(target);
  geometry.points.push(
    { id: pointIds[0], position: [...projected[0]] },
    { id: pointIds[1], position: [...projected[1]] }
  );
  geometry.segments.push({
    id: segmentId,
    type: 'line',
    startPointId: pointIds[0],
    endPointId: pointIds[1],
    construction: true,
    sourceRef: { ...sourceRef, vertexIds: [...sourceRef.vertexIds] },
  });
  geometry.points.sort((left, right) => left.id.localeCompare(right.id));
  geometry.segments.sort((left, right) => left.id.localeCompare(right.id));
  return { ok: true, geometry, sourceRef, createdPointIds: pointIds, createdSegmentId: segmentId };
}

function resolveProjection(
  edgeRef: EdgeRef,
  body: Body,
  plane: ConstructionPlane,
  planarityTolerance: number,
  pointTolerance: number
):
  | { ok: true; vertexIds: [string, string]; projected: [Point2D, Point2D] }
  | { ok: false; error: ModelEdgeProjectionError } {
  if (!validReference(edgeRef)) {
    return failure('INVALID_REFERENCE', 'Model edge projection requires complete stable references.', []);
  }
  if (edgeRef.bodyId !== body.id) {
    return failure(
      'BODY_REFERENCE_MISMATCH',
      'The selected edge reference does not belong to the supplied body.',
      [edgeRef.bodyId, body.id, edgeRef.edgeId]
    );
  }
  const edge = body.edges.get(edgeRef.edgeId);
  if (!edge) {
    return failure('EDGE_NOT_FOUND', 'The selected model edge no longer exists.', [edgeRef.edgeId]);
  }
  if (!Array.isArray(edge.vertexIds) || edge.vertexIds.length !== 2) {
    return failure(
      'UNSUPPORTED_EDGE_GEOMETRY',
      'Only straight two-vertex model edges can be projected.',
      [edgeRef.edgeId]
    );
  }
  const vertexIds: [string, string] = [edge.vertexIds[0], edge.vertexIds[1]];
  const vertices = vertexIds.map((vertexId) => body.vertices.get(vertexId));
  const missingVertexIds = vertexIds.filter((_, index) => !vertices[index]);
  if (missingVertexIds.length > 0) {
    return failure(
      'VERTEX_NOT_FOUND',
      'A model-edge endpoint no longer exists.',
      missingVertexIds
    );
  }
  const positions = vertices.map((vertex) => vertex!.position);
  if (positions.some((position) => !finitePoint3(position))) {
    return failure(
      'NON_FINITE_VERTEX',
      'Model-edge endpoints must have finite world coordinates.',
      vertexIds
    );
  }
  const offPlaneVertexIds = vertexIds.filter((_, index) =>
    Math.abs(signedPlaneDistance(plane, positions[index]!)) > planarityTolerance
  );
  if (offPlaneVertexIds.length > 0) {
    return failure(
      'EDGE_OFF_PLANE',
      'Both model-edge endpoints must lie on the active sketch plane.',
      [edgeRef.edgeId, ...offPlaneVertexIds]
    );
  }

  const projected: [Point2D, Point2D] = [
    worldToPlane(plane, positions[0]!),
    worldToPlane(plane, positions[1]!),
  ];
  if (pointDistance(projected[0], projected[1]) <= pointTolerance) {
    return failure(
      'DEGENERATE_EDGE',
      'The projected model edge has no usable sketch length.',
      [edgeRef.edgeId, ...vertexIds]
    );
  }
  return { ok: true, vertexIds, projected };
}

function validReference(edgeRef: EdgeRef): boolean {
  return [edgeRef.featureId, edgeRef.bodyId, edgeRef.edgeId]
    .every((value) => typeof value === 'string' && value.trim().length > 0);
}

function validPlane(plane: ConstructionPlane): boolean {
  if (![plane.origin, plane.normal, plane.uAxis, plane.vAxis].every(finitePoint3)) return false;
  const normalLength = length3(plane.normal);
  const uLength = length3(plane.uAxis);
  const vLength = length3(plane.vAxis);
  if (Math.min(normalLength, uLength, vLength) <= DEFAULT_TOLERANCE_POLICY.linear) return false;
  const orthogonality = Math.max(
    Math.abs(dot3(plane.normal, plane.uAxis) / (normalLength * uLength)),
    Math.abs(dot3(plane.normal, plane.vAxis) / (normalLength * vLength)),
    Math.abs(dot3(plane.uAxis, plane.vAxis) / (uLength * vLength))
  );
  return orthogonality <= DEFAULT_TOLERANCE_POLICY.angular;
}

function signedPlaneDistance(
  plane: ConstructionPlane,
  point: [number, number, number]
): number {
  const relative: [number, number, number] = [
    point[0] - plane.origin[0],
    point[1] - plane.origin[1],
    point[2] - plane.origin[2],
  ];
  return dot3(relative, plane.normal) / length3(plane.normal);
}

function worldToPlane(plane: ConstructionPlane, point: [number, number, number]): Point2D {
  const relative: [number, number, number] = [
    point[0] - plane.origin[0],
    point[1] - plane.origin[1],
    point[2] - plane.origin[2],
  ];
  return [
    dot3(relative, plane.uAxis) / dot3(plane.uAxis, plane.uAxis),
    dot3(relative, plane.vAxis) / dot3(plane.vAxis, plane.vAxis),
  ];
}

function stablePart(value: string): string {
  return `${value.length}:${value}`;
}

function positiveTolerance(value: number | undefined, fallback: number): number | null {
  const resolved = value ?? fallback;
  return Number.isFinite(resolved) && resolved > 0 ? resolved : null;
}

function finitePoint3(point: readonly number[]): point is [number, number, number] {
  return point.length === 3 && point.every(Number.isFinite);
}

function dot3(left: readonly number[], right: readonly number[]): number {
  return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}

function length3(value: readonly number[]): number {
  return Math.hypot(value[0]!, value[1]!, value[2]!);
}

function pointDistance(left: Point2D, right: Point2D): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function failure(
  code: ModelEdgeProjectionErrorCode,
  message: string,
  sourceIds: string[]
): { ok: false; error: ModelEdgeProjectionError } {
  return {
    ok: false,
    error: { code, message, sourceIds: [...new Set(sourceIds)].sort() },
  };
}

function refreshFailure(
  segmentId: string,
  code: ModelEdgeProjectionErrorCode,
  message: string,
  sourceIds: string[]
): ProjectedModelEdgeRefreshResult {
  return {
    ok: false,
    segmentId,
    error: failure(code, message, sourceIds).error,
  };
}
