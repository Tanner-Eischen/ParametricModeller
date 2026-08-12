import { describe, expect, it } from 'vitest';
import { createDependencyGraph, createFeatureRecord } from '../../src/features';

describe('DependencyGraph', () => {
  it('tracks direct and transitive dependents in history order', () => {
    const root = createFeatureRecord('test', 'Root', {}, { id: 'root' });
    const child = createFeatureRecord('test', 'Child', {}, { id: 'child', refsIn: ['root'] });
    const grandchild = createFeatureRecord('test', 'Grandchild', {}, { id: 'grandchild', refsIn: ['child'] });

    const graph = createDependencyGraph([root, child, grandchild]);

    expect(graph.diagnostics).toEqual([]);
    expect(graph.getDirectDependents('root')).toEqual(['child']);
    expect(graph.getTransitiveDependents('root')).toEqual(['child', 'grandchild']);
  });

  it.each([
    {
      name: 'duplicate IDs',
      features: [
        createFeatureRecord('test', 'First', {}, { id: 'same' }),
        createFeatureRecord('test', 'Second', {}, { id: 'same' }),
      ],
      code: 'DUPLICATE_FEATURE_ID',
    },
    {
      name: 'missing dependencies',
      features: [
        createFeatureRecord('test', 'Child', {}, { id: 'child', refsIn: ['missing'] }),
      ],
      code: 'MISSING_DEPENDENCY',
    },
    {
      name: 'forward dependencies',
      features: [
        createFeatureRecord('test', 'Child', {}, { id: 'child', refsIn: ['later'] }),
        createFeatureRecord('test', 'Later', {}, { id: 'later' }),
      ],
      code: 'FORWARD_DEPENDENCY',
    },
    {
      name: 'suppressed dependencies',
      features: [
        createFeatureRecord('test', 'Parent', {}, { id: 'parent', suppressed: true }),
        createFeatureRecord('test', 'Child', {}, { id: 'child', refsIn: ['parent'] }),
      ],
      code: 'SUPPRESSED_DEPENDENCY',
    },
    {
      name: 'dependency cycles',
      features: [
        createFeatureRecord('test', 'A', {}, { id: 'a', refsIn: ['b'] }),
        createFeatureRecord('test', 'B', {}, { id: 'b', refsIn: ['a'] }),
      ],
      code: 'DEPENDENCY_CYCLE',
    },
  ])('reports actionable diagnostics for $name', ({ features, code }) => {
    const graph = createDependencyGraph(features);
    const diagnostic = graph.diagnostics.find((item) => item.code === code);

    expect(diagnostic).toBeDefined();
    expect(diagnostic?.featureId).toBeTruthy();
    expect(diagnostic?.message.length).toBeGreaterThan(20);
  });
});
