import { describe, expect, it } from 'vitest';
import type { NormalizedSketchGeometry } from '../../src/sketch/NormalizedSketch';
import type { SketchRelation } from '../../src/sketch/SketchConstraints';
import {
  addDrivingDistanceDimension,
  addSketchRelation,
  appendCenterRectangle,
  appendRegularPolygon,
  appendSharedPointPolyline,
  appendSharedPointRectangle,
  extendStraightSegment,
  moveSketchPoint,
  projectStraightSegments,
  trimStraightSegment,
} from '../../src/sketch/SketchEditing';

function emptyGeometry(): NormalizedSketchGeometry {
  return { schemaVersion: 1, points: [], segments: [] };
}

function crossingGeometry(): NormalizedSketchGeometry {
  return {
    schemaVersion: 1,
    points: [
      { id: 'a', position: [0, 0] },
      { id: 'b', position: [4, 0] },
      { id: 'c', position: [2, -1] },
      { id: 'd', position: [2, 1] },
    ],
    segments: [
      { id: 'target', type: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'cutter', type: 'line', startPointId: 'c', endPointId: 'd', construction: false },
    ],
  };
}

describe('professional sketch editing operations', () => {
  it('creates a deterministic shared-point rectangle without mutating input', () => {
    const source = emptyGeometry();
    const result = appendSharedPointRectangle(source, 'rectangle', [0, 0], [4, 2]);

    expect(result.ok).toBe(true);
    expect(source).toEqual(emptyGeometry());
    if (!result.ok) return;
    expect(result.geometry.points).toHaveLength(4);
    expect(result.geometry.segments).toHaveLength(4);
    expect(result.geometry.segments[3]).toMatchObject({
      startPointId: 'rectangle:point:3',
      endPointId: 'rectangle:point:0',
    });
    expect(appendSharedPointRectangle(source, 'rectangle', [0, 0], [4, 2])).toEqual(result);
  });

  it('creates closed L and U profiles through the shared polyline API', () => {
    const lShape = appendSharedPointPolyline(emptyGeometry(), 'l', [
      [0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3],
    ], { closed: true });
    const uShape = appendSharedPointPolyline(emptyGeometry(), 'u', [
      [0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3],
    ], { closed: true });

    expect(lShape.ok && lShape.geometry.segments).toHaveLength(6);
    expect(uShape.ok && uShape.geometry.segments).toHaveLength(8);
  });

  it('creates center rectangles and regular polygons with stable namespaces', () => {
    const rectangle = appendCenterRectangle(emptyGeometry(), 'center', [0, 0], [2, 1]);
    const polygon = appendRegularPolygon(emptyGeometry(), 'hex', [0, 0], [2, 0], 6);

    expect(rectangle.ok && rectangle.geometry.points).toHaveLength(4);
    expect(polygon.ok && polygon.geometry.points).toHaveLength(6);
    expect(polygon.ok && polygon.geometry.segments[0]?.id).toBe('hex:segment:0');
  });

  it('moves one editable point while preserving IDs and source geometry', () => {
    const created = appendSharedPointRectangle(emptyGeometry(), 'rectangle', [0, 0], [2, 1]);
    if (!created.ok) throw new Error(created.error.message);
    const moved = moveSketchPoint(created.geometry, 'rectangle:point:0', [-1, -1]);

    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.geometry.points.find((point) => point.id === 'rectangle:point:0')?.position)
      .toEqual([-1, -1]);
    expect(created.geometry.points.find((point) => point.id === 'rectangle:point:0')?.position)
      .toEqual([0, 0]);
  });

  it('adds every supported relation and a driving distance immutably', () => {
    const created = appendSharedPointRectangle(emptyGeometry(), 'r', [0, 0], [2, 2]);
    if (!created.ok) throw new Error(created.error.message);
    const relationsToAdd: SketchRelation[] = [
      { id: 'fixed', type: 'fixed', pointId: 'r:point:0', position: [0, 0] },
      { id: 'horizontal', type: 'horizontal', segmentId: 'r:segment:0' },
      { id: 'vertical', type: 'vertical', segmentId: 'r:segment:1' },
      { id: 'parallel', type: 'parallel', segmentAId: 'r:segment:0', segmentBId: 'r:segment:2' },
      { id: 'perpendicular', type: 'perpendicular', segmentAId: 'r:segment:0', segmentBId: 'r:segment:1' },
      { id: 'equal', type: 'equal', segmentAId: 'r:segment:0', segmentBId: 'r:segment:1' },
      { id: 'coincident', type: 'coincident', pointAId: 'r:point:0', pointBId: 'r:point:1' },
    ];
    let relations: SketchRelation[] = [];
    for (const relation of relationsToAdd) {
      const result = addSketchRelation(created.geometry, relations, relation);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      relations = result.relations;
    }
    const dimension = addDrivingDistanceDimension(
      created.geometry,
      relations,
      'width',
      'r:point:0',
      'r:point:1',
      5,
      'Width'
    );

    expect(dimension.ok).toBe(true);
    expect(relations).toHaveLength(7);
    expect(dimension.ok && dimension.relations).toHaveLength(8);
  });

  it('rejects invalid relations with actionable IDs', () => {
    const result = addSketchRelation(emptyGeometry(), [], {
      id: 'bad', type: 'horizontal', segmentId: 'missing',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RELATION', entityIds: ['bad', 'missing'] },
    });
  });

  it('trims a straight segment at a strict intersection and preserves its ID', () => {
    const source = crossingGeometry();
    const result = trimStraightSegment(source, 'trim', 'target', 'cutter', 'start');

    expect(result.ok).toBe(true);
    expect(source.points.find((point) => point.id === 'b')).toBeDefined();
    if (!result.ok) return;
    const target = result.geometry.segments.find((segment) => segment.id === 'target')!;
    expect(target.endPointId).toBe('trim:point:intersection');
    expect(result.geometry.points.find((point) => point.id === target.endPointId)?.position).toEqual([2, 0]);
    expect(result.geometry.points.some((point) => point.id === 'b')).toBe(false);
  });

  it('accepts removeSide while preserving the legacy keep-side call', () => {
    const modern = trimStraightSegment(
      crossingGeometry(),
      'trim',
      'target',
      'cutter',
      { removeSide: 'start' }
    );
    const legacy = trimStraightSegment(
      crossingGeometry(),
      'trim',
      'target',
      'cutter',
      'end'
    );

    expect(modern).toEqual(legacy);
    expect(modern.ok).toBe(true);
    if (modern.ok) {
      const target = modern.geometry.segments.find((segment) => segment.id === 'target');
      expect(target?.startPointId).toBe('trim:point:intersection');
    }
  });

  it('extends the requested endpoint to a finite boundary', () => {
    const geometry: NormalizedSketchGeometry = {
      schemaVersion: 1,
      points: [
        { id: 'a', position: [0, 0] }, { id: 'b', position: [1, 0] },
        { id: 'c', position: [3, -1] }, { id: 'd', position: [3, 1] },
      ],
      segments: [
        { id: 'target', type: 'line', startPointId: 'a', endPointId: 'b', construction: false },
        { id: 'boundary', type: 'line', startPointId: 'c', endPointId: 'd', construction: false },
      ],
    };
    const result = extendStraightSegment(geometry, 'extend', 'target', 'boundary', 'end');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.geometry.points.find((point) => point.id === 'extend:point:intersection')?.position)
        .toEqual([3, 0]);
    }
  });

  it('projects selected shared segments as deterministic construction geometry', () => {
    const sourceResult = appendSharedPointPolyline(emptyGeometry(), 'source', [[0, 0], [1, 0], [1, 1]]);
    if (!sourceResult.ok) throw new Error(sourceResult.error.message);
    const result = projectStraightSegments(
      emptyGeometry(),
      sourceResult.geometry,
      ['source:segment:1', 'source:segment:0'],
      'project'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.geometry.points).toHaveLength(3);
    expect(result.geometry.segments).toHaveLength(2);
    expect(result.geometry.segments.every((segment) => segment.construction)).toBe(true);
    expect(projectStraightSegments(
      emptyGeometry(), sourceResult.geometry, ['source:segment:0', 'source:segment:1'], 'project'
    )).toEqual(result);
  });

  it('fails closed for trim, extension, projection, and namespace errors', () => {
    expect(trimStraightSegment(crossingGeometry(), 'trim', 'target', 'missing', 'start'))
      .toMatchObject({ ok: false, error: { code: 'SEGMENT_NOT_FOUND' } });
    expect(extendStraightSegment(crossingGeometry(), 'extend', 'target', 'cutter', 'end'))
      .toMatchObject({ ok: false, error: { code: 'WRONG_EXTENSION_DIRECTION' } });
    expect(projectStraightSegments(emptyGeometry(), crossingGeometry(), ['missing'], 'project'))
      .toMatchObject({ ok: false, error: { code: 'SEGMENT_NOT_FOUND' } });
    const created = appendSharedPointRectangle(emptyGeometry(), 'same', [0, 0], [1, 1]);
    if (!created.ok) return;
    expect(appendSharedPointRectangle(created.geometry, 'same', [2, 2], [3, 3]))
      .toMatchObject({ ok: false, error: { code: 'ID_COLLISION' } });
  });
});
