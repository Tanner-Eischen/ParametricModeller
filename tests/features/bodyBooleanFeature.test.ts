import { describe, expect, it } from 'vitest';
import {
  createBodyBooleanFeature,
  createBoxFeature,
  createRebuildContext,
  rebuildBodyBoolean,
  rebuildBox,
  registerBodies,
  validateBodyBooleanParams,
} from '../../src/features';
import { createBodyRef, validateClosedManifoldBody } from '../../src/geometry';

function buildBox(
  origin: [number, number, number],
  size: [number, number, number] = [2, 2, 2]
) {
  const feature = createBoxFeature({
    width: size[0],
    depth: size[1],
    height: size[2],
    origin,
  });
  const result = rebuildBox(feature, createRebuildContext());
  if (!result.ok) throw new Error(result.error);
  return { feature, body: result.bodies[0]! };
}

describe('BodyBooleanFeature', () => {
  it('requires an explicit target and tool body', () => {
    const diagnostics = validateBodyBooleanParams({
      operation: 'difference',
      targetBodyRef: { featureId: '', bodyId: '' },
      toolBodyRefs: [],
    });
    expect(diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['MISSING_TARGET_BODY', 'MISSING_TOOL_BODY'])
    );
  });

  it('rebuilds a boundary-crossing difference from exact feature outputs', () => {
    const target = buildBox([0, 0, 0]);
    const tool = buildBox([0.5, -1, 0.5], [1, 4, 1]);
    let context = createRebuildContext([target.feature, tool.feature]);
    context = registerBodies(context, target.feature.id, [target.body]);
    context = registerBodies(context, tool.feature.id, [tool.body]);
    const feature = createBodyBooleanFeature({
      operation: 'difference',
      targetBodyRef: createBodyRef(target.feature.id, target.body.id),
      toolBodyRefs: [createBodyRef(tool.feature.id, tool.body.id)],
      keepTools: false,
    });

    const result = rebuildBodyBoolean(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replacedBodyIds).toEqual([target.body.id, tool.body.id]);
    expect(result.bodies[0]!.id).toBe(target.body.id);
    expect(validateClosedManifoldBody(result.bodies[0]!).ok).toBe(true);
  });

  it('fails closed rather than resolving an unrelated body', () => {
    const target = buildBox([0, 0, 0]);
    const unrelated = buildBox([3, 0, 0]);
    let context = createRebuildContext([target.feature, unrelated.feature]);
    context = registerBodies(context, target.feature.id, [target.body]);
    context = registerBodies(context, unrelated.feature.id, [unrelated.body]);
    const feature = createBodyBooleanFeature({
      operation: 'difference',
      targetBodyRef: createBodyRef(target.feature.id, 'missing-body'),
      toolBodyRefs: [createBodyRef(unrelated.feature.id, unrelated.body.id)],
      keepTools: false,
    });

    const result = rebuildBodyBoolean(feature, context);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('TARGET_BODY_NOT_FOUND');
  });

  it('preserves tools when keepTools is enabled', () => {
    const target = buildBox([0, 0, 0]);
    const tool = buildBox([1, 0, 0]);
    let context = createRebuildContext([target.feature, tool.feature]);
    context = registerBodies(context, target.feature.id, [target.body]);
    context = registerBodies(context, tool.feature.id, [tool.body]);
    const feature = createBodyBooleanFeature({
      operation: 'intersection',
      targetBodyRef: createBodyRef(target.feature.id, target.body.id),
      toolBodyRefs: [createBodyRef(tool.feature.id, tool.body.id)],
      keepTools: true,
    });

    const result = rebuildBodyBoolean(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replacedBodyIds).toEqual([target.body.id]);
  });
});
