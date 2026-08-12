import {
  WOOD_JOINT_KINDS,
  validateWoodJointParams,
  type WoodJointComputedDefaults,
  type WoodJointKind,
  type WoodJointMemberRef,
  type WoodJointParams,
} from '../features/joints/WoodJointFeature';
import {
  definitionCompatibilityFields,
  normalizeWoodJointDefinition,
  validateWoodJointDefinition,
  type WoodJointDefinition,
} from '../features/joints/WoodJointDefinitions';
import type {
  ContextTaskActionDescriptor,
  ContextTaskFieldDescriptor,
  ContextTaskFieldValue,
} from './ContextTaskPanel';

export type WoodJointEditorSection =
  | 'joint'
  | 'fit'
  | 'dimensions'
  | 'options'
  | 'members';

export interface WoodJointEditorFieldDescriptor extends ContextTaskFieldDescriptor {
  section: WoodJointEditorSection;
  /** Stable parameter path consumed by applyWoodJointEditorValue(). */
  path: string;
  /** True when the displayed value is derived from current member stock. */
  computed?: boolean;
}

export interface WoodJointEditorDiagnostic {
  code: string;
  message: string;
  fieldId?: string;
}

export interface WoodJointEditorPresenter {
  title: string;
  kind: WoodJointKind;
  parameters: WoodJointParams;
  fields: WoodJointEditorFieldDescriptor[];
  actions: ContextTaskActionDescriptor[];
  diagnostics: WoodJointEditorDiagnostic[];
  guidance: readonly string[];
  canApply: boolean;
}

export interface WoodJointEditorPresenterOptions {
  computedDefaults?: WoodJointComputedDefaults;
  memberLabels?: readonly string[];
  unit?: string;
}

export interface WoodJointEditorUpdateResult {
  ok: boolean;
  parameters: WoodJointParams;
  diagnostics: WoodJointEditorDiagnostic[];
}

const KIND_LABELS: Record<WoodJointKind, string> = {
  mortiseTenon: 'Mortise & Tenon',
  dado: 'Dado',
  groove: 'Groove',
  rabbet: 'Rabbet',
  crossLap: 'Cross-lap',
  endLap: 'End-lap',
  halfLap: 'Half-lap',
  bridle: 'Bridle',
  notch: 'Notch',
  sawCut: 'Saw Cut',
  chamfer: 'Chamfer',
  threeWayMiter: 'Three-way Miter',
};

export function woodJointKindLabel(kind: WoodJointKind): string {
  return KIND_LABELS[kind];
}

export function createWoodJointEditorPresenter(
  params: WoodJointParams,
  options: WoodJointEditorPresenterOptions = {}
): WoodJointEditorPresenter {
  const parameters = canonicalEditorParameters(params);
  const definition = parameters.definition!;
  const fields: WoodJointEditorFieldDescriptor[] = [
    selectField(
      'kind',
      'Joint type',
      parameters.kind,
      WOOD_JOINT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
      'joint'
    ),
    numberField(
      'sideClearance',
      'Side clearance',
      parameters.sideClearance,
      'fit',
      options.unit,
      false,
      'Zero is nominal. Positive values loosen the fit; negative values create interference.'
    ),
    numberField(
      'endClearance',
      'End clearance',
      parameters.endClearance,
      'fit',
      options.unit,
      false,
      'Zero is nominal. This value is always explicit and never hidden in a preset.'
    ),
    ...definitionFields(definition, options),
    ...memberFields(parameters.kind, parameters.members, options.memberLabels),
  ];
  const diagnostics = editorDiagnostics(parameters);
  for (const diagnostic of diagnostics) {
    const field = diagnostic.fieldId
      ? fields.find((candidate) => candidate.id === diagnostic.fieldId)
      : undefined;
    if (field && !field.error) field.error = diagnostic.message;
  }
  const actions = parameters.members.map((_, memberIndex) => ({
    id: `reselectMember:${memberIndex}`,
    label: `Reselect ${memberRoleActionLabel(parameters.kind, memberIndex)}`,
    kind: 'secondary' as const,
  }));
  if (parameters.kind === 'chamfer') {
    actions.push({
      id: 'reselectChamferEdges',
      label: 'Reselect chamfer edges',
      kind: 'secondary',
    });
  }
  return {
    title: KIND_LABELS[parameters.kind],
    kind: parameters.kind,
    parameters,
    fields,
    actions,
    diagnostics,
    guidance: jointGuidance(parameters.kind),
    canApply: diagnostics.length === 0,
  };
}

export function applyWoodJointEditorValue(
  params: WoodJointParams,
  fieldId: string,
  value: ContextTaskFieldValue
): WoodJointEditorUpdateResult {
  const current = canonicalEditorParameters(params);
  if (fieldId === 'kind') {
    if (typeof value !== 'string' || !WOOD_JOINT_KINDS.includes(value as WoodJointKind)) {
      return invalidUpdate(current, 'INVALID_JOINT_KIND', 'Choose a supported joint type.', fieldId);
    }
    const kind = value as WoodJointKind;
    return finishUpdate({
      ...current,
      kind,
      definition: normalizeWoodJointDefinition(kind, undefined),
    });
  }
  if (fieldId === 'sideClearance' || fieldId === 'endClearance') {
    const parsed = parseFiniteNumber(value);
    if (parsed === null) {
      return invalidUpdate(current, 'INVALID_CLEARANCE', 'Clearance must be a finite number.', fieldId);
    }
    return finishUpdate({ ...current, [fieldId]: parsed });
  }
  if (!fieldId.startsWith('definition.')) {
    return invalidUpdate(current, 'UNKNOWN_JOINT_FIELD', `Unknown joint field ${fieldId}.`, fieldId);
  }

  const definition = cloneDefinition(current.definition!);
  const definitionPath = fieldId.slice('definition.'.length);
  const tupleMatch = /^memberAnglesDegrees\.(\d)$/.exec(definitionPath);
  if (tupleMatch && definition.kind === 'threeWayMiter') {
    const parsed = parseFiniteNumber(value);
    if (parsed === null) {
      return invalidUpdate(current, 'INVALID_THREE_WAY_ANGLE', 'Angle must be a finite number.', fieldId);
    }
    const index = Number(tupleMatch[1]);
    if (index > 2) return invalidUpdate(current, 'UNKNOWN_JOINT_FIELD', 'Unknown member angle.', fieldId);
    definition.memberAnglesDegrees[index] = parsed;
    return finishUpdate({ ...current, definition });
  }
  if (definitionPath === 'edgeIds' && definition.kind === 'chamfer') {
    definition.edgeIds = typeof value === 'string'
      ? [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))].sort()
      : [];
    return finishUpdate({ ...current, definition });
  }
  if (!isEditableDefinitionField(definition, definitionPath)) {
    return invalidUpdate(current, 'UNKNOWN_JOINT_FIELD', `Unknown joint field ${fieldId}.`, fieldId);
  }

  const currentValue = definition[definitionPath as keyof typeof definition];
  if (typeof currentValue === 'boolean') {
    if (typeof value !== 'boolean') {
      return invalidUpdate(current, 'INVALID_JOINT_VALUE', 'Expected a true or false value.', fieldId);
    }
    setDefinitionValue(definition, definitionPath, value);
  } else if (typeof currentValue === 'string') {
    if (typeof value !== 'string') {
      return invalidUpdate(current, 'INVALID_JOINT_VALUE', 'Expected a listed option.', fieldId);
    }
    setDefinitionValue(definition, definitionPath, value);
    if (
      definition.kind === 'mortiseTenon'
      && definitionPath === 'positionMode'
      && value === 'centered'
    ) {
      definition.widthOffset = 0;
      definition.thicknessOffset = 0;
    }
    if (
      definition.kind === 'bridle'
      && definitionPath === 'widthMode'
      && value === 'automatic'
    ) {
      delete definition.width;
    }
  } else if (value === '' || value === null) {
    deleteDefinitionValue(definition, definitionPath);
  } else {
    const parsed = parseFiniteNumber(value);
    if (parsed === null) {
      return invalidUpdate(current, 'INVALID_JOINT_VALUE', 'Expected a finite number.', fieldId);
    }
    setDefinitionValue(definition, definitionPath, parsed);
  }
  return finishUpdate({ ...current, definition });
}

function definitionFields(
  definition: WoodJointDefinition,
  options: WoodJointEditorPresenterOptions
): WoodJointEditorFieldDescriptor[] {
  const defaults = options.computedDefaults ?? {};
  const unit = options.unit;
  switch (definition.kind) {
    case 'mortiseTenon':
      return [
        automaticNumber('definition.width', 'Tenon width', definition.width, defaults.width, unit),
        automaticNumber('definition.thickness', 'Tenon thickness', definition.thickness, defaults.depth, unit),
        automaticNumber('definition.length', 'Tenon length', definition.length, defaults.length, unit),
        selectField('definition.positionMode', 'Position', definition.positionMode, [
          { value: 'centered', label: 'Centered on end' },
          { value: 'offset', label: 'Custom position' },
        ], 'options'),
        {
          ...numberField('definition.widthOffset', 'Width-axis offset', definition.widthOffset, 'dimensions', unit),
          disabled: definition.positionMode === 'centered',
          help: 'Signed distance from the centered position along the tenon width direction.',
        },
        {
          ...numberField('definition.thicknessOffset', 'Thickness-axis offset', definition.thicknessOffset, 'dimensions', unit),
          disabled: definition.positionMode === 'centered',
          help: 'Signed distance from the centered position through the stock thickness.',
        },
        selectField('definition.shoulderMode', 'Shoulders', definition.shoulderMode, [
          { value: 'fourSided', label: 'Four-sided' },
          { value: 'twoSided', label: 'Two-sided' },
          { value: 'barefaced', label: 'Barefaced' },
        ], 'options'),
        checkboxField('definition.haunchEnabled', 'Add haunch', definition.haunchEnabled),
        ...(definition.haunchEnabled ? [
          automaticNumber('definition.haunchWidth', 'Haunch width', definition.haunchWidth, defaults.haunchWidth, unit),
          automaticNumber('definition.haunchDepth', 'Haunch depth', definition.haunchDepth, defaults.haunchDepth, unit),
        ] : []),
      ];
    case 'dado':
    case 'groove':
    case 'rabbet':
      return [
        selectField('definition.widthMode', 'Width source', definition.widthMode, [
          { value: 'member', label: 'Mating member' },
          { value: 'explicit', label: 'Explicit' },
        ], 'options'),
        automaticNumber('definition.width', 'Width', definition.width, defaults.width, unit),
        automaticNumber('definition.depth', 'Depth', definition.depth, defaults.depth, unit),
        numberField('definition.offset', 'Offset', definition.offset, 'dimensions', unit),
        checkboxField('definition.through', 'Through housing', definition.through),
      ];
    case 'crossLap':
    case 'endLap':
    case 'halfLap':
      return [
        automaticNumber('definition.width', 'Lap width', definition.width, defaults.width, unit),
        automaticNumber('definition.depth', 'Cut depth', definition.depth, defaults.depth, unit),
        numberField('definition.offset', 'Offset', definition.offset, 'dimensions', unit),
      ];
    case 'bridle':
      return [
        selectField('definition.widthMode', 'Sizing', definition.widthMode, [
          { value: 'automatic', label: 'Automatic from stock' },
          { value: 'custom', label: 'Custom width' },
        ], 'options'),
        {
          ...automaticNumber('definition.width', 'Tongue and slot width', definition.width, defaults.width, unit),
          disabled: definition.widthMode === 'automatic',
          help: definition.widthMode === 'automatic'
            ? 'Computed as one third of the tongue member width.'
            : 'Sets both the tongue and complementary open slot.',
        },
        automaticNumber('definition.length', 'Bridle length', definition.length, defaults.length, unit),
        {
          ...numberField('definition.offset', 'Position from center', definition.offset, 'dimensions', unit),
          help: 'Signed offset of the tongue and slot together; zero keeps the joint centered.',
        },
        selectField('definition.shoulderMode', 'Shoulders', definition.shoulderMode, [
          { value: 'fourSided', label: 'Four-sided' },
          { value: 'twoSided', label: 'Two-sided' },
        ], 'options'),
      ];
    case 'notch':
      return [
        automaticNumber('definition.width', 'Notch width', definition.width, defaults.width, unit),
        automaticNumber('definition.depth', 'Notch depth', definition.depth, defaults.depth, unit),
        numberField('definition.offset', 'Offset', definition.offset, 'dimensions', unit),
        checkboxField('definition.through', 'Through notch', definition.through),
      ];
    case 'sawCut':
      return [
        numberField('definition.angleDegrees', 'Saw angle', definition.angleDegrees, 'dimensions', '°'),
        automaticNumber('definition.offset', 'Offset', definition.offset, defaults.offset, unit),
        numberField('definition.kerf', 'Kerf', definition.kerf, 'dimensions', unit),
        selectField('definition.keep', 'Keep', definition.keep, [
          { value: 'both', label: 'Both pieces' },
          { value: 'datumSide', label: 'Datum side' },
          { value: 'oppositeSide', label: 'Opposite side' },
        ], 'options'),
      ];
    case 'chamfer':
      return [
        selectField('definition.mode', 'Definition', definition.mode, [
          { value: 'distance', label: 'Equal distance' },
          { value: 'distanceAngle', label: 'Distance and angle' },
        ], 'options'),
        automaticNumber('definition.distance', 'Distance', definition.distance, defaults.chamferDistance, unit),
        ...(definition.mode === 'distanceAngle' ? [
          numberField('definition.angleDegrees', 'Angle', definition.angleDegrees, 'dimensions', '°'),
        ] : []),
        {
          id: 'definition.edgeIds',
          path: 'definition.edgeIds',
          label: 'Additional edges',
          type: 'readonly',
          value: `${definition.edgeIds.length + 1} edge${definition.edgeIds.length === 0 ? '' : 's'} selected`,
          section: 'members',
          help: 'Use Reselect chamfer edges to replace the compatible edge set.',
        },
      ];
    case 'threeWayMiter':
      return [
        ...definition.memberAnglesDegrees.map((angle, index) =>
          numberField(
            `definition.memberAnglesDegrees.${index}`,
            `Member ${String.fromCharCode(65 + index)} angle`,
            angle,
            'dimensions',
            '°'
          )
        ),
        numberField('definition.closureTolerance', 'Closure tolerance', definition.closureTolerance, 'dimensions', unit),
        selectField('definition.keep', 'Keep', definition.keep, [
          { value: 'trim', label: 'Trim ends' },
          { value: 'split', label: 'Keep offcuts' },
        ], 'options'),
        automaticNumber('definition.explodedDistance', 'Exploded preview distance', definition.explodedDistance, undefined, unit),
      ];
  }
}

function memberFields(
  kind: WoodJointKind,
  members: readonly WoodJointMemberRef[],
  labels: readonly string[] | undefined
): WoodJointEditorFieldDescriptor[] {
  return members.map((member, memberIndex) => ({
    id: `members.${memberIndex}`,
    path: `members.${memberIndex}`,
    label: memberRoleLabel(kind, memberIndex),
    type: 'readonly',
    value: labels?.[memberIndex] ?? `${datumKindLabel(member.datumRef.kind)} selected`,
    section: 'members',
    help: memberSelectionHelp(kind, memberIndex),
  }));
}

function editorDiagnostics(params: WoodJointParams): WoodJointEditorDiagnostic[] {
  const definitionDiagnostics = validateWoodJointDefinition(params.definition!).map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.field ? { fieldId: diagnostic.field } : {}),
  }));
  const definitionCodes = new Set(definitionDiagnostics.map((diagnostic) => diagnostic.code));
  const baseDiagnostics = validateWoodJointParams(params)
    .filter((diagnostic) => !definitionCodes.has(diagnostic.code))
    .map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message }));
  return [...baseDiagnostics, ...definitionDiagnostics];
}

function canonicalEditorParameters(params: WoodJointParams): WoodJointParams {
  const definition = normalizeWoodJointDefinition(
    params.kind,
    params.definition,
    params.definition ? {} : params
  );
  const compatibility = definitionCompatibilityFields(definition);
  return {
    ...params,
    ...compatibility,
    definition,
    members: params.members.map((member) => ({
      bodyRef: { ...member.bodyRef },
      datumRef: { ...member.datumRef },
      ...(member.cornerVertexId ? { cornerVertexId: member.cornerVertexId } : {}),
    })),
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

function finishUpdate(params: WoodJointParams): WoodJointEditorUpdateResult {
  const parameters = canonicalEditorParameters(params);
  const diagnostics = editorDiagnostics(parameters);
  return { ok: diagnostics.length === 0, parameters, diagnostics };
}

function invalidUpdate(
  params: WoodJointParams,
  code: string,
  message: string,
  fieldId: string
): WoodJointEditorUpdateResult {
  return {
    ok: false,
    parameters: canonicalEditorParameters(params),
    diagnostics: [{ code, message, fieldId }],
  };
}

function cloneDefinition(definition: WoodJointDefinition): WoodJointDefinition {
  if (definition.kind === 'chamfer') {
    return { ...definition, edgeIds: [...definition.edgeIds] };
  }
  if (definition.kind === 'threeWayMiter') {
    return { ...definition, memberAnglesDegrees: [...definition.memberAnglesDegrees] };
  }
  return { ...definition };
}

function setDefinitionValue(
  definition: WoodJointDefinition,
  key: string,
  value: string | number | boolean
): void {
  (definition as unknown as Record<string, unknown>)[key] = value;
}

function deleteDefinitionValue(definition: WoodJointDefinition, key: string): void {
  delete (definition as unknown as Record<string, unknown>)[key];
}

function parseFiniteNumber(value: ContextTaskFieldValue): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isEditableDefinitionField(
  definition: WoodJointDefinition,
  field: string
): boolean {
  const common: Partial<Record<WoodJointDefinition['kind'], readonly string[]>> = {
    mortiseTenon: [
      'width', 'thickness', 'length', 'widthOffset', 'thicknessOffset',
      'positionMode', 'shoulderMode', 'haunchEnabled', 'haunchWidth', 'haunchDepth',
    ],
    dado: ['widthMode', 'width', 'depth', 'offset', 'through'],
    groove: ['widthMode', 'width', 'depth', 'offset', 'through'],
    rabbet: ['widthMode', 'width', 'depth', 'offset', 'through'],
    crossLap: ['width', 'depth', 'offset'],
    endLap: ['width', 'depth', 'offset'],
    halfLap: ['width', 'depth', 'offset'],
    bridle: ['widthMode', 'width', 'length', 'offset', 'shoulderMode'],
    notch: ['width', 'depth', 'offset', 'through'],
    sawCut: ['angleDegrees', 'offset', 'kerf', 'keep'],
    chamfer: ['mode', 'distance', 'angleDegrees', 'edgeIds'],
    threeWayMiter: ['closureTolerance', 'keep', 'explodedDistance'],
  };
  return common[definition.kind]?.includes(field) ?? false;
}

function automaticNumber(
  id: string,
  label: string,
  explicitValue: number | undefined,
  computedValue: number | undefined,
  unit: string | undefined
): WoodJointEditorFieldDescriptor {
  const computed = explicitValue === undefined;
  return numberField(
    id,
    label,
    explicitValue ?? computedValue ?? '',
    'dimensions',
    unit,
    computed,
    computed
      ? computedValue === undefined
        ? 'Automatic from selected stock; enter a value to override.'
        : `Computed from selected stock: ${computedValue}. Enter a value to override.`
      : 'Explicit override. Clear the field to return to the stock-derived value.'
  );
}

function numberField(
  id: string,
  label: string,
  value: number | '',
  section: WoodJointEditorSection,
  unit?: string,
  computed = false,
  help?: string
): WoodJointEditorFieldDescriptor {
  return {
    id,
    path: id,
    label,
    type: 'number',
    value,
    section,
    ...(unit ? { unit } : {}),
    ...(help ? { help } : {}),
    ...(computed ? { computed: true, placeholder: 'Automatic from stock' } : {}),
  };
}

function selectField(
  id: string,
  label: string,
  value: string,
  options: readonly { value: string; label: string }[],
  section: WoodJointEditorSection
): WoodJointEditorFieldDescriptor {
  return { id, path: id, label, type: 'select', value, options, section };
}

function checkboxField(
  id: string,
  label: string,
  value: boolean
): WoodJointEditorFieldDescriptor {
  return { id, path: id, label, type: 'checkbox', value, section: 'options' };
}

function datumKindLabel(kind: WoodJointMemberRef['datumRef']['kind']): string {
  if (kind === 'face' || kind === 'faceCenter') return 'Planar face';
  if (kind === 'edge' || kind === 'edgePoint') return 'Edge';
  if (kind === 'vertex') return 'Vertex';
  return 'Body frame';
}

function memberRoleLabel(kind: WoodJointKind, memberIndex: number): string {
  if (kind === 'mortiseTenon') {
    return memberIndex === 0
      ? 'Member A · tenon end face'
      : 'Member B · mortise end face';
  }
  if (kind === 'bridle') {
    return memberIndex === 0
      ? 'Member A · tongue end face'
      : 'Member B · fork end face';
  }
  return `Member ${String.fromCharCode(65 + memberIndex)} end datum`;
}

function memberRoleActionLabel(kind: WoodJointKind, memberIndex: number): string {
  if (kind === 'mortiseTenon') {
    return memberIndex === 0 ? 'Member A tenon face' : 'Member B mortise face';
  }
  if (kind === 'bridle') {
    return memberIndex === 0 ? 'Member A tongue face' : 'Member B fork face';
  }
  return `member ${String.fromCharCode(65 + memberIndex)} datum`;
}

function memberSelectionHelp(kind: WoodJointKind, memberIndex: number): string {
  if (
    memberIndex === 1
    && (kind === 'mortiseTenon' || kind === 'bridle')
  ) {
    return 'Use Reselect for this exact face. Member A is temporarily hidden while this datum is requested, then restored automatically.';
  }
  return 'Use Reselect to replace this exact reference without changing global selection mode.';
}

function jointGuidance(kind: WoodJointKind): readonly string[] {
  if (kind === 'bridle') {
    return [
      'Member A is the tongue: select its end face first.',
      'Member B is the fork: select its opposing end face second.',
      'After Member A is selected, it is temporarily hidden so a coincident Member B face is easy to pick; it is restored automatically.',
      'Use Automatic sizing for a centered one-third-width bridle, or choose Custom width and position.',
    ];
  }
  if (kind === 'mortiseTenon') {
    return [
      'Member A is the tenon member; Member B is the mortise member. Select their opposing end faces in that order.',
      'After Member A is selected, it is temporarily hidden so a coincident Member B face is easy to pick; it is restored automatically.',
      'The boards may overlap by the tenon length or meet normally at coplanar end faces.',
      'Choose Custom position to move the mortise and tenon together away from center.',
    ];
  }
  return [];
}
