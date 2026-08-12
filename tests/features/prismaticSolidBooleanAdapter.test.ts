import { describe, expect, it } from 'vitest';
import { prismaticSolidBooleanAdapter } from '../../src/features/extrude';
import {
  createPrismaticBody,
  hashBodyGeometry,
  measureBody,
  type Body,
  type PlanarRegion,
  type PrismaticFrame,
} from '../../src/geometry';

const frame: PrismaticFrame = {
  origin: [0, 0, 0],
  uAxis: [1, 0, 0],
  vAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

function prism(id: string, outer: PlanarRegion['outer'], minDepth: number, maxDepth: number): Body {
  const result = createPrismaticBody({
    id,
    operationId: `seed:${id}`,
    frame,
    region: { outer, holes: [] },
    minDepth,
    maxDepth,
  });
  if (!result.ok) throw new Error(result.diagnostics[0]?.message);
  return result.body;
}

describe('prismaticSolidBooleanAdapter', () => {
  it('unions overlapping rectangular tool bodies without mutating either source', () => {
    const target = prism('target', [[0, 0], [2, 0], [2, 2], [0, 2]], 0, 2);
    const tool = prism('tool', [[1, 0], [3, 0], [3, 2], [1, 2]], 0, 2);
    const before = [hashBodyGeometry(target), hashBodyGeometry(tool)];

    const result = prismaticSolidBooleanAdapter.apply({
      operation: 'Add', featureId: 'union-feature', targetBody: target, toolBody: tool,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(measureBody(result.body).volume).toBeCloseTo(12, 8);
    expect([hashBodyGeometry(target), hashBodyGeometry(tool)]).toEqual(before);
  });

  it('creates a deterministic pocket from the actual tool overlap', () => {
    const target = prism('target', [[0, 0], [4, 0], [4, 4], [0, 4]], 0, 2);
    const tool = prism('tool', [[1, 1], [3, 1], [3, 3], [1, 3]], 1, 2);
    const runs = Array.from({ length: 10 }, () => prismaticSolidBooleanAdapter.apply({
      operation: 'Cut', featureId: 'cut-feature', targetBody: target, toolBody: tool,
    }));

    expect(runs.every((result) => result.ok)).toBe(true);
    const bodies = runs.flatMap((result) => result.ok ? [result.body] : []);
    expect(measureBody(bodies[0]!).volume).toBeCloseTo(28, 8);
    expect(new Set(bodies.map((body) => hashBodyGeometry(body)))).toHaveLength(1);
  });

  it('supports an interior planar pocket through the general kernel', () => {
    const target = prism('target', [[0, 0], [4, 0], [4, 4], [0, 4]], 0, 2);
    const tool = prism('tool', [[1, 1], [3, 1], [3, 3], [1, 3]], 0.5, 1.5);

    const result = prismaticSolidBooleanAdapter.apply({
      operation: 'Cut', featureId: 'interior-cut', targetBody: target, toolBody: tool,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(measureBody(result.body).volume).toBeCloseTo(28, 8);
  });
});
