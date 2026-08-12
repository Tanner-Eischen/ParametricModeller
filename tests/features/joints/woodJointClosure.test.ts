import { describe, expect, it } from 'vitest';
import {
  createFacePlacementRef,
  createRebuildContext,
  createWoodJointExplodedPreviewPlan,
  createWoodJointFeature,
  planWoodJoint,
  rebuildWoodJoint,
  registerBodies,
  type RebuildContext,
  type WoodJointMemberRef,
} from '../../../src/features';
import { createBoxBody } from '../../../src/features/primitives/BoxFeature';
import { hashGeometry, type Body } from '../../../src/geometry';

interface Fixture {
  featureId: string;
  body: Body;
}

function box(
  featureId: string,
  origin: [number, number, number],
  dimensions: [number, number, number]
): Fixture {
  return {
    featureId,
    body: createBoxBody({
      width: dimensions[0],
      depth: dimensions[1],
      height: dimensions[2],
      anchorMode: 'corner',
      origin,
    }, `${featureId}-body`),
  };
}

function member(fixture: Fixture, faceId: string, cornerVertexId: string): WoodJointMemberRef {
  return {
    bodyRef: { featureId: fixture.featureId, bodyId: fixture.body.id },
    datumRef: createFacePlacementRef(fixture.featureId, fixture.body.id, faceId),
    cornerVertexId,
  };
}

function contextFor(...fixtures: Fixture[]): RebuildContext {
  return fixtures.reduce(
    (context, fixture) => registerBodies(context, fixture.featureId, [fixture.body]),
    createRebuildContext()
  );
}

function orthogonalMembers(): { fixtures: Fixture[]; members: WoodJointMemberRef[] } {
  const a = box('member-a', [-4, -1, -1], [4, 2, 2]);
  const b = box('member-b', [-2, -3, -1], [2, 4, 2]);
  const c = box('member-c', [-2, -1, -3], [2, 2, 4]);
  return {
    fixtures: [a, b, c],
    members: [
      member(a, '+X', '+X+Y+Z'),
      member(b, '+Y', '+X+Y+Z'),
      member(c, '+Z', '+X+Y+Z'),
    ],
  };
}

describe('three-way miter closure and exploded preview', () => {
  it('reports deterministic member roles at one closed joint point', () => {
    const { fixtures, members } = orthogonalMembers();
    const feature = createWoodJointFeature({
      kind: 'threeWayMiter',
      members,
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'threeWayMiter',
        memberAnglesDegrees: [40, 45, 50],
        closureTolerance: 0.001,
        keep: 'trim',
        explodedDistance: 3,
      },
    });
    feature.id = 'closed-three-way';
    const context = contextFor(...fixtures);

    const snapshots = Array.from({ length: 10 }, () => planWoodJoint(feature, context));
    expect(snapshots.every((result) => result.ok)).toBe(true);
    const plans = snapshots.filter((result) => result.ok).map((result) => result.plan);
    expect(plans[0]!.threeWayClosure).toMatchObject({
      jointPoint: [0, 1, 1],
      maximumGap: 0,
      determinant: 1,
      roles: [
        { role: 'memberA', endAxis: [1, 0, 0], angleDegrees: 40 },
        { role: 'memberB', endAxis: [0, 1, 0], angleDegrees: 45 },
        { role: 'memberC', endAxis: [0, 0, 1], angleDegrees: 50 },
      ],
    });
    expect(new Set(plans.map((plan) => JSON.stringify(plan.threeWayClosure))).size).toBe(1);

    const rebuild = rebuildWoodJoint(feature, context);
    expect(rebuild.ok, !rebuild.ok ? JSON.stringify(rebuild) : undefined).toBe(true);
    if (rebuild.ok) expect(rebuild.bodies).toHaveLength(3);
  });

  it('creates non-authoritative deterministic preview transforms without changing bodies', () => {
    const { fixtures, members } = orthogonalMembers();
    const feature = createWoodJointFeature({
      kind: 'threeWayMiter',
      members,
      sideClearance: 0,
      endClearance: 0,
    });
    feature.id = 'exploded-three-way';
    const context = contextFor(...fixtures);
    const before = hashGeometry(fixtures.map((fixture) => fixture.body));

    const result = createWoodJointExplodedPreviewPlan(feature, context, 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      authoritative: false,
      distance: 2,
      members: [
        { role: 'memberA', direction: [1, 0, 0] },
        { role: 'memberB', direction: [0, 1, 0] },
        { role: 'memberC', direction: [0, 0, 1] },
      ],
    });
    expect(result.plan.members.map((entry) => entry.transform.slice(12, 15))).toEqual([
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ]);
    expect(hashGeometry(fixtures.map((fixture) => fixture.body))).toBe(before);
  });

  it('fails closed with an actionable gap diagnostic', () => {
    const { fixtures, members } = orthogonalMembers();
    const shifted = box('member-c-shifted', [-1.98, -1, -3], [2, 2, 4]);
    fixtures[2] = shifted;
    members[2] = member(shifted, '+Z', '+X+Y+Z');
    const feature = createWoodJointFeature({
      kind: 'threeWayMiter',
      members,
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'threeWayMiter',
        memberAnglesDegrees: [45, 45, 45],
        closureTolerance: 0.001,
        keep: 'trim',
      },
    });
    feature.id = 'gapped-three-way';

    expect(planWoodJoint(feature, contextFor(...fixtures))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'THREE_WAY_CLOSURE_GAP', featureId: feature.id }],
    });
  });

  it('fails closed when member axes cannot define three complementary roles', () => {
    const { fixtures, members } = orthogonalMembers();
    const parallel = box('member-c-parallel', [-4, -1, -1], [4, 2, 2]);
    fixtures[2] = parallel;
    members[2] = member(parallel, '+X', '+X+Y+Z');
    const feature = createWoodJointFeature({
      kind: 'threeWayMiter',
      members,
      sideClearance: 0,
      endClearance: 0,
    });
    feature.id = 'interfering-three-way';

    expect(planWoodJoint(feature, contextFor(...fixtures))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'THREE_WAY_INTERFERENCE', featureId: feature.id }],
    });
  });
});
