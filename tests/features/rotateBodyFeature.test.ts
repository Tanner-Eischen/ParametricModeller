import { describe, expect, it } from 'vitest';
import {
  createBoxFeature,
  rebuildBox,
  createRebuildContext,
  registerBodies,
  createRebuildEngine,
} from '../../src/features';
import {
  ROTATE_BODY_FEATURE_TYPE,
  createRotateBodyFeature,
  rebuildRotateBody,
  validateRotateBodyParams,
  type RotateBodyParams,
} from '../../src/features/transform';
import { getBodyBoundingBox, hashBodyGeometry } from '../../src/geometry';

describe('RotateBodyFeature', () => {
  it('rotates the exact historical feature output rather than a later body with the same ID', () => {
    const source = createBoxFeature({ width: 10, depth: 2, height: 1, origin: [0, 0, 0] });
    const engine = createRebuildEngine();
    engine.registerHandler('box', rebuildBox);
    engine.registerHandler('rotateBody', rebuildRotateBody);
    const initial = engine.rebuild([source]);
    if (!initial.ok) throw new Error(initial.error);
    const bodyId = initial.bodies[0]!.id;
    const first = createRotateBodyFeature({ featureId: source.id, bodyId }, [0, 0, 90], 'worldOrigin');
    const fromOriginal = createRotateBodyFeature({ featureId: source.id, bodyId }, [0, 0, 90], 'worldOrigin');
    const fromRotation = createRotateBodyFeature({ featureId: first.id, bodyId }, [0, 0, 90], 'worldOrigin');
    const originalHistory = engine.rebuild([source, first, fromOriginal]);
    const cumulativeHistory = engine.rebuild([source, first, fromRotation]);
    expect(originalHistory.ok).toBe(true);
    expect(cumulativeHistory.ok).toBe(true);
    if (!originalHistory.ok || !cumulativeHistory.ok) return;
    expect(originalHistory.bodies).toHaveLength(1);
    expect(hashBodyGeometry(originalHistory.bodies[0]!)).toBe(hashBodyGeometry(originalHistory.bodiesByFeature.get(first.id)![0]!));
    const bounds = getBodyBoundingBox(cumulativeHistory.bodies[0]!);
    expect(bounds.min[0]).toBeCloseTo(-10, 8);
    expect(bounds.min[1]).toBeCloseTo(-2, 8);
    expect(bounds.max[0]).toBeCloseTo(0, 8);
    expect(bounds.max[1]).toBeCloseTo(0, 8);
    expect(hashBodyGeometry(originalHistory.bodiesByFeature.get(source.id)![0]!)).toBe(hashBodyGeometry(initial.bodies[0]!));
  });

  it('fails closed for mismatched feature/body ownership even when the body exists in the current scene', () => {
    const source = createBoxFeature({ width: 10, depth: 2, height: 1 });
    const built = rebuildBox(source, createRebuildContext());
    if (!built.ok) throw new Error(built.error);
    const context = registerBodies(createRebuildContext(), source.id, built.bodies);
    const feature = createRotateBodyFeature({ featureId: 'another-feature', bodyId: built.bodies[0]!.id }, [0, 0, 90]);
    const result = rebuildRotateBody(feature, context);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'BODY_NOT_FOUND' }));
  });

  it('continues to support saved rotations with an omitted legacy pivot', () => {
    const source = createBoxFeature({ width: 10, depth: 2, height: 1, origin: [0, 0, 0] });
    const built = rebuildBox(source, createRebuildContext());
    if (!built.ok) throw new Error(built.error);
    const context = registerBodies(createRebuildContext(), source.id, built.bodies);
    const feature = createRotateBodyFeature({ featureId: source.id, bodyId: built.bodies[0]!.id }, [0, 0, 90]);
    delete feature.parameters.pivot;
    const result = rebuildRotateBody(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bounds = getBodyBoundingBox(result.bodies[0]!);
    expect((bounds.min[0] + bounds.max[0]) / 2).toBeCloseTo(5, 8);
    expect((bounds.min[1] + bounds.max[1]) / 2).toBeCloseTo(1, 8);
  });

  it('validates missing body references', () => {
    const diagnostics = validateRotateBodyParams({ rotationDegrees: [0, 0, 15] } as Partial<RotateBodyParams>);
    expect(diagnostics.some((item) => item.code === 'MISSING_BODY_REF')).toBe(true);
  });

  it('creates a rotate feature record', () => {
    const feature = createRotateBodyFeature({ bodyId: 'body-1', featureId: 'feature-1' });
    expect(feature.type).toBe(ROTATE_BODY_FEATURE_TYPE);
    expect(feature.refsIn).toEqual(['feature-1']);
  });

  it('rotates a box around its center and replaces the source body', () => {
    const sourceFeature = createBoxFeature({
      width: 2,
      depth: 1,
      height: 1,
      origin: [0, 0, 0],
    });

    const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
    expect(sourceResult.ok).toBe(true);
    if (!sourceResult.ok) return;

    let context = createRebuildContext();
    context = registerBodies(context, sourceFeature.id, sourceResult.bodies);
    const sourceBody = sourceResult.bodies[0]!;

    const rotateFeature = createRotateBodyFeature(
      { bodyId: sourceBody.id, featureId: sourceFeature.id },
      [0, 0, 90]
    );

    const result = rebuildRotateBody(rotateFeature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.replacedBodyIds).toEqual([sourceBody.id]);
    expect(result.bodies[0]?.id).toBe(sourceBody.id);

    const positions = Array.from(result.bodies[0]!.vertices.values()).map((vertex) => vertex.position);
    const centerX = positions.reduce((sum, point) => sum + point[0], 0) / positions.length;
    const centerY = positions.reduce((sum, point) => sum + point[1], 0) / positions.length;
    expect(centerX).toBeCloseTo(1, 5);
    expect(centerY).toBeCloseTo(0.5, 5);
  });
});
