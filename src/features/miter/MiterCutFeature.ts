import { createFeatureRecord, type FeatureRecord } from '../FeatureRecord';
import { error, type Diagnostic } from '../Diagnostics';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import {
  createPlane,
  DEFAULT_TOLERANCE_POLICY,
  getOrderedLoopVertices,
  splitConvexBodyByPlane,
  type BodyRef,
  type Plane,
} from '../../geometry';
import type { FaceRef } from '../offsetFace';

export const MITER_CUT_FEATURE_TYPE = 'miterCut';

export type MiterCutResultMode = 'split' | 'trim';
export type MiterCutTiltAxis = 'u' | 'v';
export type MiterCutStyle = 'single' | 'threeWay';
export type ThreeWayMiterCorner = 'corner0' | 'corner1' | 'corner2' | 'corner3';

export interface MiterCutParams {
  /** Stable body source used by rebuilds and woodworking metadata inheritance. */
  sourceBodyRef: BodyRef;
  /** Explicit planar face that anchors and orients the cutting plane. */
  faceRef: FaceRef;
  /** Signed rotation away from the selected face, in degrees. */
  angleDegrees: number;
  /** Distance from the selected face toward the body interior. */
  inset: number;
  /** Which local direction on the selected face acts as the rotation axis. */
  tiltAxis: MiterCutTiltAxis;
  /** Keep both pieces or discard the outward offcut. */
  resultMode: MiterCutResultMode;
  /** A conventional one-plane miter or an exact two-plane three-way member end. */
  cutStyle: MiterCutStyle;
  /** Stable corner in the selected face's deterministic boundary order. */
  threeWayCorner: ThreeWayMiterCorner;
  /** Stable topology identity for the chosen corner after document placement. */
  threeWayVertexId?: string;
  /** Stable face-corner IDs captured before the miter preview replaces the source face. */
  threeWayVertexIds?: [string, string, string, string];
}

export const defaultMiterCutParams: MiterCutParams = {
  sourceBodyRef: { featureId: '', bodyId: '' },
  faceRef: { featureId: '', bodyId: '', faceId: '' },
  angleDegrees: 45,
  inset: 0,
  tiltAxis: 'u',
  resultMode: 'split',
  cutStyle: 'single',
  threeWayCorner: 'corner0',
};

export function validateMiterCutParams(params: Partial<MiterCutParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const cutStyle = params.cutStyle ?? 'single';
  if (!params.sourceBodyRef?.featureId || !params.sourceBodyRef.bodyId) {
    diagnostics.push(error('MISSING_BODY_REF', 'The miter cut requires an explicit source body.'));
  }
  if (!params.faceRef) {
    diagnostics.push(error('MISSING_FACE_REF', 'Select a planar face for the miter cut.'));
  } else {
    if (!params.faceRef.featureId) diagnostics.push(error('MISSING_FEATURE_ID', 'The selected face has no source feature.'));
    if (!params.faceRef.bodyId) diagnostics.push(error('MISSING_BODY_ID', 'The selected face has no body.'));
    if (!params.faceRef.faceId) diagnostics.push(error('MISSING_FACE_ID', 'The selected face reference is incomplete.'));
  }

  if (cutStyle === 'single' && !Number.isFinite(params.angleDegrees)) {
    diagnostics.push(error('INVALID_ANGLE', 'Miter angle must be a finite number.'));
  } else if (cutStyle === 'single' && (Math.abs(params.angleDegrees ?? 0) < 0.1 || Math.abs(params.angleDegrees ?? 0) >= 89.9)) {
    diagnostics.push(error('INVALID_ANGLE', 'Miter angle must be between -89.9° and 89.9° and cannot be zero.'));
  }

  if (!Number.isFinite(params.inset) || (params.inset ?? 0) < 0) {
    diagnostics.push(error('INVALID_INSET', 'Inset must be a finite distance of zero or more.'));
  }
  if (cutStyle === 'single' && params.tiltAxis !== 'u' && params.tiltAxis !== 'v') {
    diagnostics.push(error('INVALID_TILT_AXIS', 'Tilt axis must be Across U or Across V.'));
  }
  if (params.resultMode !== 'split' && params.resultMode !== 'trim') {
    diagnostics.push(error('INVALID_RESULT_MODE', 'Result must keep both pieces or trim the end.'));
  }
  if (cutStyle !== 'single' && cutStyle !== 'threeWay') {
    diagnostics.push(error('INVALID_CUT_STYLE', 'Cut type must be Single miter or Three-way end.'));
  }
  if (
    cutStyle === 'threeWay'
    && !['corner0', 'corner1', 'corner2', 'corner3'].includes(params.threeWayCorner ?? '')
  ) {
    diagnostics.push(error('INVALID_THREE_WAY_CORNER', 'Choose one of the four end-face corners.'));
  }
  if (params.sourceBodyRef && params.faceRef && (
    params.sourceBodyRef.featureId !== params.faceRef.featureId
    || params.sourceBodyRef.bodyId !== params.faceRef.bodyId
  )) {
    diagnostics.push(error('MISMATCHED_REFERENCE', 'The selected face must belong to the source body.'));
  }
  return diagnostics;
}

export function createMiterCutFeature(
  faceRef: FaceRef,
  options: Partial<Omit<MiterCutParams, 'faceRef'>> = {},
  name = 'Miter Cut'
): FeatureRecord {
  const params: MiterCutParams = {
    ...defaultMiterCutParams,
    ...options,
    sourceBodyRef: { featureId: faceRef.featureId, bodyId: faceRef.bodyId },
    faceRef: { ...faceRef },
  };
  return createFeatureRecord(
    MITER_CUT_FEATURE_TYPE,
    name,
    params as unknown as Record<string, unknown>,
    { refsIn: [faceRef.featureId] }
  );
}

export function rebuildMiterCut(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params: MiterCutParams = {
    ...defaultMiterCutParams,
    ...(feature.parameters as Partial<MiterCutParams>),
  };
  const diagnostics = validateMiterCutParams(params);
  if (diagnostics.length > 0) {
    return { ok: false, error: 'Invalid miter cut parameters', diagnostics };
  }

  const targetBody = context.bodiesByFeature
    .get(params.sourceBodyRef.featureId)
    ?.find((body) => body.id === params.sourceBodyRef.bodyId);
  if (!targetBody) {
    return {
      ok: false,
      error: 'Miter cut target body not found',
      diagnostics: [error(
        'BODY_NOT_FOUND',
        `The selected body ${params.sourceBodyRef.bodyId} is no longer produced by ${params.sourceBodyRef.featureId}.`,
        feature.id
      )],
    };
  }

  const targetFace = targetBody.faces.get(params.faceRef.faceId);
  const targetPlane = targetFace ? targetBody.planes.get(targetFace.planeId) : undefined;
  if (!targetFace || !targetPlane) {
    return {
      ok: false,
      error: 'Miter cut target face not found',
      diagnostics: [error(
        'FACE_NOT_FOUND',
        `The selected face ${params.faceRef.faceId} no longer exists on ${targetBody.name}.`,
        feature.id
      )],
    };
  }

  if (params.cutStyle === 'threeWay') {
    return rebuildThreeWayMiterEnd(feature, targetBody, params);
  }

  const cutPlane = resolveMiterCutPlane(
    targetBody,
    params.faceRef.faceId,
    params.angleDegrees,
    params.inset,
    params.tiltAxis
  );
  if (!cutPlane) {
    return {
      ok: false,
      error: 'Miter cut plane could not be resolved',
      diagnostics: [error(
        'INVALID_FACE',
        'The selected face needs a closed boundary edge aligned with the chosen Face U or Face V direction.',
        feature.id
      )],
    };
  }

  const prefix = `miter:${feature.id}`;
  const result = splitConvexBodyByPlane(targetBody, cutPlane, {
    topologyPrefix: prefix,
    negativeBodyId: targetBody.id,
    positiveBodyId: `${feature.id}_offcut`,
    negativeName: `${targetBody.name} main`,
    positiveName: `${targetBody.name} offcut`,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.message,
      diagnostics: [error(result.code, result.message, feature.id)],
    };
  }

  return {
    ok: true,
    bodies: params.resultMode === 'split'
      ? [result.negative, result.positive]
      : [result.negative],
    diagnostics: [],
    replacedBodyIds: [targetBody.id],
  };
}

function rebuildThreeWayMiterEnd(
  feature: FeatureRecord,
  targetBody: Parameters<typeof splitConvexBodyByPlane>[0],
  params: MiterCutParams
): RebuildHandlerResult {
  if (!params.threeWayVertexId) {
    const message = 'Three-way miter requires a stable corner reference. Re-select the end face and joint corner.';
    return {
      ok: false,
      error: message,
      diagnostics: [error('MISSING_THREE_WAY_CORNER_REF', message, feature.id)],
    };
  }
  const faceError = validateThreeWayMiterEndFace(targetBody, params.faceRef.faceId, params.inset);
  if (faceError) {
    return {
      ok: false,
      error: faceError,
      diagnostics: [error('THREE_WAY_REQUIRES_SQUARE_END', faceError, feature.id)],
    };
  }
  if (params.threeWayVertexId) {
    const face = targetBody.faces.get(params.faceRef.faceId)!;
    const vertices = getOrderedLoopVertices(targetBody, face.boundaryEdgeIds);
    if (!vertices.some((vertex) => vertex.id === params.threeWayVertexId)) {
      const message = 'The saved three-way joint corner no longer exists on the selected end face.';
      return {
        ok: false,
        error: message,
        diagnostics: [error('THREE_WAY_CORNER_LOST', message, feature.id)],
      };
    }
  }
  const planes = resolveThreeWayMiterPlanes(
    targetBody,
    params.faceRef.faceId,
    params.inset,
    params.threeWayVertexId
  );
  if (!planes) {
    const message = 'The selected three-way corner could not be resolved from the end face.';
    return {
      ok: false,
      error: message,
      diagnostics: [error('INVALID_THREE_WAY_CORNER', message, feature.id)],
    };
  }

  const prefix = `miter:${feature.id}:threeWay`;
  const first = splitConvexBodyByPlane(targetBody, planes[0], {
    topologyPrefix: `${prefix}:first`,
    negativeBodyId: targetBody.id,
    positiveBodyId: `${feature.id}_offcut_u`,
    negativeName: `${targetBody.name} three-way main`,
    positiveName: `${targetBody.name} offcut U`,
  });
  if (!first.ok) {
    return {
      ok: false,
      error: first.message,
      diagnostics: [error(first.code, `First three-way cut: ${first.message}`, feature.id)],
    };
  }
  const second = splitConvexBodyByPlane(first.negative, planes[1], {
    topologyPrefix: `${prefix}:second`,
    negativeBodyId: targetBody.id,
    positiveBodyId: `${feature.id}_offcut_v`,
    negativeName: `${targetBody.name} three-way end`,
    positiveName: `${targetBody.name} offcut V`,
  });
  if (!second.ok) {
    return {
      ok: false,
      error: second.message,
      diagnostics: [error(second.code, `Second three-way cut: ${second.message}`, feature.id)],
    };
  }

  return {
    ok: true,
    bodies: params.resultMode === 'split'
      ? [second.negative, first.positive, second.positive]
      : [second.negative],
    diagnostics: [],
    replacedBodyIds: [targetBody.id],
  };
}

export function validateThreeWayMiterEndFace(
  body: Parameters<typeof splitConvexBodyByPlane>[0],
  faceId: string,
  inset = 0
): string | null {
  const face = body.faces.get(faceId);
  if (!face || (face.innerBoundaryEdgeIds?.length ?? 0) > 0) {
    return 'Three-way miter requires one planar end face without holes.';
  }
  const vertices = getOrderedLoopVertices(body, face.boundaryEdgeIds);
  if (vertices.length !== 4) {
    return 'Three-way miter requires a four-sided square end face.';
  }
  const edgeVectors = vertices.map((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]!;
    return subtract3(next.position, vertex.position);
  });
  const lengths = edgeVectors.map((vector) => Math.hypot(...vector));
  const maximumLength = Math.max(...lengths);
  const equalityTolerance = Math.max(
    DEFAULT_TOLERANCE_POLICY.linear * 10,
    maximumLength * 1e-6
  );
  if (
    !Number.isFinite(maximumLength)
    || maximumLength <= DEFAULT_TOLERANCE_POLICY.linear
    || lengths.some((length) => Math.abs(length - maximumLength) > equalityTolerance)
  ) {
    return 'Three-way miter requires square stock: the selected end must have equal width and thickness.';
  }
  for (let index = 0; index < edgeVectors.length; index++) {
    const current = edgeVectors[index]!;
    const next = edgeVectors[(index + 1) % edgeVectors.length]!;
    const cosine = dot3(current, next) / (lengths[index]! * lengths[(index + 1) % lengths.length]!);
    if (Math.abs(cosine) > DEFAULT_TOLERANCE_POLICY.angular * 10) {
      return 'Three-way miter requires a square end with four right-angle corners.';
    }
  }
  const facePlane = body.planes.get(face.planeId);
  if (!facePlane || body.vertices.size !== 8 || body.faces.size !== 6) {
    return 'Three-way miter requires straight, constant-section square stock.';
  }
  const selectedIds = new Set(vertices.map((vertex) => vertex.id));
  const oppositeVertices = [...body.vertices.values()].filter((vertex) => !selectedIds.has(vertex.id));
  if (oppositeVertices.length !== 4) {
    return 'Three-way miter requires straight, constant-section square stock.';
  }
  const inwardDepths = oppositeVertices.map((vertex) => -dot3(
    subtract3(vertex.position, facePlane.origin),
    facePlane.normal
  ));
  const availableDepth = Math.max(...inwardDepths);
  const prismTolerance = Math.max(DEFAULT_TOLERANCE_POLICY.linear * 10, maximumLength * 1e-6);
  if (
    !Number.isFinite(availableDepth)
    || inwardDepths.some((depth) => Math.abs(depth - availableDepth) > prismTolerance)
  ) {
    return 'Three-way miter requires straight, constant-section square stock.';
  }
  const isMatchingOppositeCorner = (position: [number, number, number]): boolean => {
    const expected = position.map((component, index) =>
      component - facePlane.normal[index]! * availableDepth
    ) as [number, number, number];
    return oppositeVertices.some((vertex) =>
      Math.hypot(...subtract3(vertex.position, expected)) <= prismTolerance
    );
  };
  if (!vertices.every((vertex) => isMatchingOppositeCorner(vertex.position))) {
    return 'Three-way miter requires straight, constant-section square stock.';
  }
  if (availableDepth + prismTolerance < inset + maximumLength) {
    return 'The stock is too short for this three-way end: available length must exceed the square width plus inset.';
  }
  return null;
}

export function resolveThreeWayMiterCornerVertexId(
  body: Parameters<typeof splitConvexBodyByPlane>[0],
  faceId: string,
  corner: ThreeWayMiterCorner
): string | null {
  const face = body.faces.get(faceId);
  if (!face) return null;
  const vertices = getOrderedLoopVertices(body, face.boundaryEdgeIds);
  const cornerIndex = Number(corner.slice('corner'.length));
  return Number.isInteger(cornerIndex) && cornerIndex >= 0 && cornerIndex < vertices.length
    ? vertices[cornerIndex]!.id
    : null;
}

/** Resolve both exact 45-degree planes before either cut changes the source topology. */
export function resolveThreeWayMiterPlanes(
  body: Parameters<typeof splitConvexBodyByPlane>[0],
  faceId: string,
  inset: number,
  stableVertexId: string
): [Plane, Plane] | null {
  if (validateThreeWayMiterEndFace(body, faceId, inset)) return null;
  const face = body.faces.get(faceId)!;
  const facePlane = body.planes.get(face.planeId);
  const vertices = getOrderedLoopVertices(body, face.boundaryEdgeIds);
  if (!facePlane) return null;
  const cornerIndex = vertices.findIndex((vertex) => vertex.id === stableVertexId);
  if (!Number.isInteger(cornerIndex) || cornerIndex < 0 || cornerIndex >= vertices.length) return null;
  const selected = vertices[cornerIndex]!;
  const previous = vertices[(cornerIndex - 1 + vertices.length) % vertices.length]!;
  const next = vertices[(cornerIndex + 1) % vertices.length]!;
  const opposite = vertices[(cornerIndex + 2) % vertices.length]!;
  const first = createThreeWayPlane(
    selected.position,
    next.position,
    [previous.position, opposite.position],
    facePlane,
    inset
  );
  const second = createThreeWayPlane(
    selected.position,
    previous.position,
    [next.position, opposite.position],
    facePlane,
    inset
  );
  return first && second ? [first, second] : null;
}

function createThreeWayPlane(
  first: [number, number, number],
  second: [number, number, number],
  offEdgePoints: Array<[number, number, number]>,
  facePlane: Plane,
  inset: number
): Plane | null {
  const edgeVector = subtract3(second, first);
  const edgeLength = Math.hypot(...edgeVector);
  if (edgeLength <= DEFAULT_TOLERANCE_POLICY.linear) return null;
  const axis = edgeVector.map((component) => component / edgeLength) as [number, number, number];
  const hinge: [number, number, number] = [
    (first[0] + second[0]) / 2,
    (first[1] + second[1]) / 2,
    (first[2] + second[2]) / 2,
  ];
  let normal = rotateAroundAxis(facePlane.normal, axis, Math.PI / 4);
  const sideWitness = offEdgePoints.reduce<[number, number, number]>(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
    [0, 0, 0]
  ).map((component) => component / offEdgePoints.length) as [number, number, number];
  if (dot3(subtract3(sideWitness, hinge), normal) < 0) {
    normal = rotateAroundAxis(facePlane.normal, axis, -Math.PI / 4);
  }
  const origin = hinge.map((component, index) =>
    component - facePlane.normal[index]! * inset
  ) as [number, number, number];
  return createPlane(origin, normal);
}

export function resolveMiterCutPlane(
  body: Parameters<typeof splitConvexBodyByPlane>[0],
  faceId: string,
  angleDegrees: number,
  inset: number,
  tiltAxis: MiterCutTiltAxis
): Plane | null {
  const face = body.faces.get(faceId);
  const facePlane = face ? body.planes.get(face.planeId) : undefined;
  if (!face || !facePlane) return null;
  const vertices = getOrderedLoopVertices(body, face.boundaryEdgeIds);
  if (vertices.length < 3) return null;

  const axis = tiltAxis === 'u' ? facePlane.uAxis : facePlane.vAxis;
  const angleRadians = angleDegrees * Math.PI / 180;
  const tangentDirection = cross3(axis, facePlane.normal).map(
    (component) => component * Math.sign(angleRadians)
  ) as [number, number, number];
  const hingeMidpoint = resolveHingeMidpoint(body, face.boundaryEdgeIds, axis, tangentDirection);
  if (!hingeMidpoint) return null;
  const origin = hingeMidpoint.map((component, index) =>
    component - facePlane.normal[index]! * inset
  ) as [number, number, number];
  const normal = rotateAroundAxis(facePlane.normal, axis, angleRadians);
  return createPlane(origin, normal);
}

function resolveHingeMidpoint(
  body: Parameters<typeof splitConvexBodyByPlane>[0],
  edgeIds: string[],
  axis: [number, number, number],
  tangentDirection: [number, number, number]
): [number, number, number] | null {
  const candidates = edgeIds.flatMap((edgeId) => {
    const edge = body.edges.get(edgeId);
    const first = edge ? body.vertices.get(edge.vertexIds[0]) : undefined;
    const second = edge ? body.vertices.get(edge.vertexIds[1]) : undefined;
    if (!edge || !first || !second) return [];
    const direction: [number, number, number] = [
      second.position[0] - first.position[0],
      second.position[1] - first.position[1],
      second.position[2] - first.position[2],
    ];
    const length = Math.hypot(...direction);
    if (length === 0) return [];
    const alignment = Math.abs(
      direction[0] * axis[0] + direction[1] * axis[1] + direction[2] * axis[2]
    ) / length;
    const midpoint: [number, number, number] = [
      (first.position[0] + second.position[0]) / 2,
      (first.position[1] + second.position[1]) / 2,
      (first.position[2] + second.position[2]) / 2,
    ];
    const tangentPosition = midpoint[0] * tangentDirection[0]
      + midpoint[1] * tangentDirection[1]
      + midpoint[2] * tangentDirection[2];
    return [{ edgeId, midpoint, alignment, tangentPosition }];
  });
  candidates.sort((left, right) =>
    right.alignment - left.alignment
    || left.tangentPosition - right.tangentPosition
    || left.edgeId.localeCompare(right.edgeId)
  );
  const best = candidates[0];
  if (!best || best.alignment < 1 - 1e-6) return null;
  return best.midpoint;
}

function cross3(
  first: [number, number, number],
  second: [number, number, number]
): [number, number, number] {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function subtract3(
  first: [number, number, number],
  second: [number, number, number]
): [number, number, number] {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function dot3(
  first: [number, number, number],
  second: [number, number, number]
): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function rotateAroundAxis(
  vector: [number, number, number],
  axis: [number, number, number],
  radians: number
): [number, number, number] {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dot = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2];
  const cross: [number, number, number] = [
    axis[1] * vector[2] - axis[2] * vector[1],
    axis[2] * vector[0] - axis[0] * vector[2],
    axis[0] * vector[1] - axis[1] * vector[0],
  ];
  return [
    vector[0] * cosine + cross[0] * sine + axis[0] * dot * (1 - cosine),
    vector[1] * cosine + cross[1] * sine + axis[1] * dot * (1 - cosine),
    vector[2] * cosine + cross[2] * sine + axis[2] * dot * (1 - cosine),
  ];
}
