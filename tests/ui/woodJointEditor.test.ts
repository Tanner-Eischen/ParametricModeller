import { describe, expect, it } from 'vitest';
import {
  createDefaultWoodJointDefinition,
  WOOD_JOINT_KINDS,
  type WoodJointKind,
  type WoodJointMemberRef,
  type WoodJointParams,
} from '../../src/features';
import {
  applyWoodJointEditorValue,
  createWoodJointEditorPresenter,
} from '../../src/ui/WoodJointEditor';

function membersFor(kind: WoodJointKind): WoodJointMemberRef[] {
  const count = kind === 'sawCut' || kind === 'chamfer'
    ? 1
    : kind === 'threeWayMiter' ? 3 : 2;
  return Array.from({ length: count }, (_, index) => ({
    bodyRef: { featureId: `feature-${index}`, bodyId: `body-${index}` },
    datumRef: kind === 'chamfer'
      ? {
          kind: 'edge' as const,
          featureId: `feature-${index}`,
          bodyId: `body-${index}`,
          edgeId: `edge-${index}`,
        }
      : {
          kind: 'face' as const,
          featureId: `feature-${index}`,
          bodyId: `body-${index}`,
          faceId: `face-${index}`,
        },
    ...(kind === 'threeWayMiter' ? { cornerVertexId: `corner-${index}` } : {}),
  }));
}

function paramsFor(kind: WoodJointKind): WoodJointParams {
  return {
    kind,
    members: membersFor(kind),
    sideClearance: 0,
    endClearance: 0,
    definition: createDefaultWoodJointDefinition(kind),
  };
}

const REQUIRED_FIELDS: Record<WoodJointKind, string[]> = {
  mortiseTenon: [
    'definition.width', 'definition.thickness', 'definition.length',
    'definition.positionMode',
    'definition.widthOffset', 'definition.thicknessOffset',
    'definition.shoulderMode', 'definition.haunchEnabled',
  ],
  dado: ['definition.widthMode', 'definition.width', 'definition.depth', 'definition.offset', 'definition.through'],
  groove: ['definition.widthMode', 'definition.width', 'definition.depth', 'definition.offset', 'definition.through'],
  rabbet: ['definition.widthMode', 'definition.width', 'definition.depth', 'definition.offset', 'definition.through'],
  crossLap: ['definition.width', 'definition.depth', 'definition.offset'],
  endLap: ['definition.width', 'definition.depth', 'definition.offset'],
  halfLap: ['definition.width', 'definition.depth', 'definition.offset'],
  bridle: [
    'definition.widthMode', 'definition.width', 'definition.length',
    'definition.offset', 'definition.shoulderMode',
  ],
  notch: ['definition.width', 'definition.depth', 'definition.offset', 'definition.through'],
  sawCut: ['definition.angleDegrees', 'definition.offset', 'definition.kerf', 'definition.keep'],
  chamfer: ['definition.mode', 'definition.distance', 'definition.edgeIds'],
  threeWayMiter: [
    'definition.memberAnglesDegrees.0', 'definition.memberAnglesDegrees.1',
    'definition.memberAnglesDegrees.2', 'definition.closureTolerance',
    'definition.keep', 'definition.explodedDistance',
  ],
};

describe('WoodJointEditor presenter', () => {
  it('exposes complete typed fields and always-visible fit controls for every joint kind', () => {
    for (const kind of WOOD_JOINT_KINDS) {
      const presenter = createWoodJointEditorPresenter(paramsFor(kind), {
        computedDefaults: {
          width: 1.5,
          depth: 0.75,
          length: 2,
          offset: 4,
          chamferDistance: 0.25,
          haunchWidth: 0.5,
          haunchDepth: 0.25,
        },
        unit: 'in',
      });
      const ids = presenter.fields.map((field) => field.id);

      expect(ids, kind).toEqual(expect.arrayContaining([
        'kind',
        'sideClearance',
        'endClearance',
        ...REQUIRED_FIELDS[kind],
      ]));
      expect(presenter.canApply, kind).toBe(true);
      expect(presenter.fields.find((field) => field.id === 'sideClearance')?.section).toBe('fit');
      expect(presenter.fields.find((field) => field.id === 'endClearance')?.section).toBe('fit');
    }
  });

  it('shows stock-derived defaults while keeping optional dimensions editable', () => {
    const presenter = createWoodJointEditorPresenter(paramsFor('mortiseTenon'), {
      computedDefaults: { width: 1.5, depth: 0.75, length: 2 },
    });

    expect(presenter.fields.find((field) => field.id === 'definition.width')).toMatchObject({
      type: 'number',
      value: 1.5,
      computed: true,
    });
    const update = applyWoodJointEditorValue(
      presenter.parameters,
      'definition.width',
      1.25
    );
    expect(update.ok).toBe(true);
    expect(update.parameters.definition).toMatchObject({ width: 1.25 });
    expect(update.parameters.width).toBe(1.25);
  });

  it('applies nested tuples, enumerations, booleans, and deterministic edge lists immutably', () => {
    const original = paramsFor('threeWayMiter');
    const angleUpdate = applyWoodJointEditorValue(
      original,
      'definition.memberAnglesDegrees.1',
      42
    );
    expect(angleUpdate.ok).toBe(true);
    expect(angleUpdate.parameters.definition).toMatchObject({
      memberAnglesDegrees: [45, 42, 45],
    });
    expect(original.definition).toMatchObject({ memberAnglesDegrees: [45, 45, 45] });

    const chamfer = paramsFor('chamfer');
    const modeUpdate = applyWoodJointEditorValue(chamfer, 'definition.mode', 'distanceAngle');
    const edgeUpdate = applyWoodJointEditorValue(
      modeUpdate.parameters,
      'definition.edgeIds',
      'edge-z, edge-a, edge-z'
    );
    expect(edgeUpdate.parameters.definition).toMatchObject({
      mode: 'distanceAngle',
      edgeIds: ['edge-a', 'edge-z'],
    });

    const housing = applyWoodJointEditorValue(paramsFor('dado'), 'definition.through', true);
    expect(housing.parameters.definition).toMatchObject({ through: true });
  });

  it('returns field-level diagnostics and disables apply for invalid values', () => {
    const result = applyWoodJointEditorValue(
      paramsFor('sawCut'),
      'definition.angleDegrees',
      180
    );
    const presenter = createWoodJointEditorPresenter(result.parameters);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'INVALID_SAW_ANGLE',
      fieldId: 'definition.angleDegrees',
    }));
    expect(presenter.canApply).toBe(false);
    expect(presenter.fields.find((field) => field.id === 'definition.angleDegrees')?.error)
      .toContain('between 0° and 180°');
  });

  it('uses human member labels and reselect actions without exposing raw IDs', () => {
    const presenter = createWoodJointEditorPresenter(paramsFor('threeWayMiter'), {
      memberLabels: ['Left rail · end face', 'Right rail · end face', 'Post · top face'],
    });
    const renderedValues = presenter.fields.map((field) => String(field.value)).join(' ');

    expect(renderedValues).toContain('Left rail · end face');
    expect(renderedValues).not.toContain('feature-0');
    expect(renderedValues).not.toContain('body-0');
    expect(presenter.actions.map((action) => action.id)).toEqual([
      'reselectMember:0',
      'reselectMember:1',
      'reselectMember:2',
    ]);
  });

  it('guides member roles, exposes occluded-face recovery, and resets centered offsets', () => {
    const mortise = createWoodJointEditorPresenter(paramsFor('mortiseTenon'));
    expect(mortise.fields.find((field) => field.id === 'members.0')?.label)
      .toBe('Member A · tenon end face');
    expect(mortise.fields.find((field) => field.id === 'members.1')?.label)
      .toBe('Member B · mortise end face');
    expect(mortise.fields.find((field) => field.id === 'members.1')?.help)
      .toContain('temporarily hidden');
    expect(mortise.guidance.join(' ')).toContain('restored automatically');

    const custom = applyWoodJointEditorValue(
      mortise.parameters,
      'definition.positionMode',
      'offset'
    );
    const shifted = applyWoodJointEditorValue(
      custom.parameters,
      'definition.widthOffset',
      0.375
    );
    const centered = applyWoodJointEditorValue(
      shifted.parameters,
      'definition.positionMode',
      'centered'
    );
    expect(centered.parameters.definition).toMatchObject({
      positionMode: 'centered',
      widthOffset: 0,
      thicknessOffset: 0,
    });

    const bridle = createWoodJointEditorPresenter(paramsFor('bridle'));
    expect(bridle.fields.find((field) => field.id === 'members.0')?.label)
      .toBe('Member A · tongue end face');
    expect(bridle.fields.find((field) => field.id === 'members.1')?.label)
      .toBe('Member B · fork end face');
    expect(bridle.fields.find((field) => field.id === 'definition.width')?.disabled)
      .toBe(true);
  });
});
