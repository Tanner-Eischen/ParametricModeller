import type { Body } from './Body';
import { cloneBody } from './Body';
import { DEFAULT_TOLERANCE_POLICY } from './TolerancePolicy';
import { validateClosedManifoldBody } from './Validation';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('FaceOffset');

/** Compatibility result shape retained for geometry API consumers. */
export interface OffsetFaceResult {
  ok: true;
  body: Body;
  diagnostics: [];
}

function getFaceVertexIds(body: Body, faceId: string): Set<string> {
  const face = body.faces.get(faceId);
  if (!face) return new Set();

  const vertexIds = new Set<string>();
  for (const edgeId of [
    ...face.boundaryEdgeIds,
    ...(face.innerBoundaryEdgeIds?.flat() ?? []),
  ]) {
    const edge = body.edges.get(edgeId);
    if (!edge) continue;
    for (const vertexId of edge.vertexIds) vertexIds.add(vertexId);
  }
  return vertexIds;
}

/**
 * Validate a signed face offset. Positive distances follow the outward face
 * normal; negative distances move into the solid. Inward moves fail closed
 * before the face reaches the nearest body vertex behind its supporting plane.
 */
export function validateOffsetFace(
  body: Body,
  faceId: string,
  distance: number
): { valid: boolean; error: string | null } {
  const face = body.faces.get(faceId);
  if (!face) {
    return { valid: false, error: `Face ${faceId} not found in body ${body.id}` };
  }

  const plane = body.planes.get(face.planeId);
  if (!plane) {
    return { valid: false, error: `Plane ${face.planeId} not found for face ${faceId}` };
  }

  if (!Number.isFinite(distance) || Math.abs(distance) <= DEFAULT_TOLERANCE_POLICY.linear) {
    return { valid: false, error: 'Offset distance must be a finite, non-zero value' };
  }

  const inputValidation = validateClosedManifoldBody(body);
  if (!inputValidation.ok) {
    return { valid: false, error: 'Push/Pull requires a valid closed planar body' };
  }

  const targetVertexIds = getFaceVertexIds(body, faceId);
  if (targetVertexIds.size < 3) {
    return { valid: false, error: `Face ${faceId} does not have a valid boundary` };
  }

  const adjacentFaceIds = new Set<string>();
  for (const edgeId of face.boundaryEdgeIds) {
    const edge = body.edges.get(edgeId);
    if (!edge) return { valid: false, error: `Face ${faceId} has a missing boundary edge` };
    for (const adjacentFaceId of edge.faceIds) {
      if (adjacentFaceId !== faceId) adjacentFaceIds.add(adjacentFaceId);
    }
  }
  for (const adjacentFaceId of adjacentFaceIds) {
    const adjacentFace = body.faces.get(adjacentFaceId);
    const adjacentPlane = adjacentFace ? body.planes.get(adjacentFace.planeId) : null;
    if (!adjacentPlane || Math.abs(
      plane.normal[0] * adjacentPlane.normal[0]
      + plane.normal[1] * adjacentPlane.normal[1]
      + plane.normal[2] * adjacentPlane.normal[2]
    ) > DEFAULT_TOLERANCE_POLICY.angular) {
      return {
        valid: false,
        error: 'Push/Pull currently requires a prismatic end face with perpendicular side faces',
      };
    }
  }

  const oppositeDepths: number[] = [];
  for (const vertex of body.vertices.values()) {
    if (targetVertexIds.has(vertex.id)) continue;
    const signedDistance =
      plane.normal[0] * (vertex.position[0] - plane.origin[0])
      + plane.normal[1] * (vertex.position[1] - plane.origin[1])
      + plane.normal[2] * (vertex.position[2] - plane.origin[2]);
    if (signedDistance >= -DEFAULT_TOLERANCE_POLICY.operationBounds) {
      return {
        valid: false,
        error: 'Push/Pull requires a two-layer prismatic body',
      };
    }
    oppositeDepths.push(-signedDistance);
  }

  const thickness = oppositeDepths[0];
  if (
    thickness === undefined
    || oppositeDepths.some((depth) => Math.abs(depth - thickness) > DEFAULT_TOLERANCE_POLICY.planarity)
  ) {
    return {
      valid: false,
      error: 'Push/Pull requires a two-layer prismatic body',
    };
  }

  if (distance < 0) {
    const remainingThickness = thickness - Math.abs(distance);
    if (remainingThickness <= DEFAULT_TOLERANCE_POLICY.operationBounds) {
      return {
        valid: false,
        error: `Offset of ${distance} would collapse or pass through the body`,
      };
    }
  }

  return { valid: true, error: null };
}

/**
 * Move one planar face along its normal while preserving topology IDs.
 * Adjacent faces inherit the moved shared vertices and are validated for
 * planarity before the result is accepted.
 */
export function offsetFace(body: Body, faceId: string, distance: number): Body | null {
  const validation = validateOffsetFace(body, faceId, distance);
  if (!validation.valid) {
    log.warn('Face offset validation failed', { faceId, distance, error: validation.error });
    return null;
  }

  const newBody = cloneBody(body, body.id);
  const face = newBody.faces.get(faceId);
  if (!face) return null;
  const plane = newBody.planes.get(face.planeId);
  if (!plane) return null;

  const vertexIds = getFaceVertexIds(newBody, faceId);
  for (const vertexId of vertexIds) {
    const vertex = newBody.vertices.get(vertexId);
    if (!vertex) return null;
    newBody.vertices.set(vertexId, {
      ...vertex,
      position: [
        vertex.position[0] + plane.normal[0] * distance,
        vertex.position[1] + plane.normal[1] * distance,
        vertex.position[2] + plane.normal[2] * distance,
      ],
    });
  }

  newBody.planes.set(face.planeId, {
    ...plane,
    origin: [
      plane.origin[0] + plane.normal[0] * distance,
      plane.origin[1] + plane.normal[1] * distance,
      plane.origin[2] + plane.normal[2] * distance,
    ],
  });

  const result = validateClosedManifoldBody(newBody);
  if (!result.ok) {
    log.warn('Face offset produced invalid planar geometry', {
      faceId,
      distance,
      errors: result.errors,
    });
    return null;
  }

  log.info('Face offset complete', { faceId, distance, movedVertexCount: vertexIds.size });
  return newBody;
}
