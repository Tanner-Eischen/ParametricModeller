import type { Body, BodyRef, PrismaticFrame } from '../../geometry';
import {
  addEdge,
  addFace,
  addPlane,
  addVertex,
  createBody,
  createEdge,
  createFace,
  createPlane,
  createPrismaticBody,
  createVertex,
  DEFAULT_TOLERANCE_POLICY,
  executePlanarBoolean,
  getBodyBoundingBox,
  normalizePlanarRegion,
  splitConvexBodyByPlane,
  triangulatePlanarRegion,
  validateClosedManifoldBody,
} from '../../geometry';
import type {
  ManufacturingOperation,
  ManufacturingOperationKind,
  ManufacturingProcess,
} from '../../woodworking/ManufacturingOperation';
import { sortManufacturingOperations } from '../../woodworking/ManufacturingOperation';
import { error, type Diagnostic } from '../Diagnostics';
import { createFeatureRecord, type FeatureRecord } from '../FeatureRecord';
import type {
  EdgePlacementRef,
  FacePlacementRef,
  PlacementDatumRef,
  PlacementFrameRef,
} from '../placement/PlacementReferences';
import {
  resolvePlacementBody,
  resolvePlacementFrame,
} from '../placement/PlacementReferences';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import {
  rebuildMiterCut,
  type MiterCutParams,
} from '../miter/MiterCutFeature';
import { createBoxBody } from '../primitives/BoxFeature';
import {
  createDefaultWoodJointDefinition,
  definitionCompatibilityFields,
  normalizeWoodJointDefinition,
  validateWoodJointDefinition,
  type SawCutKeep,
  type WoodJointDefinition,
  type WoodJointResultMode,
} from './WoodJointDefinitions';

export const WOOD_JOINT_FEATURE_TYPE = 'woodJoint';

export const WOOD_JOINT_KINDS = [
  'mortiseTenon',
  'dado',
  'groove',
  'rabbet',
  'crossLap',
  'endLap',
  'halfLap',
  'bridle',
  'notch',
  'sawCut',
  'chamfer',
  'threeWayMiter',
] as const;

export type WoodJointKind = typeof WOOD_JOINT_KINDS[number];

/**
 * A member stores both the exact body and the exact setup datum.  Persisting
 * both prevents a surviving datum on the wrong rebuilt body from silently
 * redirecting a joint.
 */
export interface WoodJointMemberRef {
  bodyRef: BodyRef;
  datumRef: PlacementFrameRef;
  /** Required for a three-way miter; stable identity beats loop-order matching. */
  cornerVertexId?: string;
}

export interface WoodJointParams {
  kind: WoodJointKind;
  members: WoodJointMemberRef[];
  /** Signed fit adjustment on both profile sides. Zero means nominal fit. */
  sideClearance: number;
  /** Signed fit adjustment at the end of a pocket or tenon. */
  endClearance: number;
  /** Canonical typed definition. Flat fields below remain compatibility aliases. */
  definition?: WoodJointDefinition | undefined;
  width?: number | undefined;
  depth?: number | undefined;
  length?: number | undefined;
  /** Distance inward from a saw-cut datum face. Defaults to stock midpoint. */
  offset?: number | undefined;
  /** Material removed by a saw cut. */
  kerf?: number | undefined;
  keep?: SawCutKeep | undefined;
  chamferWidth?: number | undefined;
  resultMode?: WoodJointResultMode | undefined;
  angleDegrees?: number | undefined;
}

export interface WoodJointComputedDefaults {
  width?: number;
  depth?: number;
  length?: number;
  offset?: number;
  kerf?: number;
  chamferDistance?: number;
  haunchWidth?: number;
  haunchDepth?: number;
}

export type WoodJointMemberRole = 'memberA' | 'memberB' | 'memberC';

export interface WoodJointExplodedMemberPreview {
  memberIndex: number;
  role: WoodJointMemberRole;
  bodyId: string;
  direction: [number, number, number];
  distance: number;
  /** Derived preview matrix only; never written to document or body geometry. */
  transform: number[];
}

export interface WoodJointExplodedPreviewPlan {
  distance: number;
  members: WoodJointExplodedMemberPreview[];
  authoritative: false;
}

export interface ThreeWayMiterRoleGeometry {
  memberIndex: number;
  role: WoodJointMemberRole;
  bodyId: string;
  cornerVertexId: string;
  corner: [number, number, number];
  endAxis: [number, number, number];
  angleDegrees: number;
}

export interface ThreeWayMiterClosure {
  jointPoint: [number, number, number];
  maximumGap: number;
  tolerance: number;
  determinant: number;
  roles: ThreeWayMiterRoleGeometry[];
}

export interface WoodJointEditPlan {
  id: string;
  memberIndex: number;
  bodyId: string;
  operation: 'difference' | 'split' | 'miter';
  removal: 'rectangularPrism' | 'triangularPrism' | 'planeCut';
  bounds?: AxisAlignedBounds;
}

export interface WoodJointPlan {
  featureId: string;
  kind: WoodJointKind;
  edits: WoodJointEditPlan[];
  manufacturingOperations: ManufacturingOperation[];
  replacedBodyIds: string[];
  computedDefaults: WoodJointComputedDefaults;
  explodedPreview: WoodJointExplodedPreviewPlan;
  threeWayClosure?: ThreeWayMiterClosure;
  executable: true;
}

export type WoodJointPlanResult =
  | { ok: true; plan: WoodJointPlan }
  | { ok: false; error: string; diagnostics: Diagnostic[] };

export const defaultWoodJointParams: Omit<WoodJointParams, 'kind' | 'members'> = {
  sideClearance: 0,
  endClearance: 0,
  kerf: 0.125,
  keep: 'both',
  resultMode: 'trim',
};

interface ResolvedMember {
  ref: WoodJointMemberRef;
  body: Body;
  frame: {
    origin: [number, number, number];
    xAxis: [number, number, number];
    yAxis: [number, number, number];
    zAxis: [number, number, number];
  };
  bounds: AxisAlignedBounds;
}

export interface AxisAlignedBounds {
  min: [number, number, number];
  max: [number, number, number];
}

type Axis = 0 | 1 | 2;

interface InternalPlan {
  publicPlan: WoodJointPlan;
  params: WoodJointParams;
  members: ResolvedMember[];
  overlap?: AxisAlignedBounds;
  /** Translation from a virtual source-end prism to the receiver-end prism. */
  endJointReceiverOffset?: [number, number, number];
}

export function validateWoodJointParams(
  params: Partial<WoodJointParams>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!params.kind || !WOOD_JOINT_KINDS.includes(params.kind)) {
    diagnostics.push(error('INVALID_JOINT_KIND', 'Choose a supported woodworking joint type.'));
  }
  if (!Array.isArray(params.members)) {
    diagnostics.push(error('MISSING_JOINT_MEMBERS', 'The joint requires exact member datum references.'));
    return diagnostics;
  }

  const expected = expectedMemberCount(params.kind);
  if (
    (expected === 2 && params.members.length !== 2)
    || (expected === 1 && params.members.length !== 1)
    || (expected === 3 && ![1, 3].includes(params.members.length))
  ) {
    diagnostics.push(error(
      'INVALID_MEMBER_COUNT',
      expected === 3
        ? 'A three-way miter requires one end treatment or exactly three members.'
        : `${params.kind ?? 'This joint'} requires exactly ${expected} member${expected === 1 ? '' : 's'}.`
    ));
  }

  const memberKeys = new Set<string>();
  params.members.forEach((member, index) => {
    if (!validBodyRef(member?.bodyRef)) {
      diagnostics.push(error(
        'MISSING_MEMBER_BODY_REF',
        `Joint member ${index + 1} requires an exact feature and body reference.`
      ));
      return;
    }
    if (!validDatumRef(member.datumRef)) {
      diagnostics.push(error(
        'MISSING_MEMBER_DATUM_REF',
        `Joint member ${index + 1} requires an exact body, face, edge, or vertex datum.`
      ));
      return;
    }
    if (
      member.bodyRef.featureId !== member.datumRef.featureId
      || member.bodyRef.bodyId !== member.datumRef.bodyId
    ) {
      diagnostics.push(error(
        'MISMATCHED_MEMBER_DATUM',
        `Joint member ${index + 1} datum must belong to its exact member body.`
      ));
    }
    const key = `${member.bodyRef.featureId}:${member.bodyRef.bodyId}`;
    if (memberKeys.has(key)) {
      diagnostics.push(error(
        'DUPLICATE_JOINT_MEMBER',
        'A paired joint cannot use the same body for both members.'
      ));
    }
    memberKeys.add(key);
  });

  for (const [name, value] of [
    ['side clearance', params.sideClearance],
    ['end clearance', params.endClearance],
  ] as const) {
    if (value === undefined || !Number.isFinite(value)) {
      diagnostics.push(error(
        'INVALID_CLEARANCE',
        `Joint ${name} must be an explicit finite number (use zero for nominal fit).`
      ));
    }
  }
  for (const [name, value] of [
    ['width', params.width],
    ['depth', params.depth],
    ['length', params.length],
    ['kerf', params.kerf],
    ['chamfer width', params.chamferWidth],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      diagnostics.push(error(
        'INVALID_JOINT_DIMENSION',
        `Joint ${name} must be finite and greater than zero.`
      ));
    }
  }
  if (params.offset !== undefined && !Number.isFinite(params.offset)) {
    diagnostics.push(error(
      'INVALID_JOINT_DIMENSION',
      'Joint offset must be a finite number.'
    ));
  }
  if (params.keep !== undefined && !['both', 'datumSide', 'oppositeSide'].includes(params.keep)) {
    diagnostics.push(error('INVALID_SAW_KEEP', 'Saw cut keep mode must be both, datumSide, or oppositeSide.'));
  }
  if (params.resultMode !== undefined && !['trim', 'split'].includes(params.resultMode)) {
    diagnostics.push(error('INVALID_JOINT_RESULT_MODE', 'Result mode must be trim or split.'));
  }
  if (
    params.definition
    && params.kind
    && params.definition.kind !== params.kind
  ) {
    diagnostics.push(error(
      'MISMATCHED_JOINT_DEFINITION',
      'The typed joint definition must match the selected joint kind.'
    ));
  } else if (params.kind && WOOD_JOINT_KINDS.includes(params.kind)) {
    if (
      params.definition?.kind === 'threeWayMiter'
      && (
        !Array.isArray(params.definition.memberAnglesDegrees)
        || params.definition.memberAnglesDegrees.length !== 3
        || !params.definition.memberAnglesDegrees.every(Number.isFinite)
      )
    ) {
      diagnostics.push(error(
        'INVALID_THREE_WAY_ANGLES',
        'Three-way miter requires exactly three finite member angles.'
      ));
    }
    if (
      params.definition?.kind === 'chamfer'
      && (
        !Array.isArray(params.definition.edgeIds)
        || !params.definition.edgeIds.every((edgeId) => typeof edgeId === 'string' && edgeId)
      )
    ) {
      diagnostics.push(error(
        'INVALID_CHAMFER_EDGE_LIST',
        'Chamfer edge selections must be a list of stable edge references.'
      ));
    }
    const definition = normalizeWoodJointDefinition(
      params.kind,
      params.definition,
      params.definition ? {} : params
    );
    diagnostics.push(...validateWoodJointDefinition(definition).map((diagnostic) =>
      error(diagnostic.code, diagnostic.message)
    ));
  }
  return diagnostics;
}

export function createWoodJointFeature(
  params: Omit<WoodJointParams, 'sideClearance' | 'endClearance'> &
    Partial<Pick<WoodJointParams, 'sideClearance' | 'endClearance'>>,
  name = woodJointDisplayName(params.kind)
): FeatureRecord {
  const definition = normalizeWoodJointDefinition(
    params.kind,
    params.definition,
    params.definition ? {} : params
  );
  const compatibility = definitionCompatibilityFields(definition);
  const normalized: WoodJointParams = {
    ...defaultWoodJointParams,
    ...params,
    ...compatibility,
    members: params.members.map(cloneMemberRef),
    sideClearance: params.sideClearance ?? 0,
    endClearance: params.endClearance ?? 0,
    definition,
    width: compatibility.width,
    depth: compatibility.depth,
    length: compatibility.length,
    offset: compatibility.offset,
    kerf: compatibility.kerf,
    keep: compatibility.keep,
    chamferWidth: compatibility.chamferWidth,
    resultMode: compatibility.resultMode,
    angleDegrees: compatibility.angleDegrees,
  };
  return createFeatureRecord(
    WOOD_JOINT_FEATURE_TYPE,
    name,
    normalized as unknown as Record<string, unknown>,
    {
      refsIn: [...new Set(normalized.members.map((member) => member.bodyRef.featureId))].sort(),
    }
  );
}

export function planWoodJoint(
  feature: FeatureRecord,
  context: RebuildContext
): WoodJointPlanResult {
  const internal = createInternalPlan(feature, context);
  return internal.ok ? { ok: true, plan: internal.plan.publicPlan } : internal;
}

export type WoodJointExplodedPreviewResult =
  | { ok: true; plan: WoodJointExplodedPreviewPlan }
  | { ok: false; error: string; diagnostics: Diagnostic[] };

export function createWoodJointExplodedPreviewPlan(
  feature: FeatureRecord,
  context: RebuildContext,
  distance?: number
): WoodJointExplodedPreviewResult {
  if (distance !== undefined && (!Number.isFinite(distance) || distance <= 0)) {
    return featureFailure(
      feature.id,
      'INVALID_EXPLODED_DISTANCE',
      'Exploded preview distance must be finite and greater than zero.'
    );
  }
  const internal = createInternalPlan(feature, context);
  if (!internal.ok) return internal;
  return {
    ok: true,
    plan: buildExplodedPreviewPlan(
      internal.plan.params,
      internal.plan.members,
      distance
    ),
  };
}

export function getWoodJointManufacturingOperations(
  feature: FeatureRecord,
  context: RebuildContext
): ManufacturingOperation[] {
  const result = planWoodJoint(feature, context);
  return result.ok ? result.plan.manufacturingOperations : [];
}

export function rebuildWoodJoint(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const internalResult = createInternalPlan(feature, context);
  if (!internalResult.ok) return internalResult;
  const { plan } = internalResult;

  switch (plan.params.kind) {
    case 'mortiseTenon':
    case 'bridle':
      return rebuildMortiseTenon(feature, plan);
    case 'dado':
    case 'groove':
    case 'rabbet':
    case 'notch':
      return rebuildOverlapHousing(feature, plan);
    case 'crossLap':
    case 'endLap':
    case 'halfLap':
      return rebuildLap(feature, plan);
    case 'sawCut':
      return rebuildSawCut(feature, plan);
    case 'chamfer':
      return rebuildChamfer(feature, plan);
    case 'threeWayMiter':
      return rebuildThreeWayMiterJoint(feature, context, plan);
  }
}

function createInternalPlan(
  feature: FeatureRecord,
  context: RebuildContext
): { ok: true; plan: InternalPlan } | { ok: false; error: string; diagnostics: Diagnostic[] } {
  const params = normalizeWoodJointParams(feature);
  const diagnostics = validateWoodJointParams(params);
  if (diagnostics.length > 0) {
    return failure('Invalid woodworking joint parameters', withFeatureId(diagnostics, feature.id));
  }

  const members: ResolvedMember[] = [];
  for (const member of params.members) {
    const bodyResult = resolvePlacementBody(context, member.bodyRef, feature.id);
    if (!bodyResult.ok) {
      return failure(bodyResult.diagnostic.message, [bodyResult.diagnostic]);
    }
    const frameResult = resolvePlacementFrame(context, member.datumRef, feature.id);
    if (!frameResult.ok) {
      return failure(frameResult.diagnostic.message, [frameResult.diagnostic]);
    }
    members.push({
      ref: member,
      body: bodyResult.value,
      frame: frameResult.value,
      bounds: getBodyBoundingBox(bodyResult.value),
    });
  }

  const needsOverlap = !['sawCut', 'chamfer', 'threeWayMiter'].includes(params.kind);
  let overlap = members.length >= 2
    ? intersectBounds(members[0]!.bounds, members[1]!.bounds)
    : undefined;
  let endJointReceiverOffset: [number, number, number] | undefined;
  if (
    !overlap
    && (params.kind === 'mortiseTenon' || params.kind === 'bridle')
  ) {
    const endJointBounds = deriveEndJointWorkingBounds(feature, params, members);
    if (!endJointBounds.ok) return endJointBounds;
    overlap = endJointBounds.bounds;
    endJointReceiverOffset = endJointBounds.receiverOffset;
  }
  if (
    needsOverlap
    && (
      !overlap
      || boundsVolume(overlap) <= DEFAULT_TOLERANCE_POLICY.linear ** 3
    )
  ) {
    return featureFailure(
      feature.id,
      'INSUFFICIENT_STOCK',
      'The selected members do not contain a positive rectangular overlap for this joint.'
    );
  }

  const planCheck = validateResolvedPlan(feature, params, members, overlap);
  if (planCheck) return planCheck;

  const closureResult = params.kind === 'threeWayMiter'
    ? resolveThreeWayMiterClosure(feature, params, members)
    : null;
  if (closureResult && !closureResult.ok) return closureResult;

  const operations = createManufacturingOperations(feature.id, params, members, overlap);
  const edits = createEditPlans(
    feature.id,
    params,
    members,
    overlap,
    endJointReceiverOffset
  );
  const computedDefaults = computeWoodJointDefaults(params, members, overlap);
  const publicPlan: WoodJointPlan = {
    featureId: feature.id,
    kind: params.kind,
    edits,
    manufacturingOperations: sortManufacturingOperations(operations),
    replacedBodyIds: members.map((member) => member.body.id),
    computedDefaults,
    explodedPreview: buildExplodedPreviewPlan(params, members),
    ...(closureResult?.ok ? { threeWayClosure: closureResult.closure } : {}),
    executable: true,
  };
  return {
    ok: true,
    plan: {
      publicPlan,
      params,
      members,
      ...(overlap ? { overlap } : {}),
      ...(endJointReceiverOffset ? { endJointReceiverOffset } : {}),
    },
  };
}

function validateResolvedPlan(
  feature: FeatureRecord,
  params: WoodJointParams,
  members: ResolvedMember[],
  overlap: AxisAlignedBounds | undefined
): { ok: false; error: string; diagnostics: Diagnostic[] } | null {
  if (params.kind === 'chamfer' && members[0]!.ref.datumRef.kind !== 'edge') {
    return featureFailure(
      feature.id,
      'CHAMFER_REQUIRES_EDGE_DATUM',
      'A chamfer requires an exact edge datum.'
    );
  }
  if (
    ['mortiseTenon', 'bridle', 'sawCut', 'threeWayMiter'].includes(params.kind)
    && members.some((member) => member.ref.datumRef.kind !== 'face')
  ) {
    return featureFailure(
      feature.id,
      'JOINT_REQUIRES_FACE_DATUM',
      `${woodJointDisplayName(params.kind)} requires exact planar face datums.`
    );
  }
  if (
    params.kind === 'threeWayMiter'
    && members.some((member) => !member.ref.cornerVertexId)
  ) {
    return featureFailure(
      feature.id,
      'MISSING_THREE_WAY_CORNER_REF',
      'Each three-way miter member requires an exact corner vertex reference.'
    );
  }

  if (overlap) {
    const overlapSize = boundsSize(overlap);
    const cleared = overlapSize.map((size) => size + 2 * params.sideClearance);
    if (cleared.some((size) => size <= DEFAULT_TOLERANCE_POLICY.linear)) {
      return featureFailure(
        feature.id,
        'COLLAPSED_CLEARANCE',
        'Side clearance collapses the planned joint removal.'
      );
    }
    const ended = Math.min(...overlapSize) + params.endClearance;
    if (ended <= DEFAULT_TOLERANCE_POLICY.linear) {
      return featureFailure(
        feature.id,
        'COLLAPSED_CLEARANCE',
        'End clearance collapses the planned joint removal.'
      );
    }
  }

  if (params.kind === 'mortiseTenon' || params.kind === 'bridle') {
    const source = members[0]!;
    const receiving = members[1]!;
    const axis = dominantAxis(source.frame.zAxis);
    const receivingAxis = dominantAxis(receiving.frame.zAxis);
    if (
      receivingAxis !== axis
      || dot3(source.frame.zAxis, receiving.frame.zAxis)
        > -1 + DEFAULT_TOLERANCE_POLICY.angular * 10
    ) {
      return featureFailure(
        feature.id,
        'JOINT_DATUM_MISALIGNMENT',
        'Tenon and receiving-face datums must be parallel and outward-facing in opposite directions.'
      );
    }
    const sourceEnd = source.frame.zAxis[axis] > 0
      ? source.bounds.max[axis]
      : source.bounds.min[axis];
    const receivingEnd = receiving.frame.zAxis[axis] > 0
      ? receiving.bounds.max[axis]
      : receiving.bounds.min[axis];
    const sourceBoundsOverlap = coordinateIsOnBoundsEnd(
      sourceEnd,
      overlap!,
      axis
    );
    const receivingBoundsOverlap = coordinateIsOnBoundsEnd(
      receivingEnd,
      overlap!,
      axis
    );
    if (
      Math.abs(source.frame.origin[axis] - sourceEnd)
        > DEFAULT_TOLERANCE_POLICY.operationBounds
      || Math.abs(receiving.frame.origin[axis] - receivingEnd)
        > DEFAULT_TOLERANCE_POLICY.operationBounds
      || !sourceBoundsOverlap
      || !receivingBoundsOverlap
    ) {
      return featureFailure(
        feature.id,
        'INTERFERENCE',
        'Member face datums do not bound the intended overlap; reselect the mating end faces.'
      );
    }
    const crossAxes = otherAxes(axis);
    const sourceSize = boundsSize(source.bounds);
    const width = params.width ?? sourceSize[crossAxes[0]]! / 3;
    const depth = params.kind === 'bridle'
      ? sourceSize[crossAxes[1]]!
      : params.depth ?? sourceSize[crossAxes[1]]! / 3;
    const length = params.length ?? boundsSize(overlap!)[axis]!;
    if (
      width + 2 * params.sideClearance <= DEFAULT_TOLERANCE_POLICY.linear
      || depth + 2 * params.sideClearance <= DEFAULT_TOLERANCE_POLICY.linear
    ) {
      return featureFailure(
        feature.id,
        'COLLAPSED_CLEARANCE',
        'The requested mortise clearance collapses its profile.'
      );
    }
    if (
      width >= sourceSize[crossAxes[0]]! - DEFAULT_TOLERANCE_POLICY.linear
      || (
        params.kind !== 'bridle'
        && depth >= sourceSize[crossAxes[1]]! - DEFAULT_TOLERANCE_POLICY.linear
      )
      || length <= DEFAULT_TOLERANCE_POLICY.linear
      || length >= sourceSize[axis]! - DEFAULT_TOLERANCE_POLICY.linear
      || Math.abs(length - boundsSize(overlap!)[axis]!)
        > DEFAULT_TOLERANCE_POLICY.operationBounds
    ) {
      return featureFailure(
        feature.id,
        'INSUFFICIENT_STOCK',
        'The selected member stock is too small for the requested tenon, or its overlap does not match the tenon length.'
      );
    }
    const definition = params.definition;
    const widthOffset = definition?.kind === 'mortiseTenon'
      ? definition.widthOffset
      : definition?.kind === 'bridle' ? definition.offset : 0;
    const thicknessOffset = definition?.kind === 'mortiseTenon'
      ? definition.thicknessOffset
      : 0;
    const center = boundsCenter(overlap!);
    const profileBounds = cloneBounds(overlap!);
    profileBounds.min[crossAxes[0]] = center[crossAxes[0]] + widthOffset - width / 2;
    profileBounds.max[crossAxes[0]] = center[crossAxes[0]] + widthOffset + width / 2;
    profileBounds.min[crossAxes[1]] = center[crossAxes[1]] + thicknessOffset - depth / 2;
    profileBounds.max[crossAxes[1]] = center[crossAxes[1]] + thicknessOffset + depth / 2;
    const receiverProfile = cloneBounds(profileBounds);
    receiverProfile.min[crossAxes[0]] -= params.sideClearance;
    receiverProfile.max[crossAxes[0]] += params.sideClearance;
    if (params.kind !== 'bridle') {
      receiverProfile.min[crossAxes[1]] -= params.sideClearance;
      receiverProfile.max[crossAxes[1]] += params.sideClearance;
    }
    if (
      !crossSectionContains(source.bounds, profileBounds, crossAxes)
      || !crossSectionContains(receiving.bounds, receiverProfile, crossAxes)
    ) {
      return featureFailure(
        feature.id,
        'JOINT_POSITION_OUT_OF_BOUNDS',
        'The requested joint position or fit allowance falls outside the selected member end; reduce its offsets or dimensions.'
      );
    }
    if (!isAxisAlignedBox(source.body)) {
      return featureFailure(
        feature.id,
        'UNSUPPORTED_STOCK',
        'The guarded tenon executor requires rectangular prismatic source stock.'
      );
    }
    if (
      params.kind === 'bridle'
      && Math.abs(
        sourceSize[crossAxes[1]]!
        - boundsSize(members[1]!.bounds)[crossAxes[1]]!
      ) > DEFAULT_TOLERANCE_POLICY.operationBounds
    ) {
      return featureFailure(
        feature.id,
        'INSUFFICIENT_STOCK',
        'A guarded bridle requires equal member thickness through its open slot.'
      );
    }
  }

  if (['crossLap', 'endLap', 'halfLap'].includes(params.kind)) {
    const axis = dominantAxis(members[0]!.frame.zAxis);
    const available = boundsSize(overlap!)[axis]!;
    const depth = params.depth ?? available / 2;
    if (
      depth <= DEFAULT_TOLERANCE_POLICY.linear
      || depth >= available - DEFAULT_TOLERANCE_POLICY.linear
    ) {
      return featureFailure(
        feature.id,
        'INSUFFICIENT_STOCK',
        'Lap depth must leave positive stock on both complementary members.'
      );
    }
  }
  return null;
}

function computeWoodJointDefaults(
  params: WoodJointParams,
  members: ResolvedMember[],
  overlap: AxisAlignedBounds | undefined
): WoodJointComputedDefaults {
  const first = members[0]!;
  const memberSize = boundsSize(first.bounds);
  const axis = dominantAxis(first.frame.zAxis);
  const crossAxes = otherAxes(axis);
  const overlapSize = overlap ? boundsSize(overlap) : memberSize;

  switch (params.kind) {
    case 'mortiseTenon': {
      const width = params.width ?? memberSize[crossAxes[0]]! / 3;
      const depth = params.depth ?? memberSize[crossAxes[1]]! / 3;
      return {
        width,
        depth,
        length: params.length ?? overlapSize[axis],
        haunchWidth: width / 3,
        haunchDepth: depth / 2,
      };
    }
    case 'bridle':
      return {
        width: params.width ?? memberSize[crossAxes[0]]! / 3,
        depth: memberSize[crossAxes[1]],
        length: params.length ?? overlapSize[axis],
        offset: params.offset ?? 0,
      };
    case 'dado':
    case 'groove':
    case 'rabbet':
    case 'notch':
      return {
        width: params.width ?? overlapSize[crossAxes[0]],
        depth: params.depth ?? overlapSize[axis] / 2,
        offset: params.offset ?? 0,
      };
    case 'crossLap':
    case 'endLap':
    case 'halfLap':
      return {
        width: params.width ?? overlapSize[crossAxes[0]],
        depth: params.depth ?? overlapSize[axis] / 2,
        offset: params.offset ?? 0,
      };
    case 'sawCut':
      return {
        offset: params.offset ?? memberSize[axis] / 2,
        kerf: params.kerf ?? defaultWoodJointParams.kerf ?? 0.125,
      };
    case 'chamfer':
      return {
        chamferDistance: params.chamferWidth
          ?? Math.min(...memberSize) / 4,
      };
    case 'threeWayMiter':
      return { offset: params.offset ?? 0 };
  }
}

function buildExplodedPreviewPlan(
  params: WoodJointParams,
  members: ResolvedMember[],
  requestedDistance?: number
): WoodJointExplodedPreviewPlan {
  const configuredDistance = params.definition?.kind === 'threeWayMiter'
    ? params.definition.explodedDistance
    : undefined;
  const stockScale = Math.max(
    ...members.flatMap((member) => boundsSize(member.bounds))
  );
  const distance = requestedDistance ?? configuredDistance ?? stockScale * 0.25;
  return {
    distance,
    authoritative: false,
    members: members.map((member, memberIndex) => {
      const direction = normalizedDirection(member.frame.zAxis);
      const translation = scale3(direction, distance);
      return {
        memberIndex,
        role: memberRole(memberIndex),
        bodyId: member.body.id,
        direction,
        distance,
        transform: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          translation[0], translation[1], translation[2], 1,
        ],
      };
    }),
  };
}

type ThreeWayClosureResult =
  | { ok: true; closure: ThreeWayMiterClosure }
  | { ok: false; error: string; diagnostics: Diagnostic[] };

function resolveThreeWayMiterClosure(
  feature: FeatureRecord,
  params: WoodJointParams,
  members: ResolvedMember[]
): ThreeWayClosureResult {
  const definitionCandidate = params.definition?.kind === 'threeWayMiter'
    ? params.definition
    : createDefaultWoodJointDefinition('threeWayMiter', params);
  if (definitionCandidate.kind !== 'threeWayMiter') {
    return featureFailure(
      feature.id,
      'MISMATCHED_JOINT_DEFINITION',
      'Three-way closure requires a three-way miter definition.'
    );
  }
  const definition = definitionCandidate;
  const roles: ThreeWayMiterRoleGeometry[] = [];
  for (const [memberIndex, member] of members.entries()) {
    const cornerVertexId = member.ref.cornerVertexId!;
    const corner = member.body.vertices.get(cornerVertexId);
    if (!corner) {
      return featureFailure(
        feature.id,
        'THREE_WAY_CORNER_LOST',
        `Member ${String.fromCharCode(65 + memberIndex)} corner no longer exists.`,
        cornerVertexId
      );
    }
    const datum = member.ref.datumRef as FacePlacementRef;
    const face = member.body.faces.get(datum.faceId);
    const faceVertexIds = new Set(
      face?.boundaryEdgeIds.flatMap((edgeId) =>
        member.body.edges.get(edgeId)?.vertexIds ?? []
      ) ?? []
    );
    if (!faceVertexIds.has(cornerVertexId)) {
      return featureFailure(
        feature.id,
        'THREE_WAY_CORNER_NOT_ON_DATUM',
        `Member ${String.fromCharCode(65 + memberIndex)} corner is not on its selected end face.`,
        cornerVertexId
      );
    }
    roles.push({
      memberIndex,
      role: memberRole(memberIndex),
      bodyId: member.body.id,
      cornerVertexId,
      corner: [...corner.position],
      endAxis: normalizedDirection(member.frame.zAxis),
      angleDegrees: definition.memberAnglesDegrees[memberIndex] ?? 45,
    });
  }

  const jointPoint: [number, number, number] = [0, 0, 0];
  for (const role of roles) {
    jointPoint[0] += role.corner[0] / roles.length;
    jointPoint[1] += role.corner[1] / roles.length;
    jointPoint[2] += role.corner[2] / roles.length;
  }
  const maximumGap = Math.max(
    ...roles.map((role) => vectorLength(subtract3(role.corner, jointPoint)))
  );
  if (maximumGap > definition.closureTolerance) {
    return featureFailure(
      feature.id,
      'THREE_WAY_CLOSURE_GAP',
      `Three-way end datums miss by ${maximumGap.toPrecision(6)}; closure tolerance is ${definition.closureTolerance.toPrecision(6)}.`
    );
  }

  const determinant = roles.length === 3
    ? Math.abs(dot3(roles[0]!.endAxis, cross3(roles[1]!.endAxis, roles[2]!.endAxis)))
    : 1;
  if (roles.length === 3 && determinant <= DEFAULT_TOLERANCE_POLICY.angular * 10) {
    return featureFailure(
      feature.id,
      'THREE_WAY_INTERFERENCE',
      'Three-way member end axes are coplanar or parallel, so the complementary cuts cannot close without interference.'
    );
  }

  return {
    ok: true,
    closure: {
      jointPoint,
      maximumGap,
      tolerance: definition.closureTolerance,
      determinant,
      roles,
    },
  };
}

function memberRole(memberIndex: number): WoodJointMemberRole {
  if (memberIndex === 0) return 'memberA';
  if (memberIndex === 1) return 'memberB';
  return 'memberC';
}

function normalizedDirection(
  value: readonly [number, number, number]
): [number, number, number] {
  const length = vectorLength(value);
  if (length <= DEFAULT_TOLERANCE_POLICY.angular) return [0, 0, 1];
  return value.map((component) => {
    const normalized = component / length;
    return Math.abs(normalized) <= Number.EPSILON ? 0 : normalized;
  }) as [number, number, number];
}

function vectorLength(value: readonly [number, number, number]): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function rotateAroundAxis(
  vector: readonly [number, number, number],
  axis: readonly [number, number, number],
  angleRadians: number
): [number, number, number] {
  const unitAxis = normalizedDirection(axis);
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  return normalizedDirection(add3(
    scale3(vector, cosine),
    add3(
      scale3(cross3(unitAxis, vector), sine),
      scale3(unitAxis, dot3(unitAxis, vector) * (1 - cosine))
    )
  ));
}

function rebuildOverlapHousing(
  feature: FeatureRecord,
  plan: InternalPlan
): RebuildHandlerResult {
  const target = plan.members[0]!;
  const partner = plan.members[1]!;
  const cutterBounds = expandBounds(
    plan.overlap!,
    plan.params.sideClearance,
    plan.params.endClearance,
    dominantAxis(target.frame.zAxis)
  );
  if (boundsContain(cutterBounds, target.bounds, DEFAULT_TOLERANCE_POLICY.linear)) {
    return asHandlerFailure(featureFailure(
      feature.id,
      'INSUFFICIENT_STOCK',
      'The planned housing would remove all target stock.'
    ));
  }
  const direct = createNotchedRectangularBody(
    target.body,
    cutterBounds,
    dominantAxis(target.frame.zAxis),
    `${feature.id}:${plan.params.kind}:housing`
  );
  const result = direct.ok
    ? {
        ok: true as const,
        bodies: [direct.body],
        diagnostics: [],
        replacedBodyIds: [target.body.id],
      }
    : differenceBodies(
        feature.id,
        `${plan.params.kind}:housing`,
        target.body,
        [boxFromBounds(cutterBounds, `${feature.id}:housing-cutter`)],
        false
      );
  if (!result.ok) return result;
  return {
    ok: true,
    bodies: [
      preserveBodyProperties(target.body, result.bodies[0]!, target.body.id),
      partner.body,
    ],
    diagnostics: [],
    replacedBodyIds: [target.body.id, partner.body.id],
  };
}

function rebuildMortiseTenon(
  feature: FeatureRecord,
  plan: InternalPlan
): RebuildHandlerResult {
  const tenonMember = plan.members[0]!;
  const mortiseMember = plan.members[1]!;
  const overlap = plan.overlap!;
  const axis = dominantAxis(tenonMember.frame.zAxis);
  const crossAxes = otherAxes(axis);
  const sourceSize = boundsSize(tenonMember.bounds);
  const tenonSize = [
    plan.params.width ?? sourceSize[crossAxes[0]]! / 3,
    plan.params.kind === 'bridle'
      ? sourceSize[crossAxes[1]]!
      : plan.params.depth ?? sourceSize[crossAxes[1]]! / 3,
  ] as const;
  const definition = plan.params.definition;
  const widthOffset = definition?.kind === 'mortiseTenon'
    ? definition.widthOffset
    : definition?.kind === 'bridle' ? definition.offset : 0;
  const thicknessOffset = definition?.kind === 'mortiseTenon'
    ? definition.thicknessOffset
    : 0;
  const overlapCenter = boundsCenter(overlap);
  const tenonBounds = cloneBounds(overlap);
  tenonBounds.min[crossAxes[0]] = overlapCenter[crossAxes[0]] + widthOffset - tenonSize[0] / 2;
  tenonBounds.max[crossAxes[0]] = overlapCenter[crossAxes[0]] + widthOffset + tenonSize[0] / 2;
  tenonBounds.min[crossAxes[1]] = overlapCenter[crossAxes[1]] + thicknessOffset - tenonSize[1] / 2;
  tenonBounds.max[crossAxes[1]] = overlapCenter[crossAxes[1]] + thicknessOffset + tenonSize[1] / 2;
  const nominalTenonBounds = cloneBounds(tenonBounds);

  const mainBounds = cloneBounds(tenonMember.bounds);
  const touchesMaximum = Math.abs(
    tenonMember.frame.origin[axis] - tenonMember.bounds.max[axis]
  )
    <= DEFAULT_TOLERANCE_POLICY.operationBounds;
  const touchesMinimum = Math.abs(
    tenonMember.frame.origin[axis] - tenonMember.bounds.min[axis]
  )
    <= DEFAULT_TOLERANCE_POLICY.operationBounds;
  if (touchesMaximum === touchesMinimum) {
    return asHandlerFailure(featureFailure(
      feature.id,
      'INTERFERENCE',
      'Tenon overlap must occupy exactly one end of its rectangular member.'
    ));
  }
  if (touchesMaximum) mainBounds.max[axis] = overlap.min[axis];
  else mainBounds.min[axis] = overlap.max[axis];
  const unionOverlap = DEFAULT_TOLERANCE_POLICY.throughAllExtension;
  if (touchesMaximum) tenonBounds.min[axis] -= unionOverlap;
  else tenonBounds.max[axis] += unionOverlap;
  const mainBody = boxFromBounds(mainBounds, tenonMember.body.id);
  const tenonTool = boxFromBounds(tenonBounds, `${feature.id}:tenon`);
  const tenonResult = unionBodies(feature.id, 'tenon', mainBody, tenonTool);
  if (!tenonResult.ok) return tenonResult;

  const mortiseAxisDirection = Math.sign(mortiseMember.frame.zAxis[axis]) || 1;
  const mortiseNominalBounds = plan.endJointReceiverOffset
    ? translateBounds(nominalTenonBounds, plan.endJointReceiverOffset)
    : nominalTenonBounds;
  const mortiseBounds = expandMortiseBounds(
    mortiseNominalBounds,
    plan.params.sideClearance,
    plan.params.endClearance,
    axis,
    mortiseAxisDirection
  );
  if (plan.params.kind === 'bridle') {
    mortiseBounds.min[crossAxes[1]] = mortiseMember.bounds.min[crossAxes[1]];
    mortiseBounds.max[crossAxes[1]] = mortiseMember.bounds.max[crossAxes[1]];
  }
  const directBridle = plan.params.kind === 'bridle'
    ? createNotchedRectangularBody(
        mortiseMember.body,
        mortiseBounds,
        axis,
        `${feature.id}:bridle-slot`
      )
    : null;
  const mortiseResult = directBridle?.ok
    ? {
        ok: true as const,
        bodies: [directBridle.body],
        diagnostics: [],
        replacedBodyIds: [mortiseMember.body.id],
      }
    : differenceBodies(
        feature.id,
        'mortise',
        mortiseMember.body,
        [boxFromBounds(mortiseBounds, `${feature.id}:mortise-cutter`)],
        false
      );
  if (!mortiseResult.ok) return mortiseResult;

  return {
    ok: true,
    bodies: [
      preserveBodyProperties(tenonMember.body, tenonResult.bodies[0]!, tenonMember.body.id),
      preserveBodyProperties(mortiseMember.body, mortiseResult.bodies[0]!, mortiseMember.body.id),
    ],
    diagnostics: [],
    replacedBodyIds: [tenonMember.body.id, mortiseMember.body.id],
  };
}

function rebuildLap(
  feature: FeatureRecord,
  plan: InternalPlan
): RebuildHandlerResult {
  const first = plan.members[0]!;
  const second = plan.members[1]!;
  const overlap = plan.overlap!;
  const axis = dominantAxis(first.frame.zAxis);
  const direction = Math.sign(first.frame.zAxis[axis]) || 1;
  const available = boundsSize(overlap)[axis]!;
  const depth = plan.params.depth ?? available / 2;
  const split = direction > 0 ? overlap.max[axis] - depth : overlap.min[axis] + depth;
  const firstCut = expandBounds(cloneBounds(overlap), plan.params.sideClearance, 0, axis);
  const secondCut = expandBounds(cloneBounds(overlap), plan.params.sideClearance, 0, axis);
  if (direction > 0) {
    firstCut.min[axis] = split;
    secondCut.max[axis] = split;
  } else {
    firstCut.max[axis] = split;
    secondCut.min[axis] = split;
  }

  const firstResult = createNotchedRectangularBody(
    first.body,
    firstCut,
    axis,
    `${feature.id}:${plan.params.kind}:first`
  );
  if (!firstResult.ok) {
    return asHandlerFailure(featureFailure(
      feature.id,
      firstResult.code,
      firstResult.message
    ));
  }
  const secondResult = createNotchedRectangularBody(
    second.body,
    secondCut,
    axis,
    `${feature.id}:${plan.params.kind}:second`
  );
  if (!secondResult.ok) {
    return asHandlerFailure(featureFailure(
      feature.id,
      secondResult.code,
      secondResult.message
    ));
  }

  return {
    ok: true,
    bodies: [
      preserveBodyProperties(first.body, firstResult.body, first.body.id),
      preserveBodyProperties(second.body, secondResult.body, second.body.id),
    ],
    diagnostics: [],
    replacedBodyIds: [first.body.id, second.body.id],
  };
}

function rebuildSawCut(
  feature: FeatureRecord,
  plan: InternalPlan
): RebuildHandlerResult {
  const member = plan.members[0]!;
  const datumFrame = member.frame;
  const datumProjections = [...member.body.vertices.values()].map((vertex) =>
    projectToFrame(datumFrame, vertex.position)
  );
  const datumMinDepth = Math.min(...datumProjections.map((point) => point[2]));
  const datumMaxDepth = Math.max(...datumProjections.map((point) => point[2]));
  const stockDepth = datumMaxDepth - datumMinDepth;
  const kerf = plan.params.kerf ?? defaultWoodJointParams.kerf!;
  const offset = plan.params.offset ?? stockDepth / 2;
  const faceDepth = Math.abs(datumMaxDepth) <= Math.abs(datumMinDepth)
    ? datumMaxDepth
    : datumMinDepth;
  const inwardSign = faceDepth === datumMaxDepth ? -1 : 1;
  const anchor = add3(
    datumFrame.origin,
    scale3(datumFrame.zAxis, faceDepth + inwardSign * offset)
  );
  const angleDegrees = plan.params.angleDegrees ?? 90;
  const cutNormal = rotateAroundAxis(
    normalizedDirection(datumFrame.zAxis),
    normalizedDirection(datumFrame.xAxis),
    (90 - angleDegrees) * Math.PI / 180
  );
  const cutU = normalizedDirection(datumFrame.xAxis);
  const cutV = normalizedDirection(cross3(cutNormal, cutU));
  const cutFrame = {
    origin: anchor,
    xAxis: cutU,
    yAxis: cutV,
    zAxis: cutNormal,
  };
  const projections = [...member.body.vertices.values()].map((vertex) =>
    projectToFrame(cutFrame, vertex.position)
  );
  const minU = Math.min(...projections.map((point) => point[0]));
  const maxU = Math.max(...projections.map((point) => point[0]));
  const minV = Math.min(...projections.map((point) => point[1]));
  const maxV = Math.max(...projections.map((point) => point[1]));
  const minDepth = Math.min(...projections.map((point) => point[2]));
  const maxDepth = Math.max(...projections.map((point) => point[2]));
  if (
    minDepth >= -kerf / 2 - DEFAULT_TOLERANCE_POLICY.linear
    || maxDepth <= kerf / 2 + DEFAULT_TOLERANCE_POLICY.linear
  ) {
    return asHandlerFailure(featureFailure(
      feature.id,
      'INSUFFICIENT_STOCK',
      'Saw offset and kerf must leave positive stock on both sides of the cut.'
    ));
  }

  const directCut = splitSawKerfFromConvexStock(
    feature.id,
    member.body,
    anchor,
    cutNormal,
    kerf
  );
  const cut = directCut.ok ? directCut : (() => {
    const margin = Math.max(DEFAULT_TOLERANCE_POLICY.linear * 100, kerf);
    const toolResult = createPrismaticBody({
      id: `${feature.id}:saw-tool`,
      name: 'Saw kerf',
      operationId: `${feature.id}:saw-tool`,
      frame: coordinateFrameAsPrismatic(cutFrame),
      region: {
        outer: [
          [minU - margin, minV - margin],
          [maxU + margin, minV - margin],
          [maxU + margin, maxV + margin],
          [minU - margin, maxV + margin],
        ],
        holes: [],
      },
      minDepth: -kerf / 2,
      maxDepth: kerf / 2,
    });
    return toolResult.ok
      ? differenceBodies(feature.id, 'saw', member.body, [toolResult.body], true)
      : booleanFailure(feature.id, toolResult.diagnostics);
  })();
  if (!cut.ok) return cut;
  if (cut.bodies.length !== 2) {
    return asHandlerFailure(featureFailure(
      feature.id,
      'SAW_SPLIT_FAILED',
      `Saw cut expected two stock pieces but produced ${cut.bodies.length}.`
    ));
  }

  const keep = plan.params.keep ?? 'both';
  const sorted = [...cut.bodies].sort((left, right) => {
    const leftDepth = bodyCenterDepth(left, datumFrame);
    const rightDepth = bodyCenterDepth(right, datumFrame);
    return leftDepth - rightDepth || left.id.localeCompare(right.id);
  });
  const datumSide = faceDepth === datumMaxDepth ? sorted[1]! : sorted[0]!;
  const oppositeSide = faceDepth === datumMaxDepth ? sorted[0]! : sorted[1]!;
  let kept: Body[];
  if (keep === 'datumSide') kept = [datumSide];
  else if (keep === 'oppositeSide') kept = [oppositeSide];
  else kept = sorted;

  const inherited = kept.map((body, index) => preserveBodyProperties(
    member.body,
    body,
    kept.length === 1 || body.id === member.body.id
      ? member.body.id
      : `${feature.id}:saw-piece:${index + 1}`
  ));
  return {
    ok: true,
    bodies: inherited,
    diagnostics: [],
    replacedBodyIds: [member.body.id],
  };
}

function splitSawKerfFromConvexStock(
  featureId: string,
  body: Body,
  anchor: [number, number, number],
  normal: [number, number, number],
  kerf: number
): RebuildHandlerResult {
  const firstPlane = createPlane(
    add3(anchor, scale3(normal, -kerf / 2)),
    normal
  );
  const first = splitConvexBodyByPlane(body, firstPlane, {
    topologyPrefix: `${featureId}:saw:first`,
    negativeBodyId: body.id,
    positiveBodyId: `${featureId}:saw:intermediate`,
    negativeName: `${body.name} saw piece 1`,
    positiveName: `${body.name} saw remainder`,
  });
  if (!first.ok) {
    return featureFailure(featureId, first.code, first.message);
  }
  const secondPlane = createPlane(
    add3(anchor, scale3(normal, kerf / 2)),
    normal
  );
  const second = splitConvexBodyByPlane(first.positive, secondPlane, {
    topologyPrefix: `${featureId}:saw:second`,
    negativeBodyId: `${featureId}:saw:kerf`,
    positiveBodyId: `${featureId}:saw-piece:2`,
    negativeName: `${body.name} saw kerf`,
    positiveName: `${body.name} saw piece 2`,
  });
  if (!second.ok) {
    return featureFailure(featureId, second.code, second.message);
  }
  return {
    ok: true,
    bodies: [first.negative, second.positive],
    diagnostics: [],
    replacedBodyIds: [body.id],
  };
}

function rebuildChamfer(
  feature: FeatureRecord,
  plan: InternalPlan
): RebuildHandlerResult {
  const member = plan.members[0]!;
  const datum = member.ref.datumRef as EdgePlacementRef;
  const definition = plan.params.definition?.kind === 'chamfer'
    ? plan.params.definition
    : createDefaultWoodJointDefinition('chamfer', plan.params);
  if (definition.kind !== 'chamfer') {
    return asHandlerFailure(featureFailure(
      feature.id,
      'MISMATCHED_JOINT_DEFINITION',
      'Chamfer requires a chamfer definition.'
    ));
  }
  const edgeIds = [
    datum.edgeId,
    ...definition.edgeIds.filter((edgeId) => edgeId !== datum.edgeId),
  ];
  const edgePoints: [number, number, number][] = [];
  let edgeAxis: Axis | null = null;
  for (const edgeId of edgeIds) {
    const edge = member.body.edges.get(edgeId);
    if (!edge || edge.faceIds.length !== 2) {
      return asHandlerFailure(featureFailure(
        feature.id,
        'BROKEN_CHAMFER_EDGE_REF',
        'Every selected chamfer edge must exist and have exactly two adjacent planar faces.',
        edgeId
      ));
    }
    const start = member.body.vertices.get(edge.vertexIds[0]);
    const end = member.body.vertices.get(edge.vertexIds[1]);
    const planes = edge.faceIds
      .map((faceId) => member.body.faces.get(faceId))
      .map((face) => face ? member.body.planes.get(face.planeId) : undefined);
    if (!start || !end || !planes[0] || !planes[1]) {
      return asHandlerFailure(featureFailure(
        feature.id,
        'BROKEN_CHAMFER_EDGE_REF',
        'A selected chamfer edge has incomplete topology.',
        edgeId
      ));
    }
    if (
      Math.abs(dot3(planes[0].normal, planes[1].normal))
        > DEFAULT_TOLERANCE_POLICY.angular * 10
    ) {
      return asHandlerFailure(featureFailure(
        feature.id,
        'UNSUPPORTED_CHAMFER_EDGE',
        'The guarded chamfer core supports perpendicular planar edge faces.',
        edgeId
      ));
    }
    const candidateAxis = dominantAxis(subtract3(end.position, start.position));
    if (edgeAxis !== null && candidateAxis !== edgeAxis) {
      return asHandlerFailure(featureFailure(
        feature.id,
        'INCOMPATIBLE_CHAMFER_EDGES',
        'All edges in one chamfer must be parallel.',
        edgeId
      ));
    }
    edgeAxis = candidateAxis;
    edgePoints.push([...start.position]);
  }
  const width = plan.params.chamferWidth ?? plan.params.width
    ?? Math.min(...boundsSize(member.bounds)) / 4;
  if (width <= DEFAULT_TOLERANCE_POLICY.linear) {
    return asHandlerFailure(featureFailure(
      feature.id,
      'COLLAPSED_CLEARANCE',
      'Chamfer width collapses the triangular removal.'
    ));
  }
  const secondWidth = definition.mode === 'distanceAngle'
    ? width * Math.tan(definition.angleDegrees * Math.PI / 180)
    : width;
  const direct = createChamferedRectangularBody(
    member.body,
    edgeAxis!,
    edgePoints,
    width,
    secondWidth,
    `${feature.id}:chamfer`
  );
  if (!direct.ok) {
    return asHandlerFailure(featureFailure(feature.id, direct.code, direct.message));
  }
  return {
    ok: true,
    bodies: [preserveBodyProperties(member.body, direct.body, member.body.id)],
    diagnostics: [],
    replacedBodyIds: [member.body.id],
  };
}

function rebuildThreeWayMiterJoint(
  feature: FeatureRecord,
  context: RebuildContext,
  plan: InternalPlan
): RebuildHandlerResult {
  const bodies: Body[] = [];
  for (const [index, member] of plan.members.entries()) {
    const datum = member.ref.datumRef as FacePlacementRef;
    const parameters: MiterCutParams = {
      sourceBodyRef: { ...member.ref.bodyRef },
      faceRef: {
        featureId: datum.featureId,
        bodyId: datum.bodyId,
        faceId: datum.faceId,
      },
      angleDegrees: 45,
      inset: plan.params.offset ?? 0,
      tiltAxis: 'u',
      resultMode: plan.params.resultMode ?? 'trim',
      cutStyle: 'threeWay',
      threeWayCorner: 'corner0',
      threeWayVertexId: member.ref.cornerVertexId!,
    };
    const delegated: FeatureRecord = {
      id: `${feature.id}:miter:${index}`,
      type: 'miterCut',
      name: `${feature.name} member ${index + 1}`,
      parameters: parameters as unknown as Record<string, unknown>,
      refsIn: [member.ref.bodyRef.featureId],
      refsOut: [],
      suppressed: false,
    };
    const result = rebuildMiterCut(delegated, context);
    if (!result.ok) {
      return {
        ...result,
        diagnostics: result.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          featureId: feature.id,
        })),
      };
    }
    bodies.push(...result.bodies.map((body) =>
      preserveBodyProperties(member.body, body, body.id)
    ));
  }
  return {
    ok: true,
    bodies,
    diagnostics: [],
    replacedBodyIds: plan.members.map((member) => member.body.id),
  };
}

function differenceBodies(
  featureId: string,
  operationName: string,
  target: Body,
  tools: Body[],
  allowDisconnected: boolean
): RebuildHandlerResult {
  let bodies = [target];
  for (const [toolIndex, tool] of tools.entries()) {
    if (bodies.length !== 1) {
      return asHandlerFailure(featureFailure(
        featureId,
        'DISCONNECTED_JOINT_RESULT',
        `${operationName} disconnected the member before all planned cuts were complete.`
      ));
    }
    const result = executePlanarBoolean({
      operation: 'difference',
      operationId: `${featureId}:${operationName}:${toolIndex}`,
      target: bodies[0]!,
      tools: [tool],
    });
    if (!result.ok) return booleanFailure(featureId, result.diagnostics);
    bodies = result.bodies;
  }
  if (!allowDisconnected && bodies.length !== 1) {
    return asHandlerFailure(featureFailure(
      featureId,
      'DISCONNECTED_JOINT_RESULT',
      `${operationName} would disconnect the member into ${bodies.length} solids.`
    ));
  }
  return {
    ok: true,
    bodies,
    diagnostics: [],
    replacedBodyIds: [target.id],
  };
}

function unionBodies(
  featureId: string,
  operationName: string,
  target: Body,
  tool: Body
): RebuildHandlerResult {
  const result = executePlanarBoolean({
    operation: 'union',
    operationId: `${featureId}:${operationName}`,
    target,
    tools: [tool],
  });
  if (!result.ok) return booleanFailure(featureId, result.diagnostics);
  if (result.bodies.length !== 1) {
    return asHandlerFailure(featureFailure(
      featureId,
      'DISCONNECTED_JOINT_RESULT',
      `${operationName} did not produce one connected member.`
    ));
  }
  return {
    ok: true,
    bodies: result.bodies,
    diagnostics: [],
    replacedBodyIds: [target.id],
  };
}

function createManufacturingOperations(
  featureId: string,
  params: WoodJointParams,
  members: ResolvedMember[],
  overlap: AxisAlignedBounds | undefined
): ManufacturingOperation[] {
  const operationKinds = operationKindsFor(params.kind, members.length);
  const process = processFor(params.kind);
  const inferred = overlap ? boundsSize(overlap) : boundsSize(members[0]!.bounds);
  return operationKinds.map((kind, sequence) => {
    const member = members[Math.min(sequence, members.length - 1)]!;
    const removal: ManufacturingOperation['removal'] = {
      shape: params.kind === 'chamfer'
        ? 'triangularPrism'
        : params.kind === 'sawCut' || params.kind === 'threeWayMiter'
          ? 'planeCut'
          : 'rectangularPrism',
      width: params.width ?? inferred[0],
      depth: params.depth ?? inferred[2],
      length: params.length ?? inferred[1],
      ...(params.kind === 'sawCut' ? { kerf: params.kerf ?? defaultWoodJointParams.kerf! } : {}),
      ...(params.kind === 'sawCut' ? { angleDegrees: params.angleDegrees ?? 90 } : {}),
      ...(params.kind === 'threeWayMiter' ? {
        angleDegrees: params.definition?.kind === 'threeWayMiter'
          ? params.definition.memberAnglesDegrees[sequence] ?? 45
          : 45,
      } : {}),
    };
    return {
      id: `${featureId}:manufacturing:${sequence}:${kind}`,
      featureId,
      memberBodyId: member.body.id,
      kind,
      process,
      sequence,
      datumRef: cloneDatumRef(member.ref.datumRef),
      removal,
      sideClearance: params.sideClearance,
      endClearance: params.endClearance,
    };
  });
}

function createEditPlans(
  featureId: string,
  params: WoodJointParams,
  members: ResolvedMember[],
  overlap: AxisAlignedBounds | undefined,
  endJointReceiverOffset?: readonly [number, number, number]
): WoodJointEditPlan[] {
  const count = ['dado', 'groove', 'rabbet', 'notch', 'sawCut', 'chamfer'].includes(params.kind)
    ? 1
    : members.length;
  return Array.from({ length: count }, (_, memberIndex) => ({
    id: `${featureId}:edit:${memberIndex}`,
    memberIndex,
    bodyId: members[memberIndex]!.body.id,
    operation: params.kind === 'sawCut'
      ? 'split'
      : params.kind === 'threeWayMiter' ? 'miter' : 'difference',
    removal: params.kind === 'chamfer'
      ? 'triangularPrism'
      : params.kind === 'sawCut' || params.kind === 'threeWayMiter'
        ? 'planeCut'
        : 'rectangularPrism',
    ...(overlap ? {
      bounds: memberIndex === 1 && endJointReceiverOffset
        ? translateBounds(overlap, endJointReceiverOffset)
        : cloneBounds(overlap),
    } : {}),
  }));
}

function operationKindsFor(
  kind: WoodJointKind,
  memberCount: number
): ManufacturingOperationKind[] {
  switch (kind) {
    case 'mortiseTenon':
      return ['tenon', 'mortise'];
    case 'bridle':
      return ['tenon', 'bridle'];
    case 'dado':
    case 'groove':
    case 'rabbet':
    case 'notch':
      return [kind];
    case 'crossLap':
    case 'endLap':
    case 'halfLap':
      return ['lap', 'lap'];
    case 'sawCut':
    case 'chamfer':
      return [kind];
    case 'threeWayMiter':
      return Array.from({ length: memberCount }, () => 'miter');
  }
}

function processFor(kind: WoodJointKind): ManufacturingProcess {
  if (kind === 'sawCut' || kind === 'threeWayMiter') return 'saw';
  if (kind === 'chamfer') return 'router';
  if (kind === 'mortiseTenon' || kind === 'bridle') return 'chisel';
  return 'router';
}

function normalizeWoodJointParams(feature: FeatureRecord): WoodJointParams {
  const raw = feature.parameters as Partial<WoodJointParams>;
  const kind = raw.kind as WoodJointKind;
  const definition = createDefaultWoodJointDefinition(kind, raw);
  const normalizedDefinition = normalizeWoodJointDefinition(
    kind,
    raw.definition,
    raw.definition ? {} : raw
  );
  const compatibility = definitionCompatibilityFields(normalizedDefinition);
  return {
    ...defaultWoodJointParams,
    ...raw,
    ...compatibility,
    kind,
    members: Array.isArray(raw.members) ? raw.members.map(cloneMemberRef) : [],
    sideClearance: raw.sideClearance ?? 0,
    endClearance: raw.endClearance ?? 0,
    definition: raw.definition ? normalizedDefinition : definition,
    width: compatibility.width,
    depth: compatibility.depth,
    length: compatibility.length,
    offset: compatibility.offset,
    kerf: compatibility.kerf,
    keep: compatibility.keep,
    chamferWidth: compatibility.chamferWidth,
    resultMode: compatibility.resultMode,
    angleDegrees: compatibility.angleDegrees,
  };
}

function expectedMemberCount(kind: WoodJointKind | undefined): 1 | 2 | 3 {
  if (kind === 'sawCut' || kind === 'chamfer') return 1;
  if (kind === 'threeWayMiter') return 3;
  return 2;
}

function validBodyRef(value: BodyRef | undefined): value is BodyRef {
  return !!value?.featureId && !!value.bodyId;
}

function validDatumRef(value: PlacementDatumRef | undefined): value is PlacementDatumRef {
  if (
    !value
    || !value.featureId
    || !value.bodyId
    || !['body', 'face', 'edge', 'vertex', 'edgePoint', 'faceCenter'].includes(value.kind)
  ) {
    return false;
  }
  if ((value.kind === 'face' || value.kind === 'faceCenter') && !value.faceId) return false;
  if ((value.kind === 'edge' || value.kind === 'edgePoint') && !value.edgeId) return false;
  if (value.kind === 'vertex' && !value.vertexId) return false;
  return value.kind !== 'edgePoint'
    || Number.isFinite(value.parameter)
    && value.parameter >= 0
    && value.parameter <= 1;
}

function cloneMemberRef(member: WoodJointMemberRef): WoodJointMemberRef {
  return {
    bodyRef: { ...member.bodyRef },
    datumRef: cloneDatumRef(member.datumRef),
    ...(member.cornerVertexId !== undefined ? { cornerVertexId: member.cornerVertexId } : {}),
  };
}

function cloneDatumRef<T extends PlacementDatumRef>(datum: T): T {
  return { ...datum } as T;
}

function featureFailure(
  featureId: string,
  code: string,
  message: string,
  entityId?: string
): { ok: false; error: string; diagnostics: Diagnostic[] } {
  return {
    ok: false,
    error: message,
    diagnostics: [error(code, message, featureId, entityId)],
  };
}

function failure(
  message: string,
  diagnostics: Diagnostic[]
): { ok: false; error: string; diagnostics: Diagnostic[] } {
  return { ok: false, error: message, diagnostics };
}

function asHandlerFailure(
  value: { ok: false; error: string; diagnostics: Diagnostic[] }
): RebuildHandlerResult {
  return value;
}

function booleanFailure(
  featureId: string,
  diagnostics: readonly { code: string; message: string; entityIds: readonly string[] }[]
): RebuildHandlerResult {
  const mapped = diagnostics.map((diagnostic) =>
    error(diagnostic.code, diagnostic.message, featureId, diagnostic.entityIds[0])
  );
  return {
    ok: false,
    error: mapped[0]?.message ?? 'Joint Boolean failed.',
    diagnostics: mapped,
  };
}

function withFeatureId(diagnostics: Diagnostic[], featureId: string): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({ ...diagnostic, featureId }));
}

function preserveBodyProperties(source: Body, result: Body, id: string): Body {
  return {
    ...source,
    ...result,
    id,
    name: source.name,
    vertices: result.vertices,
    edges: result.edges,
    faces: result.faces,
    planes: result.planes,
  };
}

type DirectBodyBuildResult =
  | { ok: true; body: Body }
  | { ok: false; code: string; message: string };

function createNotchedRectangularBody(
  source: Body,
  removal: AxisAlignedBounds,
  cutAxis: Axis,
  operationId: string
): DirectBodyBuildResult {
  if (!isAxisAlignedBox(source)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_STOCK',
      message: 'A guarded housing or lap requires rectangular prismatic stock.',
    };
  }
  const sourceBounds = getBodyBoundingBox(source);
  const tolerance = DEFAULT_TOLERANCE_POLICY.operationBounds;
  const touchesMinimum = removal.min[cutAxis] <= sourceBounds.min[cutAxis] + tolerance;
  const touchesMaximum = removal.max[cutAxis] >= sourceBounds.max[cutAxis] - tolerance;
  if (touchesMinimum === touchesMaximum) {
    return {
      ok: false,
      code: 'UNSUPPORTED_JOINT_REMOVAL',
      message: 'The rectangular removal must enter from exactly one stock face.',
    };
  }

  const throughAxis = otherAxes(cutAxis).find((axis) =>
    removal.min[axis] <= sourceBounds.min[axis] + tolerance
    && removal.max[axis] >= sourceBounds.max[axis] - tolerance
  );
  if (throughAxis === undefined) {
    return {
      ok: false,
      code: 'UNSUPPORTED_JOINT_REMOVAL',
      message: 'The guarded rectangular executor requires a removal spanning one stock axis.',
    };
  }
  const profileAxis = ([0, 1, 2] as const).find((axis) =>
    axis !== cutAxis && axis !== throughAxis
  )!;
  const pMin = sourceBounds.min[profileAxis];
  const pMax = sourceBounds.max[profileAxis];
  const qMin = sourceBounds.min[cutAxis];
  const qMax = sourceBounds.max[cutAxis];
  const notchMinP = Math.max(pMin, removal.min[profileAxis]);
  const notchMaxP = Math.min(pMax, removal.max[profileAxis]);
  if (notchMaxP - notchMinP <= DEFAULT_TOLERANCE_POLICY.linear) {
    return {
      ok: false,
      code: 'COLLAPSED_CLEARANCE',
      message: 'The rectangular removal profile has collapsed.',
    };
  }

  const loop = touchesMaximum
    ? compactPlanarLoop([
        [pMin, qMin],
        [pMax, qMin],
        [pMax, qMax],
        [notchMaxP, qMax],
        [notchMaxP, Math.max(qMin, removal.min[cutAxis])],
        [notchMinP, Math.max(qMin, removal.min[cutAxis])],
        [notchMinP, qMax],
        [pMin, qMax],
      ])
    : compactPlanarLoop([
        [pMin, qMin],
        [notchMinP, qMin],
        [notchMinP, Math.min(qMax, removal.max[cutAxis])],
        [notchMaxP, Math.min(qMax, removal.max[cutAxis])],
        [notchMaxP, qMin],
        [pMax, qMin],
        [pMax, qMax],
        [pMin, qMax],
      ]);
  const frame = coordinateAxesFrame(profileAxis, cutAxis);
  const depths = axisDepthRange(sourceBounds, frame.normal);
  return buildTriangulatedPrism(source, operationId, frame, loop, depths);
}

function createChamferedRectangularBody(
  source: Body,
  edgeAxis: Axis,
  edgePoints: readonly [number, number, number][],
  firstWidth: number,
  secondWidth: number,
  operationId: string
): DirectBodyBuildResult {
  if (!isAxisAlignedBox(source)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_STOCK',
      message: 'The guarded chamfer executor requires rectangular prismatic stock.',
    };
  }
  const bounds = getBodyBoundingBox(source);
  const [uAxisIndex, vAxisIndex] = otherAxes(edgeAxis);
  const uMin = bounds.min[uAxisIndex];
  const uMax = bounds.max[uAxisIndex];
  const vMin = bounds.min[vAxisIndex];
  const vMax = bounds.max[vAxisIndex];
  if (
    firstWidth >= uMax - uMin - DEFAULT_TOLERANCE_POLICY.linear
    || firstWidth >= vMax - vMin - DEFAULT_TOLERANCE_POLICY.linear
    || secondWidth >= uMax - uMin - DEFAULT_TOLERANCE_POLICY.linear
    || secondWidth >= vMax - vMin - DEFAULT_TOLERANCE_POLICY.linear
  ) {
    return {
      ok: false,
      code: 'INSUFFICIENT_STOCK',
      message: 'Chamfer width must leave positive stock on both adjacent faces.',
    };
  }

  const corners: [number, number][] = [
    [uMin, vMin],
    [uMax, vMin],
    [uMax, vMax],
    [uMin, vMax],
  ];
  const cornerIndices = edgePoints.map((edgePoint) => corners.findIndex(([u, v]) =>
    Math.abs(edgePoint[uAxisIndex] - u) <= DEFAULT_TOLERANCE_POLICY.linear
    && Math.abs(edgePoint[vAxisIndex] - v) <= DEFAULT_TOLERANCE_POLICY.linear
  ));
  if (cornerIndices.some((cornerIndex) => cornerIndex < 0)) {
    return {
      ok: false,
      code: 'BROKEN_CHAMFER_EDGE_REF',
      message: 'A selected edge is not a stable rectangular stock corner.',
    };
  }
  const selectedCorners = new Set(cornerIndices);
  const profile = corners.flatMap((point, index) =>
    selectedCorners.has(index)
      ? [
          movePlanarPoint(
            point,
            corners[(index + corners.length - 1) % corners.length]!,
            firstWidth
          ),
          movePlanarPoint(
            point,
            corners[(index + 1) % corners.length]!,
            secondWidth
          ),
        ]
      : [point]
  );
  const frame = coordinateAxesFrame(uAxisIndex, vAxisIndex);
  const depths = axisDepthRange(bounds, frame.normal);
  return buildTriangulatedPrism(source, operationId, frame, profile, depths);
}

function buildTriangulatedPrism(
  source: Body,
  operationId: string,
  frame: PrismaticFrame,
  rawLoop: [number, number][],
  depths: [number, number]
): DirectBodyBuildResult {
  const normalized = normalizePlanarRegion({ outer: rawLoop, holes: [] });
  if (!normalized.ok) {
    return {
      ok: false,
      code: normalized.diagnostics[0]?.code ?? 'INVALID_JOINT_PROFILE',
      message: normalized.diagnostics[0]?.message ?? 'The joint profile is invalid.',
    };
  }
  const triangulation = triangulatePlanarRegion(normalized.region);
  if (!triangulation) {
    return {
      ok: false,
      code: 'INVALID_JOINT_PROFILE',
      message: 'The joint profile could not be triangulated deterministically.',
    };
  }

  const body = createBody(source.id, source.name);
  const points = triangulation.points;
  const lowerVertices = points.map((point, index) => {
    const id = `${operationId}:vertex:min:${index}`;
    addVertex(body, createVertex(framePoint(frame, point, depths[0]), id));
    return id;
  });
  const upperVertices = points.map((point, index) => {
    const id = `${operationId}:vertex:max:${index}`;
    addVertex(body, createVertex(framePoint(frame, point, depths[1]), id));
    return id;
  });
  const lowerBoundary = points.map((_, index) => addNamedEdge(
    body,
    lowerVertices[index]!,
    lowerVertices[(index + 1) % points.length]!,
    `${operationId}:edge:min:${index}`
  ));
  const upperBoundary = points.map((_, index) => addNamedEdge(
    body,
    upperVertices[index]!,
    upperVertices[(index + 1) % points.length]!,
    `${operationId}:edge:max:${index}`
  ));
  const verticalEdges = points.map((_, index) => addNamedEdge(
    body,
    lowerVertices[index]!,
    upperVertices[index]!,
    `${operationId}:edge:vertical:${index}`
  ));

  const lowerPlaneId = `${operationId}:plane:min`;
  const upperPlaneId = `${operationId}:plane:max`;
  addPlane(body, createPlane(
    framePoint(frame, [0, 0], depths[0]),
    scale3(frame.normal, -1)
  ), lowerPlaneId);
  addPlane(body, createPlane(
    framePoint(frame, [0, 0], depths[1]),
    frame.normal
  ), upperPlaneId);
  addTriangulatedCapFaces(
    body,
    operationId,
    'min',
    lowerPlaneId,
    lowerVertices,
    lowerBoundary,
    [...triangulation.indices].reverse()
  );
  addTriangulatedCapFaces(
    body,
    operationId,
    'max',
    upperPlaneId,
    upperVertices,
    upperBoundary,
    triangulation.indices
  );

  points.forEach((point, index) => {
    const nextIndex = (index + 1) % points.length;
    const next = points[nextIndex]!;
    const edge2: [number, number] = [next[0] - point[0], next[1] - point[1]];
    const sideNormal = add3(
      scale3(frame.uAxis, edge2[1]),
      scale3(frame.vAxis, -edge2[0])
    );
    const sidePlaneId = `${operationId}:plane:side:${index}`;
    addPlane(body, createPlane(framePoint(frame, point, depths[0]), sideNormal), sidePlaneId);
    addFace(body, createFace(sidePlaneId, [
      lowerBoundary[index]!,
      verticalEdges[nextIndex]!,
      upperBoundary[index]!,
      verticalEdges[index]!,
    ], `${operationId}:face:side:${index}`, `Joint side ${index}`));
  });

  const validation = validateClosedManifoldBody(body);
  return validation.ok
    ? { ok: true, body }
    : {
        ok: false,
        code: 'NON_MANIFOLD_JOINT_RESULT',
        message: validation.errors[0]?.message ?? 'The joint result is not a closed manifold.',
      };
}

function addTriangulatedCapFaces(
  body: Body,
  operationId: string,
  cap: 'min' | 'max',
  planeId: string,
  vertexIds: string[],
  boundaryEdges: string[],
  indices: number[]
): void {
  const edgeByPair = new Map<string, string>();
  boundaryEdges.forEach((edgeId, index) => {
    edgeByPair.set(indexPairKey(index, (index + 1) % vertexIds.length), edgeId);
  });
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index]!, indices[index + 1]!, indices[index + 2]!];
    const edges = triangle.map((start, triangleIndex) => {
      const end = triangle[(triangleIndex + 1) % triangle.length]!;
      const key = indexPairKey(start, end);
      const existing = edgeByPair.get(key);
      if (existing) return existing;
      const edgeId = addNamedEdge(
        body,
        vertexIds[start]!,
        vertexIds[end]!,
        `${operationId}:edge:${cap}:diagonal:${key}`
      );
      edgeByPair.set(key, edgeId);
      return edgeId;
    });
    addFace(body, createFace(
      planeId,
      edges,
      `${operationId}:face:${cap}:${index / 3}`,
      `Joint ${cap} cap ${index / 3}`
    ));
  }
}

function addNamedEdge(
  body: Body,
  startVertexId: string,
  endVertexId: string,
  edgeId: string
): string {
  addEdge(body, createEdge(startVertexId, endVertexId, edgeId));
  return edgeId;
}

function indexPairKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function framePoint(
  frame: PrismaticFrame,
  point: [number, number],
  depth: number
): [number, number, number] {
  return add3(
    frame.origin,
    add3(
      scale3(frame.uAxis, point[0]),
      add3(scale3(frame.vAxis, point[1]), scale3(frame.normal, depth))
    )
  );
}

function coordinateAxesFrame(uAxisIndex: Axis, vAxisIndex: Axis): PrismaticFrame {
  const uAxis = axisVector(uAxisIndex);
  const vAxis = axisVector(vAxisIndex);
  return {
    origin: [0, 0, 0],
    uAxis,
    vAxis,
    normal: cross3(uAxis, vAxis),
  };
}

function axisDepthRange(
  bounds: AxisAlignedBounds,
  normal: [number, number, number]
): [number, number] {
  const axis = dominantAxis(normal);
  const first = bounds.min[axis] * normal[axis];
  const second = bounds.max[axis] * normal[axis];
  return [Math.min(first, second), Math.max(first, second)];
}

function axisVector(axis: Axis): [number, number, number] {
  if (axis === 0) return [1, 0, 0];
  if (axis === 1) return [0, 1, 0];
  return [0, 0, 1];
}

function compactPlanarLoop(
  points: [number, number][]
): [number, number][] {
  return points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!;
    return Math.hypot(point[0] - previous[0], point[1] - previous[1])
      > DEFAULT_TOLERANCE_POLICY.linear;
  });
}

function movePlanarPoint(
  from: [number, number],
  toward: [number, number],
  distance: number
): [number, number] {
  const delta: [number, number] = [toward[0] - from[0], toward[1] - from[1]];
  const length = Math.hypot(...delta);
  return [
    from[0] + delta[0] * distance / length,
    from[1] + delta[1] * distance / length,
  ];
}

function woodJointDisplayName(kind: WoodJointKind): string {
  return kind.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

function boxFromBounds(bounds: AxisAlignedBounds, id: string): Body {
  const size = boundsSize(bounds);
  return createBoxBody({
    width: size[0],
    depth: size[1],
    height: size[2],
    anchorMode: 'corner',
    origin: [...bounds.min],
  }, id);
}

function intersectBounds(
  first: AxisAlignedBounds,
  second: AxisAlignedBounds
): AxisAlignedBounds | undefined {
  const result: AxisAlignedBounds = {
    min: [
      Math.max(first.min[0], second.min[0]),
      Math.max(first.min[1], second.min[1]),
      Math.max(first.min[2], second.min[2]),
    ],
    max: [
      Math.min(first.max[0], second.max[0]),
      Math.min(first.max[1], second.max[1]),
      Math.min(first.max[2], second.max[2]),
    ],
  };
  return boundsSize(result).every((size) => size > DEFAULT_TOLERANCE_POLICY.linear)
    ? result
    : undefined;
}

/**
 * A mortise-and-tenon does not require the members to occupy the same space.
 * When two selected end faces meet, derive equal work prisms inward from both
 * members. The stored receiver offset maps the tenon prism to its complementary
 * mortise/slot without inventing material outside either stock body. Existing
 * overlapping documents keep their original intersection bounds.
 */
function deriveEndJointWorkingBounds(
  feature: FeatureRecord,
  params: WoodJointParams,
  members: ResolvedMember[]
):
  | {
      ok: true;
      bounds: AxisAlignedBounds;
      receiverOffset: [number, number, number];
    }
  | { ok: false; error: string; diagnostics: Diagnostic[] } {
  const source = members[0]!;
  const receiving = members[1]!;
  if (
    source.ref.datumRef.kind !== 'face'
    || receiving.ref.datumRef.kind !== 'face'
  ) {
    return featureFailure(
      feature.id,
      'JOINT_REQUIRES_FACE_DATUM',
      `${woodJointDisplayName(params.kind)} requires exact planar end-face datums.`
    );
  }

  const axis = dominantAxis(source.frame.zAxis);
  if (
    dominantAxis(receiving.frame.zAxis) !== axis
    || dot3(source.frame.zAxis, receiving.frame.zAxis)
      > -1 + DEFAULT_TOLERANCE_POLICY.angular * 10
  ) {
    return featureFailure(
      feature.id,
      'JOINT_DATUM_MISALIGNMENT',
      'Tenon and receiving-face datums must be parallel and outward-facing in opposite directions.'
    );
  }

  const sourceEnd = source.frame.zAxis[axis] > 0
    ? source.bounds.max[axis]
    : source.bounds.min[axis];
  const receivingEnd = receiving.frame.zAxis[axis] > 0
    ? receiving.bounds.max[axis]
    : receiving.bounds.min[axis];
  if (
    Math.abs(source.frame.origin[axis] - sourceEnd)
      > DEFAULT_TOLERANCE_POLICY.operationBounds
    || Math.abs(receiving.frame.origin[axis] - receivingEnd)
      > DEFAULT_TOLERANCE_POLICY.operationBounds
  ) {
    return featureFailure(
      feature.id,
      'INTERFERENCE',
      'Select the true end face of each member; a side or internal face cannot define this joint.'
    );
  }
  if (
    Math.abs(source.frame.origin[axis] - receiving.frame.origin[axis])
      > DEFAULT_TOLERANCE_POLICY.operationBounds
  ) {
    return featureFailure(
      feature.id,
      'END_JOINT_FACE_GAP',
      'The selected end faces neither overlap nor meet. Align the member ends, or use an explicit placement before creating the joint.'
    );
  }

  const crossAxes = otherAxes(axis);
  const bounds: AxisAlignedBounds = {
    min: [...source.bounds.min],
    max: [...source.bounds.max],
  };
  for (const crossAxis of crossAxes) {
    bounds.min[crossAxis] = Math.max(
      source.bounds.min[crossAxis],
      receiving.bounds.min[crossAxis]
    );
    bounds.max[crossAxis] = Math.min(
      source.bounds.max[crossAxis],
      receiving.bounds.max[crossAxis]
    );
    if (
      bounds.max[crossAxis] - bounds.min[crossAxis]
        <= DEFAULT_TOLERANCE_POLICY.linear
    ) {
      return featureFailure(
        feature.id,
        'END_JOINT_CROSS_SECTION_MISS',
        'The selected member ends do not share enough face area for this joint.'
      );
    }
  }

  const sourceSize = boundsSize(source.bounds);
  const receivingSize = boundsSize(receiving.bounds);
  const defaultLength = Math.min(
    sourceSize[crossAxes[0]]!,
    sourceSize[crossAxes[1]]!,
    sourceSize[axis]! / 2,
    receivingSize[axis]! / 2
  );
  const length = params.length ?? defaultLength;
  const interfaceCoordinate = (
    source.frame.origin[axis] + receiving.frame.origin[axis]
  ) / 2;
  const sourceOutward = Math.sign(source.frame.zAxis[axis]) || 1;
  const sourceInward = -sourceOutward;
  const innerCoordinate = interfaceCoordinate + sourceInward * length;
  bounds.min[axis] = Math.min(interfaceCoordinate, innerCoordinate);
  bounds.max[axis] = Math.max(interfaceCoordinate, innerCoordinate);

  if (
    bounds.min[axis] < source.bounds.min[axis]
      - DEFAULT_TOLERANCE_POLICY.operationBounds
    || bounds.max[axis] > source.bounds.max[axis]
      + DEFAULT_TOLERANCE_POLICY.operationBounds
  ) {
    return featureFailure(
      feature.id,
      'INSUFFICIENT_TENON_LENGTH',
      'The requested joint length extends beyond the tenon member stock; shorten the joint or choose longer stock.'
    );
  }
  const receiverOffset: [number, number, number] = [0, 0, 0];
  receiverOffset[axis] = sourceOutward * length;
  const receiverBounds = translateBounds(bounds, receiverOffset);
  if (
    receiverBounds.min[axis] < receiving.bounds.min[axis]
      - DEFAULT_TOLERANCE_POLICY.operationBounds
    || receiverBounds.max[axis] > receiving.bounds.max[axis]
      + DEFAULT_TOLERANCE_POLICY.operationBounds
  ) {
    return featureFailure(
      feature.id,
      'INSUFFICIENT_MORTISE_DEPTH',
      'The requested joint length extends through the far end of the receiving member; shorten the joint or choose longer stock.'
    );
  }
  return { ok: true, bounds, receiverOffset };
}

function coordinateIsOnBoundsEnd(
  coordinate: number,
  bounds: AxisAlignedBounds,
  axis: Axis
): boolean {
  return Math.abs(coordinate - bounds.min[axis])
      <= DEFAULT_TOLERANCE_POLICY.operationBounds
    || Math.abs(coordinate - bounds.max[axis])
      <= DEFAULT_TOLERANCE_POLICY.operationBounds;
}

function crossSectionContains(
  outer: AxisAlignedBounds,
  inner: AxisAlignedBounds,
  axes: readonly [Axis, Axis]
): boolean {
  return axes.every((axis) =>
    inner.min[axis] >= outer.min[axis] - DEFAULT_TOLERANCE_POLICY.operationBounds
    && inner.max[axis] <= outer.max[axis] + DEFAULT_TOLERANCE_POLICY.operationBounds
  );
}

function translateBounds(
  bounds: AxisAlignedBounds,
  translation: readonly [number, number, number]
): AxisAlignedBounds {
  return {
    min: [
      bounds.min[0] + translation[0],
      bounds.min[1] + translation[1],
      bounds.min[2] + translation[2],
    ],
    max: [
      bounds.max[0] + translation[0],
      bounds.max[1] + translation[1],
      bounds.max[2] + translation[2],
    ],
  };
}

function expandBounds(
  bounds: AxisAlignedBounds,
  sideClearance: number,
  endClearance: number,
  endAxis: Axis
): AxisAlignedBounds {
  const result = cloneBounds(bounds);
  for (const axis of [0, 1, 2] as const) {
    const clearance = axis === endAxis ? endClearance : sideClearance;
    result.min[axis] -= clearance;
    result.max[axis] += clearance;
  }
  return result;
}

function expandMortiseBounds(
  bounds: AxisAlignedBounds,
  sideClearance: number,
  endClearance: number,
  endAxis: Axis,
  outwardDirection: number
): AxisAlignedBounds {
  const result = cloneBounds(bounds);
  for (const axis of otherAxes(endAxis)) {
    result.min[axis] -= sideClearance;
    result.max[axis] += sideClearance;
  }
  const throughExtension = Math.max(
    DEFAULT_TOLERANCE_POLICY.throughAllExtension,
    boundsSize(bounds)[endAxis]
  );
  if (outwardDirection > 0) {
    result.max[endAxis] += throughExtension;
    result.min[endAxis] -= endClearance;
  } else {
    result.min[endAxis] -= throughExtension;
    result.max[endAxis] += endClearance;
  }
  return result;
}

function cloneBounds(bounds: AxisAlignedBounds): AxisAlignedBounds {
  return { min: [...bounds.min], max: [...bounds.max] };
}

function isAxisAlignedBox(body: Body): boolean {
  if (body.vertices.size !== 8 || body.edges.size !== 12 || body.faces.size !== 6) {
    return false;
  }
  const bounds = getBodyBoundingBox(body);
  return [...body.vertices.values()].every((vertex) =>
    ([0, 1, 2] as const).every((axis) =>
      Math.abs(vertex.position[axis] - bounds.min[axis]) <= DEFAULT_TOLERANCE_POLICY.linear
      || Math.abs(vertex.position[axis] - bounds.max[axis]) <= DEFAULT_TOLERANCE_POLICY.linear
    )
  );
}

function boundsSize(bounds: AxisAlignedBounds): [number, number, number] {
  return [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
}

function boundsCenter(bounds: AxisAlignedBounds): [number, number, number] {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function boundsVolume(bounds: AxisAlignedBounds): number {
  return boundsSize(bounds).reduce((product, size) => product * Math.max(0, size), 1);
}

function boundsContain(
  outer: AxisAlignedBounds,
  inner: AxisAlignedBounds,
  tolerance: number
): boolean {
  return ([0, 1, 2] as const).every((axis) =>
    outer.min[axis] <= inner.min[axis] + tolerance
    && outer.max[axis] >= inner.max[axis] - tolerance
  );
}

function dominantAxis(vector: readonly [number, number, number]): Axis {
  const absolute = vector.map(Math.abs);
  if (absolute[1]! > absolute[0]! && absolute[1]! >= absolute[2]!) return 1;
  return absolute[2]! > absolute[0]! ? 2 : 0;
}

function otherAxes(axis: Axis): [Axis, Axis] {
  if (axis === 0) return [1, 2];
  if (axis === 1) return [0, 2];
  return [0, 1];
}

function coordinateFrameAsPrismatic(frame: ResolvedMember['frame']): PrismaticFrame {
  return {
    origin: [...frame.origin],
    uAxis: [...frame.xAxis],
    vAxis: [...frame.yAxis],
    normal: [...frame.zAxis],
  };
}

function projectToFrame(
  frame: ResolvedMember['frame'],
  point: [number, number, number]
): [number, number, number] {
  const relative = subtract3(point, frame.origin);
  return [
    dot3(relative, frame.xAxis),
    dot3(relative, frame.yAxis),
    dot3(relative, frame.zAxis),
  ];
}

function bodyCenterDepth(body: Body, frame: ResolvedMember['frame']): number {
  const center = boundsCenter(getBodyBoundingBox(body));
  return projectToFrame(frame, center)[2];
}

function subtract3(
  first: readonly [number, number, number],
  second: readonly [number, number, number]
): [number, number, number] {
  return [
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  ];
}

function add3(
  first: readonly [number, number, number],
  second: readonly [number, number, number]
): [number, number, number] {
  return [
    first[0] + second[0],
    first[1] + second[1],
    first[2] + second[2],
  ];
}

function scale3(
  vector: readonly [number, number, number],
  amount: number
): [number, number, number] {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function dot3(
  first: readonly [number, number, number],
  second: readonly [number, number, number]
): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross3(
  first: readonly [number, number, number],
  second: readonly [number, number, number]
): [number, number, number] {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}
