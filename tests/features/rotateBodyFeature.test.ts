import { describe, expect, it } from 'vitest';
import {
  createBoxFeature,
  rebuildBox,
  createRebuildContext,
  registerBodies,
} from '../../src/features';
import {
  ROTATE_BODY_FEATURE_TYPE,
  createRotateBodyFeature,
  rebuildRotateBody,
  validateRotateBodyParams,
  type RotateBodyParams,
} from '../../src/features/transform';

describe('RotateBodyFeature', () => {
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
