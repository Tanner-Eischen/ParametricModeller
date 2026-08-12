import { generateId } from '../../core/id';
import {
  transformVertexPositions,
  validateBody,
} from '../../geometry';
import type { BodyRef } from '../../geometry/SubObjectTypes';
import type { Diagnostic } from '../Diagnostics';
import { error } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import type { Placement } from './PlacementSolver';
import {
  getPlacementReferences,
  solvePlacementMatrix,
  validatePlacementDefinition,
} from './PlacementSolver';
import { getPlacementReferenceFeatureIds } from './PlacementReferences';

export const TRANSFORM_BODIES_FEATURE_TYPE = 'transformBodies';

export type TransformBodiesMode = 'move' | 'copy';

export interface TransformBodiesParams {
  bodyRefs: BodyRef[];
  mode: TransformBodiesMode;
  placement: Placement;
}

export function validateTransformBodiesParams(
  params: Partial<TransformBodiesParams>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!params.bodyRefs || params.bodyRefs.length === 0) {
    diagnostics.push(error(
      'MISSING_TRANSFORM_BODIES',
      'Transform Bodies requires at least one exact body reference.'
    ));
  } else {
    const seen = new Set<string>();
    params.bodyRefs.forEach((ref, index) => {
      if (!ref.featureId || !ref.bodyId) {
        diagnostics.push(error(
          'INVALID_TRANSFORM_BODY_REF',
          `Transform body reference ${index + 1} must contain featureId and bodyId.`
        ));
        return;
      }
      const key = `${ref.featureId}\u0000${ref.bodyId}`;
      if (seen.has(key)) {
        diagnostics.push(error(
          'DUPLICATE_TRANSFORM_BODY_REF',
          `Body "${ref.bodyId}" from feature "${ref.featureId}" is selected more than once.`
        ));
      }
      seen.add(key);
    });
  }

  if (params.mode !== 'move' && params.mode !== 'copy') {
    diagnostics.push(error(
      'INVALID_TRANSFORM_MODE',
      'Transform Bodies mode must be move or copy.'
    ));
  }
  diagnostics.push(...validatePlacementDefinition(params.placement));
  return diagnostics;
}

export function createTransformBodiesFeature(
  bodyRefs: BodyRef[],
  placement: Placement,
  mode: TransformBodiesMode = 'move',
  name = mode === 'copy' ? 'Copy Bodies' : 'Move Bodies',
  id = generateId()
): FeatureRecord {
  const params: TransformBodiesParams = {
    bodyRefs: bodyRefs.map((ref) => ({ ...ref })),
    mode,
    placement: clonePlacement(placement),
  };
  return {
    id,
    type: TRANSFORM_BODIES_FEATURE_TYPE,
    name,
    parameters: params as unknown as Record<string, unknown>,
    refsIn: collectTransformBodiesDependencyIds(params),
    refsOut: [],
    suppressed: false,
  };
}

export function rebuildTransformBodies(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params = normalizeTransformBodiesParams(
    feature.parameters as Partial<TransformBodiesParams>
  );
  const validationDiagnostics = validateTransformBodiesParams(params);
  if (validationDiagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid Transform Bodies parameters',
      diagnostics: validationDiagnostics.map((diagnostic) => ({
        ...diagnostic,
        featureId: feature.id,
      })),
    };
  }

  const sources = [];
  for (const ref of params.bodyRefs) {
    const source = context.bodiesByFeature
      .get(ref.featureId)
      ?.find((body) => body.id === ref.bodyId);
    if (!source) {
      const message = `Exact source body "${ref.bodyId}" from feature "${ref.featureId}" is unavailable; reselect the body or repair the Transform Bodies reference.`;
      return {
        ok: false,
        error: message,
        diagnostics: [
          error('BROKEN_TRANSFORM_BODY_REF', message, feature.id, ref.bodyId),
        ],
      };
    }
    sources.push(source);
  }

  // Solve once and apply the same rigid transform to every selected body.
  const placementResult = solvePlacementMatrix(params.placement, context, feature.id);
  if (!placementResult.ok) {
    return {
      ok: false,
      error: placementResult.diagnostics[0]?.message ?? 'Placement could not be resolved',
      diagnostics: placementResult.diagnostics,
    };
  }

  const bodies = sources.map((source) => {
    const resultId = params.mode === 'move'
      ? source.id
      : `${source.id}_${feature.id}_copy`;
    const transformed = transformVertexPositions(source, placementResult.matrix, resultId);
    transformed.name = params.mode === 'copy' ? `${source.name} (copy)` : source.name;
    return transformed;
  });

  for (const body of bodies) {
    const validation = validateBody(body);
    if (!validation.ok) {
      return {
        ok: false,
        error: `Transform produced invalid body "${body.id}"`,
        diagnostics: validation.errors.map((item) => error(
          'INVALID_TRANSFORM_RESULT',
          item.message,
          feature.id,
          body.id
        )),
      };
    }
  }

  return {
    ok: true,
    bodies,
    diagnostics: [],
    ...(params.mode === 'move'
      ? { replacedBodyIds: sources.map((body) => body.id) }
      : {}),
  };
}

export function normalizeTransformBodiesParams(
  params: Partial<TransformBodiesParams>
): TransformBodiesParams {
  return {
    bodyRefs: (params.bodyRefs ?? []).map((ref) => ({ ...ref })),
    mode: params.mode ?? 'move',
    placement: params.placement
      ? clonePlacement(params.placement)
      : {
          type: 'Free',
          translation: [0, 0, 0],
          rotationDegrees: [0, 0, 0],
          pivot: [0, 0, 0],
        },
  };
}

export function collectTransformBodiesDependencyIds(
  params: TransformBodiesParams
): string[] {
  return [...new Set([
    ...params.bodyRefs.map((ref) => ref.featureId),
    ...getPlacementReferenceFeatureIds(getPlacementReferences(params.placement)),
  ])].filter(Boolean).sort();
}

function clonePlacement(placement: Placement): Placement {
  return structuredClone(placement);
}
