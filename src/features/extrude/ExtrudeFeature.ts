import { generateId } from '../../core/id';
import { createPrismaticBody, type Body, type BodyRef } from '../../geometry';
import { getConstructionPlaneFromRef, type ConstructionPlane } from '../../geometry/ConstructionPlane';
import { cloneBody } from '../../geometry/Body';
import { validateBody } from '../../geometry/Validation';
import {
  analyzeNormalizedSketchRegions,
  getProfileByIndex,
  normalizeSketchEntities,
  resolveSketchRegionRef,
  type Point2D,
  type Profile2D,
  type Sketch,
  type SketchRegionRef,
} from '../../sketch';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import { getAllBodies, resolveSketch, type RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import type { SketchParams } from '../sketch';
import {
  migrateExtrudeExtent,
  resolveExtrudeExtent,
  type ExtrudeExtentDefinition,
  type ResolvedExtrudeExtent,
} from './ExtentResolver';
import { buildPrism, validatePrismParams } from './PrismBuilder';
import {
  unavailableSolidBooleanAdapter,
  type SolidBooleanAdapter,
} from './SolidBooleanAdapter';

export const EXTRUDE_FEATURE_TYPE = 'extrude';

export type ExtrudeOperation = 'New' | 'Add' | 'Cut';

/** Persisted schema; legacy fields remain readable and writable for existing UI/scenes. */
export interface ExtrudeParams {
  sketchId: string;
  profileIndex: number;
  regionRef?: SketchRegionRef;
  distance: number;
  flip: boolean;
  mode: 'newBody';
  operation?: ExtrudeOperation;
  extent?: ExtrudeExtentDefinition;
  targetBodyRef?: BodyRef;
  sketchData?: SketchParams;
}

export interface NormalizedExtrudeParams extends ExtrudeParams {
  operation: ExtrudeOperation;
  extent: ExtrudeExtentDefinition;
}

export interface ExtrudePreviewPlan {
  featureId: string;
  operation: ExtrudeOperation;
  sketchId: string;
  profileIndex: number;
  flip: boolean;
  extent: ResolvedExtrudeExtent;
  targetBodyRef?: BodyRef;
  targetBody?: Body;
  plane: ConstructionPlane;
  profile: Profile2D;
  toolBody: Body;
}

export type ExtrudePreviewPlanResult =
  | { ok: true; plan: ExtrudePreviewPlan }
  | { ok: false; error: string; diagnostics: Diagnostic[] };

export interface ExtrudeExecutionResult {
  plan: ExtrudePreviewPlan;
  bodies: Body[];
  replacedBodyIds: string[];
}

export const defaultExtrudeParams: NormalizedExtrudeParams = {
  sketchId: '',
  profileIndex: 0,
  distance: 1,
  flip: false,
  mode: 'newBody',
  operation: 'New',
  extent: { direction: 'OneSided', limit: 'Distance', distance: 1 },
};

export function migrateExtrudeParams(params: Partial<ExtrudeParams>): NormalizedExtrudeParams {
  const distance = params.distance ?? params.extent?.distance ?? defaultExtrudeParams.distance;
  return {
    sketchId: params.sketchId ?? '',
    profileIndex: params.profileIndex ?? 0,
    distance,
    flip: params.flip ?? false,
    mode: 'newBody',
    operation: params.operation ?? 'New',
    extent: migrateExtrudeExtent(params.extent, { distance }),
    ...(params.targetBodyRef ? { targetBodyRef: { ...params.targetBodyRef } } : {}),
    ...(params.regionRef ? {
      regionRef: {
        ...params.regionRef,
        outerSegmentIds: [...params.regionRef.outerSegmentIds],
        holeSegmentIds: params.regionRef.holeSegmentIds.map((ids) => [...ids]),
      },
    } : {}),
    ...(params.sketchData ? { sketchData: params.sketchData } : {}),
  };
}

export function validateExtrudeParams(params: Partial<ExtrudeParams>): Diagnostic[] {
  const normalized = migrateExtrudeParams(params);
  const diagnostics: Diagnostic[] = [];
  if (params.mode !== undefined && params.mode !== 'newBody') {
    diagnostics.push(error('UNSUPPORTED_MODE', 'Legacy extrude mode must be newBody.'));
  }
  if (!normalized.sketchId) diagnostics.push(error('MISSING_SKETCH_ID', 'Sketch ID is required.'));
  if (!Number.isInteger(normalized.profileIndex) || normalized.profileIndex < 0) {
    diagnostics.push(error('INVALID_PROFILE_INDEX', 'Profile index must be a non-negative integer.'));
  }
  if (normalized.regionRef && normalized.regionRef.sketchId !== normalized.sketchId) {
    diagnostics.push(error('SKETCH_REGION_MISMATCH', 'The selected region belongs to a different sketch.'));
  }
  if (!['New', 'Add', 'Cut'].includes(normalized.operation)) {
    diagnostics.push(error('UNSUPPORTED_OPERATION', 'Extrude operation must be New, Add, or Cut.'));
  }
  if (normalized.operation !== 'New') {
    if (!normalized.targetBodyRef?.featureId || !normalized.targetBodyRef.bodyId) {
      diagnostics.push(error(
        'MISSING_TARGET_BODY',
        `${normalized.operation} requires a complete target feature/body reference.`
      ));
    }
  }
  if (normalized.extent.limit === 'ThroughAll' &&
      (!normalized.targetBodyRef?.featureId || !normalized.targetBodyRef.bodyId)) {
    diagnostics.push(error(
      'MISSING_TARGET_BODY',
      'Through All requires a complete target feature/body reference.'
    ));
  }
  if (normalized.extent.limit === 'Distance' &&
      (!Number.isFinite(normalized.extent.distance) || (normalized.extent.distance ?? 0) <= 0)) {
    diagnostics.push(error('INVALID_DISTANCE', 'Distance extent must be finite and greater than zero.'));
  }
  if (normalized.extent.limit === 'UpToFace' && !normalized.extent.upToFaceRef) {
    diagnostics.push(error('MISSING_UP_TO_FACE_REF', 'Up To Face requires a typed face reference.'));
  }
  return diagnostics;
}

export function getExtrudeDependencyIds(params: Partial<ExtrudeParams>): string[] {
  const normalized = migrateExtrudeParams(params);
  return [...new Set([
    normalized.sketchId,
    ...(normalized.targetBodyRef?.featureId
      ? [normalized.targetBodyRef.featureId]
      : []),
    ...(normalized.extent.upToFaceRef?.featureId
      ? [normalized.extent.upToFaceRef.featureId]
      : []),
  ].filter(Boolean))];
}

export function createExtrudePreviewPlan(
  feature: FeatureRecord,
  context: RebuildContext
): ExtrudePreviewPlanResult {
  const params = migrateExtrudeParams(feature.parameters as Partial<ExtrudeParams>);
  const diagnostics = validateExtrudeParams(params);
  if (diagnostics.length > 0) return planFailure('Invalid extrude parameters.', diagnostics);

  // Resolve destructive-operation ownership first so a broken target produces the
  // actionable diagnostic even when its sketch dependency is also unavailable.
  const targetResult = resolveTargetBody(params.targetBodyRef, params.operation, context);
  if (!targetResult.ok) return targetResult;
  const sketchResult = resolveExtrudeSketch(params, context);
  if (!sketchResult.ok) return sketchResult;
  const profileResult = resolveExtrudeProfile(sketchResult.sketch, params);
  if (!profileResult.ok) return profileResult;
  const { profile, holeLoops } = profileResult;
  const bodies = getAllBodies(context);
  const plane = getConstructionPlaneFromRef(
    sketchResult.sketch.planeRef,
    bodies,
    context.bodiesByFeature
  );
  if (!plane) {
    return planFailure('Could not resolve the sketch plane.', [
      error('PLANE_NOT_FOUND', 'Could not resolve the sketch plane reference.'),
    ]);
  }

  const axis: [number, number, number] = params.flip
    ? [-plane.normal[0], -plane.normal[1], -plane.normal[2]]
    : [...plane.normal];
  const extentResult = resolveExtrudeExtent(params.extent, {
    plane,
    axis,
    bodies,
    bodiesByFeature: context.bodiesByFeature,
    ...(targetResult.body ? { targetBody: targetResult.body } : {}),
  });
  if (!extentResult.ok) {
    return planFailure(extentResult.error.message, [
      error(
        extentResult.error.code,
        extentResult.error.message,
        feature.id,
        extentResult.error.referenceIds[0]
      ),
    ]);
  }
  const prismErrors = validatePrismParams({
    plane,
    profile,
    distance: extentResult.extent.distance,
    startOffset: extentResult.extent.startOffset,
    flip: params.flip,
  });
  if (prismErrors.length > 0) {
    return planFailure(prismErrors[0] ?? 'Invalid prism parameters.',
      prismErrors.map((message) => error('INVALID_PRISM', message, feature.id)));
  }
  const toolBodyId = params.operation === 'New' ? `${feature.id}_body` : `${feature.id}_tool`;
  const toolBodyResult = buildExtrudeToolBody(
    feature.id,
    toolBodyId,
    plane,
    profile,
    holeLoops,
    extentResult.extent.distance,
    extentResult.extent.startOffset,
    params.flip
  );
  if (!toolBodyResult.ok) return toolBodyResult;
  const toolBody = toolBodyResult.body;
  return {
    ok: true,
    plan: {
      featureId: feature.id,
      operation: params.operation,
      sketchId: params.sketchId,
      profileIndex: params.profileIndex,
      flip: params.flip,
      extent: extentResult.extent,
      ...(params.targetBodyRef ? { targetBodyRef: { ...params.targetBodyRef } } : {}),
      ...(targetResult.body ? { targetBody: targetResult.body } : {}),
      plane,
      profile,
      toolBody,
    },
  };
}

function resolveExtrudeProfile(
  sketch: Sketch,
  params: NormalizedExtrudeParams
): { ok: true; profile: Profile2D; holeLoops: Point2D[][] }
  | { ok: false; error: string; diagnostics: Diagnostic[] } {
  if (!params.regionRef) {
    const profile = getProfileByIndex(sketch, params.profileIndex);
    return profile
      ? { ok: true, profile, holeLoops: [] }
      : planFailure(
        `Profile ${params.profileIndex} was not found in sketch "${params.sketchId}".`,
        [error('PROFILE_NOT_FOUND', `Profile ${params.profileIndex} was not found in sketch "${params.sketchId}".`)]
      );
  }
  const analysis = analyzeNormalizedSketchRegions(
    sketch.id,
    normalizeSketchEntities(sketch.entities)
  );
  const region = resolveSketchRegionRef(params.regionRef, analysis);
  if (!region) {
    return planFailure(
      `Region "${params.regionRef.regionId}" was not found in sketch "${params.sketchId}".`,
      [error(
        'SKETCH_REGION_NOT_FOUND',
        'The selected sketch region no longer exists. Repair the region reference before rebuilding.',
        params.sketchId,
        params.regionRef.regionId
      )]
    );
  }
  return {
    ok: true,
    profile: {
      id: region.id,
      sketchId: sketch.id,
      loop: region.outerLoop.map((point) => [...point]),
      entityIds: [...region.outerSegmentIds],
      isValid: true,
    },
    holeLoops: region.holeLoops.map((loop) => loop.map((point) => [...point])),
  };
}

function buildExtrudeToolBody(
  operationId: string,
  bodyId: string,
  plane: ConstructionPlane,
  profile: Profile2D,
  holeLoops: Point2D[][],
  distance: number,
  startOffset: number,
  flip: boolean
): { ok: true; body: Body } | { ok: false; error: string; diagnostics: Diagnostic[] } {
  if (holeLoops.length === 0) {
    return {
      ok: true,
      body: buildPrism({ plane, profile, distance, startOffset, flip }, bodyId),
    };
  }
  const minDepth = flip ? -(startOffset + distance) : startOffset;
  const maxDepth = flip ? -startOffset : startOffset + distance;
  const result = createPrismaticBody({
    id: bodyId,
    name: 'Prism',
    operationId: `${operationId}:region`,
    frame: {
      origin: [...plane.origin],
      uAxis: [...plane.uAxis],
      vAxis: [...plane.vAxis],
      normal: [...plane.normal],
    },
    region: {
      outer: profile.loop.map((point) => [...point]),
      holes: holeLoops.map((loop) => loop.map((point) => [...point])),
    },
    minDepth,
    maxDepth,
  });
  if (!result.ok) {
    const diagnostics = result.diagnostics.map((diagnostic) =>
      error(diagnostic.code, diagnostic.message, operationId, diagnostic.entityIds[0])
    );
    return {
      ok: false,
      error: diagnostics[0]?.message ?? 'The selected sketch region could not be extruded.',
      diagnostics,
    };
  }
  return { ok: true, body: result.body };
}

export function executeExtrudePlan(
  plan: ExtrudePreviewPlan,
  booleanAdapter: SolidBooleanAdapter = unavailableSolidBooleanAdapter
): { ok: true; result: ExtrudeExecutionResult } | { ok: false; error: string; diagnostics: Diagnostic[] } {
  if (plan.operation === 'New') {
    return { ok: true, result: { plan, bodies: [plan.toolBody], replacedBodyIds: [] } };
  }
  if (!plan.targetBody) {
    return planFailure('The target body was not resolved.', [
      error('TARGET_BODY_NOT_FOUND', 'The target body was not resolved.', plan.featureId),
    ]);
  }
  const booleanResult = booleanAdapter.apply({
    operation: plan.operation,
    featureId: plan.featureId,
    targetBody: plan.targetBody,
    toolBody: plan.toolBody,
  });
  if (!booleanResult.ok) {
    return planFailure(booleanResult.message, [
      error(booleanResult.code, booleanResult.message, plan.featureId, booleanResult.referenceIds?.[0]),
    ]);
  }
  const resultBodies = booleanResult.bodies ?? [booleanResult.body];
  const normalizedBodies = resultBodies.map((body) =>
    body.id === booleanResult.body.id && body.id !== plan.targetBody!.id
      ? cloneBody(body, plan.targetBody!.id)
      : body
  );
  for (const body of normalizedBodies) {
    const validation = validateBody(body);
    if (!validation.ok) {
      return planFailure('Boolean operation produced an invalid body.',
        validation.errors.map((item) => error('INVALID_BOOLEAN_BODY', item.message, plan.featureId)));
    }
  }
  return {
    ok: true,
    result: { plan, bodies: normalizedBodies, replacedBodyIds: [plan.targetBody.id] },
  };
}

export function rebuildExtrudeWithAdapter(
  feature: FeatureRecord,
  context: RebuildContext,
  booleanAdapter: SolidBooleanAdapter
): RebuildHandlerResult {
  const planResult = createExtrudePreviewPlan(feature, context);
  if (!planResult.ok) return planResult;
  const execution = executeExtrudePlan(planResult.plan, booleanAdapter);
  if (!execution.ok) return execution;
  return {
    ok: true,
    bodies: execution.result.bodies,
    replacedBodyIds: execution.result.replacedBodyIds,
    diagnostics: [],
  };
}

export function rebuildExtrude(feature: FeatureRecord, context: RebuildContext): RebuildHandlerResult {
  return rebuildExtrudeWithAdapter(feature, context, unavailableSolidBooleanAdapter);
}

export function createExtrudeFeature(
  sketchFeature: FeatureRecord,
  profileIndex = 0,
  distance = 1,
  flip = false,
  name = 'Extrude'
): FeatureRecord {
  return createExtrudeFeatureFromParams(sketchFeature, {
    profileIndex,
    distance,
    flip,
    operation: 'New',
    extent: { direction: 'OneSided', limit: 'Distance', distance },
  }, name);
}

export function createExtrudeFeatureFromParams(
  sketchFeature: FeatureRecord,
  params: Partial<ExtrudeParams>,
  name = 'Extrude'
): FeatureRecord {
  const normalized = migrateExtrudeParams({ ...params, sketchId: sketchFeature.id });
  return {
    id: generateId(),
    type: EXTRUDE_FEATURE_TYPE,
    name,
    parameters: normalized as unknown as Record<string, unknown>,
    refsIn: getExtrudeDependencyIds(normalized),
    refsOut: [],
    suppressed: false,
  };
}

export function updateExtrudeDistance(feature: FeatureRecord, distance: number): FeatureRecord {
  if (feature.type !== EXTRUDE_FEATURE_TYPE) return feature;
  const params = migrateExtrudeParams(feature.parameters as Partial<ExtrudeParams>);
  return {
    ...feature,
    parameters: {
      ...params,
      distance,
      extent: { ...params.extent, limit: 'Distance', distance },
    } as unknown as Record<string, unknown>,
  };
}

export function updateExtrudeFlip(feature: FeatureRecord, flip: boolean): FeatureRecord {
  if (feature.type !== EXTRUDE_FEATURE_TYPE) return feature;
  return {
    ...feature,
    parameters: { ...feature.parameters, flip },
  };
}

export function getExtrudeParams(feature: FeatureRecord): ExtrudeParams | null {
  return feature.type === EXTRUDE_FEATURE_TYPE
    ? migrateExtrudeParams(feature.parameters as Partial<ExtrudeParams>)
    : null;
}

function resolveExtrudeSketch(
  params: NormalizedExtrudeParams,
  context: RebuildContext
): { ok: true; sketch: Sketch } | { ok: false; error: string; diagnostics: Diagnostic[] } {
  const liveSketch = resolveSketch(context, params.sketchId);
  if (liveSketch) return { ok: true, sketch: liveSketch };
  if (!params.sketchData) {
    return planFailure(`Sketch "${params.sketchId}" was not rebuilt.`, [
      error('SKETCH_NOT_FOUND', `Sketch "${params.sketchId}" was not rebuilt.`, params.sketchId),
    ]);
  }
  return {
    ok: true,
    sketch: {
      id: params.sketchId,
      name: 'Sketch',
      planeRef: params.sketchData.planeRef,
      entities: params.sketchData.entities,
      dimensions: params.sketchData.dimensions,
    },
  };
}

function resolveTargetBody(
  ref: BodyRef | undefined,
  operation: ExtrudeOperation,
  context: RebuildContext
): { ok: true; body?: Body } | { ok: false; error: string; diagnostics: Diagnostic[] } {
  if (!ref) return operation === 'New'
    ? { ok: true }
    : planFailure('A target body reference is required.', [
      error('MISSING_TARGET_BODY', `${operation} requires a target body reference.`),
    ]);
  const body = context.allBodies.find((candidate) => candidate.id === ref.bodyId);
  if (!body) {
    return planFailure(`Target body "${ref.bodyId}" was not rebuilt.`, [
      error('TARGET_BODY_NOT_FOUND', `Target body "${ref.bodyId}" was not rebuilt.`, ref.featureId, ref.bodyId),
    ]);
  }
  if (!(context.bodiesByFeature.get(ref.featureId) ?? []).some((candidate) => candidate.id === ref.bodyId)) {
    return planFailure(`Target body "${ref.bodyId}" is not produced by feature "${ref.featureId}".`, [
      error(
        'TARGET_BODY_REFERENCE_MISMATCH',
        `Target body "${ref.bodyId}" is not produced by feature "${ref.featureId}".`,
        ref.featureId,
        ref.bodyId
      ),
    ]);
  }
  return { ok: true, body };
}

function planFailure(
  message: string,
  diagnostics: Diagnostic[]
): { ok: false; error: string; diagnostics: Diagnostic[] } {
  return { ok: false, error: message, diagnostics };
}
