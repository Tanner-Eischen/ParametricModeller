import { describe, expect, it } from 'vitest';
import {
  createCenterRectangle,
  createRegularPolygon,
} from '../../src/sketch/SketchPrimitives';

function signedArea(points: Array<[number, number]>): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

describe('createCenterRectangle', () => {
  it('creates a symmetric counter-clockwise loop from any corner quadrant', () => {
    const result = createCenterRectangle([2, 3], [0, 2]);

    expect(result).toEqual({
      ok: true,
      points: [[0, 2], [4, 2], [4, 4], [0, 4]],
    });
    if (result.ok) {
      expect(signedArea(result.points)).toBeGreaterThan(0);
    }
  });

  it('rejects zero-size and non-finite rectangles', () => {
    expect(createCenterRectangle([0, 0], [0, 1])).toMatchObject({
      ok: false,
      error: { code: 'ZERO_SIZE' },
    });
    expect(createCenterRectangle([0, 0], [Number.NaN, 1])).toMatchObject({
      ok: false,
      error: { code: 'NON_FINITE_POINT' },
    });
  });

  it('supports a caller-defined minimum size', () => {
    expect(createCenterRectangle([0, 0], [0.1, 1], { minimumSize: 0.2 })).toMatchObject({
      ok: false,
      error: { code: 'ZERO_SIZE' },
    });
  });
});

describe('createRegularPolygon', () => {
  it('preserves the defining vertex and produces a counter-clockwise regular polygon', () => {
    const result = createRegularPolygon([0, 0], [2, 0], 6);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toHaveLength(6);
    expect(result.points[0]).toEqual([2, 0]);
    expect(signedArea(result.points)).toBeGreaterThan(0);
    for (const point of result.points) {
      expect(Math.hypot(point[0], point[1])).toBeCloseTo(2, 12);
    }
  });

  it('is deterministic for identical inputs', () => {
    expect(createRegularPolygon([1, 2], [1, 5], 5)).toEqual(
      createRegularPolygon([1, 2], [1, 5], 5)
    );
  });

  it.each([2, 3.5, 65])('rejects invalid side count %s', (sides) => {
    expect(createRegularPolygon([0, 0], [1, 0], sides)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SIDE_COUNT' },
    });
  });

  it('rejects a vertex at the center and non-finite coordinates', () => {
    expect(createRegularPolygon([0, 0], [0, 0], 4)).toMatchObject({
      ok: false,
      error: { code: 'ZERO_SIZE' },
    });
    expect(createRegularPolygon([0, Number.POSITIVE_INFINITY], [1, 0], 4)).toMatchObject({
      ok: false,
      error: { code: 'NON_FINITE_POINT' },
    });
  });
});
