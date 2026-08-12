import { generateId } from '../../core/id';
import type { BodyRef } from '../../geometry';
import { cloneBody } from '../../geometry/Body';
import { performCut, validateCutOperation } from '../../geometry/CutBuilder';
import { validateBody } from '../../geometry/Validation';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import type { SketchParams } from '../sketch';
import type { SketchRegionRef } from '../../sketch';
import {
  createExtrudePreviewPlan,
  executeExtrudePlan,
  type ExtrudePreviewPlan,
  type ExtrudePreviewPlanResult,
  type ExtrudeParams,
} from '../extrude/ExtrudeFeature';
import {
  migrateExtrudeExtent,
  type ExtrudeExtentDefinition,
} from '../extrude/ExtentResolver';
import type { SolidBooleanAdapter } from '../extrude/SolidBooleanAdapter';

export const EXTRUDE_CUT_FEATURE_TYPE = 'extrudeCut';

/** Persisted schema with legacy mode/distance retained for existing scenes and UI. */
export interface ExtrudeCutParams {
  targetBodyRef: BodyRef;
  sketchId: string;
  profileIndex: number;
  regionRef?: SketchRegionRef;
  mode: 'distance' | 'through';
  distance?: number;
  flip: boolean;
  extent?: ExtrudeExtentDefinition;
  sketchData?: SketchParams;
}

export interface NormalizedExtrudeCutParams extends ExtrudeCutParams {
  extent: ExtrudeExtentDefinition;
}

export type ExtrudeCutPreviewPlan = ExtrudePreviewPlan;
export type ExtrudeCutPreviewPlanResult = ExtrudePreviewPlanResult;

export const defaultExtrudeCutParams: NormalizedExtrudeCutParams = {
  targetBodyRef: { bodyId: '', featureId: '' },
  sketchId: '',
  profileIndex: 0,
  mode: 'distance',
  distance: 0.5,
  flip: false,
  extent: { direction: 'OneSided', limit: 'Distance', distance: 0.5 },
};

export function migrateExtrudeCutParams(
  params: Partial<ExtrudeCutParams>
): NormalizedExtrudeCutParams {
  const mode = params.mode ?? (params.extent?.limit === 'ThroughAll' ? 'through' : 'distance');
  const distance = params.distance ?? params.extent?.distance ?? defaultExtrudeCutParams.distance;
  return {
    targetBodyRef: params.targetBodyRef
      ? { ...params.targetBodyRef }
      : { ...defaultExtrudeCutParams.targetBodyRef },
    sketchId: params.sketchId ?? '',
    profileIndex: params.profileIndex ?? 0,
    ...(params.regionRef ? {
      regionRef: {
        ...params.regionRef,
        outerSegmentIds: [...params.regionRef.outerSegmentIds],
        holeSegmentIds: params.regionRef.holeSegmentIds.map((ids) => [...ids]),
      },
    } : {}),
    mode,
    ...(distance !== undefined ? { distance } : {}),
    flip: params.flip ?? false,
    extent: migrateExtrudeExtent(params.extent, {
      mode,
      ...(distance !== undefined ? { distance } : {}),
    }),
    ...(params.sketchData ? { sketchData: params.sketchData } : {}),
  };
}

export function validateExtrudeCutParams(params: Partial<ExtrudeCutParams>): Diagnostic[] {
  const normalized = migrateExtrudeCutParams(params);
  const diagnostics: Diagnostic[] = [];
  if (!params.targetBodyRef) {
    diagnostics.push(error('MISSING_TARGET_BODY', 'Target body reference is required.'));
  } else {
    if (!normalized.targetBodyRef.bodyId) diagnostics.push(error('MISSING_TARGET_BODY', 'Target body ID is required.'));
    if (!normalized.targetBodyRef.featureId) diagnostics.push(error('MISSING_TARGET_BODY', 'Target feature ID is required.'));
  }
  if (!normalized.sketchId) diagnostics.push(error('MISSING_SKETCH_ID', 'Sketch ID is required.'));
  if (!Number.isInteger(normalized.profileIndex) || normalized.profileIndex < 0) {
    diagnostics.push(error('INVALID_PROFILE_INDEX', 'Profile index must be a non-negative integer.'));
  }
  if (params.mode && !['distance', 'through'].includes(params.mode)) {
    diagnostics.push(error('UNSUPPORTED_MODE', 'Legacy cut mode must be distance or through.'));
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

export function getExtrudeCutDependencyIds(params: Partial<ExtrudeCutParams>): string[] {
  const normalized = migrateExtrudeCutParams(params);
  return [...new Set([
    normalized.targetBodyRef.featureId,
    normalized.sketchId,
    normalized.extent.upToFaceRef?.featureId ?? '',
  ].filter(Boolean))];
}

export function createExtrudeCutPreviewPlan(
  feature: FeatureRecord,
  context: RebuildContext
): ExtrudeCutPreviewPlanResult {
  const params = migrateExtrudeCutParams(feature.parameters as Partial<ExtrudeCutParams>);
  const diagnostics = validateExtrudeCutParams(feature.parameters as Partial<ExtrudeCutParams>);
  if (diagnostics.length > 0) {
    return { ok: false, error: 'Invalid extrude cut parameters.', diagnostics };
  }
  const compatibleParams: ExtrudeParams = {
    sketchId: params.sketchId,
    profileIndex: params.profileIndex,
    ...(params.regionRef ? { regionRef: params.regionRef } : {}),
    distance: params.distance ?? defaultExtrudeCutParams.distance!,
    flip: params.flip,
    mode: 'newBody',
    operation: 'Cut',
    extent: params.extent,
    targetBodyRef: params.targetBodyRef,
    ...(params.sketchData ? { sketchData: params.sketchData } : {}),
  };
  return createExtrudePreviewPlan({
    ...feature,
    type: 'extrude',
    parameters: compatibleParams as unknown as Record<string, unknown>,
  }, context);
}

export function rebuildExtrudeCutWithAdapter(
  feature: FeatureRecord,
  context: RebuildContext,
  booleanAdapter: SolidBooleanAdapter
): RebuildHandlerResult {
  const planResult = createExtrudeCutPreviewPlan(feature, context);
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

/** Default handler preserves the proven planar pocket path and fails closed for symmetric extents. */
export function rebuildExtrudeCut(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const planResult = createExtrudeCutPreviewPlan(feature, context);
  if (!planResult.ok) return planResult;
  const plan = planResult.plan;
  if (!plan.targetBody) {
    return {
      ok: false,
      error: 'Target body was not resolved.',
      diagnostics: [error('TARGET_BODY_NOT_FOUND', 'Target body was not resolved.', feature.id)],
    };
  }
  if (plan.extent.definition.direction !== 'OneSided' || Math.abs(plan.extent.startOffset) > 0) {
    return {
      ok: false,
      error: 'Symmetric cut requires the planar boolean kernel.',
      diagnostics: [error(
        'BOOLEAN_KERNEL_REQUIRED',
        'Symmetric cut requires the planar boolean kernel; use rebuildExtrudeCutWithAdapter when it is available.',
        feature.id
      )],
    };
  }
  const validation = validateCutOperation(
    plan.targetBody,
    plan.plane,
    plan.profile,
    plan.extent.distance,
    plan.flip
  );
  if (!validation.valid) {
    return {
      ok: false,
      error: validation.error ?? 'Invalid cut operation.',
      diagnostics: [error('INVALID_CUT', validation.error ?? 'Invalid cut operation.', feature.id)],
    };
  }
  const result = performCut(
    cloneBody(plan.targetBody, plan.targetBody.id),
    plan.plane,
    plan.profile,
    plan.extent.distance,
    plan.flip,
    feature.id
  );
  if (!result) {
    return {
      ok: false,
      error: 'Cut operation failed.',
      diagnostics: [error('CUT_FAILED', 'Cut operation failed to produce geometry.', feature.id)],
    };
  }
  const bodyValidation = validateBody(result);
  if (!bodyValidation.ok) {
    return {
      ok: false,
      error: 'Cut produced an invalid body.',
      diagnostics: bodyValidation.errors.map((item) => error('INVALID_BODY', item.message, feature.id)),
    };
  }
  return {
    ok: true,
    bodies: [result],
    diagnostics: [],
    replacedBodyIds: [plan.targetBody.id],
  };
}

export function createExtrudeCutFeature(
  targetBodyRef: BodyRef,
  sketchFeature: FeatureRecord,
  mode: 'distance' | 'through' = 'distance',
  distance: number | undefined = undefined,
  flip = false,
  name = 'Extrude Cut'
): FeatureRecord {
  return createExtrudeCutFeatureFromParams(targetBodyRef, sketchFeature, {
    mode,
    ...(distance !== undefined ? { distance } : {}),
    flip,
    extent: migrateExtrudeExtent(undefined, {
      mode,
      ...(distance !== undefined ? { distance } : {}),
    }),
  }, name);
}

export function createExtrudeCutFeatureFromParams(
  targetBodyRef: BodyRef,
  sketchFeature: FeatureRecord,
  params: Partial<ExtrudeCutParams>,
  name = 'Extrude Cut'
): FeatureRecord {
  const normalized = migrateExtrudeCutParams({
    ...params,
    targetBodyRef,
    sketchId: sketchFeature.id,
  });
  return {
    id: generateId(),
    type: EXTRUDE_CUT_FEATURE_TYPE,
    name,
    parameters: normalized as unknown as Record<string, unknown>,
    refsIn: getExtrudeCutDependencyIds(normalized),
    refsOut: [],
    suppressed: false,
  };
}

export function updateExtrudeCutDistance(feature: FeatureRecord, distance: number): FeatureRecord {
  if (feature.type !== EXTRUDE_CUT_FEATURE_TYPE) return feature;
  const params = migrateExtrudeCutParams(feature.parameters as Partial<ExtrudeCutParams>);
  return {
    ...feature,
    parameters: {
      ...params,
      mode: 'distance',
      distance,
      extent: { ...params.extent, limit: 'Distance', distance },
    } as unknown as Record<string, unknown>,
  };
}

export function updateExtrudeCutMode(
  feature: FeatureRecord,
  mode: 'distance' | 'through'
): FeatureRecord {
  if (feature.type !== EXTRUDE_CUT_FEATURE_TYPE) return feature;
  const params = migrateExtrudeCutParams(feature.parameters as Partial<ExtrudeCutParams>);
  return {
    ...feature,
    parameters: {
      ...params,
      mode,
      extent: {
        ...params.extent,
        limit: mode === 'through' ? 'ThroughAll' : 'Distance',
      },
    } as unknown as Record<string, unknown>,
  };
}

export function updateExtrudeCutFlip(feature: FeatureRecord, flip: boolean): FeatureRecord {
  if (feature.type !== EXTRUDE_CUT_FEATURE_TYPE) return feature;
  return { ...feature, parameters: { ...feature.parameters, flip } };
}

export function getExtrudeCutParams(feature: FeatureRecord): ExtrudeCutParams | null {
  return feature.type === EXTRUDE_CUT_FEATURE_TYPE
    ? migrateExtrudeCutParams(feature.parameters as Partial<ExtrudeCutParams>)
    : null;
}

export function createBodyRef(bodyId: string, featureId: string): BodyRef {
  return { bodyId, featureId };
}

export type { BodyRef };
