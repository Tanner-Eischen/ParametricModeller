import { describe, expect, it } from 'vitest';
import {
  createBoxFeature,
  rebuildBox,
  createRebuildContext,
} from '../../src/features';
import {
  BAKE_BODY_FEATURE_TYPE,
  createBakeBodyFeature,
  rebuildBakeBody,
  validateBakeBodyParams,
  getBakeBodyParams,
  type BakeBodyParams,
} from '../../src/features/bake';

function buildBox(width: number, depth: number, height: number) {
  const sourceFeature = createBoxFeature({ width, depth, height, origin: [0, 0, 0] });
  const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
  if (!sourceResult.ok) throw new Error('box rebuild failed');
  return { sourceFeature, sourceBody: sourceResult.bodies[0]! };
}

describe('BakeBodyFeature', () => {
  it('creates a feature record with no source dependency', () => {
    const { sourceBody, sourceFeature } = buildBox(2, 1, 1);
    const feature = createBakeBodyFeature(sourceBody, 'Board copy', sourceFeature.id);

    expect(feature.type).toBe(BAKE_BODY_FEATURE_TYPE);
    expect(feature.refsIn).toEqual([]);
    expect(feature.name).toBe('Board copy');
  });

  it('rebuilds the same geometry as the source body', () => {
    const { sourceBody, sourceFeature } = buildBox(2, 1, 1);

    const feature = createBakeBodyFeature(sourceBody, undefined, sourceFeature.id);
    const result = rebuildBakeBody(feature, createRebuildContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const baked = result.bodies[0]!;

    expect(baked.vertices.size).toBe(sourceBody.vertices.size);
    expect(baked.edges.size).toBe(sourceBody.edges.size);
    expect(baked.faces.size).toBe(sourceBody.faces.size);
    expect(baked.planes.size).toBe(sourceBody.planes.size);

    const sourcePositions = Array.from(sourceBody.vertices.values())
      .map((vertex) => vertex.position)
      .sort((a, b) => a[0]! - b[0]!);
    const bakedPositions = Array.from(baked.vertices.values())
      .map((vertex) => vertex.position)
      .sort((a, b) => a[0]! - b[0]!);
    expect(bakedPositions).toEqual(sourcePositions);
  });

  it('is independent: rebuilds with an empty context (no source registered)', () => {
    const { sourceBody } = buildBox(2, 1, 1);
    const feature = createBakeBodyFeature(sourceBody);

    // Empty context — the source body is intentionally NOT registered. A truly
    // independent feature must still rebuild from its stored snapshot.
    const result = rebuildBakeBody(feature, createRebuildContext());
    expect(result.ok).toBe(true);
  });

  it('is unaffected by mutation of the source body after baking', () => {
    const { sourceBody } = buildBox(2, 1, 1);
    const originalX = Array.from(sourceBody.vertices.values()).map((vertex) => vertex.position[0]);

    const feature = createBakeBodyFeature(sourceBody);

    // Mutate the source body's geometry after the snapshot is taken.
    for (const vertex of sourceBody.vertices.values()) {
      vertex.position = [vertex.position[0]! + 100, vertex.position[1], vertex.position[2]];
    }

    const result = rebuildBakeBody(feature, createRebuildContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bakedX = Array.from(result.bodies[0]!.vertices.values()).map((vertex) => vertex.position[0]);
    expect(bakedX.sort((a, b) => a - b)).toEqual([...originalX].sort((a, b) => a - b));
  });

  it('assigns a deterministic body id that differs from the source', () => {
    const { sourceBody } = buildBox(2, 1, 1);
    const feature = createBakeBodyFeature(sourceBody);

    const first = rebuildBakeBody(feature, createRebuildContext());
    const second = rebuildBakeBody(feature, createRebuildContext());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.bodies[0]!.id).toBe(`${feature.id}:bake`);
    expect(second.bodies[0]!.id).toBe(`${feature.id}:bake`);
    expect(first.bodies[0]!.id).not.toBe(sourceBody.id);
  });

  it('rejects a malformed snapshot', () => {
    const diagnostics = validateBakeBodyParams({ snapshot: { vertices: [] } as unknown as BakeBodyParams['snapshot'] });
    expect(diagnostics.some((item) => item.code === 'INVALID_SNAPSHOT')).toBe(true);
  });

  it('reads back its own parameters', () => {
    const { sourceBody } = buildBox(2, 1, 1);
    const feature = createBakeBodyFeature(sourceBody, 'Copy', 'src-feature');
    const params = getBakeBodyParams(feature);
    expect(params).not.toBeNull();
    expect(params?.sourceFeatureId).toBe('src-feature');
    expect(params?.snapshot.vertices.length).toBe(sourceBody.vertices.size);
  });
});
