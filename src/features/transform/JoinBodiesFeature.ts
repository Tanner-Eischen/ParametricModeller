import { createFeatureRecord, type FeatureRecord } from '../FeatureRecord';
import { error, type Diagnostic } from '../Diagnostics';
import { getAllBodies, type RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { combineBodies, getBodyBoundingBox, validateBody, type Body } from '../../geometry';
import type { BodyRef } from '../../geometry/SubObjectTypes';
import { createModuleLogger } from '../../core/logger';

const log = createModuleLogger('JoinBodiesFeature');

export const JOIN_BODIES_FEATURE_TYPE = 'joinBodies';

export interface JoinBodiesParams {
  bodyRefs: BodyRef[];
}

export const defaultJoinBodiesParams: JoinBodiesParams = {
  bodyRefs: [],
};

export function validateJoinBodiesParams(params: Partial<JoinBodiesParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!params.bodyRefs || params.bodyRefs.length < 2) {
    diagnostics.push(error('INSUFFICIENT_BODIES', 'Compound Bodies requires at least two selected bodies'));
    return diagnostics;
  }

  const seenBodyIds = new Set<string>();
  for (const ref of params.bodyRefs) {
    if (!ref.featureId) {
      diagnostics.push(error('MISSING_FEATURE_ID', 'Feature ID is required in each body reference'));
    }
    if (!ref.bodyId) {
      diagnostics.push(error('MISSING_BODY_ID', 'Body ID is required in each body reference'));
      continue;
    }
    if (seenBodyIds.has(ref.bodyId)) {
      diagnostics.push(error('DUPLICATE_BODY', `Body ${ref.bodyId} is listed more than once`));
    }
    seenBodyIds.add(ref.bodyId);
  }

  return diagnostics;
}

export function createJoinBodiesFeature(
  bodyRefs: BodyRef[],
  name = 'Compound Bodies'
): FeatureRecord {
  return createFeatureRecord(
    JOIN_BODIES_FEATURE_TYPE,
    name,
    {
      bodyRefs,
    } satisfies JoinBodiesParams as unknown as Record<string, unknown>,
    {
      refsIn: bodyRefs.map((ref) => ref.featureId),
    }
  );
}

export function rebuildJoinBodies(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params: JoinBodiesParams = {
    ...defaultJoinBodiesParams,
    ...(feature.parameters as Partial<JoinBodiesParams>),
  };

  const diagnostics = validateJoinBodiesParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid join bodies parameters',
      diagnostics,
    };
  }

  const allBodies = getAllBodies(context);
  const sourceBodies = params.bodyRefs
    .map((ref) => allBodies.find((body) => body.id === ref.bodyId) ?? null);
  const missingIndex = sourceBodies.findIndex((body) => body === null);
  if (missingIndex !== -1) {
    const bodyId = params.bodyRefs[missingIndex]?.bodyId ?? 'unknown';
    return {
      ok: false,
      error: `Body ${bodyId} not found`,
      diagnostics: [error('BODY_NOT_FOUND', `Body ${bodyId} not found`)],
    };
  }

  const resolvedBodies = sourceBodies.filter((body): body is NonNullable<typeof body> => body !== null);
  const overlappingBodyIds = findVolumetricOverlap(resolvedBodies);
  if (overlappingBodyIds) {
    return {
      ok: false,
      error: `Bodies ${overlappingBodyIds[0]} and ${overlappingBodyIds[1]} overlap volumetrically`,
      diagnostics: [
        error(
          'OVERLAPPING_BODIES',
          `Compound Bodies keeps separated or face-to-face touching solids together without fusing overlaps (${overlappingBodyIds[0]} vs ${overlappingBodyIds[1]}). Use Union for overlapping bodies.`
        ),
      ],
    };
  }

  const primaryBody = resolvedBodies[0]!;
  const joinedBody = combineBodies(resolvedBodies, primaryBody.id, `${primaryBody.name} Compound`);
  const validation = validateBody(joinedBody);
  if (!validation.ok) {
    return {
      ok: false,
    error: 'Compound Bodies produced invalid body',
      diagnostics: validation.errors.map((item) => error('INVALID_BODY', item.message)),
    };
  }

  log.info('Compound bodies complete', {
    featureId: feature.id,
    bodyCount: resolvedBodies.length,
    targetBodyId: primaryBody.id,
  });

  return {
    ok: true,
    bodies: [joinedBody],
    diagnostics: [],
    replacedBodyIds: params.bodyRefs.map((ref) => ref.bodyId),
  };
}

function findVolumetricOverlap(
  bodies: Body[]
): [string, string] | null {
  const tolerance = 1e-6;

  for (let i = 0; i < bodies.length; i++) {
    const left = bodies[i]!;
    const leftBounds = getBodyBoundingBox(left);
    for (let j = i + 1; j < bodies.length; j++) {
      const right = bodies[j]!;
      const rightBounds = getBodyBoundingBox(right);

      const overlapX = Math.min(leftBounds.max[0], rightBounds.max[0]) - Math.max(leftBounds.min[0], rightBounds.min[0]);
      const overlapY = Math.min(leftBounds.max[1], rightBounds.max[1]) - Math.max(leftBounds.min[1], rightBounds.min[1]);
      const overlapZ = Math.min(leftBounds.max[2], rightBounds.max[2]) - Math.max(leftBounds.min[2], rightBounds.min[2]);

      if (overlapX > tolerance && overlapY > tolerance && overlapZ > tolerance) {
        return [left.id, right.id];
      }
    }
  }

  return null;
}
