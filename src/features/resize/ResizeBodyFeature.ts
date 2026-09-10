import { generateId } from '../../core/id';
import {
  resizeBodyToDimensions,
  validateBody,
  type BodyRef,
} from '../../geometry';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';

export const RESIZE_BODY_FEATURE_TYPE = 'resizeBody';

export interface ResizeBodyParams {
  bodyRef: BodyRef;
  /** World X size. */
  width: number;
  /** World Y size (vertical in the modeling workspace). */
  height: number;
  /** World Z size. */
  depth: number;
}

export function validateResizeBodyParams(params: Partial<ResizeBodyParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!params.bodyRef?.featureId || !params.bodyRef.bodyId) {
    diagnostics.push(error('MISSING_BODY_REF', 'Resize requires an exact body reference.'));
  }
  for (const [name, value] of [
    ['Width', params.width],
    ['Height', params.height],
    ['Depth', params.depth],
  ] as const) {
    if (!Number.isFinite(value) || (value ?? 0) <= 0) {
      diagnostics.push(error('INVALID_DIMENSION', `${name} must be finite and greater than zero.`));
    }
  }
  return diagnostics;
}

export function createResizeBodyFeature(
  bodyRef: BodyRef,
  dimensions: [number, number, number],
  name = 'Resize Body'
): FeatureRecord {
  const parameters: ResizeBodyParams = {
    bodyRef: { ...bodyRef },
    width: dimensions[0],
    height: dimensions[1],
    depth: dimensions[2],
  };
  return {
    id: generateId(),
    type: RESIZE_BODY_FEATURE_TYPE,
    name,
    parameters: parameters as unknown as Record<string, unknown>,
    refsIn: [bodyRef.featureId],
    refsOut: [],
    suppressed: false,
  };
}

export function rebuildResizeBody(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params = feature.parameters as unknown as Partial<ResizeBodyParams>;
  const diagnostics = validateResizeBodyParams(params);
  if (diagnostics.length > 0) {
    return { ok: false, error: 'Invalid resize parameters', diagnostics };
  }

  const complete = params as ResizeBodyParams;
  const source = context.bodiesByFeature
    .get(complete.bodyRef.featureId)
    ?.find((body) => body.id === complete.bodyRef.bodyId);
  if (!source) {
    const message = `Body ${complete.bodyRef.bodyId} from feature ${complete.bodyRef.featureId} was not found.`;
    return {
      ok: false,
      error: message,
      diagnostics: [error('BODY_NOT_FOUND', message, feature.id, complete.bodyRef.bodyId)],
    };
  }

  let body;
  try {
    body = resizeBodyToDimensions(
      source,
      [complete.width, complete.height, complete.depth],
      source.id
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return {
      ok: false,
      error: message,
      diagnostics: [error('UNSUPPORTED_RESIZE', message, feature.id, source.id)],
    };
  }
  body.name = source.name;

  const validation = validateBody(body);
  if (!validation.ok) {
    return {
      ok: false,
      error: `Resize produced invalid body ${source.id}`,
      diagnostics: validation.errors.map((item) => error(
        'INVALID_RESIZE_RESULT',
        item.message,
        feature.id,
        source.id
      )),
    };
  }

  return {
    ok: true,
    bodies: [body],
    diagnostics: [],
    replacedBodyIds: [source.id],
  };
}

