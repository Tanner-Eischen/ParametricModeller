import { describe, expect, it } from 'vitest';
import {
  createFacePlacementRef,
  createEdgePlacementRef,
  createRebuildContext,
  createWoodJointFeature,
  planWoodJoint,
  rebuildWoodJoint,
  registerBodies,
  validateWoodJointParams,
  WOOD_JOINT_KINDS,
  type RebuildContext,
  type WoodJointMemberRef,
  type WoodJointParams,
} from '../../../src/features';
import { createBoxBody } from '../../../src/features/primitives/BoxFeature';
import {
  hashGeometry,
  measureBody,
  validateClosedManifoldBody,
  type Body,
} from '../../../src/geometry';

interface BoxFixture {
  featureId: string;
  body: Body;
}

function box(
  featureId: string,
  origin: [number, number, number],
  dimensions: [number, number, number]
): BoxFixture {
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

function contextFor(...fixtures: BoxFixture[]): RebuildContext {
  return fixtures.reduce(
    (context, fixture) => registerBodies(
      context,
      fixture.featureId,
      [fixture.body]
    ),
    createRebuildContext()
  );
}

function faceMember(fixture: BoxFixture, faceId: string): WoodJointMemberRef {
  return {
    bodyRef: { featureId: fixture.featureId, bodyId: fixture.body.id },
    datumRef: createFacePlacementRef(fixture.featureId, fixture.body.id, faceId),
  };
}

function edgeMember(fixture: BoxFixture, edgeId: string): WoodJointMemberRef {
  return {
    bodyRef: { featureId: fixture.featureId, bodyId: fixture.body.id },
    datumRef: createEdgePlacementRef(fixture.featureId, fixture.body.id, edgeId),
  };
}

function feature(
  params: Omit<WoodJointParams, 'sideClearance' | 'endClearance'> &
    Partial<Pick<WoodJointParams, 'sideClearance' | 'endClearance'>>,
  id: string
) {
  const result = createWoodJointFeature(params);
  result.id = id;
  return result;
}

function expectValidBodies(bodies: Body[]): void {
  expect(bodies.every((body) => validateClosedManifoldBody(body).ok)).toBe(true);
}

describe('woodJoint paired rectangular joints', () => {
  it('builds complementary mortise and tenon edits with exact source IDs', () => {
    const rail = box('rail', [0, 1.5, 1.5], [6, 3, 3]);
    const post = box('post', [4, 0, 0], [4, 6, 6]);
    const joint = feature({
      kind: 'mortiseTenon',
      members: [faceMember(rail, '+X'), faceMember(post, '-X')],
      width: 1.5,
      depth: 1.5,
      length: 2,
      sideClearance: 0,
      endClearance: 0,
    }, 'mortise-tenon');
    const result = rebuildWoodJoint(joint, contextFor(rail, post));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.bodies.map((body) => body.id)).toEqual([rail.body.id, post.body.id]);
    expect(result.replacedBodyIds).toEqual([rail.body.id, post.body.id]);
    expectValidBodies(result.bodies);
    expect(measureBody(result.bodies[0]!).volume).toBeLessThan(measureBody(rail.body).volume);
    expect(measureBody(result.bodies[1]!).volume).toBeLessThan(measureBody(post.body).volume);

    const plan = planWoodJoint(joint, contextFor(rail, post));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.manufacturingOperations.map((operation) => operation.kind))
      .toEqual(['tenon', 'mortise']);
    expect(plan.plan.manufacturingOperations.every((operation) =>
      operation.sideClearance === 0 && operation.endClearance === 0
    )).toBe(true);
  });

  it.each([
    ['dado', [3, -1, 1] as [number, number, number]],
    ['rabbet', [0, -1, 1] as [number, number, number]],
  ] as const)('executes a guarded %s housing from member overlap', (kind, partnerOrigin) => {
    const panel = box('panel', [0, 0, 0], [8, 4, 2]);
    const partner = box('partner', partnerOrigin, [2, 6, 1]);
    const joint = feature({
      kind,
      members: [faceMember(panel, '+Z'), faceMember(partner, '-Z')],
      sideClearance: 0,
      endClearance: 0,
    }, `${kind}-joint`);
    const result = rebuildWoodJoint(joint, contextFor(panel, partner));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.bodies.map((body) => body.id)).toEqual([panel.body.id, partner.body.id]);
    expectValidBodies(result.bodies);
    expect(measureBody(result.bodies[0]!).volume).toBeLessThan(measureBody(panel.body).volume);
    expect(measureBody(result.bodies[1]!).volume).toBe(measureBody(partner.body).volume);
  });

  it('cuts complementary halves from a crossing half-lap', () => {
    const first = box('first', [0, 2, 0], [8, 2, 2]);
    const second = box('second', [3, 0, 0], [2, 6, 2]);
    const joint = feature({
      kind: 'halfLap',
      members: [faceMember(first, '+Z'), faceMember(second, '-Z')],
      sideClearance: 0,
      endClearance: 0,
    }, 'half-lap');
    const result = rebuildWoodJoint(joint, contextFor(first, second));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.bodies.map((body) => body.id)).toEqual([first.body.id, second.body.id]);
    expectValidBodies(result.bodies);
    expect(measureBody(result.bodies[0]!).volume).toBeLessThan(measureBody(first.body).volume);
    expect(measureBody(result.bodies[1]!).volume).toBeLessThan(measureBody(second.body).volume);
    expect([...result.bodies[0]!.vertices.values()].some((vertex) =>
      vertex.position[0] === 3 && vertex.position[2] === 1
    )).toBe(true);
    expect([...result.bodies[1]!.vertices.values()].some((vertex) =>
      vertex.position[1] === 2 && vertex.position[2] === 1
    )).toBe(true);
  });

  it('builds a rectangular open-slot bridle on equal-thickness members', () => {
    const tenon = box('tenon', [0, 0, 0], [6, 2, 2]);
    const fork = box('fork', [4, 0, 0], [4, 2, 2]);
    const joint = feature({
      kind: 'bridle',
      members: [faceMember(tenon, '+X'), faceMember(fork, '-X')],
      width: 1,
      length: 2,
      sideClearance: 0,
      endClearance: 0,
    }, 'bridle');
    const result = rebuildWoodJoint(joint, contextFor(tenon, fork));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodies.map((body) => body.id)).toEqual([tenon.body.id, fork.body.id]);
    expectValidBodies(result.bodies);
    expect(measureBody(result.bodies[0]!).volume).toBeLessThan(measureBody(tenon.body).volume);
    expect(measureBody(result.bodies[1]!).volume).toBeLessThan(measureBody(fork.body).volume);
  });

  it('cuts an offset mortise and tenon inward from normally meeting board ends', () => {
    const rail = box('end-rail', [0, 1, 1], [6, 4, 4]);
    const post = box('end-post', [6, 0, 0], [4, 6, 6]);
    const joint = feature({
      kind: 'mortiseTenon',
      members: [faceMember(rail, '+X'), faceMember(post, '-X')],
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'mortiseTenon',
        width: 1,
        thickness: 1,
        length: 2,
        positionMode: 'offset',
        widthOffset: 1,
        thicknessOffset: -0.5,
        shoulderMode: 'fourSided',
        haunchEnabled: false,
      },
    }, 'offset-end-mortise');
    const context = contextFor(rail, post);
    const result = rebuildWoodJoint(joint, context);

    expect(result.ok, !result.ok ? JSON.stringify(result) : undefined).toBe(true);
    if (!result.ok) return;
    expect(result.bodies.map((body) => body.id)).toEqual([rail.body.id, post.body.id]);
    expectValidBodies(result.bodies);
    expect(measureBody(result.bodies[0]!).volume).toBeLessThan(measureBody(rail.body).volume);
    expect(measureBody(result.bodies[1]!).volume).toBeLessThan(measureBody(post.body).volume);
    expect([...result.bodies[0]!.vertices.values()].some((vertex) =>
      vertex.position[1] === 3.5 && vertex.position[2] === 2
    )).toBe(true);

    const plan = planWoodJoint(joint, context);
    expect(plan).toMatchObject({
      ok: true,
      plan: {
        edits: [
          { bounds: { min: [4, 1, 1], max: [6, 5, 5] } },
          { bounds: { min: [6, 1, 1], max: [8, 5, 5] } },
        ],
      },
    });
    const hashes = Array.from({ length: 10 }, () => {
      const rebuilt = rebuildWoodJoint(joint, context);
      return rebuilt.ok ? hashGeometry(rebuilt.bodies) : 'failed';
    });
    expect(new Set(hashes).size).toBe(1);
  });

  it('uses automatic bridle sizing and applies its position to both pieces', () => {
    const tongue = box('guided-tongue', [0, 0, 0], [6, 3, 2]);
    const fork = box('guided-fork', [6, 0, 0], [4, 3, 2]);
    const joint = feature({
      kind: 'bridle',
      members: [faceMember(tongue, '+X'), faceMember(fork, '-X')],
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'bridle',
        widthMode: 'automatic',
        length: 2,
        offset: 0.5,
        shoulderMode: 'twoSided',
      },
    }, 'guided-bridle');
    const result = rebuildWoodJoint(joint, contextFor(tongue, fork));

    expect(result.ok, !result.ok ? JSON.stringify(result) : undefined).toBe(true);
    if (!result.ok) return;
    expectValidBodies(result.bodies);
    expect([...result.bodies[0]!.vertices.values()].some((vertex) =>
      vertex.position[1] === 1.5
    )).toBe(true);
    expect([...result.bodies[1]!.vertices.values()].some((vertex) =>
      vertex.position[1] === 2.5
    )).toBe(true);
  });

  it('fails closed when a mortise position leaves the member end', () => {
    const rail = box('bad-offset-rail', [0, 1, 1], [6, 4, 4]);
    const post = box('bad-offset-post', [6, 0, 0], [4, 6, 6]);
    const joint = feature({
      kind: 'mortiseTenon',
      members: [faceMember(rail, '+X'), faceMember(post, '-X')],
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'mortiseTenon',
        width: 1,
        thickness: 1,
        length: 2,
        positionMode: 'offset',
        widthOffset: 2,
        thicknessOffset: 0,
        shoulderMode: 'fourSided',
        haunchEnabled: false,
      },
    }, 'bad-offset-mortise');

    expect(rebuildWoodJoint(joint, contextFor(rail, post))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'JOINT_POSITION_OUT_OF_BOUNDS' }],
    });
  });
});

describe('woodJoint unary planar stock operations', () => {
  it('splits a board by explicit saw kerf and can keep both pieces', () => {
    const board = box('board', [0, 0, 0], [8, 2, 2]);
    const joint = feature({
      kind: 'sawCut',
      members: [faceMember(board, '+X')],
      offset: 4,
      kerf: 0.125,
      keep: 'both',
      sideClearance: 0,
      endClearance: 0,
    }, 'saw-split');
    const result = rebuildWoodJoint(joint, contextFor(board));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.bodies).toHaveLength(2);
    expect(result.bodies.some((body) => body.id === board.body.id)).toBe(true);
    expectValidBodies(result.bodies);
    expect(result.bodies.reduce((sum, body) => sum + measureBody(body).volume, 0))
      .toBeCloseTo(31.5, 6);
  });

  it('executes an angled saw kerf and records its manufacturing angle', () => {
    const board = box('angled-board', [0, 0, 0], [8, 2, 2]);
    const joint = feature({
      kind: 'sawCut',
      members: [faceMember(board, '+X')],
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'sawCut',
        angleDegrees: 45,
        offset: 4,
        kerf: 0.125,
        keep: 'both',
      },
    }, 'angled-saw');

    const result = rebuildWoodJoint(joint, contextFor(board));
    expect(result.ok, !result.ok ? JSON.stringify(result) : undefined).toBe(true);
    if (!result.ok) return;
    expect(result.bodies).toHaveLength(2);
    expectValidBodies(result.bodies);

    const plan = planWoodJoint(joint, contextFor(board));
    expect(plan).toMatchObject({
      ok: true,
      plan: {
        manufacturingOperations: [{ removal: { angleDegrees: 45, kerf: 0.125 } }],
      },
    });
  });

  it('creates a planar 45-degree chamfer along an exact edge', () => {
    const board = box('board', [0, 0, 0], [8, 2, 2]);
    const joint = feature({
      kind: 'chamfer',
      members: [edgeMember(board, '+Y+Z')],
      chamferWidth: 0.5,
      sideClearance: 0,
      endClearance: 0,
    }, 'chamfer');
    const result = rebuildWoodJoint(joint, contextFor(board));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0]!.id).toBe(board.body.id);
    expectValidBodies(result.bodies);
    expect(measureBody(result.bodies[0]!).volume).toBeCloseTo(31, 6);
  });

  it('applies one distance-angle chamfer to multiple compatible edges', () => {
    const board = box('multi-chamfer-board', [0, 0, 0], [8, 2, 2]);
    const joint = feature({
      kind: 'chamfer',
      members: [edgeMember(board, '+Y+Z')],
      sideClearance: 0,
      endClearance: 0,
      definition: {
        kind: 'chamfer',
        mode: 'distanceAngle',
        distance: 0.5,
        angleDegrees: 30,
        edgeIds: ['-Y+Z'],
      },
    }, 'multi-chamfer');

    const result = rebuildWoodJoint(joint, contextFor(board));
    expect(result.ok, !result.ok ? JSON.stringify(result) : undefined).toBe(true);
    if (!result.ok) return;
    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0]!.id).toBe(board.body.id);
    expectValidBodies(result.bodies);
    expect(result.bodies[0]!.vertices.size).toBeGreaterThan(10);
    expect(measureBody(result.bodies[0]!).volume).toBeLessThan(
      measureBody(board.body).volume
    );
  });

  it('delegates an exact square-stock three-way end treatment', () => {
    const board = box('board', [0, 0, 0], [6, 2, 2]);
    const member = faceMember(board, '+X');
    member.cornerVertexId = '+X+Y+Z';
    const joint = feature({
      kind: 'threeWayMiter',
      members: [member],
      resultMode: 'trim',
      sideClearance: 0,
      endClearance: 0,
    }, 'three-way');
    const result = rebuildWoodJoint(joint, contextFor(board));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0]!.id).toBe(board.body.id);
    expectValidBodies(result.bodies);
    expect(measureBody(result.bodies[0]!).volume).toBeLessThan(measureBody(board.body).volume);
  });
});

describe('woodJoint guarded rebuild behavior', () => {
  it('provides typed validation coverage for every declared joint kind', () => {
    const unary = new Set(['sawCut', 'chamfer']);
    for (const kind of WOOD_JOINT_KINDS) {
      const memberCount = unary.has(kind) ? 1 : kind === 'threeWayMiter' ? 3 : 2;
      const members = Array.from({ length: memberCount }, (_, index): WoodJointMemberRef => ({
        bodyRef: { featureId: `feature-${index}`, bodyId: `body-${index}` },
        datumRef:
          kind === 'chamfer'
            ? {
                kind: 'edge',
                featureId: `feature-${index}`,
                bodyId: `body-${index}`,
                edgeId: `edge-${index}`,
              }
            : {
                kind: 'face',
                featureId: `feature-${index}`,
                bodyId: `body-${index}`,
                faceId: `face-${index}`,
              },
        ...(kind === 'threeWayMiter' ? { cornerVertexId: `corner-${index}` } : {}),
      }));
      expect(validateWoodJointParams({
        kind,
        members,
        sideClearance: 0,
        endClearance: 0,
      }), kind).toEqual([]);
    }
  });

  it('fails closed on a broken exact datum', () => {
    const board = box('board', [0, 0, 0], [8, 2, 2]);
    const member = faceMember(board, '+X');
    member.datumRef = createFacePlacementRef(board.featureId, board.body.id, 'lost-face');
    const joint = feature({
      kind: 'sawCut',
      members: [member],
      kerf: 0.125,
      sideClearance: 0,
      endClearance: 0,
    }, 'broken');

    expect(rebuildWoodJoint(joint, contextFor(board))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'BROKEN_PLACEMENT_FACE_REF', featureId: 'broken' }],
    });
  });

  it('fails closed when signed clearance collapses the mortise', () => {
    const rail = box('rail', [0, 1.5, 1.5], [6, 3, 3]);
    const post = box('post', [4, 0, 0], [4, 6, 6]);
    const joint = feature({
      kind: 'mortiseTenon',
      members: [faceMember(rail, '+X'), faceMember(post, '-X')],
      width: 1,
      depth: 1,
      sideClearance: -0.5,
      endClearance: 0,
    }, 'collapsed');

    expect(rebuildWoodJoint(joint, contextFor(rail, post))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'COLLAPSED_CLEARANCE' }],
    });
  });

  it('produces identical body IDs and geometry hashes across ten rebuilds', () => {
    const first = box('first', [0, 2, 0], [8, 2, 2]);
    const second = box('second', [3, 0, 0], [2, 6, 2]);
    const joint = feature({
      kind: 'halfLap',
      members: [faceMember(first, '+Z'), faceMember(second, '-Z')],
      sideClearance: 0,
      endClearance: 0,
    }, 'deterministic-half-lap');
    const context = contextFor(first, second);

    const snapshots = Array.from({ length: 10 }, () => {
      const result = rebuildWoodJoint(joint, context);
      expect(result).toMatchObject({ ok: true });
      return result.ok
        ? {
            ids: result.bodies.map((body) => body.id),
            hash: hashGeometry(result.bodies),
          }
        : null;
    });
    expect(new Set(snapshots.map((snapshot) => JSON.stringify(snapshot))).size).toBe(1);
  });
});
