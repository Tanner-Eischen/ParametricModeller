import { describe, expect, it } from 'vitest';
import {
  createBoxFeature,
  rebuildBox,
  createRebuildContext,
  registerBodies,
} from '../../src/features';
import {
  JOIN_BODIES_FEATURE_TYPE,
  createJoinBodiesFeature,
  rebuildJoinBodies,
  validateJoinBodiesParams,
  type JoinBodiesParams,
} from '../../src/features/transform';

describe('JoinBodiesFeature', () => {
  it('validates that at least two bodies are required', () => {
    const diagnostics = validateJoinBodiesParams({ bodyRefs: [] } as Partial<JoinBodiesParams>);
    expect(diagnostics.some((item) => item.code === 'INSUFFICIENT_BODIES')).toBe(true);
  });

  it('creates a join feature record', () => {
    const feature = createJoinBodiesFeature([
      { bodyId: 'body-1', featureId: 'feature-1' },
      { bodyId: 'body-2', featureId: 'feature-2' },
    ]);
    expect(feature.type).toBe(JOIN_BODIES_FEATURE_TYPE);
    expect(feature.refsIn).toEqual(['feature-1', 'feature-2']);
  });

  it('joins multiple bodies into one result and replaces the originals', () => {
    const firstFeature = createBoxFeature({ width: 1, depth: 1, height: 1, origin: [0, 0, 0] });
    const secondFeature = createBoxFeature({ width: 1, depth: 1, height: 1, origin: [2, 0, 0] });

    const firstResult = rebuildBox(firstFeature, createRebuildContext());
    const secondResult = rebuildBox(secondFeature, createRebuildContext());
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;

    let context = createRebuildContext();
    context = registerBodies(context, firstFeature.id, firstResult.bodies);
    context = registerBodies(context, secondFeature.id, secondResult.bodies);

    const joinFeature = createJoinBodiesFeature([
      { bodyId: firstResult.bodies[0]!.id, featureId: firstFeature.id },
      { bodyId: secondResult.bodies[0]!.id, featureId: secondFeature.id },
    ]);

    const result = rebuildJoinBodies(joinFeature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.replacedBodyIds).toEqual([
      firstResult.bodies[0]!.id,
      secondResult.bodies[0]!.id,
    ]);
    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0]!.id).toBe(firstResult.bodies[0]!.id);
    expect(result.bodies[0]!.vertices.size).toBeGreaterThan(8);
  });

  it('drops the shared interior faces for face-to-face joins', () => {
    const firstFeature = createBoxFeature({ width: 1, depth: 1, height: 1, origin: [0, 0, 0] });
    const secondFeature = createBoxFeature({ width: 1, depth: 1, height: 1, origin: [1, 0, 0] });

    const firstResult = rebuildBox(firstFeature, createRebuildContext());
    const secondResult = rebuildBox(secondFeature, createRebuildContext());
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;

    let context = createRebuildContext();
    context = registerBodies(context, firstFeature.id, firstResult.bodies);
    context = registerBodies(context, secondFeature.id, secondResult.bodies);

    const feature = createJoinBodiesFeature([
      { bodyId: firstResult.bodies[0]!.id, featureId: firstFeature.id },
      { bodyId: secondResult.bodies[0]!.id, featureId: secondFeature.id },
    ]);

    const result = rebuildJoinBodies(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bodies[0]!.faces.size).toBe(10);
  });

  it('fails closed when selected bodies overlap volumetrically', () => {
    const firstFeature = createBoxFeature({ width: 1, depth: 1, height: 1, origin: [0, 0, 0] });
    const secondFeature = createBoxFeature({ width: 1, depth: 1, height: 1, origin: [0.5, 0, 0] });

    const firstResult = rebuildBox(firstFeature, createRebuildContext());
    const secondResult = rebuildBox(secondFeature, createRebuildContext());
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;

    let context = createRebuildContext();
    context = registerBodies(context, firstFeature.id, firstResult.bodies);
    context = registerBodies(context, secondFeature.id, secondResult.bodies);

    const feature = createJoinBodiesFeature([
      { bodyId: firstResult.bodies[0]!.id, featureId: firstFeature.id },
      { bodyId: secondResult.bodies[0]!.id, featureId: secondFeature.id },
    ]);

    const result = rebuildJoinBodies(feature, context);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((item) => item.code === 'OVERLAPPING_BODIES')).toBe(true);
  });
});
