import { describe, expect, it } from 'vitest';
import type { Body, PlanarLoop, PrismaticFrame, PrismaticBooleanResult } from '../../src/geometry';
import {
  createPrismaticBody,
  differencePrismatic,
  triangulateBody,
  triangulateFace,
  unionPrismatic,
  validateClosedManifoldBody,
} from '../../src/geometry';

const frame: PrismaticFrame = {
  origin: [0, 0, 0],
  uAxis: [1, 0, 0],
  vAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

const rectangle = (minX: number, minY: number, maxX: number, maxY: number): PlanarLoop => [
  [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
];

function prism(id: string, outer: PlanarLoop, minDepth = 0, maxDepth = 2): Body {
  return unwrap(createPrismaticBody({
    id,
    operationId: `source:${id}`,
    frame,
    region: { outer, holes: [] },
    minDepth,
    maxDepth,
  }));
}

function unwrap(result: PrismaticBooleanResult): Body {
  if (!result.ok) throw new Error(result.diagnostics[0]?.message);
  return result.body;
}

function snapshot(body: Body): string {
  return JSON.stringify({
    id: body.id,
    vertices: [...body.vertices].map(([id, value]) => [id, value]),
    edges: [...body.edges].map(([id, value]) => [id, value]),
    faces: [...body.faces].map(([id, value]) => [id, value]),
    planes: [...body.planes].map(([id, value]) => [id, value]),
    triangles: triangulateBody(body),
  });
}

function volume(body: Body): number {
  const mesh = triangulateBody(body);
  let signed = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const ai = mesh.indices[index]! * 3;
    const bi = mesh.indices[index + 1]! * 3;
    const ci = mesh.indices[index + 2]! * 3;
    const a = [mesh.positions[ai]!, mesh.positions[ai + 1]!, mesh.positions[ai + 2]!];
    const b = [mesh.positions[bi]!, mesh.positions[bi + 1]!, mesh.positions[bi + 2]!];
    const c = [mesh.positions[ci]!, mesh.positions[ci + 1]!, mesh.positions[ci + 2]!];
    signed += a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!)
      + a[1]! * (b[2]! * c[0]! - b[0]! * c[2]!)
      + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  }
  return Math.abs(signed / 6);
}

describe('restricted prismatic booleans', () => {
  it('unions overlapping boxes when their result is safely one rectangle', () => {
    const left = prism('left', rectangle(0, 0, 2, 2));
    const right = prism('right', rectangle(1, 0, 3, 2));
    const before = [snapshot(left), snapshot(right)];
    const result = unionPrismatic({ left, right, frame, operationId: 'union' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateClosedManifoldBody(result.body).ok).toBe(true);
    expect(volume(result.body)).toBeCloseTo(12, 8);
    expect(result.body.faces.size).toBe(6);
    expect([snapshot(left), snapshot(right)]).toEqual(before);
  });

  it.each([
    ['rectangular pocket', rectangle(1, 1, 3, 3), false, 28],
    ['concave pocket', [[1, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3]], false, 29],
    ['rectangular through cut', rectangle(1, 1, 3, 3), true, 24],
    ['concave through cut', [[1, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3]], true, 26],
  ] as Array<[string, PlanarLoop, boolean, number]>)('builds a manifold %s', (_name, profile, throughAll, expectedVolume) => {
    const target = prism('target', rectangle(0, 0, 4, 4));
    const before = snapshot(target);
    const result = differencePrismatic({
      target,
      frame,
      profile: { outer: profile },
      operationId: `cut:${_name}`,
      throughAll,
      ...(throughAll ? {} : { depth: 1 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateClosedManifoldBody(result.body).ok).toBe(true);
    expect(volume(result.body)).toBeCloseTo(expectedVolume, 8);
    const top = [...result.body.faces.values()].find((face) => face.name === 'Top')!;
    expect(top.innerBoundaryEdgeIds).toHaveLength(1);
    expect(triangulateFace(result.body, top, top.id)?.indices.length).toBeGreaterThan(0);
    expect(snapshot(target)).toBe(before);
  });

  it('rejects non-manifold and tangential inputs without touching the source', () => {
    const target = prism('target', rectangle(0, 0, 4, 4));
    const edge = target.edges.values().next().value!;
    edge.faceIds.push('third-face');
    const invalidBefore = snapshot(target);
    expect(differencePrismatic({
      target, frame, profile: { outer: rectangle(1, 1, 2, 2) },
      operationId: 'invalid', throughAll: true,
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'NON_MANIFOLD_INPUT' }] });
    expect(snapshot(target)).toBe(invalidBefore);

    const valid = prism('valid', rectangle(0, 0, 4, 4));
    const validBefore = snapshot(valid);
    expect(differencePrismatic({
      target: valid, frame, profile: { outer: rectangle(0, 1, 2, 2) },
      operationId: 'touching', throughAll: true,
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'AMBIGUOUS_CONTACT' }] });
    expect(snapshot(valid)).toBe(validBefore);
  });

  it('produces identical topology and triangles across ten runs', () => {
    const target = prism('target', rectangle(0, 0, 4, 4));
    const profile: PlanarLoop = [[1, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3]];
    const throughRuns = Array.from({ length: 10 }, () => unwrap(differencePrismatic({
      target, frame, profile: { outer: profile }, operationId: 'stable-cut', throughAll: true,
    })));
    const pocketRuns = Array.from({ length: 10 }, () => unwrap(differencePrismatic({
      target, frame, profile: { outer: profile }, operationId: 'stable-pocket', depth: 1,
    })));
    const left = prism('left', rectangle(0, 0, 2, 2));
    const right = prism('right', rectangle(1, 0, 3, 2));
    const unionRuns = Array.from({ length: 10 }, () => unwrap(unionPrismatic({
      left, right, frame, operationId: 'stable-union',
    })));

    expect(new Set(throughRuns.map(snapshot)).size).toBe(1);
    expect(new Set(pocketRuns.map(snapshot)).size).toBe(1);
    expect(new Set(unionRuns.map(snapshot)).size).toBe(1);
  });
});
