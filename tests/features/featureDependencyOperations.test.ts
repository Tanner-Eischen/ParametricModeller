import { describe, expect, it } from 'vitest';
import {
  createDependencyGraph,
  createFeatureRecord,
  createSketchFeature,
  planFeatureRemoval,
  planFeatureSuppression,
} from '../../src/features';
import { createFacePlaneRef } from '../../src/sketch';

function createFeatureChain(options: { suppressChild?: boolean } = {}) {
  const root = createFeatureRecord('test', 'Root', {}, { id: 'root' });
  const child = createFeatureRecord('test', 'Child', {}, {
    id: 'child',
    refsIn: ['root'],
    suppressed: options.suppressChild ?? false,
  });
  const grandchild = createFeatureRecord('test', 'Grandchild', {}, {
    id: 'grandchild',
    refsIn: ['child'],
    suppressed: options.suppressChild ?? false,
  });
  return { root, child, grandchild };
}

describe('FeatureDependencyOperations', () => {
  it.each([
    ['remove', planFeatureRemoval],
    ['suppress', planFeatureSuppression],
  ] as const)('blocks %s when direct or transitive active dependents exist', (_operation, planner) => {
    const { root, child, grandchild } = createFeatureChain();
    const plan = planner(createDependencyGraph([root, child, grandchild]), root.id);

    expect(plan.allowed).toBe(false);
    expect(plan.featureIds).toEqual([]);
    expect(plan.activeDependentIds).toEqual(['child', 'grandchild']);
    expect(plan.diagnostics[0]?.code).toBe('ACTIVE_DEPENDENTS_BLOCK_OPERATION');
    expect(plan.diagnostics[0]?.message).toContain('explicit cascade');
    expect(plan.diagnostics[0]?.message).toContain('Grandchild');
  });

  it('allows suppression when every dependent is already suppressed', () => {
    const { root, child, grandchild } = createFeatureChain({ suppressChild: true });
    const plan = planFeatureSuppression(
      createDependencyGraph([root, child, grandchild]),
      root.id
    );

    expect(plan.allowed).toBe(true);
    expect(plan.featureIds).toEqual(['root']);
    expect(plan.activeDependentIds).toEqual([]);
    expect(plan.suppressedDependentIds).toEqual(['child', 'grandchild']);
  });

  it('warns but does not silently rewrite suppressed dependents during removal', () => {
    const { root, child, grandchild } = createFeatureChain({ suppressChild: true });
    const graph = createDependencyGraph([root, child, grandchild]);
    const refsBefore = [child.refsIn, grandchild.refsIn].map((refs) => [...refs]);
    const plan = planFeatureRemoval(graph, root.id);

    expect(plan.allowed).toBe(true);
    expect(plan.featureIds).toEqual(['root']);
    expect(plan.diagnostics[0]?.code).toBe('SUPPRESSED_DEPENDENTS_RETAIN_BROKEN_REFS');
    expect([child.refsIn, grandchild.refsIn]).toEqual(refsBefore);

    const rebuiltGraph = createDependencyGraph([child, grandchild]);
    expect(rebuiltGraph.diagnostics.some((item) => item.code === 'MISSING_DEPENDENCY')).toBe(true);
  });

  it.each([
    ['removal', planFeatureRemoval],
    ['suppression', planFeatureSuppression],
  ] as const)('returns a deterministic dependent-first cascade for %s', (_operation, planner) => {
    const { root, child, grandchild } = createFeatureChain();
    const graph = createDependencyGraph([root, child, grandchild]);

    const first = planner(graph, root.id, { cascade: true });
    const second = planner(graph, root.id, { cascade: true });

    expect(first.allowed).toBe(true);
    expect(first.featureIds).toEqual(['grandchild', 'child', 'root']);
    expect(second.featureIds).toEqual(first.featureIds);
  });

  it('includes suppressed dependents in explicit removal cascades', () => {
    const { root, child, grandchild } = createFeatureChain({ suppressChild: true });
    const plan = planFeatureRemoval(
      createDependencyGraph([root, child, grandchild]),
      root.id,
      { cascade: true }
    );

    expect(plan.allowed).toBe(true);
    expect(plan.featureIds).toEqual(['grandchild', 'child', 'root']);
    expect(plan.diagnostics).toEqual([]);
  });

  it('returns an actionable diagnostic for an unknown target', () => {
    const plan = planFeatureRemoval(createDependencyGraph([]), 'missing');

    expect(plan.allowed).toBe(false);
    expect(plan.featureIds).toEqual([]);
    expect(plan.diagnostics[0]?.code).toBe('FEATURE_NOT_FOUND');
  });

  it.each([
    ['removal', planFeatureRemoval],
    ['suppression', planFeatureSuppression],
  ] as const)('blocks owner %s while a face sketch depends on it', (_operation, planner) => {
    const owner = createFeatureRecord('box', 'Box', {}, { id: 'box-feature' });
    owner.refsOut = ['box-body'];
    const sketch = createSketchFeature({
      planeRef: createFacePlaneRef('box-body_face_pos_z', 'box-body', owner.id),
      entities: [],
      dimensions: [],
    }, 'Face Sketch');

    const graph = createDependencyGraph([owner, sketch]);
    const plan = planner(graph, owner.id);

    expect(graph.getDirectDependents(owner.id)).toEqual([sketch.id]);
    expect(plan.allowed).toBe(false);
    expect(plan.activeDependentIds).toEqual([sketch.id]);
  });
});
