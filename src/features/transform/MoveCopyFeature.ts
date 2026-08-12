import { generateId } from '../../core/id';
import { translateBody } from '../../geometry/TransformUtils';
import type { BodyRef } from '../../geometry/SubObjectTypes';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';

export const MOVE_COPY_FEATURE_TYPE = 'moveCopy';

export type MoveCopyMode = 'move' | 'copy';

export interface MoveCopyParams {
  sourceBodyRef: BodyRef;
  translation: [number, number, number];
  mode: MoveCopyMode;
}

export const defaultMoveCopyParams: MoveCopyParams = {
  sourceBodyRef: { featureId: '', bodyId: '' },
  translation: [0, 0, 0],
  mode: 'move',
};

export function validateMoveCopyParams(params: Partial<MoveCopyParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!params.sourceBodyRef?.featureId) {
    diagnostics.push(error('MISSING_SOURCE_FEATURE', 'Move/Copy requires a source feature reference'));
  }
  if (!params.sourceBodyRef?.bodyId) {
    diagnostics.push(error('MISSING_SOURCE_BODY', 'Move/Copy requires a source body reference'));
  }
  if (
    !params.translation
    || params.translation.length !== 3
    || !params.translation.every(Number.isFinite)
  ) {
    diagnostics.push(error('INVALID_TRANSLATION', 'Translation must contain three finite values'));
  }
  if (params.mode !== 'move' && params.mode !== 'copy') {
    diagnostics.push(error('INVALID_MODE', 'Move/Copy mode must be move or copy'));
  }
  return diagnostics;
}

export function createMoveCopyFeature(
  sourceBodyRef: BodyRef,
  translation: [number, number, number],
  mode: MoveCopyMode = 'move',
  name = mode === 'copy' ? 'Copy' : 'Move'
): FeatureRecord {
  return {
    id: generateId(),
    type: MOVE_COPY_FEATURE_TYPE,
    name,
    parameters: {
      sourceBodyRef: { ...sourceBodyRef },
      translation: [...translation],
      mode,
    } satisfies MoveCopyParams as unknown as Record<string, unknown>,
    refsIn: [sourceBodyRef.featureId],
    refsOut: [],
    suppressed: false,
  };
}

export function rebuildMoveCopy(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params = normalizeMoveCopyParams(feature.parameters as Partial<MoveCopyParams>);
  const diagnostics = validateMoveCopyParams(params);
  if (diagnostics.length > 0) {
    return { ok: false, error: 'Invalid Move/Copy parameters', diagnostics };
  }

  const source = context.bodiesByFeature
    .get(params.sourceBodyRef.featureId)
    ?.find((body) => body.id === params.sourceBodyRef.bodyId);
  if (!source) {
    const message = `Source body ${params.sourceBodyRef.bodyId} from feature ${params.sourceBodyRef.featureId} was not found`;
    return {
      ok: false,
      error: message,
      diagnostics: [error('SOURCE_BODY_NOT_FOUND', message, feature.id, params.sourceBodyRef.bodyId)],
    };
  }

  const resultBodyId = params.mode === 'move'
    ? source.id
    : `${source.id}_${feature.id}_copy`;
  const body = translateBody(source, params.translation, resultBodyId);
  body.name = params.mode === 'copy' ? `${source.name} (copy)` : source.name;

  return {
    ok: true,
    bodies: [body],
    diagnostics: [],
    ...(params.mode === 'move' ? { replacedBodyIds: [source.id] } : {}),
  };
}

export function normalizeMoveCopyParams(
  params: Partial<MoveCopyParams>
): MoveCopyParams {
  return {
    sourceBodyRef: {
      ...defaultMoveCopyParams.sourceBodyRef,
      ...(params.sourceBodyRef ?? {}),
    },
    translation: params.translation
      ? [...params.translation] as [number, number, number]
      : [...defaultMoveCopyParams.translation],
    mode: params.mode ?? defaultMoveCopyParams.mode,
  };
}

