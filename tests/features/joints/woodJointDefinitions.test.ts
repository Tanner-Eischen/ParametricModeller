import { describe, expect, it } from 'vitest';
import {
  createDefaultWoodJointDefinition,
  definitionCompatibilityFields,
  normalizeWoodJointDefinition,
  validateWoodJointParams,
  validateWoodJointDefinition,
  WOOD_JOINT_KINDS,
} from '../../../src/features';

describe('WoodJointDefinitions', () => {
  it('provides a typed, valid default definition for every first-release joint', () => {
    for (const kind of WOOD_JOINT_KINDS) {
      const definition = createDefaultWoodJointDefinition(kind);
      expect(definition.kind).toBe(kind);
      expect(validateWoodJointDefinition(definition), kind).toEqual([]);
    }
  });

  it('preserves legacy flat values through canonical definitions and aliases', () => {
    const definition = createDefaultWoodJointDefinition('mortiseTenon', {
      width: 1.25,
      depth: 0.75,
      length: 2,
    });

    expect(definition).toMatchObject({
      kind: 'mortiseTenon',
      width: 1.25,
      thickness: 0.75,
      length: 2,
      shoulderMode: 'fourSided',
      haunchEnabled: false,
    });
    expect(definitionCompatibilityFields(definition)).toEqual({
      width: 1.25,
      depth: 0.75,
      length: 2,
    });

    expect(normalizeWoodJointDefinition('mortiseTenon', {
      kind: 'mortiseTenon',
      widthOffset: 0.25,
      thicknessOffset: -0.125,
    })).toMatchObject({ positionMode: 'offset' });
    expect(normalizeWoodJointDefinition('bridle', {
      kind: 'bridle',
      width: 0.75,
    })).toMatchObject({ widthMode: 'custom', width: 0.75 });
  });

  it('canonicalizes multi-edge chamfer identity deterministically', () => {
    const definition = normalizeWoodJointDefinition('chamfer', {
      kind: 'chamfer',
      mode: 'distanceAngle',
      distance: 0.125,
      angleDegrees: 30,
      edgeIds: ['edge-c', 'edge-a', 'edge-c', '', 'edge-b'],
    });

    expect(definition).toMatchObject({
      edgeIds: ['edge-a', 'edge-b', 'edge-c'],
      distance: 0.125,
      angleDegrees: 30,
    });
  });

  it('reports exact fields for invalid haunch, saw, chamfer, and closure values', () => {
    const invalidDefinitions = [
      {
        kind: 'mortiseTenon' as const,
        widthOffset: 0,
        thicknessOffset: 0,
        positionMode: 'centered' as const,
        shoulderMode: 'fourSided' as const,
        haunchEnabled: true,
        haunchWidth: -1,
        haunchDepth: 0,
      },
      {
        kind: 'sawCut' as const,
        angleDegrees: 180,
        kerf: 0,
        keep: 'both' as const,
      },
      {
        kind: 'chamfer' as const,
        mode: 'distanceAngle' as const,
        distance: 0,
        angleDegrees: 90,
        edgeIds: [],
      },
      {
        kind: 'threeWayMiter' as const,
        memberAnglesDegrees: [45, 0, 45] as [number, number, number],
        closureTolerance: 0,
        keep: 'trim' as const,
      },
    ];

    const fields = invalidDefinitions.flatMap((definition) =>
      validateWoodJointDefinition(definition).map((diagnostic) => diagnostic.field)
    );
    expect(fields).toEqual(expect.arrayContaining([
      'definition.haunchWidth',
      'definition.haunchDepth',
      'definition.angleDegrees',
      'definition.kerf',
      'definition.distance',
      'definition.memberAnglesDegrees.1',
      'definition.closureTolerance',
    ]));
  });

  it('fails closed instead of normalizing malformed persisted angle and edge lists', () => {
    const member = (index: number) => ({
      bodyRef: { featureId: `feature-${index}`, bodyId: `body-${index}` },
      datumRef: {
        kind: 'face' as const,
        featureId: `feature-${index}`,
        bodyId: `body-${index}`,
        faceId: `face-${index}`,
      },
      cornerVertexId: `corner-${index}`,
    });
    const threeWayDiagnostics = validateWoodJointParams({
      kind: 'threeWayMiter',
      members: [member(0), member(1), member(2)],
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'threeWayMiter',
        memberAnglesDegrees: [45, 45] as unknown as [number, number, number],
        closureTolerance: 0.001,
        keep: 'trim',
      },
    });
    const chamferDiagnostics = validateWoodJointParams({
      kind: 'chamfer',
      members: [{
        bodyRef: { featureId: 'feature', bodyId: 'body' },
        datumRef: {
          kind: 'edge',
          featureId: 'feature',
          bodyId: 'body',
          edgeId: 'edge',
        },
      }],
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'chamfer',
        mode: 'distance',
        distance: 0.25,
        angleDegrees: 45,
        edgeIds: null as unknown as string[],
      },
    });

    expect(threeWayDiagnostics.map((diagnostic) => diagnostic.code))
      .toContain('INVALID_THREE_WAY_ANGLES');
    expect(chamferDiagnostics.map((diagnostic) => diagnostic.code))
      .toContain('INVALID_CHAMFER_EDGE_LIST');
  });
});
