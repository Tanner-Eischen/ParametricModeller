import type { Body } from '../../geometry/Body';
import type {
  CoordinateFrame3D,
  Vector3Tuple,
} from '../../geometry/CoordinateFrame3D';
import {
  createCoordinateFrameFromXAxis,
  createCoordinateFrameFromZAxis,
} from '../../geometry/CoordinateFrame3D';
import type { Diagnostic } from '../Diagnostics';
import { error } from '../Diagnostics';
import type { RebuildContext } from '../RebuildContext';

export interface PlacementReferenceBase {
  featureId: string;
  bodyId: string;
}

export interface BodyPlacementRef extends PlacementReferenceBase {
  kind: 'body';
}

export interface FacePlacementRef extends PlacementReferenceBase {
  kind: 'face';
  faceId: string;
}

export interface EdgePlacementRef extends PlacementReferenceBase {
  kind: 'edge';
  edgeId: string;
}

export interface VertexPlacementRef extends PlacementReferenceBase {
  kind: 'vertex';
  vertexId: string;
}

export interface EdgePointPlacementRef extends PlacementReferenceBase {
  kind: 'edgePoint';
  edgeId: string;
  /** Stable normalized position from edge.vertexIds[0] to edge.vertexIds[1]. */
  parameter: number;
}

export interface FaceCenterPlacementRef extends PlacementReferenceBase {
  kind: 'faceCenter';
  faceId: string;
}

export type PlacementReference =
  | BodyPlacementRef
  | FacePlacementRef
  | EdgePlacementRef
  | VertexPlacementRef
  | EdgePointPlacementRef
  | FaceCenterPlacementRef;

export type PlacementDatumRef = PlacementReference;

export type PlacementPointRef =
  | BodyPlacementRef
  | VertexPlacementRef
  | EdgePointPlacementRef
  | FaceCenterPlacementRef;

export type PlacementFrameRef =
  | BodyPlacementRef
  | FacePlacementRef
  | EdgePlacementRef
  | VertexPlacementRef
  | EdgePointPlacementRef
  | FaceCenterPlacementRef;

export type PlacementResolution<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostic: Diagnostic };

export function createBodyPlacementRef(
  featureId: string,
  bodyId: string
): BodyPlacementRef {
  return { kind: 'body', featureId, bodyId };
}

export function createFacePlacementRef(
  featureId: string,
  bodyId: string,
  faceId: string
): FacePlacementRef {
  return { kind: 'face', featureId, bodyId, faceId };
}

export function createEdgePlacementRef(
  featureId: string,
  bodyId: string,
  edgeId: string
): EdgePlacementRef {
  return { kind: 'edge', featureId, bodyId, edgeId };
}

export function createVertexPlacementRef(
  featureId: string,
  bodyId: string,
  vertexId: string
): VertexPlacementRef {
  return { kind: 'vertex', featureId, bodyId, vertexId };
}

export function createEdgePointPlacementRef(
  featureId: string,
  bodyId: string,
  edgeId: string,
  parameter = 0.5
): EdgePointPlacementRef {
  return { kind: 'edgePoint', featureId, bodyId, edgeId, parameter };
}

export function createFaceCenterPlacementRef(
  featureId: string,
  bodyId: string,
  faceId: string
): FaceCenterPlacementRef {
  return { kind: 'faceCenter', featureId, bodyId, faceId };
}

export const createPlacementBodyRef = createBodyPlacementRef;
export const createPlacementFaceRef = createFacePlacementRef;
export const createPlacementEdgeRef = createEdgePlacementRef;
export const createPlacementVertexRef = createVertexPlacementRef;
export const createPlacementEdgePointRef = createEdgePointPlacementRef;
export const createPlacementFaceCenterRef = createFaceCenterPlacementRef;

export function getPlacementReferenceFeatureIds(
  refs: PlacementReference[]
): string[] {
  return [...new Set(refs.map((ref) => ref.featureId))].sort();
}

export function resolvePlacementBody(
  context: Pick<RebuildContext, 'bodiesByFeature'>,
  ref: PlacementReferenceBase,
  ownerFeatureId?: string
): PlacementResolution<Body> {
  const body = context.bodiesByFeature
    .get(ref.featureId)
    ?.find((candidate) => candidate.id === ref.bodyId);
  if (body) {
    return { ok: true, value: body };
  }

  return {
    ok: false,
    diagnostic: error(
      'BROKEN_PLACEMENT_BODY_REF',
      `Exact body "${ref.bodyId}" from feature "${ref.featureId}" is unavailable; reselect the body or repair the placement reference.`,
      ownerFeatureId,
      ref.bodyId
    ),
  };
}

export function deriveBodyCoordinateFrame(body: Body): PlacementResolution<CoordinateFrame3D> {
  const positions = [...body.vertices.values()].map((vertex) => vertex.position);
  if (positions.length === 0) {
    return geometryFailure(
      'PLACEMENT_BODY_HAS_NO_VERTICES',
      `Body "${body.id}" has no vertices, so no placement frame can be derived.`,
      body.id
    );
  }

  const center = averagePoints(positions);
  for (const [, face] of [...body.faces].sort(([left], [right]) => left.localeCompare(right))) {
    const plane = body.planes.get(face.planeId);
    if (!plane) continue;
    try {
      return {
        ok: true,
        value: createCoordinateFrameFromZAxis(center, plane.normal, plane.uAxis),
      };
    } catch {
      // Try the next deterministic planar face.
    }
  }

  const edgeResult = firstUsableEdgeFrame(body, center);
  if (edgeResult) {
    return { ok: true, value: edgeResult };
  }

  return geometryFailure(
    'PLACEMENT_BODY_FRAME_UNAVAILABLE',
    `Body "${body.id}" has no usable planar face or edge for a stable placement frame.`,
    body.id
  );
}

export function deriveFaceCoordinateFrame(
  body: Body,
  faceId: string
): PlacementResolution<CoordinateFrame3D> {
  const face = body.faces.get(faceId);
  if (!face) {
    return geometryFailure(
      'BROKEN_PLACEMENT_FACE_REF',
      `Face "${faceId}" no longer exists on body "${body.id}"; reselect the face.`,
      faceId
    );
  }
  const plane = body.planes.get(face.planeId);
  if (!plane) {
    return geometryFailure(
      'BROKEN_PLACEMENT_FACE_PLANE',
      `Face "${faceId}" has no planar support; repair the body before placing it.`,
      faceId
    );
  }

  const positions = getFacePositions(body, face.boundaryEdgeIds);
  if (positions.length < 3) {
    return geometryFailure(
      'PLACEMENT_FACE_BOUNDARY_INVALID',
      `Face "${faceId}" has an incomplete boundary; repair or reselect the face.`,
      faceId
    );
  }

  try {
    return {
      ok: true,
      value: createCoordinateFrameFromZAxis(
        averagePoints(positions),
        plane.normal,
        plane.uAxis
      ),
    };
  } catch {
    return geometryFailure(
      'PLACEMENT_FACE_FRAME_UNAVAILABLE',
      `Face "${faceId}" cannot provide a stable coordinate frame; repair or reselect the face.`,
      faceId
    );
  }
}

export function deriveEdgeCoordinateFrame(
  body: Body,
  edgeId: string,
  parameter = 0.5
): PlacementResolution<CoordinateFrame3D> {
  const edge = body.edges.get(edgeId);
  if (!edge) {
    return geometryFailure(
      'BROKEN_PLACEMENT_EDGE_REF',
      `Edge "${edgeId}" no longer exists on body "${body.id}"; reselect the edge.`,
      edgeId
    );
  }
  if (!Number.isFinite(parameter) || parameter < 0 || parameter > 1) {
    return geometryFailure(
      'INVALID_PLACEMENT_EDGE_PARAMETER',
      `Edge point parameter for "${edgeId}" must be between 0 and 1.`,
      edgeId
    );
  }

  const start = body.vertices.get(edge.vertexIds[0]);
  const end = body.vertices.get(edge.vertexIds[1]);
  if (!start || !end) {
    return geometryFailure(
      'PLACEMENT_EDGE_VERTICES_UNAVAILABLE',
      `Edge "${edgeId}" has a broken endpoint; repair or reselect the edge.`,
      edgeId
    );
  }

  const origin: Vector3Tuple = [
    start.position[0] + (end.position[0] - start.position[0]) * parameter,
    start.position[1] + (end.position[1] - start.position[1]) * parameter,
    start.position[2] + (end.position[2] - start.position[2]) * parameter,
  ];
  const direction: Vector3Tuple = [
    end.position[0] - start.position[0],
    end.position[1] - start.position[1],
    end.position[2] - start.position[2],
  ];
  const zHint = [...edge.faceIds]
    .sort()
    .map((faceId) => body.faces.get(faceId))
    .map((face) => face ? body.planes.get(face.planeId)?.normal : undefined)
    .find((normal): normal is Vector3Tuple => normal !== undefined)
    ?? [0, 0, 1];

  try {
    return {
      ok: true,
      value: createCoordinateFrameFromXAxis(origin, direction, zHint),
    };
  } catch {
    return geometryFailure(
      'PLACEMENT_EDGE_FRAME_UNAVAILABLE',
      `Edge "${edgeId}" is degenerate and cannot define a placement axis; reselect the edge.`,
      edgeId
    );
  }
}

export function resolvePlacementFrame(
  context: Pick<RebuildContext, 'bodiesByFeature'>,
  ref: PlacementFrameRef,
  ownerFeatureId?: string
): PlacementResolution<CoordinateFrame3D> {
  const bodyResult = resolvePlacementBody(context, ref, ownerFeatureId);
  if (!bodyResult.ok) return bodyResult;
  const body = bodyResult.value;

  let result: PlacementResolution<CoordinateFrame3D>;
  switch (ref.kind) {
    case 'body':
      result = deriveBodyCoordinateFrame(body);
      break;
    case 'face':
    case 'faceCenter':
      result = deriveFaceCoordinateFrame(body, ref.faceId);
      break;
    case 'edge':
      result = deriveEdgeCoordinateFrame(body, ref.edgeId);
      break;
    case 'edgePoint':
      result = deriveEdgeCoordinateFrame(body, ref.edgeId, ref.parameter);
      break;
    case 'vertex': {
      const vertex = body.vertices.get(ref.vertexId);
      if (!vertex) {
        result = geometryFailure(
          'BROKEN_PLACEMENT_VERTEX_REF',
          `Vertex "${ref.vertexId}" no longer exists on body "${body.id}"; reselect the vertex.`,
          ref.vertexId
        );
        break;
      }
      const bodyFrame = deriveBodyCoordinateFrame(body);
      result = bodyFrame.ok
        ? {
            ok: true,
            value: { ...bodyFrame.value, origin: [...vertex.position] },
          }
        : bodyFrame;
      break;
    }
  }

  if (!result.ok && ownerFeatureId !== undefined) {
    return {
      ok: false,
      diagnostic: { ...result.diagnostic, featureId: ownerFeatureId },
    };
  }
  return result;
}

export function resolvePlacementPoint(
  context: Pick<RebuildContext, 'bodiesByFeature'>,
  ref: PlacementPointRef,
  ownerFeatureId?: string
): PlacementResolution<Vector3Tuple> {
  const frame = resolvePlacementFrame(context, ref, ownerFeatureId);
  return frame.ok
    ? { ok: true, value: [...frame.value.origin] }
    : frame;
}

function getFacePositions(body: Body, edgeIds: string[]): Vector3Tuple[] {
  const vertexIds = new Set<string>();
  for (const edgeId of edgeIds) {
    const edge = body.edges.get(edgeId);
    if (!edge) continue;
    vertexIds.add(edge.vertexIds[0]);
    vertexIds.add(edge.vertexIds[1]);
  }
  return [...vertexIds]
    .sort()
    .map((vertexId) => body.vertices.get(vertexId)?.position)
    .filter((position): position is Vector3Tuple => position !== undefined);
}

function averagePoints(points: Vector3Tuple[]): Vector3Tuple {
  const sum = points.reduce<Vector3Tuple>(
    (result, point) => [
      result[0] + point[0],
      result[1] + point[1],
      result[2] + point[2],
    ],
    [0, 0, 0]
  );
  return [
    sum[0] / points.length,
    sum[1] / points.length,
    sum[2] / points.length,
  ];
}

function firstUsableEdgeFrame(
  body: Body,
  origin: Vector3Tuple
): CoordinateFrame3D | undefined {
  for (const [edgeId] of [...body.edges].sort(([left], [right]) => left.localeCompare(right))) {
    const result = deriveEdgeCoordinateFrame(body, edgeId);
    if (result.ok) {
      return { ...result.value, origin: [...origin] };
    }
  }
  return undefined;
}

function geometryFailure<T>(
  code: string,
  message: string,
  entityId: string
): PlacementResolution<T> {
  return {
    ok: false,
    diagnostic: error(code, message, undefined, entityId),
  };
}
