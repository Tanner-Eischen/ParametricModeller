import { describe, expect, it, vi } from 'vitest';
import {
  createComponentInstance,
  createIdentityTransform,
  createInstanceFaceRef,
} from '../../src/assembly/AssemblyTypes';
import { createBoxBody, type BoxParams } from '../../src/features/primitives/BoxFeature';
import {
  createEdgePointPlacementRef,
  createFaceCenterPlacementRef,
  createFacePlacementRef,
  createVertexPlacementRef,
} from '../../src/features/placement';
import { ToolSessionManager } from '../../src/interaction/ToolSessionManager';
import {
  MateToolSession,
  PlacementToolSession,
  type DocumentTransactionAdapter,
  type MatePreview,
  type PlacementPreview,
} from '../../src/ui/PlacementToolSession';

const BOX_PARAMS: BoxParams = {
  width: 1,
  depth: 1,
  height: 1,
  anchorMode: 'corner',
  origin: [0, 0, 0],
};

interface TestDocument {
  features: Array<Record<string, unknown>>;
  constraints: string[];
  transforms: Record<string, number[]>;
}

function documentAdapter(
  read: () => TestDocument,
  write: (next: TestDocument) => void
): DocumentTransactionAdapter<TestDocument> {
  return {
    capture: () => structuredClone(read()),
    restore: (snapshot) => write(structuredClone(snapshot)),
    serialize: (snapshot) => JSON.stringify(snapshot),
  };
}

describe('PlacementToolSession', () => {
  it('stages exact point datums, uses the production solver, and cancels byte-equivalently', () => {
    const sourceBody = createBoxBody(BOX_PARAMS, 'source-body');
    const targetBody = createBoxBody({
      ...BOX_PARAMS,
      origin: [10, 2, 3],
    }, 'target-body');
    let document: TestDocument = {
      features: [],
      constraints: [],
      transforms: {},
    };
    const baseline = JSON.stringify(document);
    const requests: string[] = [];
    const previews: PlacementPreview[] = [];
    const cancelled = vi.fn();
    const session = new PlacementToolSession({
      id: 'place:point',
      kind: 'point-to-point',
      mode: 'move',
      document: documentAdapter(() => document, (next) => { document = next; }),
      getPlacementContext: () => ({
        bodiesByFeature: new Map([
          ['source', [sourceBody]],
          ['target', [targetBody]],
        ]),
      }),
      onReferenceRequest: (request) => {
        if (request) requests.push(`${request.stage}:${request.requestedSelectionMode}`);
      },
      onPreview: (preview) => {
        previews.push(preview);
        document.transforms.preview = [...preview.matrix];
      },
      onCommit: vi.fn(),
      onCancel: cancelled,
    });
    const manager = new ToolSessionManager();

    manager.start(session);
    expect(session.stage).toBe('source-selection');
    expect(session.selectSources([{ featureId: 'source', bodyId: sourceBody.id }])).toBe(true);
    expect(session.selectDatum(
      createEdgePointPlacementRef('source', sourceBody.id, '+Y+Z', 0.25)
    )).toBe(true);
    expect(session.selectDatum(
      createFaceCenterPlacementRef('target', targetBody.id, '-X')
    )).toBe(true);

    expect(session.stage).toBe('numeric-preview');
    expect(session.phase).toBe('previewing');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.placement.type).toBe('PointToPoint');
    expect(requests).toEqual([
      'source-selection:body',
      'source-datum:vertex',
      'target-datum:vertex',
    ]);
    expect(manager.routeKey('Escape')).toEqual({
      handled: true,
      ended: true,
      reason: 'cancelled',
    });
    expect(JSON.stringify(document)).toBe(baseline);
    expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({ byteEquivalent: true }));
  });

  it('aligns exact faces with signed gap, opposed normal, and quarter-turn twist before one commit', () => {
    const sourceBody = createBoxBody(BOX_PARAMS, 'source-body');
    const targetBody = createBoxBody({ ...BOX_PARAMS, origin: [5, 0, 0] }, 'target-body');
    let document: TestDocument = { features: [], constraints: [], transforms: {} };
    const commits: PlacementPreview[] = [];
    const session = new PlacementToolSession({
      id: 'place:align',
      kind: 'align',
      mode: 'copy',
      initialSourceBodyRefs: [{ featureId: 'source', bodyId: sourceBody.id }],
      document: documentAdapter(() => document, (next) => { document = next; }),
      getPlacementContext: () => ({
        bodiesByFeature: new Map([
          ['source', [sourceBody]],
          ['target', [targetBody]],
        ]),
      }),
      onPreview: () => true,
      onCommit: (commit) => {
        commits.push(commit);
        document.features.push({
          id: 'feature:align',
          placement: structuredClone(commit.placement),
        });
      },
    });
    const manager = new ToolSessionManager();

    manager.start(session);
    expect(session.stage).toBe('source-datum');
    expect(session.selectDatum(
      createFacePlacementRef('source', sourceBody.id, '+X')
    )).toBe(true);
    expect(session.selectDatum(
      createFacePlacementRef('target', targetBody.id, '-X')
    )).toBe(true);
    expect(session.setAlignOptions({ gap: -1 / 16, opposed: true, quarterTurns: 1 })).toBe(true);

    expect(session.readState().preview?.placement).toMatchObject({
      type: 'Align',
      gap: -1 / 16,
      opposed: true,
      quarterTurns: 1,
    });
    const matrices = Array.from({ length: 10 }, () => {
      expect(session.setAlignOptions({ gap: -1 / 16, opposed: true, quarterTurns: 1 }))
        .toBe(true);
      return JSON.stringify(session.readState().preview?.matrix);
    });
    expect(new Set(matrices).size).toBe(1);
    expect(manager.routeKey('Enter')).toEqual({
      handled: true,
      ended: true,
      reason: 'committed',
    });
    expect(commits).toHaveLength(1);
    expect(document.features).toHaveLength(1);
  });

  it('fails closed on a broken target reference and does not commit', () => {
    const sourceBody = createBoxBody(BOX_PARAMS, 'source-body');
    const onCommit = vi.fn();
    const diagnostics = vi.fn();
    let document: TestDocument = { features: [], constraints: [], transforms: {} };
    const session = new PlacementToolSession({
      id: 'place:broken',
      kind: 'point-to-point',
      mode: 'move',
      initialSourceBodyRefs: [{ featureId: 'source', bodyId: sourceBody.id }],
      document: documentAdapter(() => document, (next) => { document = next; }),
      getPlacementContext: () => ({
        bodiesByFeature: new Map([['source', [sourceBody]]]),
      }),
      onPreview: vi.fn(),
      onDiagnostics: diagnostics,
      onCommit,
    });

    session.start();
    expect(session.selectDatum(
      createVertexPlacementRef('source', sourceBody.id, '+X+Y+Z')
    )).toBe(true);
    expect(session.selectDatum(
      createVertexPlacementRef('missing', 'missing-body', 'missing-vertex')
    )).toBe(false);
    expect(session.phase).toBe('awaiting-input');
    expect(session.commit()).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
    expect(diagnostics).toHaveBeenCalledWith([
      expect.objectContaining({ code: 'BROKEN_PLACEMENT_BODY_REF' }),
    ]);
  });

  it('rolls back a partially-mutating rejected commit', () => {
    const sourceBody = createBoxBody(BOX_PARAMS, 'source-body');
    const targetBody = createBoxBody({ ...BOX_PARAMS, origin: [2, 0, 0] }, 'target-body');
    let document: TestDocument = { features: [], constraints: [], transforms: {} };
    const baseline = JSON.stringify(document);
    const session = new PlacementToolSession({
      id: 'place:rejected',
      kind: 'point-to-point',
      mode: 'move',
      initialSourceBodyRefs: [{ featureId: 'source', bodyId: sourceBody.id }],
      document: documentAdapter(() => document, (next) => { document = next; }),
      getPlacementContext: () => ({
        bodiesByFeature: new Map([
          ['source', [sourceBody]],
          ['target', [targetBody]],
        ]),
      }),
      onPreview: () => true,
      onCommit: () => {
        document.features.push({ id: 'must-be-rolled-back' });
        return false;
      },
    });

    session.start();
    session.selectDatum(createVertexPlacementRef('source', sourceBody.id, '+X+Y+Z'));
    session.selectDatum(createVertexPlacementRef('target', targetBody.id, '-X-Y-Z'));
    expect(session.commit()).toBe(false);

    expect(JSON.stringify(document)).toBe(baseline);
    expect(session.phase).toBe('awaiting-input');
    expect(session.readState().diagnostics).toEqual([
      expect.objectContaining({ code: 'PLACEMENT_COMMIT_REJECTED' }),
    ]);
  });
});

describe('MateToolSession', () => {
  function mateFixture() {
    const instanceA = createComponentInstance('component', 'Fixed', createIdentityTransform());
    const instanceB = createComponentInstance('component', 'Moving', createIdentityTransform());
    instanceA.id = 'instance-a';
    instanceA.grounded = true;
    instanceB.id = 'instance-b';
    const bodyA = createBoxBody(BOX_PARAMS, 'body-a');
    const bodyB = createBoxBody(BOX_PARAMS, 'body-b');
    return { instanceA, instanceB, bodyA, bodyB };
  }

  it('previews a signed-offset exact-face mate with the real solver and cancels atomically', () => {
    const { instanceA, instanceB, bodyA, bodyB } = mateFixture();
    let document: TestDocument = { features: [], constraints: [], transforms: {} };
    const baseline = JSON.stringify(document);
    const previews: MatePreview[] = [];
    const session = new MateToolSession({
      id: 'mate:offset',
      type: 'offset',
      initialOffset: 0.25,
      document: documentAdapter(() => document, (next) => { document = next; }),
      getSolverContext: () => ({
        instances: [instanceA, instanceB],
        constraints: [],
        instanceBodies: new Map([
          [instanceA.id, [bodyA]],
          [instanceB.id, [bodyB]],
        ]),
      }),
      onPreview: (preview) => {
        previews.push(preview);
        document.transforms[instanceB.id] = [
          ...(preview.solve.updatedInstances.get(instanceB.id)?.transform ?? []),
        ];
      },
      onCommit: vi.fn(),
    });
    const manager = new ToolSessionManager();

    manager.start(session);
    expect(session.selectFace(createInstanceFaceRef(instanceA.id, '+Z', bodyA.id))).toBe(true);
    expect(session.selectFace(createInstanceFaceRef(instanceB.id, '-Z', bodyB.id))).toBe(true);

    expect(session.phase).toBe('previewing');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.constraint).toMatchObject({
      id: 'mate:offset',
      offset: 0.25,
      driving: true,
      status: 'satisfied',
    });
    expect(previews[0]?.solve.updatedInstances.get(instanceB.id)?.transform[14])
      .toBeCloseTo(1.25);
    manager.routeKey('Escape');
    expect(JSON.stringify(document)).toBe(baseline);
  });

  it('commits one constraint and solved transform, and rejects same-instance faces', () => {
    const { instanceA, instanceB, bodyA, bodyB } = mateFixture();
    let document: TestDocument = { features: [], constraints: [], transforms: {} };
    const diagnostics = vi.fn();
    const commits: MatePreview[] = [];
    const session = new MateToolSession({
      id: 'mate:flush',
      type: 'flush',
      document: documentAdapter(() => document, (next) => { document = next; }),
      getSolverContext: () => ({
        instances: [instanceA, instanceB],
        constraints: [],
        instanceBodies: new Map([
          [instanceA.id, [bodyA]],
          [instanceB.id, [bodyB]],
        ]),
      }),
      onPreview: () => true,
      onDiagnostics: diagnostics,
      onCommit: (preview) => {
        commits.push(preview);
        document.constraints.push(preview.constraint.id);
        document.transforms[instanceB.id] = [
          ...(preview.solve.updatedInstances.get(instanceB.id)?.transform ?? []),
        ];
      },
    });
    const manager = new ToolSessionManager();

    manager.start(session);
    expect(session.selectFace(createInstanceFaceRef(instanceA.id, '+Z', bodyA.id))).toBe(true);
    expect(session.selectFace(createInstanceFaceRef(instanceA.id, '-Z', bodyA.id))).toBe(false);
    expect(diagnostics).toHaveBeenLastCalledWith([
      expect.objectContaining({ code: 'MATE_SAME_INSTANCE' }),
    ]);
    expect(session.selectFace(createInstanceFaceRef(instanceB.id, '-Z', bodyB.id))).toBe(true);
    expect(manager.routeKey('Enter')).toEqual({
      handled: true,
      ended: true,
      reason: 'committed',
    });

    expect(commits).toHaveLength(1);
    expect(document.constraints).toEqual(['mate:flush']);
    expect(document.transforms[instanceB.id]?.[14]).toBeCloseTo(1);
  });

  it('previews a validate-only mate without authoritatively moving instances', () => {
    const { instanceA, instanceB, bodyA, bodyB } = mateFixture();
    let document: TestDocument = { features: [], constraints: [], transforms: {} };
    const previews: MatePreview[] = [];
    const session = new MateToolSession({
      id: 'mate:validate-only',
      type: 'offset',
      initialOffset: 0.5,
      driving: false,
      document: documentAdapter(() => document, (next) => { document = next; }),
      getSolverContext: () => ({
        instances: [instanceA, instanceB],
        constraints: [],
        instanceBodies: new Map([
          [instanceA.id, [bodyA]],
          [instanceB.id, [bodyB]],
        ]),
      }),
      onPreview: (preview) => { previews.push(preview); },
      onCommit: vi.fn(),
    });

    session.start();
    session.selectFace(createInstanceFaceRef(instanceA.id, '+Z', bodyA.id));
    expect(session.selectFace(createInstanceFaceRef(instanceB.id, '-Z', bodyB.id))).toBe(true);

    expect(previews[0]?.constraint.driving).toBe(false);
    expect(previews[0]?.constraint.status).toBe('unsatisfied');
    expect(previews[0]?.solve.updatedInstances.get(instanceB.id)?.transform)
      .toEqual(createIdentityTransform());
  });
});
