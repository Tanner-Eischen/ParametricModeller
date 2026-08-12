import { describe, expect, it } from 'vitest';
import {
  createBoxFeature,
  createExtrudeFeatureFromParams,
  createExtrudePreviewPlan,
  createRebuildContext,
  createSketchFeature,
  executeExtrudePlan,
  rebuildBox,
  type ExtrudeOperation,
  type SolidBooleanAdapter,
} from '../../src/features';
import { createWorldPlaneRef, createRectangleEntity } from '../../src/sketch';
import { createBody } from '../../src/geometry';

function fixture() {
  const boxFeature = createBoxFeature({ width: 4, depth: 4, height: 2 });
  const boxResult = rebuildBox(boxFeature, createRebuildContext());
  if (!boxResult.ok) throw new Error(boxResult.error);
  const target = boxResult.bodies[0]!;
  const sketch = createSketchFeature({
    planeRef: createWorldPlaneRef('xy', 0),
    entities: [createRectangleEntity([1, 1], 1, 1, 0, 'profile')],
    dimensions: [],
  });
  const context = createRebuildContext([boxFeature, sketch]);
  context.allBodies = [target];
  context.bodiesByFeature.set(boxFeature.id, [target]);
  return { boxFeature, target, sketch, context };
}

function featureFor(
  operation: ExtrudeOperation,
  extent: NonNullable<Parameters<typeof createExtrudeFeatureFromParams>[1]['extent']>
) {
  const { boxFeature, target, sketch, context } = fixture();
  const feature = createExtrudeFeatureFromParams(sketch, {
    operation,
    extent,
    targetBodyRef: { featureId: boxFeature.id, bodyId: target.id },
    sketchData: sketch.parameters as never,
  });
  return { feature, target, context };
}

describe('professional extrude extent workflow', () => {
  it.each([
    ['OneSided', 0, 4],
    ['Symmetric', -2, 2],
  ] as const)('resolves %s distance without mutating the document', (direction, minZ, maxZ) => {
    const { feature, context } = featureFor('New', {
      direction,
      limit: 'Distance',
      distance: 4,
    });
    const before = context.allBodies.length;
    const result = createExtrudePreviewPlan(feature, context);

    expect(result.ok).toBe(true);
    expect(context.allBodies).toHaveLength(before);
    if (!result.ok) return;
    const z = [...result.plan.toolBody.vertices.values()].map((vertex) => vertex.position[2]);
    expect(Math.min(...z)).toBeCloseTo(minZ);
    expect(Math.max(...z)).toBeCloseTo(maxZ);
  });

  it.each(['Add', 'Cut'] as const)('routes %s through the boolean adapter as one replacement', (operation) => {
    const { feature, target, context } = featureFor(operation, {
      direction: 'OneSided',
      limit: 'Distance',
      distance: 1,
    });
    let received: ExtrudeOperation | undefined;
    const adapter: SolidBooleanAdapter = {
      apply: (request) => {
        received = request.operation;
        return { ok: true, body: request.targetBody };
      },
    };
    const plan = createExtrudePreviewPlan(feature, context);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const execution = executeExtrudePlan(plan.plan, adapter);

    expect(execution.ok).toBe(true);
    expect(received).toBe(operation);
    if (execution.ok) expect(execution.result.replacedBodyIds).toEqual([target.id]);
  });

  it('resolves Up To Face and reports missing topology IDs fail-closed', () => {
    const valid = featureFor('Add', {
      direction: 'OneSided',
      limit: 'UpToFace',
      upToFaceRef: { featureId: '', bodyId: '', faceId: '' },
    });
    const params = valid.feature.parameters as Record<string, unknown> & {
      extent: { upToFaceRef: { featureId: string; bodyId: string; faceId: string } };
    };
    const targetFeatureId = valid.feature.refsIn.find((id) => id !== params.sketchId)!;
    params.extent.upToFaceRef = {
      featureId: targetFeatureId,
      bodyId: valid.target.id,
      faceId: '+Z',
    };
    const resolved = createExtrudePreviewPlan(valid.feature, valid.context);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.plan.extent.distance).toBeCloseTo(2);

    params.extent.upToFaceRef.faceId = 'missing-face';
    const broken = createExtrudePreviewPlan(valid.feature, valid.context);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.diagnostics[0]?.code).toBe('UP_TO_FACE_NOT_FOUND');
  });

  it.each(['OneSided', 'Symmetric'] as const)('resolves %s Through All against the typed target', (direction) => {
    const { feature, context } = featureFor('Cut', { direction, limit: 'ThroughAll' });
    const result = createExtrudePreviewPlan(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.extent.distance).toBeGreaterThan(2);
    if (direction === 'Symmetric') expect(result.plan.extent.startOffset).toBeLessThan(0);
  });

  it('produces identical geometry and topology for ten preview rebuilds', () => {
    const { feature, context } = featureFor('New', {
      direction: 'Symmetric',
      limit: 'Distance',
      distance: 3,
    });
    const hashes = Array.from({ length: 10 }, () => {
      const result = createExtrudePreviewPlan(feature, context);
      if (!result.ok) throw new Error(result.error);
      return JSON.stringify({
        vertices: [...result.plan.toolBody.vertices].map(([id, vertex]) => [id, vertex.position]),
        edges: [...result.plan.toolBody.edges.keys()],
        faces: [...result.plan.toolBody.faces.keys()],
      });
    });
    expect(new Set(hashes)).toHaveLength(1);
  });

  it('rejects invalid boolean output without replacing the target', () => {
    const { feature, target, context } = featureFor('Cut', {
      direction: 'OneSided',
      limit: 'Distance',
      distance: 1,
    });
    const originalVertexCount = target.vertices.size;
    const plan = createExtrudePreviewPlan(feature, context);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = executeExtrudePlan(plan.plan, {
      apply: () => ({ ok: true, body: createBody('invalid') }),
    });

    expect(result.ok).toBe(false);
    expect(target.vertices.size).toBe(originalVertexCount);
  });
});
