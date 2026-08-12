import { describe, expect, it } from 'vitest';
import {
  createBoxFeature,
  createRebuildContext,
  rebuildBox,
  registerBodies,
} from '../../src/features';
import {
  createDuplicateFeature,
  createLinearPatternFeature,
  createMirrorFeature,
  rebuildDuplicate,
  rebuildLinearPattern,
  rebuildMirror,
} from '../../src/features/pattern';
import type { RebuildHandlerResult } from '../../src/features/RebuildEngine';
import type { RebuildContext } from '../../src/features/RebuildContext';
import type { Body } from '../../src/geometry/Body';
import { createWorldPlaneRef } from '../../src/sketch';

function createSourceContext(): { sourceFeatureId: string; context: RebuildContext } {
  const sourceFeature = createBoxFeature({ width: 2, depth: 1, height: 3 });
  sourceFeature.id = 'source-feature';
  const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
  if (!sourceResult.ok) {
    throw new Error(sourceResult.error);
  }
  return {
    sourceFeatureId: sourceFeature.id,
    context: registerBodies(createRebuildContext(), sourceFeature.id, sourceResult.bodies),
  };
}

function expectDisjointTopology(left: Body[], right: Body[]): void {
  const leftIds = collectBodyAndTopologyIds(left);
  const rightIds = collectBodyAndTopologyIds(right);
  expect([...leftIds].filter((id) => rightIds.has(id))).toEqual([]);
}

function collectBodyAndTopologyIds(bodies: Body[]): Set<string> {
  return new Set(bodies.flatMap((body) => [
    body.id,
    ...body.vertices.keys(),
    ...body.edges.keys(),
    ...body.faces.keys(),
    ...body.planes.keys(),
  ]));
}

function resultSnapshot(result: RebuildHandlerResult): string {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return JSON.stringify([...collectBodyAndTopologyIds(result.bodies)].sort());
}

describe('producing feature topology namespaces', () => {
  it('keeps two duplicates of the same source disjoint', () => {
    const { sourceFeatureId, context } = createSourceContext();
    const first = createDuplicateFeature(sourceFeatureId, [1, 0, 0]);
    const second = createDuplicateFeature(sourceFeatureId, [1, 0, 0]);
    first.id = 'duplicate-a';
    second.id = 'duplicate-b';
    const firstResult = rebuildDuplicate(first, context);
    const secondResult = rebuildDuplicate(second, context);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;
    expectDisjointTopology(firstResult.bodies, secondResult.bodies);
  });

  it('keeps two mirrors of the same source disjoint', () => {
    const { sourceFeatureId, context } = createSourceContext();
    const plane = createWorldPlaneRef('yz');
    const first = createMirrorFeature(sourceFeatureId, plane);
    const second = createMirrorFeature(sourceFeatureId, plane);
    first.id = 'mirror-a';
    second.id = 'mirror-b';
    const firstResult = rebuildMirror(first, context);
    const secondResult = rebuildMirror(second, context);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;
    expectDisjointTopology(firstResult.bodies, secondResult.bodies);
  });

  it('keeps two linear patterns of the same source disjoint', () => {
    const { sourceFeatureId, context } = createSourceContext();
    const first = createLinearPatternFeature(sourceFeatureId, 3, 2);
    const second = createLinearPatternFeature(sourceFeatureId, 3, 2);
    first.id = 'pattern-a';
    second.id = 'pattern-b';
    const firstResult = rebuildLinearPattern(first, context);
    const secondResult = rebuildLinearPattern(second, context);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;
    expectDisjointTopology(firstResult.bodies, secondResult.bodies);
  });

  it.each([
    ['duplicate', (sourceFeatureId: string, context: RebuildContext) => {
      const feature = createDuplicateFeature(sourceFeatureId, [1, 0, 0]);
      feature.id = 'stable-duplicate';
      return rebuildDuplicate(feature, context);
    }],
    ['mirror', (sourceFeatureId: string, context: RebuildContext) => {
      const feature = createMirrorFeature(sourceFeatureId, {
        id: 'stable-plane', type: 'world', worldPlane: 'yz', offset: 0,
      });
      feature.id = 'stable-mirror';
      return rebuildMirror(feature, context);
    }],
    ['linear pattern', (sourceFeatureId: string, context: RebuildContext) => {
      const feature = createLinearPatternFeature(sourceFeatureId, 3, 2);
      feature.id = 'stable-pattern';
      return rebuildLinearPattern(feature, context);
    }],
  ] as const)('keeps %s body and topology IDs stable across ten rebuilds', (_name, rebuild) => {
    const { sourceFeatureId, context } = createSourceContext();
    const snapshots = Array.from({ length: 10 }, () =>
      resultSnapshot(rebuild(sourceFeatureId, context))
    );
    expect(new Set(snapshots).size).toBe(1);
  });
});
