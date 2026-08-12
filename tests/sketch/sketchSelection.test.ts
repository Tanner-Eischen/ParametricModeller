import { describe, expect, it } from 'vitest';
import type { NormalizedSketchGeometry } from '../../src/sketch/NormalizedSketch';
import type {
  DrivingDistanceDimension,
  SketchConstraint,
} from '../../src/sketch/SketchConstraints';
import {
  createEmptySketchSelection,
  deleteSketchSelection,
  normalizeSketchSelection,
} from '../../src/sketch/SketchSelection';

function geometry(): NormalizedSketchGeometry {
  return {
    schemaVersion: 1,
    points: [
      { id: 'a', position: [0, 0] },
      { id: 'b', position: [1, 0] },
      { id: 'c', position: [2, 0] },
      { id: 'isolated', position: [5, 5] },
    ],
    segments: [
      {
        id: 'left',
        type: 'line',
        startPointId: 'a',
        endPointId: 'b',
        construction: false,
      },
      {
        id: 'right',
        type: 'line',
        startPointId: 'b',
        endPointId: 'c',
        construction: false,
      },
    ],
  };
}

describe('SketchSelection', () => {
  it('canonicalizes selection IDs and creates a fresh empty selection', () => {
    expect(normalizeSketchSelection({
      pointIds: ['b', 'a', 'b'],
      segmentIds: ['right', 'left'],
      relationIds: ['z', 'z'],
      dimensionIds: [],
    })).toEqual({
      pointIds: ['a', 'b'],
      segmentIds: ['left', 'right'],
      relationIds: ['z'],
      dimensionIds: [],
    });
    expect(createEmptySketchSelection()).toEqual({
      pointIds: [],
      segmentIds: [],
      relationIds: [],
      dimensionIds: [],
    });
  });

  it('atomically removes a point, incident geometry, and dependent solver inputs', () => {
    const source = geometry();
    const relations: SketchConstraint[] = [
      { id: 'left-horizontal', type: 'horizontal', segmentId: 'left' },
      { id: 'right-horizontal', type: 'horizontal', segmentId: 'right' },
      { id: 'fixed-a', type: 'fixed', pointId: 'a', position: [0, 0] },
    ];
    const dimensions: DrivingDistanceDimension[] = [
      {
        id: 'left-length',
        type: 'distance',
        pointAId: 'a',
        pointBId: 'b',
        value: 1,
      },
    ];

    const result = deleteSketchSelection(
      source,
      {
        pointIds: ['b'],
        segmentIds: [],
        relationIds: [],
        dimensionIds: [],
      },
      relations,
      dimensions
    );

    expect(result.removedSegmentIds).toEqual(['left', 'right']);
    expect(result.removedPointIds).toEqual(['a', 'b', 'c']);
    expect(result.removedRelationIds).toEqual([
      'fixed-a',
      'left-horizontal',
      'right-horizontal',
    ]);
    expect(result.removedDimensionIds).toEqual(['left-length']);
    expect(result.geometry).toEqual({
      schemaVersion: 1,
      points: [{ id: 'isolated', position: [5, 5] }],
      segments: [],
    });
    expect(result.selection).toEqual(createEmptySketchSelection());
    expect(source).toEqual(geometry());
  });

  it('can delete only a relation or dimension without touching isolated geometry', () => {
    const relations: SketchConstraint[] = [
      { id: 'horizontal', type: 'horizontal', segmentId: 'left' },
    ];
    const dimensions: DrivingDistanceDimension[] = [
      { id: 'length', type: 'distance', pointAId: 'a', pointBId: 'b', value: 1 },
    ];
    const result = deleteSketchSelection(
      geometry(),
      relations,
      dimensions,
      {
        pointIds: [],
        segmentIds: [],
        relationIds: ['horizontal'],
        dimensionIds: ['length'],
      }
    );

    expect(result.geometry).toEqual(geometry());
    expect(result.relations).toEqual([]);
    expect(result.dimensions).toEqual([]);
  });

  it('reports stale selected IDs while applying all valid deletions deterministically', () => {
    const result = deleteSketchSelection(
      geometry(),
      [],
      [],
      {
        pointIds: ['missing-point'],
        segmentIds: ['left', 'missing-segment'],
        relationIds: ['missing-relation'],
        dimensionIds: ['missing-dimension'],
      }
    );

    expect(result.removedSegmentIds).toEqual(['left']);
    expect(result.diagnostics.map(({ targetType, targetId }) => [
      targetType,
      targetId,
    ])).toEqual([
      ['dimension', 'missing-dimension'],
      ['point', 'missing-point'],
      ['relation', 'missing-relation'],
      ['segment', 'missing-segment'],
    ]);
  });
});
