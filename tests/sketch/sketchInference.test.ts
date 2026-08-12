import { describe, expect, it } from 'vitest';
import {
  createPersistentSketchInferenceInput,
  createSketchInferenceRelations,
  findSketchInferences,
  getBestSketchInference,
  type SketchProjector,
} from '../../src/sketch/SketchInference';

const projectAtTenPixelsPerUnit: SketchProjector = ([x, y]) => ({ x: x * 10, y: y * 10 });

describe('sketch inference', () => {
  it('ranks an endpoint ahead of a grid point', () => {
    const best = getBestSketchInference(
      [1.04, 1],
      [{ id: 'line', start: [1, 1], end: [3, 1] }],
      { projector: projectAtTenPixelsPerUnit, pixelTolerance: 5, gridStep: 0.5 }
    );

    expect(best).toMatchObject({
      id: 'endpoint:line:start',
      kind: 'endpoint',
      point: [1, 1],
    });
  });

  it('finds midpoint inference in screen space', () => {
    const candidates = findSketchInferences(
      [2.1, 0],
      [{ id: 'line', start: [0, 0], end: [4, 0] }],
      { projector: projectAtTenPixelsPerUnit, pixelTolerance: 2 }
    );

    expect(candidates).toContainEqual(expect.objectContaining({
      id: 'midpoint:line',
      kind: 'midpoint',
      point: [2, 0],
      distancePixels: 1,
    }));
  });

  it('offers horizontal and vertical alignment from an anchor', () => {
    const horizontal = findSketchInferences(
      [3, 1.1],
      [],
      { projector: projectAtTenPixelsPerUnit, pixelTolerance: 2, anchor: [0, 1] }
    );
    expect(horizontal[0]).toMatchObject({
      kind: 'horizontal',
      point: [3, 1],
    });

    const vertical = findSketchInferences(
      [1.1, 3],
      [],
      { projector: projectAtTenPixelsPerUnit, pixelTolerance: 2, anchor: [1, 0] }
    );
    expect(vertical[0]).toMatchObject({
      kind: 'vertical',
      point: [1, 3],
    });
  });

  it('prioritizes a coincident inference while drawing from an anchor', () => {
    const best = getBestSketchInference(
      [2.05, 2],
      [{ id: 'existing', start: [2, 2], end: [4, 2] }],
      {
        projector: projectAtTenPixelsPerUnit,
        pixelTolerance: 2,
        anchor: [0, 0],
      }
    );

    expect(best).toMatchObject({
      id: 'coincident:existing:start',
      kind: 'coincident',
      point: [2, 2],
    });
  });

  it('uses deterministic IDs to break equal-distance ties', () => {
    const options = { projector: projectAtTenPixelsPerUnit, pixelTolerance: 20 };
    const base = [
      { id: 'b', start: [1, 0] as [number, number], end: [10, 0] as [number, number] },
      { id: 'a', start: [-1, 0] as [number, number], end: [-10, 0] as [number, number] },
    ];
    const best = getBestSketchInference([0, 0], base, options);
    const withUnrelatedEntity = getBestSketchInference(
      [0, 0],
      [...base, { id: 'unrelated', start: [100, 100], end: [101, 100] }],
      options
    );

    expect(best?.id).toBe('endpoint:a:start');
    expect(withUnrelatedEntity?.id).toBe(best?.id);
  });

  it('honors projected pixel tolerance instead of sketch-unit distance', () => {
    const zoomedProjector: SketchProjector = ([x, y]) => ({ x: x * 1000, y: y * 1000 });
    const candidates = findSketchInferences(
      [0.01, 0],
      [{ id: 'line', start: [0, 0], end: [1, 0] }],
      { projector: zoomedProjector, pixelTolerance: 5 }
    );

    expect(candidates.some((candidate) => candidate.id === 'endpoint:line:start')).toBe(false);
  });

  it('rejects invalid tolerance and projector output safely', () => {
    expect(findSketchInferences([0, 0], [], {
      projector: projectAtTenPixelsPerUnit,
      pixelTolerance: -1,
    })).toEqual([]);
    expect(findSketchInferences([0, 0], [{ id: 'a', start: [0, 0], end: [1, 0] }], {
      projector: () => ({ x: Number.NaN, y: 0 }),
      pixelTolerance: 10,
    })).toEqual([]);
  });

  it('turns topology-backed endpoint and alignment snaps into persistent relations', () => {
    const endpoint = getBestSketchInference(
      [1.02, 1],
      [{
        id: 'line',
        start: [1, 1],
        end: [3, 1],
        startPointId: 'existing-start',
        endPointId: 'existing-end',
      }],
      {
        projector: projectAtTenPixelsPerUnit,
        pixelTolerance: 2,
        anchor: [0, 0],
        anchorPointId: 'new-point',
      }
    );
    expect(createPersistentSketchInferenceInput({
      operationId: 'draw',
      candidate: endpoint,
      pointId: 'new-point',
    })).toEqual({
      id: 'draw:inference:coincident',
      type: 'coincident',
      pointId: 'new-point',
      targetPointId: 'existing-start',
    });
    expect(createSketchInferenceRelations({
      operationId: 'draw',
      candidate: endpoint,
      pointId: 'new-point',
    })).toEqual([{
      id: 'draw:inference:coincident',
      type: 'coincident',
      pointAId: 'new-point',
      pointBId: 'existing-start',
    }]);

    const horizontal = getBestSketchInference(
      [3, 1.1],
      [],
      {
        projector: projectAtTenPixelsPerUnit,
        pixelTolerance: 2,
        anchor: [0, 1],
      }
    );
    expect(createSketchInferenceRelations({
      operationId: 'draw-horizontal',
      candidate: horizontal,
      segmentId: 'new-segment',
    })).toEqual([{
      id: 'draw-horizontal:inference:horizontal',
      type: 'horizontal',
      segmentId: 'new-segment',
    }]);
  });

  it('keeps legacy tuple inferences visual-only when no topology IDs exist', () => {
    const candidate = getBestSketchInference(
      [1, 1],
      [{ id: 'legacy', start: [1, 1], end: [2, 1] }],
      { projector: projectAtTenPixelsPerUnit, pixelTolerance: 2 }
    );

    expect(createSketchInferenceRelations({
      operationId: 'draw',
      candidate,
      pointId: 'new-point',
    })).toEqual([]);
  });
});
