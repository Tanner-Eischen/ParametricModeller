import { describe, expect, it } from 'vitest';
import {
  createDuplicateFeature,
  createLinearPatternFeature,
  createMirrorFeature,
  migrateDuplicateParams,
  migrateLinearPatternParams,
  migrateMirrorParams,
  rebuildDuplicate,
  rebuildLinearPattern,
  rebuildMirror,
} from '../../src/features/pattern';
import { createRebuildContext, registerBodies } from '../../src/features/RebuildContext';
import { addVertex, createBody, createVertex } from '../../src/geometry';
import { createWorldPlaneRef } from '../../src/sketch';

function explicitSourceFixture() {
  const first = createBody('body-a', 'First');
  const second = createBody('body-b', 'Second');
  addVertex(first, createVertex([1, 0, 0], 'a'));
  addVertex(second, createVertex([10, 0, 0], 'b'));
  return {
    sourceRef: { featureId: 'source-feature', bodyId: second.id },
    context: registerBodies(createRebuildContext(), 'source-feature', [first, second]),
  };
}

describe('pattern feature source references', () => {
  it('resolves the exact body for duplicate, linear pattern, and mirror', () => {
    const { sourceRef, context } = explicitSourceFixture();
    const duplicate = createDuplicateFeature(sourceRef, [1, 0, 0]);
    duplicate.id = 'duplicate';
    const pattern = createLinearPatternFeature(sourceRef, 2, 2);
    pattern.id = 'pattern';
    const mirror = createMirrorFeature(sourceRef, createWorldPlaneRef('yz'));
    mirror.id = 'mirror';

    const duplicateResult = rebuildDuplicate(duplicate, context);
    const patternResult = rebuildLinearPattern(pattern, context);
    const mirrorResult = rebuildMirror(mirror, context);

    expect(duplicateResult.ok && [...duplicateResult.bodies[0]!.vertices.values()][0]!.position)
      .toEqual([11, 0, 0]);
    expect(patternResult.ok && [...patternResult.bodies[0]!.vertices.values()][0]!.position)
      .toEqual([12, 0, 0]);
    expect(mirrorResult.ok && [...mirrorResult.bodies[0]!.vertices.values()][0]!.position)
      .toEqual([-10, 0, 0]);
    expect(duplicate.refsIn).toEqual(['source-feature']);
    expect(pattern.refsIn).toEqual(['source-feature']);
    expect(mirror.refsIn).toEqual(['source-feature']);
  });

  it('keeps legacy sourceFeatureId-only parameter records rebuild-compatible', () => {
    expect(migrateDuplicateParams({ sourceFeatureId: 'legacy', translation: [1, 2, 3] }))
      .toEqual({ sourceFeatureId: 'legacy', translation: [1, 2, 3] });
    expect(migrateLinearPatternParams({
      sourceFeatureId: 'legacy', count: 2, spacing: 1, direction: [1, 0, 0], symmetric: false,
    })).toEqual({
      sourceFeatureId: 'legacy', count: 2, spacing: 1, direction: [1, 0, 0], symmetric: false,
    });
    expect(migrateMirrorParams({
      sourceFeatureId: 'legacy',
      planeRef: { id: 'plane', type: 'world', worldPlane: 'yz', offset: 0 },
    })).toEqual({
      sourceFeatureId: 'legacy',
      planeRef: { id: 'plane', type: 'world', worldPlane: 'yz', offset: 0 },
    });
  });
});

