import { describe, expect, it } from 'vitest';
import {
  createLineEntity,
  createRectangleEntity,
  createSketch,
  createWorldPlaneRef,
  extractProfiles,
  type SketchEntity,
} from '../../src/sketch';

function sketchWithEntities(id: string, entities: SketchEntity[]) {
  return {
    ...createSketch(createWorldPlaneRef('xy'), 'Sketch', id),
    entities,
  };
}

describe('profile topology determinism', () => {
  it('keeps a rectangle profile ID stable across repeated extraction', () => {
    const sketch = sketchWithEntities('sketch', [
      createRectangleEntity([0, 0], 2, 3, 0, 'rectangle'),
    ]);

    const ids = Array.from({ length: 10 }, () => extractProfiles(sketch)[0]?.id);

    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toContain('rectangle');
  });

  it('keeps a line-loop profile ID stable across entity reordering and unrelated geometry', () => {
    const loop = [
      createLineEntity([0, 0], [2, 0], 'bottom'),
      createLineEntity([2, 0], [2, 1], 'right'),
      createLineEntity([2, 1], [0, 1], 'top'),
      createLineEntity([0, 1], [0, 0], 'left'),
    ];
    const unrelated = createLineEntity([10, 10], [11, 10], 'unrelated');
    const first = extractProfiles(sketchWithEntities('sketch', loop))[0];
    const second = extractProfiles(
      sketchWithEntities('sketch', [unrelated, ...loop].reverse())
    ).find((profile) => profile.entityIds.includes('bottom'));

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second?.id).toBe(first?.id);
    expect(second?.entityIds).toEqual(first?.entityIds);
  });
});
