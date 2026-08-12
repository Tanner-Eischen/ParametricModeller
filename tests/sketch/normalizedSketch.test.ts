import { describe, expect, it } from 'vitest';
import {
  cloneNormalizedSketch,
  materializeLineEntities,
  normalizeLineEntities,
  toProfileSegments,
  validateNormalizedSketch,
  type NormalizedSketchGeometry,
} from '../../src/sketch/NormalizedSketch';
import { analyzeProfiles } from '../../src/sketch/ProfileAnalyzer';
import { createLineEntity } from '../../src/sketch/SketchTypes';

describe('normalized sketch migration', () => {
  it('migrates tuple lines to persistent shared endpoints deterministically', () => {
    const lines = [
      createLineEntity([1, 0], [1, 1], 'right'),
      createLineEntity([0, 0], [1, 0], 'bottom'),
    ];
    const forward = normalizeLineEntities(lines);
    const reverse = normalizeLineEntities([...lines].reverse());

    expect(reverse).toEqual(forward);
    expect(forward.points).toHaveLength(3);
    expect(forward.segments).toEqual([
      {
        id: 'bottom',
        type: 'line',
        startPointId: 'point:bottom:start',
        endPointId: 'point:bottom:end',
        construction: false,
      },
      {
        id: 'right',
        type: 'line',
        startPointId: 'point:bottom:end',
        endPointId: 'point:right:end',
        construction: false,
      },
    ]);
  });

  it('uses an explicit migration tolerance for near endpoints', () => {
    const geometry = normalizeLineEntities([
      createLineEntity([0, 0], [1, 0], 'a'),
      createLineEntity([1.0005, 0], [2, 0], 'b'),
    ], { pointTolerance: 0.001 });

    expect(geometry.points).toHaveLength(3);
    expect(geometry.segments[0]!.endPointId).toBe(geometry.segments[1]!.startPointId);
  });

  it('materializes legacy line tuples without exposing mutable point arrays', () => {
    const geometry = normalizeLineEntities([
      createLineEntity([0, 0], [1, 0], 'a'),
      createLineEntity([1, 0], [1, 1], 'b'),
    ]);
    const lines = materializeLineEntities(geometry);

    expect(lines).toEqual([
      createLineEntity([0, 0], [1, 0], 'a'),
      createLineEntity([1, 0], [1, 1], 'b'),
    ]);
    lines[0]!.end[0] = 99;
    expect(geometry.points.some((point) => point.position[0] === 99)).toBe(false);
  });

  it('adapts normalized geometry to deterministic profile analysis', () => {
    const geometry = normalizeLineEntities([
      createLineEntity([0, 0], [2, 0], 'a'),
      createLineEntity([2, 0], [2, 1], 'b'),
      createLineEntity([2, 1], [0, 1], 'c'),
      createLineEntity([0, 1], [0, 0], 'd'),
    ]);

    const analysis = analyzeProfiles(toProfileSegments(geometry));
    expect(analysis.issues).toEqual([]);
    expect(analysis.profiles[0]).toMatchObject({
      id: 'profile:a|b|c|d',
      area: 2,
    });
  });

  it('validates missing point references, duplicate IDs, and degenerate segments', () => {
    const invalid: NormalizedSketchGeometry = {
      schemaVersion: 1,
      points: [
        { id: 'p', position: [0, 0] },
        { id: 'p', position: [0, 0] },
      ],
      segments: [
        { id: 'same', type: 'line', startPointId: 'p', endPointId: 'p', construction: false },
        { id: 'missing', type: 'line', startPointId: 'p', endPointId: 'nowhere', construction: false },
      ],
    };

    expect(validateNormalizedSketch(invalid).map((issue) => issue.code)).toEqual([
      'DEGENERATE_SEGMENT',
      'DUPLICATE_ID',
      'MISSING_POINT_REFERENCE',
    ]);
  });

  it('deep clones persistent point and segment records', () => {
    const geometry = normalizeLineEntities([createLineEntity([0, 0], [1, 0], 'a')]);
    const clone = cloneNormalizedSketch(geometry);
    clone.points[0]!.position[0] = 99;
    clone.segments[0]!.startPointId = 'changed';

    expect(geometry.points[0]!.position[0]).not.toBe(99);
    expect(geometry.segments[0]!.startPointId).not.toBe('changed');
  });
});
