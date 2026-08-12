import { describe, expect, it } from 'vitest';
import {
  normalizePlanarRegion,
  triangulatePlanarRegion,
  type PlanarPoint,
} from '../../src/geometry';

function triangleArea(points: PlanarPoint[], indices: number[]): number {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = points[indices[index]!]!;
    const b = points[indices[index + 1]!]!;
    const c = points[indices[index + 2]!]!;
    area += Math.abs(
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    ) / 2;
  }
  return area;
}

describe('PlanarRegion', () => {
  it('normalizes outer/hole winding and triangulates a hole without filling it', () => {
    const result = normalizePlanarRegion({
      outer: [[0, 0], [0, 4], [4, 4], [4, 0]],
      holes: [[[1, 1], [3, 1], [3, 3], [1, 3]]],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const triangulation = triangulatePlanarRegion(result.region)!;

    expect(triangleArea(triangulation.points, triangulation.indices)).toBeCloseTo(12, 10);
    expect(triangulation.indices.length % 3).toBe(0);
    expect(result.region.outer).toEqual([[0, 0], [4, 0], [4, 4], [0, 4]]);
    expect(result.region.holes[0]).toEqual([[1, 1], [1, 3], [3, 3], [3, 1]]);
  });

  it('triangulates a concave L region deterministically', () => {
    const region = normalizePlanarRegion({
      outer: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]],
    });
    if (!region.ok) throw new Error(region.diagnostics[0]?.message);
    const runs = Array.from({ length: 10 }, () => triangulatePlanarRegion(region.region));

    expect(runs.every((run) => run !== null)).toBe(true);
    expect(new Set(runs.map((run) => JSON.stringify(run))).size).toBe(1);
    expect(triangleArea(runs[0]!.points, runs[0]!.indices)).toBeCloseTo(3, 10);
  });

  it('fails closed for self-intersection and boundary-touching holes', () => {
    expect(normalizePlanarRegion({
      outer: [[0, 0], [2, 2], [0, 2], [2, 0]],
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'SELF_INTERSECTION' }] });
    expect(normalizePlanarRegion({
      outer: [[0, 0], [4, 0], [4, 4], [0, 4]],
      holes: [[[0, 1], [2, 1], [2, 2], [0, 2]]],
    })).toMatchObject({ ok: false });
    expect(normalizePlanarRegion({
      outer: [[0, 0], [4, 0], [2, 0], [2, 3], [0, 3]],
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'SELF_INTERSECTION' }] });
  });
});
