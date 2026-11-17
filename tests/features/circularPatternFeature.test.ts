import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  createCircularPatternFeature, getCircularPatternInstanceTransforms,
  rebuildCircularPattern, type CircularPatternParams,
} from '../../src/features/pattern/CircularPatternFeature';
import { createRebuildContext, registerBodies } from '../../src/features/RebuildContext';
import { createBoxBody, defaultBoxParams } from '../../src/features/primitives/BoxFeature';
import { serializeBody, type Body } from '../../src/geometry/Body';
import { validateClosedManifoldBody } from '../../src/geometry/Validation';

const sourceId = 'source';
function fixture() {
  const first = createBoxBody({ ...defaultBoxParams, origin: [100, 0, 0] }, 'first');
  const second = createBoxBody({ ...defaultBoxParams, origin: [20, 0, 0] }, 'second');
  const context = registerBodies(createRebuildContext(), sourceId, [first, second]);
  return { first, second, context };
}
function feature(overrides: Partial<CircularPatternParams> = {}) {
  const result = createCircularPatternFeature({
    sourceFeatureId: sourceId, sourceBodyRef: { featureId: sourceId, bodyId: 'second' },
    center: [20, 0, 0], axis: 'Z', count: 4, angle: 360, symmetric: false, ...overrides,
  });
  result.id = 'pattern';
  return result;
}
function positions(body: Body) {
  return [...body.vertices.values()].map(vertex => vertex.position);
}
function ids(body: Body) {
  return [body.id, ...body.vertices.keys(), ...body.edges.keys(), ...body.faces.keys(), ...body.planes.keys()];
}

describe('circular pattern rebuild', () => {
  it('uses the exact source and rotates around a nonzero pivot without overlapping the full-circle endpoint', () => {
    const { second, context } = fixture();
    const result = rebuildCircularPattern(feature(), context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.bodies).toHaveLength(3);
    const expected = [[19, 1, 1], [19, -1, 1], [21, -1, 1]];
    result.bodies.forEach((body, index) => {
      positions(body)[0]!.forEach((value, axis) => expect(value).toBeCloseTo(expected[index]![axis]!, 10));
      expect(validateClosedManifoldBody(body).ok).toBe(true);
    });
    const firstPoints = [second, ...result.bodies].map(body => positions(body)[0]!.map(v => v.toFixed(8)).join(','));
    expect(new Set(firstPoints).size).toBe(4);
  });

  it.each([
    ['X', [20, 5, 7], [21, 6, 7], [21, 5, 8]],
    ['Y', [20, 5, 7], [21, 6, 7], [20, 6, 6]],
    ['Z', [20, 5, 7], [21, 6, 7], [19, 6, 7]],
  ] as const)('applies the %s pivot transform to geometry and metadata consistently', (axis, center, point, expected) => {
    const params = feature({ axis, center: [...center], count: 2, angle: 90 }).parameters as unknown as CircularPatternParams;
    const transformed = new Vector3(...point).applyMatrix4(getCircularPatternInstanceTransforms(params)[0]!.transform);
    transformed.toArray().forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 10));
  });

  it.each([
    [false, 3, 180, [90, 180]],
    [false, 4, -360, [-90, -180, -270]],
    [true, 5, 180, [-90, -45, 45, 90]],
    [true, 4, 180, [-60, 60, 120]],
    [true, 4, 360, [-90, 90, 180]],
    [true, 2, 360, [180]],
  ])('defines angles for symmetric=%s, count=%s, arc=%s', (symmetric, count, angle, expected) => {
    const params = feature({ symmetric, count, angle }).parameters as unknown as CircularPatternParams;
    expect(getCircularPatternInstanceTransforms(params).map(item => item.angleDegrees)).toEqual(expected);
  });

  it('keeps every occurrence and producing feature namespace distinct across deterministic rebuilds', () => {
    const { first, second, context } = fixture();
    const before = JSON.stringify([serializeBody(first), serializeBody(second)]);
    const firstFeature = feature();
    const secondFeature = { ...feature(), id: 'another-pattern' };
    const a = rebuildCircularPattern(firstFeature, context);
    const b = rebuildCircularPattern(secondFeature, context);
    const again = rebuildCircularPattern(firstFeature, context);
    if (!a.ok || !b.ok || !again.ok) throw new Error('Expected successful patterns');
    const allIds = [...a.bodies, ...b.bodies].flatMap(ids);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(again.bodies.map(serializeBody)).toEqual(a.bodies.map(serializeBody));
    expect(JSON.stringify([serializeBody(first), serializeBody(second)])).toBe(before);
    const sourceIds = new Set([...ids(first), ...ids(second)]);
    expect(allIds.some(id => sourceIds.has(id))).toBe(false);
  });

  it('rebuilds legacy feature-only references without changing their first-body semantics', () => {
    const { first, context } = fixture();
    const legacy = createCircularPatternFeature({ sourceFeatureId: sourceId, count: 2, angle: 180 });
    const result = rebuildCircularPattern(legacy, context);
    if (!result.ok) throw new Error(result.error);
    expect(positions(result.bodies[0]!)[0]![0]).toBeCloseTo(-positions(first)[0]![0]);
    expect(legacy.refsIn).toEqual([sourceId]);
  });

  it('never falls back to another body when an exact reference disappears', () => {
    const { context } = fixture();
    const result = rebuildCircularPattern(feature({ sourceBodyRef: { featureId: sourceId, bodyId: 'missing' } }), context);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'SOURCE_NOT_FOUND', featureId: 'pattern' }] });
  });

  it('copies factory inputs and derives the dependency from an exact reference', () => {
    const center: [number, number, number] = [1, 2, 3];
    const sourceBodyRef = { featureId: sourceId, bodyId: 'second' };
    const created = createCircularPatternFeature({ center, sourceBodyRef });
    center[0] = 99; sourceBodyRef.bodyId = 'other';
    expect(created.refsIn).toEqual([sourceId]);
    expect(created.parameters).toMatchObject({ center: [1, 2, 3], sourceBodyRef: { bodyId: 'second' }, count: 6 });
  });

  it.each([
    ['count', NaN], ['count', Infinity], ['count', 2.5], ['count', 1], ['count', 1001], ['count', '4'],
    ['angle', NaN], ['angle', Infinity], ['angle', 0], ['angle', 361], ['angle', '90'],
    ['axis', 'W'], ['center', [0, 1]], ['center', [0, NaN, 0]], ['center', 'xyz'],
    ['center', [0, '1', 0]], ['symmetric', 'false'], ['sourceBodyRef', null],
    ['sourceBodyRef', { featureId: 'wrong', bodyId: 'second' }],
  ])('fails closed for malformed %s=%s', (key, value) => {
    const { context } = fixture();
    const invalid = feature();
    invalid.parameters[key] = value;
    const result = rebuildCircularPattern(invalid, context);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every(item => item.featureId === invalid.id)).toBe(true);
  });
});
