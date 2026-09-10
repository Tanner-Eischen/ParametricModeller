import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createBoxFeature,
  createRebuildContext,
  createResizeBodyFeature,
  rebuildBox,
  rebuildResizeBody,
  registerBodies,
  validateResizeBodyParams,
} from '../../src/features';
import { getBodyBoundingBox, transformVertexPositions, validateBody } from '../../src/geometry';

function fixture() {
  const sourceFeature = createBoxFeature({
    width: 2,
    depth: 3,
    height: 4,
    origin: [5, 6, 7],
  });
  sourceFeature.id = 'source-feature';
  const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
  if (!sourceResult.ok) throw new Error(sourceResult.error);
  const body = sourceResult.bodies[0]!;
  const context = registerBodies(createRebuildContext(), sourceFeature.id, [body]);
  return { sourceFeature, body, context };
}

describe('ResizeBodyFeature', () => {
  it('creates a history feature that references only the selected body owner', () => {
    const { sourceFeature, body } = fixture();
    const feature = createResizeBodyFeature(
      { featureId: sourceFeature.id, bodyId: body.id },
      [8, 9, 10]
    );

    expect(feature.refsIn).toEqual([sourceFeature.id]);
    expect(feature.parameters).toMatchObject({ width: 8, height: 9, depth: 10 });
  });

  it('resizes X/Y/Z exactly, preserves the minimum corner, and replaces the source result', () => {
    const { sourceFeature, body, context } = fixture();
    const feature = createResizeBodyFeature(
      { featureId: sourceFeature.id, bodyId: body.id },
      [8, 9, 10]
    );

    const result = rebuildResizeBody(feature, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bounds = getBodyBoundingBox(result.bodies[0]!);
    expect(bounds.min).toEqual([5, 6, 7]);
    expect(bounds.max).toEqual([13, 15, 17]);
    expect(result.replacedBodyIds).toEqual([body.id]);
    expect(validateBody(result.bodies[0]!).ok).toBe(true);
  });

  it('is deterministic across rebuilds', () => {
    const { sourceFeature, body, context } = fixture();
    const feature = createResizeBodyFeature(
      { featureId: sourceFeature.id, bodyId: body.id },
      [1.5, 2.5, 3.5]
    );
    feature.id = 'resize-feature';

    const first = rebuildResizeBody(feature, context);
    const second = rebuildResizeBody(feature, context);
    expect(first).toEqual(second);
  });

  it('preserves valid planar geometry when resizing a rotated solid', () => {
    const { sourceFeature, body } = fixture();
    const rotated = transformVertexPositions(
      body,
      new THREE.Matrix4().makeRotationY(Math.PI / 4),
      body.id
    );
    const context = registerBodies(createRebuildContext(), sourceFeature.id, [rotated]);
    const feature = createResizeBodyFeature(
      { featureId: sourceFeature.id, bodyId: rotated.id },
      [6, 7, 8]
    );

    const result = rebuildResizeBody(feature, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bounds = getBodyBoundingBox(result.bodies[0]!);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(6, 8);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(7, 8);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(8, 8);
    expect(validateBody(result.bodies[0]!).ok).toBe(true);
  });

  it('fails closed for invalid dimensions and missing bodies', () => {
    expect(validateResizeBodyParams({
      bodyRef: { featureId: 'source', bodyId: 'body' },
      width: 0,
      height: Number.NaN,
      depth: -1,
    }).map((item) => item.code)).toEqual([
      'INVALID_DIMENSION',
      'INVALID_DIMENSION',
      'INVALID_DIMENSION',
    ]);

    const feature = createResizeBodyFeature(
      { featureId: 'missing-feature', bodyId: 'missing-body' },
      [1, 2, 3]
    );
    expect(rebuildResizeBody(feature, createRebuildContext())).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'BODY_NOT_FOUND', entityId: 'missing-body' }],
    });
  });
});
