import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import {
  executePlanarBoolean,
  hashBodyGeometry,
  measureBody,
  validateClosedManifoldBody,
} from '../../src/geometry';

describe('PlanarBooleanKernel', () => {
  it('creates one manifold stepped union for overlapping boxes', () => {
    const target = createBoxBody({
      width: 2,
      depth: 1,
      height: 1,
      origin: [0, 0, 0],
      anchorMode: 'corner',
    }, 'target');
    const tool = createBoxBody({
      width: 1,
      depth: 2,
      height: 1,
      origin: [0.5, 0, 0],
      anchorMode: 'corner',
    }, 'tool');

    const result = executePlanarBoolean({
      operation: 'union',
      operationId: 'union-op',
      target,
      tools: [tool],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0]!.id).toBe(target.id);
    expect(validateClosedManifoldBody(result.bodies[0]!).ok).toBe(true);
    expect(result.bodies[0]!.faces.size).toBeGreaterThan(6);
  });

  it('supports a boundary-crossing through difference', () => {
    const target = createBoxBody({
      width: 4,
      depth: 3,
      height: 1,
      origin: [0, 0, 0],
      anchorMode: 'corner',
    }, 'target');
    const tool = createBoxBody({
      width: 2,
      depth: 2,
      height: 2,
      origin: [-1, 0.5, -0.5],
      anchorMode: 'corner',
    }, 'tool');

    const result = executePlanarBoolean({
      operation: 'difference',
      operationId: 'difference-op',
      target,
      tools: [tool],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodies).toHaveLength(1);
    expect(validateClosedManifoldBody(result.bodies[0]!).ok).toBe(true);
    expect(result.bodies[0]!.vertices.size).toBeGreaterThan(8);
  });

  it('is deterministic and partitions split material', () => {
    const createResult = () => executePlanarBoolean({
      operation: 'split',
      operationId: 'split-op',
      target: createBoxBody({
        width: 4,
        depth: 2,
        height: 1,
        origin: [0, 0, 0],
        anchorMode: 'corner',
      }, 'target'),
      tools: [createBoxBody({
        width: 1,
        depth: 4,
        height: 3,
        origin: [1.5, -1, -1],
        anchorMode: 'corner',
      }, 'tool')],
    });

    const first = createResult();
    const second = createResult();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.bodies.length).toBeGreaterThanOrEqual(2);
    expect(first.bodies.map((body) => hashBodyGeometry(body)))
      .toEqual(second.bodies.map((body) => hashBodyGeometry(body)));
    expect(first.bodies.map((body) => [...body.faces.keys()].sort()))
      .toEqual(second.bodies.map((body) => [...body.faces.keys()].sort()));
  });

  it('fails disconnected union with a Compound Bodies suggestion', () => {
    const result = executePlanarBoolean({
      operation: 'union',
      operationId: 'union-separated',
      target: createBoxBody({
        width: 1,
        depth: 1,
        height: 1,
        origin: [0, 0, 0],
        anchorMode: 'corner',
      }, 'target'),
      tools: [createBoxBody({
        width: 1,
        depth: 1,
        height: 1,
        origin: [3, 0, 0],
        anchorMode: 'corner',
      }, 'tool')],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('DISCONNECTED_RESULT');
    expect(result.diagnostics[0]?.message).toContain('Compound Bodies');
  });

  it('does not mistake a solid inside a concave result AABB for a cavity shell', () => {
    const horizontal = createBoxBody({
      width: 4,
      depth: 1,
      height: 1,
      origin: [0, 0, 0],
      anchorMode: 'corner',
    }, 'horizontal');
    const vertical = createBoxBody({
      width: 1,
      depth: 4,
      height: 1,
      origin: [0, 0, 0],
      anchorMode: 'corner',
    }, 'vertical');
    const lShape = executePlanarBoolean({
      operation: 'union',
      operationId: 'concave-l',
      target: horizontal,
      tools: [vertical],
    });
    expect(lShape.ok).toBe(true);
    if (!lShape.ok) return;

    const disconnectedInsideBounds = createBoxBody({
      width: 0.5,
      depth: 0.5,
      height: 0.5,
      origin: [2, 2, 0.25],
      anchorMode: 'corner',
    }, 'inside-aabb-only');
    const result = executePlanarBoolean({
      operation: 'union',
      operationId: 'concave-disconnected',
      target: lShape.bodies[0]!,
      tools: [disconnectedInsideBounds],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('DISCONNECTED_RESULT');
  });

  it('supports two sequential mortises without losing the first cavity', () => {
    const target = createBoxBody({
      width: 10,
      depth: 4,
      height: 2,
      origin: [0, 0, 0],
      anchorMode: 'corner',
    }, 'rail');
    const mortiseA = createBoxBody({
      width: 1,
      depth: 1,
      height: 1.25,
      origin: [2, 1.5, 1],
      anchorMode: 'corner',
    }, 'mortise-a');
    const mortiseB = createBoxBody({
      width: 1,
      depth: 1,
      height: 1.25,
      origin: [7, 1.5, 1],
      anchorMode: 'corner',
    }, 'mortise-b');

    const first = executePlanarBoolean({
      operation: 'difference',
      operationId: 'mortise-a-op',
      target,
      tools: [mortiseA],
    });
    expect(first.ok, first.ok ? undefined : JSON.stringify(first.diagnostics)).toBe(true);
    if (!first.ok) return;

    const second = executePlanarBoolean({
      operation: 'difference',
      operationId: 'mortise-b-op',
      target: first.bodies[0]!,
      tools: [mortiseB],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.bodies).toHaveLength(1);
    expect(validateClosedManifoldBody(second.bodies[0]!).ok).toBe(true);
    expect(measureBody(second.bodies[0]!).volume).toBeCloseTo(78, 8);
    expect(second.bodies[0]!.faces.size).toBeGreaterThan(first.bodies[0]!.faces.size);
  });

  it('preserves geometry hashes and topology IDs across ten identical rebuilds', () => {
    const rebuild = () => {
      const target = createBoxBody({
        width: 6,
        depth: 3,
        height: 2,
        origin: [0, 0, 0],
        anchorMode: 'corner',
      }, 'deterministic-target');
      const cutter = createBoxBody({
        width: 2,
        depth: 1,
        height: 4,
        origin: [2, 1, -1],
        anchorMode: 'corner',
      }, 'deterministic-cutter');
      return executePlanarBoolean({
        operation: 'difference',
        operationId: 'deterministic-through-dado',
        target,
        tools: [cutter],
      });
    };

    const results = Array.from({ length: 10 }, rebuild);
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const successful = results.filter((result) => result.ok);
    expect(successful).toHaveLength(10);
    const baseline = successful[0]!.bodies;

    for (const result of successful.slice(1)) {
      expect(result.bodies.map((body) => hashBodyGeometry(body)))
        .toEqual(baseline.map((body) => hashBodyGeometry(body)));
      expect(result.bodies.map((body) => [...body.vertices.keys()].sort()))
        .toEqual(baseline.map((body) => [...body.vertices.keys()].sort()));
      expect(result.bodies.map((body) => [...body.edges.keys()].sort()))
        .toEqual(baseline.map((body) => [...body.edges.keys()].sort()));
      expect(result.bodies.map((body) => [...body.faces.keys()].sort()))
        .toEqual(baseline.map((body) => [...body.faces.keys()].sort()));
    }
  });

  it('conserves volume for an overlapping union and leaves no invalid topology', () => {
    const target = createBoxBody({
      width: 3,
      depth: 2,
      height: 1,
      origin: [0, 0, 0],
      anchorMode: 'corner',
    }, 'volume-target');
    const tool = createBoxBody({
      width: 2,
      depth: 2,
      height: 1,
      origin: [2, 0, 0],
      anchorMode: 'corner',
    }, 'volume-tool');

    const intersection = executePlanarBoolean({
      operation: 'intersection',
      operationId: 'volume-intersection',
      target,
      tools: [tool],
    });
    const union = executePlanarBoolean({
      operation: 'union',
      operationId: 'volume-union',
      target,
      tools: [tool],
    });

    expect(intersection.ok).toBe(true);
    expect(union.ok).toBe(true);
    if (!intersection.ok || !union.ok) return;
    const expectedVolume = measureBody(target).volume
      + measureBody(tool).volume
      - intersection.bodies.reduce((sum, body) => sum + measureBody(body).volume, 0);
    const actualVolume = union.bodies.reduce((sum, body) => sum + measureBody(body).volume, 0);
    expect(actualVolume).toBeCloseTo(expectedVolume, 8);
    expect(validateClosedManifoldBody(union.bodies[0]!).ok).toBe(true);
  });
});
