import {
  addEdge,
  addFace,
  addPlane,
  addVertex,
  createBody,
  type Body,
} from './Body';
import { createPlane, type Plane } from './Plane';
import { getOrderedLoopVertices, triangulateBody } from './Triangulator';
import { DEFAULT_TOLERANCE_POLICY } from './TolerancePolicy';
import { validateClosedManifoldBody } from './Validation';

type Vector3 = [number, number, number];

export type PlanarBodySplitDiagnosticCode =
  | 'INVALID_CUT_PLANE'
  | 'UNSUPPORTED_OPEN_BODY'
  | 'UNSUPPORTED_HOLED_FACE'
  | 'UNSUPPORTED_NON_CONVEX_BODY'
  | 'CUT_TOUCHES_VERTEX'
  | 'CUT_DOES_NOT_SPLIT_BODY'
  | 'INVALID_SPLIT_RESULT';

export interface PlanarBodySplitFailure {
  ok: false;
  code: PlanarBodySplitDiagnosticCode;
  message: string;
}

export interface PlanarBodySplitSuccess {
  ok: true;
  /** Portion on the negative side of the cutting-plane normal. */
  negative: Body;
  /** Portion on the positive side of the cutting-plane normal. */
  positive: Body;
}

export type PlanarBodySplitResult = PlanarBodySplitFailure | PlanarBodySplitSuccess;

export interface PlanarBodySplitOptions {
  topologyPrefix: string;
  negativeBodyId: string;
  positiveBodyId: string;
  negativeName?: string;
  positiveName?: string;
}

interface SplitPoint {
  id: string;
  position: Vector3;
  sourceEdgeIds: Set<string>;
  isCut: boolean;
}

interface FacePolygon {
  id: string;
  name: string;
  plane: Plane;
  points: SplitPoint[];
  sourceFaceId: string;
}

/**
 * Split a closed convex planar B-Rep with an infinite plane. The first
 * implementation intentionally fails closed for concave, holed, tangent, and
 * degenerate cases so it cannot emit ambiguous or non-manifold topology.
 */
export function splitConvexBodyByPlane(
  body: Body,
  cutPlane: Plane,
  options: PlanarBodySplitOptions
): PlanarBodySplitResult {
  const normalizedPlane = normalizePlane(cutPlane);
  if (!normalizedPlane) {
    return failure('INVALID_CUT_PLANE', 'The miter plane must have a finite, non-zero normal.');
  }

  const inputValidation = validateClosedManifoldBody(body);
  if (!inputValidation.ok) {
    return failure('UNSUPPORTED_OPEN_BODY', 'Miter cut requires a valid closed planar body.');
  }

  for (const face of body.faces.values()) {
    if ((face.innerBoundaryEdgeIds?.length ?? 0) > 0) {
      return failure(
        'UNSUPPORTED_HOLED_FACE',
        'Miter cut does not yet support bodies with holes or internal face loops.'
      );
    }
  }

  if (!isConvexPlanarBody(body)) {
    return failure(
      'UNSUPPORTED_NON_CONVEX_BODY',
      'Miter cut currently supports convex planar bodies such as boards, boxes, and simple prisms.'
    );
  }

  const signedDistances = new Map<string, number>();
  let hasNegative = false;
  let hasPositive = false;
  for (const vertex of body.vertices.values()) {
    const distance = signedDistance(normalizedPlane, vertex.position);
    signedDistances.set(vertex.id, distance);
    if (distance < -DEFAULT_TOLERANCE_POLICY.linear) hasNegative = true;
    if (distance > DEFAULT_TOLERANCE_POLICY.linear) hasPositive = true;
  }
  if (!hasNegative || !hasPositive) {
    return failure(
      'CUT_DOES_NOT_SPLIT_BODY',
      'The miter plane does not pass through the selected body. Adjust the angle or inset.'
    );
  }

  const originalPoints = new Map(
    [...body.vertices.values()].map((vertex) => [vertex.id, {
      id: vertex.id,
      position: [...vertex.position] as Vector3,
      sourceEdgeIds: new Set(vertex.edgeIds),
      isCut: Math.abs(signedDistances.get(vertex.id) ?? Infinity) <= DEFAULT_TOLERANCE_POLICY.linear,
    } satisfies SplitPoint])
  );
  const edgeByVertexPair = new Map<string, string>();
  const cutPointsByEdge = new Map<string, SplitPoint>();
  const sectionPoints = new Map<string, SplitPoint>();
  const reservedVertexIds = new Set(body.vertices.keys());
  for (const point of originalPoints.values()) {
    if (point.isCut) sectionPoints.set(point.id, point);
  }
  for (const edge of body.edges.values()) {
    const [firstId, secondId] = edge.vertexIds;
    edgeByVertexPair.set(pairKey(firstId, secondId), edge.id);
    const first = body.vertices.get(firstId);
    const second = body.vertices.get(secondId);
    const firstDistance = signedDistances.get(firstId);
    const secondDistance = signedDistances.get(secondId);
    if (!first || !second || firstDistance === undefined || secondDistance === undefined) continue;
    if (!(
      firstDistance < -DEFAULT_TOLERANCE_POLICY.linear && secondDistance > DEFAULT_TOLERANCE_POLICY.linear
      || firstDistance > DEFAULT_TOLERANCE_POLICY.linear && secondDistance < -DEFAULT_TOLERANCE_POLICY.linear
    )) continue;
    const parameter = firstDistance / (firstDistance - secondDistance);
    const cutPoint: SplitPoint = {
      id: allocateUniqueId(
        `${options.topologyPrefix}:cutVertex:${encodeId(edge.id)}`,
        reservedVertexIds
      ),
      position: interpolate(first.position, second.position, parameter),
      sourceEdgeIds: new Set([edge.id]),
      isCut: true,
    };
    cutPointsByEdge.set(edge.id, cutPoint);
    sectionPoints.set(cutPoint.id, cutPoint);
  }
  if (sectionPoints.size < 3) {
    return failure(
      'CUT_DOES_NOT_SPLIT_BODY',
      'The miter plane does not create a valid closed section through the body.'
    );
  }

  const negativeFaces: FacePolygon[] = [];
  const positiveFaces: FacePolygon[] = [];
  for (const face of body.faces.values()) {
    const sourcePlane = body.planes.get(face.planeId);
    const orderedVertices = getOrderedLoopVertices(body, face.boundaryEdgeIds);
    if (!sourcePlane || orderedVertices.length < 3) {
      return failure('UNSUPPORTED_OPEN_BODY', `Face ${face.id} does not have a valid planar boundary.`);
    }
    const polygon = orderedVertices.map((vertex) => originalPoints.get(vertex.id)!).filter(Boolean);
    const negative = clipPolygon(
      polygon,
      true,
      signedDistances,
      edgeByVertexPair,
      cutPointsByEdge
    );
    const positive = clipPolygon(
      polygon,
      false,
      signedDistances,
      edgeByVertexPair,
      cutPointsByEdge
    );
    if (negative.length >= 3) {
      negativeFaces.push({
        id: face.id,
        name: face.name ?? face.id,
        plane: clonePlane(sourcePlane),
        points: negative,
        sourceFaceId: face.id,
      });
    }
    if (positive.length >= 3) {
      positiveFaces.push({
        id: face.id,
        name: face.name ?? face.id,
        plane: clonePlane(sourcePlane),
        points: positive,
        sourceFaceId: face.id,
      });
    }
  }

  const capPoints = sortPointsOnPlane([...sectionPoints.values()], normalizedPlane);
  const capFaceId = allocateUniqueId(
    `${options.topologyPrefix}:cutFace`,
    new Set(body.faces.keys())
  );
  negativeFaces.push({
    id: capFaceId,
    name: 'Miter cut',
    plane: clonePlane(normalizedPlane),
    points: capPoints,
    sourceFaceId: capFaceId,
  });
  positiveFaces.push({
    id: capFaceId,
    name: 'Miter cut',
    plane: createPlane(
      [...normalizedPlane.origin] as Vector3,
      negate(normalizedPlane.normal)
    ),
    points: [...capPoints].reverse(),
    sourceFaceId: capFaceId,
  });

  const negative = buildBodyFromPolygons(
    negativeFaces,
    options.negativeBodyId,
    options.negativeName ?? `${body.name} A`,
    options.topologyPrefix
  );
  const positive = buildBodyFromPolygons(
    positiveFaces,
    options.positiveBodyId,
    options.positiveName ?? `${body.name} B`,
    options.topologyPrefix
  );
  const negativeValidation = validateClosedManifoldBody(negative);
  const positiveValidation = validateClosedManifoldBody(positive);
  if (!negativeValidation.ok || !positiveValidation.ok) {
    return failure(
      'INVALID_SPLIT_RESULT',
      'The miter cut could not produce two valid closed solids. Adjust the cut parameters.'
    );
  }
  const sourceVolume = computeBodyVolume(body);
  const negativeVolume = computeBodyVolume(negative);
  const positiveVolume = computeBodyVolume(positive);
  const minimumVolume = Math.max(
    DEFAULT_TOLERANCE_POLICY.linear ** 3,
    sourceVolume * 1e-10
  );
  const conservationTolerance = Math.max(minimumVolume, sourceVolume * 1e-8);
  if (
    sourceVolume <= minimumVolume
    || negativeVolume <= minimumVolume
    || positiveVolume <= minimumVolume
    || Math.abs(negativeVolume + positiveVolume - sourceVolume) > conservationTolerance
  ) {
    return failure(
      'INVALID_SPLIT_RESULT',
      'The miter cut would create a negligible or non-conservative solid. Adjust the angle or inset.'
    );
  }

  return { ok: true, negative, positive };
}

function computeBodyVolume(body: Body): number {
  const mesh = triangulateBody(body);
  let signedVolume = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const first = mesh.indices[index]! * 3;
    const second = mesh.indices[index + 1]! * 3;
    const third = mesh.indices[index + 2]! * 3;
    const ax = mesh.positions[first]!;
    const ay = mesh.positions[first + 1]!;
    const az = mesh.positions[first + 2]!;
    const bx = mesh.positions[second]!;
    const by = mesh.positions[second + 1]!;
    const bz = mesh.positions[second + 2]!;
    const cx = mesh.positions[third]!;
    const cy = mesh.positions[third + 1]!;
    const cz = mesh.positions[third + 2]!;
    signedVolume += (
      ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx)
    ) / 6;
  }
  return Math.abs(signedVolume);
}

function clipPolygon(
  polygon: SplitPoint[],
  keepNegative: boolean,
  distances: Map<string, number>,
  edgeByVertexPair: Map<string, string>,
  cutPointsByEdge: Map<string, SplitPoint>
): SplitPoint[] {
  const result: SplitPoint[] = [];
  let previous = polygon[polygon.length - 1]!;
  const initialDistance = distances.get(previous.id)!;
  let previousInside = keepNegative
    ? initialDistance <= DEFAULT_TOLERANCE_POLICY.linear
    : initialDistance >= -DEFAULT_TOLERANCE_POLICY.linear;

  for (const current of polygon) {
    const currentDistance = distances.get(current.id)!;
    const currentInside = keepNegative
      ? currentDistance <= DEFAULT_TOLERANCE_POLICY.linear
      : currentDistance >= -DEFAULT_TOLERANCE_POLICY.linear;
    if (currentInside !== previousInside) {
      const sourceEdgeId = edgeByVertexPair.get(pairKey(previous.id, current.id));
      const intersection = sourceEdgeId ? cutPointsByEdge.get(sourceEdgeId) : undefined;
      if (intersection) result.push(intersection);
    }
    if (currentInside) result.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return deduplicateLoop(result);
}

function buildBodyFromPolygons(
  faces: FacePolygon[],
  bodyId: string,
  name: string,
  topologyPrefix: string
): Body {
  const body = createBody(bodyId, name);
  const points = new Map<string, SplitPoint>();
  for (const face of faces) {
    for (const point of face.points) points.set(point.id, point);
  }
  for (const point of points.values()) {
    addVertex(body, { id: point.id, position: [...point.position], edgeIds: [] });
  }

  const edgeIdsByPair = new Map<string, string>();
  const usedEdgeIds = new Set<string>();
  const reservedSourceEdgeIds = new Set(
    faces.flatMap((face) => face.points.flatMap((point) => [...point.sourceEdgeIds]))
  );
  const faceEdgeIds = new Map<string, string[]>();
  for (const face of faces) {
    const edgeIds: string[] = [];
    for (let index = 0; index < face.points.length; index++) {
      const first = face.points[index]!;
      const second = face.points[(index + 1) % face.points.length]!;
      const key = pairKey(first.id, second.id);
      let edgeId = edgeIdsByPair.get(key);
      if (!edgeId) {
        const sharedSourceEdge = [...first.sourceEdgeIds]
          .filter((candidate) => second.sourceEdgeIds.has(candidate))
          .sort()[0];
        edgeId = sharedSourceEdge ?? allocateUniqueId(
          `${topologyPrefix}:cutEdge:${encodeId(face.sourceFaceId)}`,
          new Set([...usedEdgeIds, ...reservedSourceEdgeIds])
        );
        if (usedEdgeIds.has(edgeId)) {
          edgeId = allocateUniqueId(
            `${topologyPrefix}:edge:${encodeId(first.id)}:${encodeId(second.id)}`,
            new Set([...usedEdgeIds, ...reservedSourceEdgeIds])
          );
        }
        edgeIdsByPair.set(key, edgeId);
        usedEdgeIds.add(edgeId);
        addEdge(body, { id: edgeId, vertexIds: [first.id, second.id], faceIds: [] });
      }
      edgeIds.push(edgeId);
    }
    faceEdgeIds.set(face.id, edgeIds);
  }

  for (const face of faces) {
    addPlane(body, clonePlane(face.plane), face.id);
    addFace(body, {
      id: face.id,
      planeId: face.id,
      boundaryEdgeIds: faceEdgeIds.get(face.id) ?? [],
      name: face.name,
    });
  }
  return body;
}

function isConvexPlanarBody(body: Body): boolean {
  const tolerance = DEFAULT_TOLERANCE_POLICY.operationBounds;
  for (const face of body.faces.values()) {
    const plane = body.planes.get(face.planeId);
    const vertices = getOrderedLoopVertices(body, face.boundaryEdgeIds);
    if (!plane || vertices.length < 3 || !isConvexFace(vertices.map((vertex) => vertex.position), plane.normal)) {
      return false;
    }
    for (const vertex of body.vertices.values()) {
      if (signedDistance(plane, vertex.position) > tolerance) return false;
    }
  }
  return true;
}

function isConvexFace(points: Vector3[], normal: Vector3): boolean {
  let orientation = 0;
  for (let index = 0; index < points.length; index++) {
    const previous = points[index]!;
    const current = points[(index + 1) % points.length]!;
    const next = points[(index + 2) % points.length]!;
    const turn = dot(cross(subtract(current, previous), subtract(next, current)), normal);
    if (Math.abs(turn) <= DEFAULT_TOLERANCE_POLICY.angular) continue;
    const sign = Math.sign(turn);
    if (orientation !== 0 && sign !== orientation) return false;
    orientation = sign;
  }
  return orientation !== 0;
}

function sortPointsOnPlane(points: SplitPoint[], plane: Plane): SplitPoint[] {
  const center = points.reduce<Vector3>(
    (sum, point) => add(sum, point.position),
    [0, 0, 0]
  ).map((value) => value / points.length) as Vector3;
  return [...points].sort((left, right) => {
    const leftRelative = subtract(left.position, center);
    const rightRelative = subtract(right.position, center);
    const leftAngle = Math.atan2(dot(leftRelative, plane.vAxis), dot(leftRelative, plane.uAxis));
    const rightAngle = Math.atan2(dot(rightRelative, plane.vAxis), dot(rightRelative, plane.uAxis));
    return leftAngle - rightAngle || left.id.localeCompare(right.id);
  });
}

function normalizePlane(plane: Plane): Plane | null {
  if (![...plane.origin, ...plane.normal].every(Number.isFinite)) return null;
  const magnitude = Math.hypot(...plane.normal);
  if (magnitude <= DEFAULT_TOLERANCE_POLICY.linear) return null;
  return createPlane(
    [...plane.origin] as Vector3,
    plane.normal.map((component) => component / magnitude) as Vector3
  );
}

function deduplicateLoop(points: SplitPoint[]): SplitPoint[] {
  const result: SplitPoint[] = [];
  for (const point of points) {
    if (result[result.length - 1]?.id !== point.id) result.push(point);
  }
  if (result.length > 1 && result[0]?.id === result[result.length - 1]?.id) result.pop();
  return result;
}

function failure(code: PlanarBodySplitDiagnosticCode, message: string): PlanarBodySplitFailure {
  return { ok: false, code, message };
}

function pairKey(first: string, second: string): string {
  return [first, second].sort().join('\u0000');
}

function encodeId(id: string): string {
  let encoded = `${id.length}_`;
  for (let index = 0; index < id.length; index++) {
    encoded += id.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return encoded;
}

function allocateUniqueId(base: string, reserved: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (reserved.has(candidate)) {
    candidate = `${base}:${suffix}`;
    suffix += 1;
  }
  reserved.add(candidate);
  return candidate;
}

function clonePlane(plane: Plane): Plane {
  return {
    origin: [...plane.origin],
    normal: [...plane.normal],
    uAxis: [...plane.uAxis],
    vAxis: [...plane.vAxis],
  };
}

function signedDistance(plane: Plane, point: Vector3): number {
  return dot(subtract(point, plane.origin), plane.normal);
}

function interpolate(first: Vector3, second: Vector3, parameter: number): Vector3 {
  return [
    first[0] + (second[0] - first[0]) * parameter,
    first[1] + (second[1] - first[1]) * parameter,
    first[2] + (second[2] - first[2]) * parameter,
  ];
}

function add(first: Vector3, second: Vector3): Vector3 {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function subtract(first: Vector3, second: Vector3): Vector3 {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function negate(vector: Vector3): Vector3 {
  return [-vector[0], -vector[1], -vector[2]];
}

function dot(first: Vector3, second: Vector3): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross(first: Vector3, second: Vector3): Vector3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}
