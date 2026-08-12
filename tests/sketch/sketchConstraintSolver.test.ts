import { describe, expect, it } from 'vitest';
import {
  solveSketchConstraints,
  validateSketchRelations,
} from '../../src/sketch/SketchConstraintSolver';
import type { NormalizedSketchGeometry } from '../../src/sketch/NormalizedSketch';
import type { SketchRelation } from '../../src/sketch/SketchConstraints';

function rectangleGeometry(): NormalizedSketchGeometry {
  return {
    schemaVersion: 1,
    points: [
      { id: 'p0', position: [0, 0] },
      { id: 'p1', position: [4, 0.2] },
      { id: 'p2', position: [4.1, 2.8] },
      { id: 'p3', position: [-0.1, 3] },
    ],
    segments: [
      { id: 'bottom', type: 'line', startPointId: 'p0', endPointId: 'p1', construction: false },
      { id: 'right', type: 'line', startPointId: 'p1', endPointId: 'p2', construction: false },
      { id: 'top', type: 'line', startPointId: 'p2', endPointId: 'p3', construction: false },
      { id: 'left', type: 'line', startPointId: 'p3', endPointId: 'p0', construction: false },
    ],
  };
}

function rectangleRelations(width = 6, height = 3): SketchRelation[] {
  return [
    { id: 'fixed-origin', type: 'fixed', pointId: 'p0', position: [0, 0] },
    { id: 'horizontal-bottom', type: 'horizontal', segmentId: 'bottom' },
    { id: 'horizontal-top', type: 'horizontal', segmentId: 'top' },
    { id: 'vertical-left', type: 'vertical', segmentId: 'left' },
    { id: 'vertical-right', type: 'vertical', segmentId: 'right' },
    { id: 'width', type: 'distance', pointAId: 'p0', pointBId: 'p1', value: width, name: 'Width' },
    { id: 'height', type: 'distance', pointAId: 'p1', pointBId: 'p2', value: height, name: 'Height' },
  ];
}

describe('solveSketchConstraints', () => {
  it('solves a fully constrained rectangle with driving dimensions', () => {
    const result = solveSketchConstraints(rectangleGeometry(), rectangleRelations());

    expect(result.ok).toBe(true);
    expect(result.status).toBe('fully_constrained');
    expect(result.degreesOfFreedom).toBe(0);
    expect(result.rank).toBe(8);
    expect(result.equationCount).toBe(8);
    const pointById = new Map(result.geometry.points.map((point) => [point.id, point.position]));
    expect(pointById.get('p0')![0]).toBeCloseTo(0, 8);
    expect(pointById.get('p0')![1]).toBeCloseTo(0, 8);
    expect(pointById.get('p1')![0]).toBeCloseTo(6, 5);
    expect(pointById.get('p1')![1]).toBeCloseTo(0, 5);
    expect(pointById.get('p2')![0]).toBeCloseTo(6, 5);
    expect(pointById.get('p2')![1]).toBeCloseTo(3, 5);
    expect(pointById.get('p3')![0]).toBeCloseTo(0, 5);
    expect(pointById.get('p3')![1]).toBeCloseTo(3, 5);
  });

  it('is deterministic under relation insertion order', () => {
    const relations = rectangleRelations();
    const forward = solveSketchConstraints(rectangleGeometry(), relations);
    const reversed = solveSketchConstraints(rectangleGeometry(), [...relations].reverse());

    expect(reversed).toEqual(forward);
  });

  it('does not count externally driven projected endpoints as free degrees of freedom', () => {
    const geometry = rectangleGeometry();
    geometry.points.push(
      { id: 'external-a', position: [10, 0] },
      { id: 'external-b', position: [12, 0] }
    );
    geometry.segments.push({
      id: 'projected-edge',
      type: 'line',
      startPointId: 'external-a',
      endPointId: 'external-b',
      construction: true,
      sourceRef: {
        kind: 'model-edge',
        featureId: 'source-feature',
        bodyId: 'source-body',
        edgeId: 'source-edge',
        vertexIds: ['source-a', 'source-b'],
      },
    });

    const result = solveSketchConstraints(geometry, rectangleRelations());

    expect(result.ok).toBe(true);
    expect(result.status).toBe('fully_constrained');
    expect(result.degreesOfFreedom).toBe(0);
    expect(result.geometry.points.find((point) => point.id === 'external-a')?.position)
      .toEqual([10, 0]);
  });

  it('fails closed when fixed points contradict a driving dimension', () => {
    const geometry: NormalizedSketchGeometry = {
      schemaVersion: 1,
      points: [
        { id: 'a', position: [0, 0] },
        { id: 'b', position: [1, 0] },
      ],
      segments: [
        { id: 'line', type: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      ],
    };
    const result = solveSketchConstraints(geometry, [
      { id: 'fix-a', type: 'fixed', pointId: 'a', position: [0, 0] },
      { id: 'fix-b', type: 'fixed', pointId: 'b', position: [1, 0] },
      { id: 'length', type: 'distance', pointAId: 'a', pointBId: 'b', value: 2 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('inconsistent');
    expect(result.geometry).toEqual(geometry);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'INCONSISTENT_CONSTRAINTS',
    }));
  });

  it('fails closed and identifies a consistent but redundant system', () => {
    const geometry: NormalizedSketchGeometry = {
      schemaVersion: 1,
      points: [
        { id: 'a', position: [0, 0] },
        { id: 'b', position: [1, 0] },
      ],
      segments: [
        { id: 'line', type: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      ],
    };
    const result = solveSketchConstraints(geometry, [
      { id: 'fix-a', type: 'fixed', pointId: 'a', position: [0, 0] },
      { id: 'fix-b', type: 'fixed', pointId: 'b', position: [1, 0] },
      { id: 'length', type: 'distance', pointAId: 'a', pointBId: 'b', value: 1 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('over_constrained');
    expect(result.diagnostics[0]).toMatchObject({ code: 'REDUNDANT_CONSTRAINTS' });
  });

  it('supports coincident, parallel, perpendicular, and equal relations', () => {
    const geometry: NormalizedSketchGeometry = {
      schemaVersion: 1,
      points: [
        { id: 'a', position: [0, 0] },
        { id: 'b', position: [2, 0] },
        { id: 'c', position: [0, 1] },
        { id: 'd', position: [2, 1] },
        { id: 'e', position: [2, 0] },
        { id: 'f', position: [2, 2] },
        { id: 'loose', position: [0, 0] },
      ],
      segments: [
        { id: 'one', type: 'line', startPointId: 'a', endPointId: 'b', construction: false },
        { id: 'two', type: 'line', startPointId: 'c', endPointId: 'd', construction: false },
        { id: 'three', type: 'line', startPointId: 'e', endPointId: 'f', construction: false },
      ],
    };
    const relations: SketchRelation[] = [
      { id: 'coincident', type: 'coincident', pointAId: 'a', pointBId: 'loose' },
      { id: 'parallel', type: 'parallel', segmentAId: 'one', segmentBId: 'two' },
      { id: 'perpendicular', type: 'perpendicular', segmentAId: 'one', segmentBId: 'three' },
      { id: 'equal', type: 'equal', segmentAId: 'one', segmentBId: 'two' },
    ];

    expect(validateSketchRelations(geometry, relations)).toEqual([]);
    const result = solveSketchConstraints(geometry, relations);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('under_constrained');
    expect(result.maximumResidual).toBeLessThanOrEqual(1e-6);
  });

  it('reports invalid references and dimension values before solving', () => {
    const result = solveSketchConstraints(rectangleGeometry(), [
      { id: 'bad-segment', type: 'horizontal', segmentId: 'missing' },
      { id: 'bad-distance', type: 'distance', pointAId: 'p0', pointBId: 'p1', value: 0 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((diagnostic) => diagnostic.code === 'INVALID_RELATION')).toBe(true);
  });
});
