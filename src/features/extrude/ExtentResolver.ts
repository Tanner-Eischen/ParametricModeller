import type { Body, FaceRef } from '../../geometry';
import type { ConstructionPlane } from '../../geometry/ConstructionPlane';
import { DEFAULT_TOLERANCE_POLICY } from '../../geometry/TolerancePolicy';

export type ExtrudeExtentDirection = 'OneSided' | 'Symmetric';
export type ExtrudeExtentLimit = 'Distance' | 'UpToFace' | 'ThroughAll';

export interface ExtrudeExtentDefinition {
  direction: ExtrudeExtentDirection;
  limit: ExtrudeExtentLimit;
  distance?: number;
  upToFaceRef?: FaceRef;
}

export interface ResolvedExtrudeExtent {
  definition: ExtrudeExtentDefinition;
  startOffset: number;
  endOffset: number;
  distance: number;
}

export interface ExtentResolutionError {
  code:
    | 'INVALID_EXTENT_DIRECTION'
    | 'INVALID_EXTENT_LIMIT'
    | 'INVALID_DISTANCE'
    | 'MISSING_UP_TO_FACE_REF'
    | 'UP_TO_FACE_BODY_NOT_FOUND'
    | 'UP_TO_FACE_REFERENCE_MISMATCH'
    | 'UP_TO_FACE_NOT_FOUND'
    | 'UP_TO_FACE_PLANE_NOT_FOUND'
    | 'UP_TO_FACE_NOT_PARALLEL'
    | 'UP_TO_FACE_BEHIND_SKETCH'
    | 'THROUGH_ALL_REQUIRES_TARGET'
    | 'THROUGH_ALL_NO_FORWARD_DEPTH'
    | 'THROUGH_ALL_EMPTY_TARGET';
  message: string;
  referenceIds: string[];
}

export type ExtentResolutionResult =
  | { ok: true; extent: ResolvedExtrudeExtent }
  | { ok: false; error: ExtentResolutionError };

export interface ExtentResolutionContext {
  plane: ConstructionPlane;
  axis: [number, number, number];
  bodies: readonly Body[];
  bodiesByFeature: ReadonlyMap<string, readonly Body[]>;
  targetBody?: Body;
}

export function migrateExtrudeExtent(
  extent: Partial<ExtrudeExtentDefinition> | undefined,
  legacy: { distance?: number; mode?: string } = {}
): ExtrudeExtentDefinition {
  return {
    direction: extent?.direction ?? 'OneSided',
    limit: extent?.limit ?? (legacy.mode === 'through' ? 'ThroughAll' : 'Distance'),
    ...(extent?.distance !== undefined || legacy.distance !== undefined
      ? { distance: extent?.distance ?? legacy.distance }
      : {}),
    ...(extent?.upToFaceRef ? { upToFaceRef: { ...extent.upToFaceRef } } : {}),
  };
}

export function resolveExtrudeExtent(
  definition: ExtrudeExtentDefinition,
  context: ExtentResolutionContext
): ExtentResolutionResult {
  if (definition.direction !== 'OneSided' && definition.direction !== 'Symmetric') {
    return failure('INVALID_EXTENT_DIRECTION', 'Extent direction must be OneSided or Symmetric.');
  }
  if (!['Distance', 'UpToFace', 'ThroughAll'].includes(definition.limit)) {
    return failure('INVALID_EXTENT_LIMIT', 'Extent limit must be Distance, UpToFace, or ThroughAll.');
  }

  if (definition.limit === 'Distance') {
    const distance = definition.distance;
    if (!Number.isFinite(distance) || (distance ?? 0) <= 0) {
      return failure('INVALID_DISTANCE', 'Extrusion distance must be finite and greater than zero.');
    }
    return success(definition, definition.direction === 'Symmetric' ? -distance! / 2 : 0,
      definition.direction === 'Symmetric' ? distance! / 2 : distance!);
  }

  if (definition.limit === 'UpToFace') {
    const ref = definition.upToFaceRef;
    if (!ref?.featureId || !ref.bodyId || !ref.faceId) {
      return failure('MISSING_UP_TO_FACE_REF', 'Up To Face requires a complete feature/body/face reference.');
    }
    const body = context.bodies.find((candidate) => candidate.id === ref.bodyId);
    if (!body) {
      return failure('UP_TO_FACE_BODY_NOT_FOUND', `Up To Face body "${ref.bodyId}" was not rebuilt.`, [ref.bodyId]);
    }
    if (!(context.bodiesByFeature.get(ref.featureId) ?? []).some((candidate) => candidate.id === ref.bodyId)) {
      return failure(
        'UP_TO_FACE_REFERENCE_MISMATCH',
        `Face reference body "${ref.bodyId}" is not produced by feature "${ref.featureId}".`,
        [ref.featureId, ref.bodyId]
      );
    }
    const face = body.faces.get(ref.faceId);
    if (!face) {
      return failure('UP_TO_FACE_NOT_FOUND', `Face "${ref.faceId}" no longer exists on body "${ref.bodyId}".`, [ref.faceId]);
    }
    const facePlane = body.planes.get(face.planeId);
    if (!facePlane) {
      return failure('UP_TO_FACE_PLANE_NOT_FOUND', `Face "${ref.faceId}" has no resolvable plane.`, [ref.faceId, face.planeId]);
    }
    if (Math.abs(dot(facePlane.normal, context.axis)) < 1 - DEFAULT_TOLERANCE_POLICY.angular) {
      return failure(
        'UP_TO_FACE_NOT_PARALLEL',
        'Up To Face currently requires a planar face parallel to the sketch plane.',
        [ref.faceId]
      );
    }
    const signedDistance = dot(subtract(facePlane.origin, context.plane.origin), context.axis);
    if (definition.direction === 'OneSided' && signedDistance <= DEFAULT_TOLERANCE_POLICY.linear) {
      return failure(
        'UP_TO_FACE_BEHIND_SKETCH',
        'The selected face is not ahead of the sketch in the extrusion direction. Flip the direction or choose another face.',
        [ref.faceId]
      );
    }
    const halfDistance = Math.abs(signedDistance);
    return definition.direction === 'Symmetric'
      ? success(definition, -halfDistance, halfDistance)
      : success(definition, 0, signedDistance);
  }

  const target = context.targetBody;
  if (!target) {
    return failure('THROUGH_ALL_REQUIRES_TARGET', 'Through All requires a typed target body reference.');
  }
  const projections = [...target.vertices.values()].map((vertex) =>
    dot(subtract(vertex.position, context.plane.origin), context.axis)
  );
  if (projections.length === 0) {
    return failure('THROUGH_ALL_EMPTY_TARGET', `Target body "${target.id}" has no vertices.`, [target.id]);
  }
  const min = Math.min(...projections);
  const max = Math.max(...projections);
  if (definition.direction === 'OneSided') {
    if (max <= DEFAULT_TOLERANCE_POLICY.linear) {
      return failure(
        'THROUGH_ALL_NO_FORWARD_DEPTH',
        'The target body has no material ahead of the sketch. Flip the direction or use a symmetric extent.',
        [target.id]
      );
    }
    return success(definition, 0, max + DEFAULT_TOLERANCE_POLICY.linear);
  }
  if (max - min <= DEFAULT_TOLERANCE_POLICY.linear) {
    return failure('THROUGH_ALL_EMPTY_TARGET', `Target body "${target.id}" has no usable depth.`, [target.id]);
  }
  return success(
    definition,
    min - DEFAULT_TOLERANCE_POLICY.linear,
    max + DEFAULT_TOLERANCE_POLICY.linear
  );
}

function success(
  definition: ExtrudeExtentDefinition,
  startOffset: number,
  endOffset: number
): ExtentResolutionResult {
  return {
    ok: true,
    extent: {
      definition: {
        ...definition,
        ...(definition.upToFaceRef ? { upToFaceRef: { ...definition.upToFaceRef } } : {}),
      },
      startOffset,
      endOffset,
      distance: endOffset - startOffset,
    },
  };
}

function failure(
  code: ExtentResolutionError['code'],
  message: string,
  referenceIds: string[] = []
): ExtentResolutionResult {
  return { ok: false, error: { code, message, referenceIds } };
}

function subtract(
  left: readonly number[],
  right: readonly number[]
): [number, number, number] {
  return [left[0]! - right[0]!, left[1]! - right[1]!, left[2]! - right[2]!];
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}
