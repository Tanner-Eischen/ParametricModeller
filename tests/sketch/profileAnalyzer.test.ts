import { describe, expect, it } from 'vitest';
import {
  analyzeProfiles,
  analyzeSketchProfiles,
  type ProfileSegment,
} from '../../src/sketch/ProfileAnalyzer';
import { createLineEntity, createSketch, createWorldPlaneRef } from '../../src/sketch/SketchTypes';

function closedSegments(points: Array<[number, number]>, prefix = 'edge'): ProfileSegment[] {
  return points.map((point, index) => ({
    id: `${prefix}-${index}`,
    start: point,
    end: points[(index + 1) % points.length]!,
  }));
}

describe('analyzeProfiles', () => {
  it('adapts persisted sketch entities and explains an open profile', () => {
    const sketch = createSketch(createWorldPlaneRef('xy'), 'Open sketch', 'sketch');
    sketch.entities.push(createLineEntity([0, 0], [1, 0], 'line'));

    const result = analyzeSketchProfiles(sketch);

    expect(result.profiles).toEqual([]);
    expect(result.issues.some((issue) => issue.code === 'OPEN_ENDPOINT')).toBe(true);
  });

  it('returns a deterministic counter-clockwise rectangle profile', () => {
    const segments = closedSegments([[0, 0], [2, 0], [2, 1], [0, 1]]);
    const result = analyzeProfiles([segments[2]!, segments[0]!, segments[3]!, segments[1]!]);

    expect(result.issues).toEqual([]);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toMatchObject({
      id: 'profile:edge-0|edge-1|edge-2|edge-3',
      loop: [[0, 0], [2, 0], [2, 1], [0, 1]],
      entityIds: ['edge-0', 'edge-1', 'edge-2', 'edge-3'],
      area: 2,
    });
  });

  it.each([
    ['L-shaped', [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]],
    ['U-shaped', [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]]],
  ] as const)('extracts a valid %s profile', (_name, points) => {
    const mutablePoints = points.map(([x, y]): [number, number] => [x, y]);
    const result = analyzeProfiles(closedSegments(mutablePoints));

    expect(result.issues).toEqual([]);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]!.area).toBeGreaterThan(0);
  });

  it('explains both endpoints of an open chain', () => {
    const result = analyzeProfiles([
      { id: 'a', start: [0, 0], end: [1, 0] },
      { id: 'b', start: [1, 0], end: [1, 1] },
    ]);

    expect(result.profiles).toEqual([]);
    expect(result.issues.filter((issue) => issue.code === 'OPEN_ENDPOINT')).toHaveLength(2);
    expect(result.issues[0]!.message).toContain('connect');
  });

  it('identifies a branching vertex and its participating entities', () => {
    const result = analyzeProfiles([
      { id: 'left', start: [-1, 0], end: [0, 0] },
      { id: 'right', start: [0, 0], end: [1, 0] },
      { id: 'up', start: [0, 0], end: [0, 1] },
    ]);

    const branch = result.issues.find((issue) => issue.code === 'BRANCHING_VERTEX');
    expect(branch).toMatchObject({
      entityIds: ['left', 'right', 'up'],
      point: [0, 0],
    });
    expect(branch?.message).toContain('trim');
    expect(result.profiles).toEqual([]);
  });

  it('rejects a self-intersecting bowtie with the crossing edges', () => {
    const result = analyzeProfiles(closedSegments([
      [0, 0], [2, 2], [0, 2], [2, 0],
    ]));

    expect(result.profiles).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'SELF_INTERSECTION',
      entityIds: ['edge-0', 'edge-2'],
      point: [1, 1],
    }));
  });

  it.each([
    {
      name: 'adjacent backtracking',
      points: [[0, 0], [4, 0], [2, 0], [2, 3], [0, 3]] as Array<[number, number]>,
      entityIds: ['edge-0', 'edge-1'],
      point: [3, 0],
    },
    {
      name: 'non-adjacent partial overlap',
      points: [
        [0, 0], [4, 0], [4, 3], [0, 3], [0, 1],
        [3, 1], [3, 0], [1, 0], [1, -1], [0, -1],
      ] as Array<[number, number]>,
      entityIds: ['edge-0', 'edge-6'],
      point: [2, 0],
    },
  ])('rejects the closed nonzero-area $name golden profile', ({ points, entityIds, point }) => {
    const result = analyzeProfiles(closedSegments(points));

    expect(result.profiles).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'OVERLAPPING_EDGE',
      entityIds,
      point,
    }));
  });

  it('reports duplicate, degenerate, and zero-area geometry', () => {
    const duplicate = analyzeProfiles([
      { id: 'a', start: [0, 0], end: [1, 0] },
      { id: 'b', start: [1, 0], end: [0, 0] },
    ]);
    expect(duplicate.issues.some((issue) => issue.code === 'DUPLICATE_EDGE')).toBe(true);

    const degenerate = analyzeProfiles([{ id: 'a', start: [0, 0], end: [0, 0] }]);
    expect(degenerate.issues).toContainEqual(expect.objectContaining({
      code: 'DEGENERATE_EDGE',
      entityIds: ['a'],
    }));

    const zeroArea = analyzeProfiles(closedSegments([[0, 0], [1, 0], [2, 0]]));
    expect(zeroArea.issues).toContainEqual(expect.objectContaining({ code: 'ZERO_AREA' }));
  });

  it('returns disjoint profiles in stable order and ignores input insertion order', () => {
    const first = closedSegments([[0, 0], [1, 0], [1, 1], [0, 1]], 'z');
    const second = closedSegments([[3, 0], [5, 0], [5, 1], [3, 1]], 'a');
    const forward = analyzeProfiles([...first, ...second]);
    const reversed = analyzeProfiles([...first, ...second].reverse());

    expect(reversed).toEqual(forward);
    expect(forward.profiles.map((profile) => profile.id)).toEqual([
      'profile:a-0|a-1|a-2|a-3',
      'profile:z-0|z-1|z-2|z-3',
    ]);
  });

  it('uses the caller-provided point tolerance to join near endpoints', () => {
    const result = analyzeProfiles([
      { id: 'a', start: [0, 0], end: [1, 0] },
      { id: 'b', start: [1.0005, 0], end: [1, 1] },
      { id: 'c', start: [1, 1], end: [0, 1] },
      { id: 'd', start: [0, 1], end: [0, 0] },
    ], { pointTolerance: 0.001 });

    expect(result.issues).toEqual([]);
    expect(result.profiles).toHaveLength(1);
  });
});
