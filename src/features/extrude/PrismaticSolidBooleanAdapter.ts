import {
  DEFAULT_TOLERANCE_POLICY,
  differencePrismatic,
  executePlanarBoolean,
  getOrderedLoopVertices,
  type Body,
  type PrismaticFrame,
} from '../../geometry';
import type {
  SolidBooleanAdapter,
  SolidBooleanAdapterResult,
  SolidBooleanRequest,
} from './SolidBooleanAdapter';

/**
 * History-tool adapter for the general deterministic planar B-Rep kernel.
 * The public name is retained for one compatibility release.
 */
export const prismaticSolidBooleanAdapter: SolidBooleanAdapter = {
  apply(request) {
    const result = executePlanarBoolean({
      operation: request.operation === 'Add' ? 'union' : 'difference',
      operationId: request.featureId,
      target: request.targetBody,
      tools: [request.toolBody],
    });
    if (!result.ok) {
      if (request.operation === 'Cut') {
        const compatibilityResult = applyCompatibilityDifference(request);
        if (compatibilityResult.ok) return compatibilityResult;
      }
      const diagnostic = result.diagnostics[0];
      return failure(
        diagnostic?.code ?? 'BOOLEAN_FAILED',
        diagnostic?.message ?? 'The planar Boolean operation failed.',
        diagnostic?.entityIds
      );
    }
    const primary = result.bodies.find((body) => body.id === result.primaryBodyId)
      ?? result.bodies[0];
    if (!primary) {
      return failure('DEGENERATE_RESULT', 'The planar Boolean operation produced no retained body.');
    }
    return {
      ok: true,
      body: primary,
      bodies: result.bodies,
      primaryBodyId: result.primaryBodyId,
    };
  },
};

function applyCompatibilityDifference(request: SolidBooleanRequest): SolidBooleanAdapterResult {
  const frame = inferToolFrame(request.toolBody);
  if (!frame) return failure('UNSUPPORTED_ORIENTATION', 'The cut tool has no usable planar cap.');
  const cap = [...request.toolBody.faces.values()].find((face) => face.name === 'Top');
  if (!cap) return failure('INVALID_INPUT', 'The cut tool has no profile cap.');
  const profile = getOrderedLoopVertices(request.toolBody, cap.boundaryEdgeIds)
    .map((vertex): [number, number] => project2(frame, vertex.position));
  if (profile.length < 3) return failure('INVALID_INPUT', 'The cut profile is degenerate.');

  const targetDepths = depths(request.targetBody, frame);
  const toolDepths = depths(request.toolBody, frame);
  const targetMin = Math.min(...targetDepths);
  const targetMax = Math.max(...targetDepths);
  const toolMin = Math.min(...toolDepths);
  const toolMax = Math.max(...toolDepths);
  const overlapMin = Math.max(targetMin, toolMin);
  const overlapMax = Math.min(targetMax, toolMax);
  const overlap = overlapMax - overlapMin;
  if (overlap <= DEFAULT_TOLERANCE_POLICY.linear) {
    return failure('PROFILE_OUTSIDE_TARGET', 'The cut tool does not overlap the target depth.');
  }
  const throughAll = overlap >= targetMax - targetMin - DEFAULT_TOLERANCE_POLICY.linear;
  const touchesMinCap = toolMin <= targetMin + DEFAULT_TOLERANCE_POLICY.linear;
  const touchesMaxCap = toolMax >= targetMax - DEFAULT_TOLERANCE_POLICY.linear;
  if (!throughAll && !touchesMinCap && !touchesMaxCap) {
    return failure('UNSUPPORTED_TOPOLOGY', 'The compatibility path only supports cuts that reach a target cap.');
  }
  const result = differencePrismatic({
    target: request.targetBody,
    frame,
    profile: { outer: profile },
    operationId: request.featureId,
    ...(throughAll ? { throughAll: true } : { depth: overlap }),
    from: touchesMinCap ? 'min' : 'max',
  });
  if (!result.ok) {
    const diagnostic = result.diagnostics[0];
    return failure(
      diagnostic?.code ?? 'BOOLEAN_FAILED',
      diagnostic?.message ?? 'The compatibility Boolean operation failed.',
      diagnostic?.entityIds
    );
  }
  return { ok: true, body: result.body, bodies: [result.body], primaryBodyId: result.body.id };
}

function inferToolFrame(body: Body): PrismaticFrame | null {
  const top = [...body.faces.values()].find((face) => face.name === 'Top');
  const bottom = [...body.faces.values()].find((face) => face.name === 'Bottom');
  if (!top || !bottom) return null;
  const topPlane = body.planes.get(top.planeId);
  const bottomPlane = body.planes.get(bottom.planeId);
  if (!topPlane || !bottomPlane) return null;
  const normal = normalize(topPlane.normal);
  const uAxis = normalize(topPlane.uAxis);
  const vAxis = normalize(cross(normal, uAxis));
  return [...normal, ...uAxis, ...vAxis, ...bottomPlane.origin].every(Number.isFinite)
    ? { origin: [...bottomPlane.origin], uAxis, vAxis, normal }
    : null;
}

function depths(body: Body, frame: PrismaticFrame): number[] {
  return [...body.vertices.values()].map((vertex) =>
    dot(subtract(vertex.position, frame.origin), frame.normal)
  );
}

function project2(frame: PrismaticFrame, point: [number, number, number]): [number, number] {
  const relative = subtract(point, frame.origin);
  return [dot(relative, frame.uAxis), dot(relative, frame.vAxis)];
}

function subtract(
  left: [number, number, number],
  right: [number, number, number]
): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(
  left: [number, number, number],
  right: [number, number, number]
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
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

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function failure(code: string, message: string, referenceIds?: string[]): SolidBooleanAdapterResult {
  return { ok: false, code, message, ...(referenceIds ? { referenceIds } : {}) };
}
