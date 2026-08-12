import { DEFAULT_TOLERANCE_POLICY } from '../../geometry/TolerancePolicy';

export type JointShoulderMode = 'fourSided' | 'twoSided' | 'barefaced';
export type HousingWidthMode = 'member' | 'explicit';
export type ChamferDefinitionMode = 'distance' | 'distanceAngle';
export type SawCutKeep = 'both' | 'datumSide' | 'oppositeSide';
export type WoodJointResultMode = 'trim' | 'split';
export type JointPositionMode = 'centered' | 'offset';
export type BridleWidthMode = 'automatic' | 'custom';

export interface MortiseTenonDefinition {
  kind: 'mortiseTenon';
  width?: number;
  thickness?: number;
  length?: number;
  widthOffset: number;
  thicknessOffset: number;
  positionMode: JointPositionMode;
  shoulderMode: JointShoulderMode;
  haunchEnabled: boolean;
  haunchWidth?: number;
  haunchDepth?: number;
}

export interface HousingJointDefinition {
  kind: 'dado' | 'groove' | 'rabbet';
  widthMode: HousingWidthMode;
  width?: number;
  depth?: number;
  offset: number;
  through: boolean;
}

export interface LapJointDefinition {
  kind: 'crossLap' | 'endLap' | 'halfLap';
  width?: number;
  depth?: number;
  offset: number;
}

export interface BridleJointDefinition {
  kind: 'bridle';
  widthMode: BridleWidthMode;
  width?: number;
  length?: number;
  offset: number;
  shoulderMode: Exclude<JointShoulderMode, 'barefaced'>;
}

export interface NotchJointDefinition {
  kind: 'notch';
  width?: number;
  depth?: number;
  offset: number;
  through: boolean;
}

export interface SawCutDefinition {
  kind: 'sawCut';
  angleDegrees: number;
  offset?: number;
  kerf: number;
  keep: SawCutKeep;
}

export interface ChamferJointDefinition {
  kind: 'chamfer';
  mode: ChamferDefinitionMode;
  distance?: number;
  angleDegrees: number;
  /** Stable edge topology IDs; the member datum remains the primary edge. */
  edgeIds: string[];
}

export interface ThreeWayMiterDefinition {
  kind: 'threeWayMiter';
  /** Per-member end treatment angles in persisted member order. */
  memberAnglesDegrees: [number, number, number];
  closureTolerance: number;
  keep: WoodJointResultMode;
  explodedDistance?: number;
}

export type WoodJointDefinition =
  | MortiseTenonDefinition
  | HousingJointDefinition
  | LapJointDefinition
  | BridleJointDefinition
  | NotchJointDefinition
  | SawCutDefinition
  | ChamferJointDefinition
  | ThreeWayMiterDefinition;

export interface LegacyWoodJointDefinitionFields {
  width?: number | undefined;
  depth?: number | undefined;
  length?: number | undefined;
  offset?: number | undefined;
  kerf?: number | undefined;
  keep?: SawCutKeep | undefined;
  chamferWidth?: number | undefined;
  resultMode?: WoodJointResultMode | undefined;
  angleDegrees?: number | undefined;
}

export interface WoodJointDefinitionDiagnostic {
  code: string;
  message: string;
  field?: string;
}

export function createDefaultWoodJointDefinition(
  kind: WoodJointDefinition['kind'],
  legacy: LegacyWoodJointDefinitionFields = {}
): WoodJointDefinition {
  switch (kind) {
    case 'mortiseTenon':
      return {
        kind,
        ...(legacy.width !== undefined ? { width: legacy.width } : {}),
        ...(legacy.depth !== undefined ? { thickness: legacy.depth } : {}),
        ...(legacy.length !== undefined ? { length: legacy.length } : {}),
        widthOffset: 0,
        thicknessOffset: 0,
        positionMode: 'centered',
        shoulderMode: 'fourSided',
        haunchEnabled: false,
      };
    case 'dado':
    case 'groove':
    case 'rabbet':
      return {
        kind,
        widthMode: legacy.width === undefined ? 'member' : 'explicit',
        ...(legacy.width !== undefined ? { width: legacy.width } : {}),
        ...(legacy.depth !== undefined ? { depth: legacy.depth } : {}),
        offset: legacy.offset ?? 0,
        through: false,
      };
    case 'crossLap':
    case 'endLap':
    case 'halfLap':
      return {
        kind,
        ...(legacy.width !== undefined ? { width: legacy.width } : {}),
        ...(legacy.depth !== undefined ? { depth: legacy.depth } : {}),
        offset: legacy.offset ?? 0,
      };
    case 'bridle':
      return {
        kind,
        widthMode: legacy.width === undefined ? 'automatic' : 'custom',
        ...(legacy.width !== undefined ? { width: legacy.width } : {}),
        ...(legacy.length !== undefined ? { length: legacy.length } : {}),
        offset: legacy.offset ?? 0,
        shoulderMode: 'twoSided',
      };
    case 'notch':
      return {
        kind,
        ...(legacy.width !== undefined ? { width: legacy.width } : {}),
        ...(legacy.depth !== undefined ? { depth: legacy.depth } : {}),
        offset: legacy.offset ?? 0,
        through: false,
      };
    case 'sawCut':
      return {
        kind,
        angleDegrees: legacy.angleDegrees ?? 90,
        ...(legacy.offset !== undefined ? { offset: legacy.offset } : {}),
        kerf: legacy.kerf ?? 0.125,
        keep: legacy.keep ?? 'both',
      };
    case 'chamfer':
      return {
        kind,
        mode: 'distance',
        ...(legacy.chamferWidth !== undefined
          ? { distance: legacy.chamferWidth }
          : legacy.width !== undefined ? { distance: legacy.width } : {}),
        angleDegrees: legacy.angleDegrees ?? 45,
        edgeIds: [],
      };
    case 'threeWayMiter':
      return {
        kind,
        memberAnglesDegrees: [45, 45, 45],
        closureTolerance: DEFAULT_TOLERANCE_POLICY.operationBounds,
        keep: legacy.resultMode ?? 'trim',
      };
  }
}

export function normalizeWoodJointDefinition(
  kind: WoodJointDefinition['kind'],
  value: Partial<WoodJointDefinition> | undefined,
  legacy: LegacyWoodJointDefinitionFields = {}
): WoodJointDefinition {
  const defaults = createDefaultWoodJointDefinition(kind, legacy);
  if (!value || value.kind !== kind) return defaults;
  const normalized = { ...defaults, ...value, kind } as WoodJointDefinition;
  if (normalized.kind === 'mortiseTenon') {
    const raw = value as Partial<MortiseTenonDefinition>;
    if (
      raw.positionMode === undefined
      && (normalized.widthOffset !== 0 || normalized.thicknessOffset !== 0)
    ) {
      normalized.positionMode = 'offset';
    }
  }
  if (normalized.kind === 'bridle') {
    const raw = value as Partial<BridleJointDefinition>;
    if (raw.widthMode === undefined && normalized.width !== undefined) {
      normalized.widthMode = 'custom';
    }
  }
  if (normalized.kind === 'chamfer') {
    normalized.edgeIds = Array.isArray(normalized.edgeIds)
      ? [...new Set(normalized.edgeIds.filter((edgeId) => typeof edgeId === 'string' && edgeId))].sort()
      : [];
  }
  if (normalized.kind === 'threeWayMiter') {
    normalized.memberAnglesDegrees = validAngleTuple(normalized.memberAnglesDegrees)
      ? [...normalized.memberAnglesDegrees]
      : [45, 45, 45];
  }
  return normalized;
}

export function definitionCompatibilityFields(
  definition: WoodJointDefinition
): LegacyWoodJointDefinitionFields {
  switch (definition.kind) {
    case 'mortiseTenon':
      return {
        ...(definition.width !== undefined ? { width: definition.width } : {}),
        ...(definition.thickness !== undefined ? { depth: definition.thickness } : {}),
        ...(definition.length !== undefined ? { length: definition.length } : {}),
      };
    case 'dado':
    case 'groove':
    case 'rabbet':
    case 'notch':
    case 'crossLap':
    case 'endLap':
    case 'halfLap':
      return {
        ...(definition.width !== undefined ? { width: definition.width } : {}),
        ...(definition.depth !== undefined ? { depth: definition.depth } : {}),
        offset: definition.offset,
      };
    case 'bridle':
      return {
        ...(definition.width !== undefined ? { width: definition.width } : {}),
        ...(definition.length !== undefined ? { length: definition.length } : {}),
        offset: definition.offset,
      };
    case 'sawCut':
      return {
        angleDegrees: definition.angleDegrees,
        ...(definition.offset !== undefined ? { offset: definition.offset } : {}),
        kerf: definition.kerf,
        keep: definition.keep,
      };
    case 'chamfer':
      return {
        angleDegrees: definition.angleDegrees,
        ...(definition.distance !== undefined ? { chamferWidth: definition.distance } : {}),
      };
    case 'threeWayMiter':
      return { resultMode: definition.keep };
  }
}

export function validateWoodJointDefinition(
  definition: WoodJointDefinition
): WoodJointDefinitionDiagnostic[] {
  const diagnostics: WoodJointDefinitionDiagnostic[] = [];
  const positive = (field: string, label: string, value: number | undefined): void => {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      diagnostics.push({
        code: 'INVALID_JOINT_DIMENSION',
        message: `${label} must be finite and greater than zero.`,
        field,
      });
    }
  };
  const finite = (field: string, label: string, value: number): void => {
    if (!Number.isFinite(value)) {
      diagnostics.push({
        code: 'INVALID_JOINT_DIMENSION',
        message: `${label} must be a finite number.`,
        field,
      });
    }
  };

  switch (definition.kind) {
    case 'mortiseTenon':
      positive('definition.width', 'Tenon width', definition.width);
      positive('definition.thickness', 'Tenon thickness', definition.thickness);
      positive('definition.length', 'Tenon length', definition.length);
      finite('definition.widthOffset', 'Width offset', definition.widthOffset);
      finite('definition.thicknessOffset', 'Thickness offset', definition.thicknessOffset);
      if (!['centered', 'offset'].includes(definition.positionMode)) {
        diagnostics.push({ code: 'INVALID_JOINT_POSITION_MODE', message: 'Choose centered or custom position.', field: 'definition.positionMode' });
      }
      if (
        definition.positionMode === 'centered'
        && (definition.widthOffset !== 0 || definition.thicknessOffset !== 0)
      ) {
        diagnostics.push({
          code: 'CENTERED_JOINT_HAS_OFFSET',
          message: 'Centered placement requires both offsets to be zero; choose Custom position to use offsets.',
          field: 'definition.positionMode',
        });
      }
      if (!['fourSided', 'twoSided', 'barefaced'].includes(definition.shoulderMode)) {
        diagnostics.push({ code: 'INVALID_SHOULDER_MODE', message: 'Choose a supported shoulder mode.', field: 'definition.shoulderMode' });
      }
      if (definition.haunchEnabled) {
        positive('definition.haunchWidth', 'Haunch width', definition.haunchWidth);
        positive('definition.haunchDepth', 'Haunch depth', definition.haunchDepth);
      }
      break;
    case 'dado':
    case 'groove':
    case 'rabbet':
      positive('definition.width', 'Housing width', definition.width);
      positive('definition.depth', 'Housing depth', definition.depth);
      finite('definition.offset', 'Housing offset', definition.offset);
      if (definition.widthMode === 'explicit' && definition.width === undefined) {
        diagnostics.push({ code: 'MISSING_HOUSING_WIDTH', message: 'Explicit width mode requires a width.', field: 'definition.width' });
      }
      if (!['member', 'explicit'].includes(definition.widthMode)) {
        diagnostics.push({ code: 'INVALID_HOUSING_WIDTH_MODE', message: 'Choose mating-member or explicit width.', field: 'definition.widthMode' });
      }
      break;
    case 'crossLap':
    case 'endLap':
    case 'halfLap':
      positive('definition.width', 'Lap width', definition.width);
      positive('definition.depth', 'Lap depth', definition.depth);
      finite('definition.offset', 'Lap offset', definition.offset);
      break;
    case 'bridle':
      positive('definition.width', 'Bridle width', definition.width);
      positive('definition.length', 'Bridle length', definition.length);
      finite('definition.offset', 'Bridle offset', definition.offset);
      if (!['automatic', 'custom'].includes(definition.widthMode)) {
        diagnostics.push({ code: 'INVALID_BRIDLE_WIDTH_MODE', message: 'Choose automatic or custom bridle sizing.', field: 'definition.widthMode' });
      }
      if (definition.widthMode === 'custom' && definition.width === undefined) {
        diagnostics.push({ code: 'MISSING_BRIDLE_WIDTH', message: 'Custom bridle sizing requires a width.', field: 'definition.width' });
      }
      if (!['fourSided', 'twoSided'].includes(definition.shoulderMode)) {
        diagnostics.push({ code: 'INVALID_SHOULDER_MODE', message: 'Choose a supported bridle shoulder mode.', field: 'definition.shoulderMode' });
      }
      break;
    case 'notch':
      positive('definition.width', 'Notch width', definition.width);
      positive('definition.depth', 'Notch depth', definition.depth);
      finite('definition.offset', 'Notch offset', definition.offset);
      break;
    case 'sawCut':
      positive('definition.kerf', 'Saw kerf', definition.kerf);
      positive('definition.offset', 'Saw offset', definition.offset);
      if (
        !Number.isFinite(definition.angleDegrees)
        || definition.angleDegrees <= 0
        || definition.angleDegrees >= 180
      ) {
        diagnostics.push({ code: 'INVALID_SAW_ANGLE', message: 'Saw angle must be between 0° and 180°.', field: 'definition.angleDegrees' });
      }
      if (!['both', 'datumSide', 'oppositeSide'].includes(definition.keep)) {
        diagnostics.push({ code: 'INVALID_SAW_KEEP', message: 'Choose which side of the saw cut to keep.', field: 'definition.keep' });
      }
      break;
    case 'chamfer':
      positive('definition.distance', 'Chamfer distance', definition.distance);
      if (
        !Number.isFinite(definition.angleDegrees)
        || definition.angleDegrees <= 0
        || definition.angleDegrees >= 90
      ) {
        diagnostics.push({ code: 'INVALID_CHAMFER_ANGLE', message: 'Chamfer angle must be between 0° and 90°.', field: 'definition.angleDegrees' });
      }
      if (!['distance', 'distanceAngle'].includes(definition.mode)) {
        diagnostics.push({ code: 'INVALID_CHAMFER_MODE', message: 'Choose equal-distance or distance-angle chamfer definition.', field: 'definition.mode' });
      }
      break;
    case 'threeWayMiter':
      definition.memberAnglesDegrees.forEach((angle, index) => {
        if (!Number.isFinite(angle) || angle <= 0 || angle >= 90) {
          diagnostics.push({
            code: 'INVALID_THREE_WAY_ANGLE',
            message: `Member ${String.fromCharCode(65 + index)} angle must be between 0° and 90°.`,
            field: `definition.memberAnglesDegrees.${index}`,
          });
        }
      });
      positive('definition.closureTolerance', 'Closure tolerance', definition.closureTolerance);
      positive('definition.explodedDistance', 'Exploded preview distance', definition.explodedDistance);
      if (!['trim', 'split'].includes(definition.keep)) {
        diagnostics.push({ code: 'INVALID_JOINT_RESULT_MODE', message: 'Choose trim ends or keep offcuts.', field: 'definition.keep' });
      }
      break;
  }
  return diagnostics;
}

function validAngleTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}
