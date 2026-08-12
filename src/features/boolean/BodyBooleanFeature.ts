import { executePlanarBoolean, type PlanarBooleanOperation } from '../../geometry';
import type { BodyRef } from '../../geometry/SubObjectTypes';
import { error, type Diagnostic } from '../Diagnostics';
import { createFeatureRecord, type FeatureRecord } from '../FeatureRecord';
import { getBodiesByFeature, type RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';

export const BODY_BOOLEAN_FEATURE_TYPE = 'bodyBoolean';

export interface BodyBooleanParams {
  operation: PlanarBooleanOperation;
  targetBodyRef: BodyRef;
  toolBodyRefs: BodyRef[];
  keepTools: boolean;
}

export const defaultBodyBooleanParams: BodyBooleanParams = {
  operation: 'union',
  targetBodyRef: { featureId: '', bodyId: '' },
  toolBodyRefs: [],
  keepTools: false,
};

export function validateBodyBooleanParams(
  params: Partial<BodyBooleanParams>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!params.targetBodyRef?.featureId || !params.targetBodyRef.bodyId) {
    diagnostics.push(error(
      'MISSING_TARGET_BODY',
      'Select one target body before running a Boolean operation.'
    ));
  }
  if (!params.toolBodyRefs || params.toolBodyRefs.length === 0) {
    diagnostics.push(error(
      'MISSING_TOOL_BODY',
      'Select at least one tool body for the Boolean operation.'
    ));
  }
  if (
    params.operation !== 'union'
    && params.operation !== 'difference'
    && params.operation !== 'intersection'
    && params.operation !== 'split'
  ) {
    diagnostics.push(error('INVALID_BOOLEAN_OPERATION', 'Choose Union, Difference, Intersection, or Split.'));
  }
  if (params.operation === 'split' && params.toolBodyRefs?.length !== 1) {
    diagnostics.push(error('INVALID_SPLIT_TOOLS', 'Split requires exactly one cutting body.'));
  }

  const targetKey = params.targetBodyRef
    ? `${params.targetBodyRef.featureId}:${params.targetBodyRef.bodyId}`
    : '';
  const seen = new Set<string>();
  for (const ref of params.toolBodyRefs ?? []) {
    if (!ref.featureId || !ref.bodyId) {
      diagnostics.push(error('INVALID_TOOL_BODY', 'Every tool body must have a stable feature and body reference.'));
      continue;
    }
    const key = `${ref.featureId}:${ref.bodyId}`;
    if (key === targetKey) {
      diagnostics.push(error('TARGET_USED_AS_TOOL', 'The target body cannot also be a tool body.'));
    }
    if (seen.has(key)) {
      diagnostics.push(error('DUPLICATE_TOOL_BODY', `Tool body ${ref.bodyId} is selected more than once.`));
    }
    seen.add(key);
  }
  return diagnostics;
}

export function createBodyBooleanFeature(
  params: BodyBooleanParams,
  name = `${capitalize(params.operation)} Bodies`
): FeatureRecord {
  return createFeatureRecord(
    BODY_BOOLEAN_FEATURE_TYPE,
    name,
    {
      operation: params.operation,
      targetBodyRef: { ...params.targetBodyRef },
      toolBodyRefs: params.toolBodyRefs.map((ref) => ({ ...ref })),
      keepTools: params.keepTools,
    },
    {
      refsIn: [...new Set([
        params.targetBodyRef.featureId,
        ...params.toolBodyRefs.map((ref) => ref.featureId),
      ])],
    }
  );
}

export function rebuildBodyBoolean(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const raw = feature.parameters as Partial<BodyBooleanParams>;
  const params: BodyBooleanParams = {
    operation: raw.operation ?? defaultBodyBooleanParams.operation,
    targetBodyRef: raw.targetBodyRef ?? defaultBodyBooleanParams.targetBodyRef,
    toolBodyRefs: raw.toolBodyRefs ?? defaultBodyBooleanParams.toolBodyRefs,
    keepTools: raw.keepTools ?? defaultBodyBooleanParams.keepTools,
  };
  const diagnostics = validateBodyBooleanParams(params);
  if (diagnostics.length > 0) {
    return { ok: false, error: 'Invalid body Boolean parameters', diagnostics };
  }

  const target = resolveExactBody(context, params.targetBodyRef);
  if (!target) {
    return unresolvedBodyResult('TARGET_BODY_NOT_FOUND', params.targetBodyRef);
  }
  const tools = [];
  for (const ref of params.toolBodyRefs) {
    const tool = resolveExactBody(context, ref);
    if (!tool) return unresolvedBodyResult('TOOL_BODY_NOT_FOUND', ref);
    tools.push(tool);
  }

  const booleanResult = executePlanarBoolean({
    operation: params.operation,
    operationId: feature.id,
    target,
    tools,
  });
  if (!booleanResult.ok) {
    const booleanDiagnostics = booleanResult.diagnostics.map((diagnostic) =>
      error(
        diagnostic.code,
        diagnostic.message,
        feature.id,
        diagnostic.entityIds[0]
      )
    );
    return {
      ok: false,
      error: booleanDiagnostics[0]?.message ?? 'Body Boolean failed',
      diagnostics: booleanDiagnostics,
    };
  }

  return {
    ok: true,
    bodies: booleanResult.bodies,
    diagnostics: booleanResult.diagnostics.map((diagnostic) =>
      error(diagnostic.code, diagnostic.message, feature.id, diagnostic.entityIds[0])
    ),
    replacedBodyIds: [
      target.id,
      ...(params.keepTools ? [] : tools.map((body) => body.id)),
    ],
  };
}

function resolveExactBody(context: RebuildContext, ref: BodyRef) {
  return getBodiesByFeature(context, ref.featureId)
    ?.find((body) => body.id === ref.bodyId);
}

function unresolvedBodyResult(code: string, ref: BodyRef): RebuildHandlerResult {
  const diagnostic = error(
    code,
    `Body ${ref.bodyId} is no longer produced by feature ${ref.featureId}. Repair the reference before rebuilding.`,
    undefined,
    ref.bodyId
  );
  return { ok: false, error: diagnostic.message, diagnostics: [diagnostic] };
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
