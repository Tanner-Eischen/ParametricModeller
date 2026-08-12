import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import { transformVertexPositions } from '../../src/geometry/TransformUtils';
import {
  convertLength,
  extentAlong,
  formatLength,
  measureBRepBody,
  measureOrientedBoard,
  projectedRangeAlong,
} from '../../src/woodworking';

describe('woodworking measurements', () => {
  it('measures length, width and thickness in board-local axes', () => {
    const body = createBoxBody({
      width: 72,
      depth: 11.25,
      height: 0.75,
      anchorMode: 'corner',
      origin: [15, -8, 4],
    }, 'shelf');

    expect(measureOrientedBoard(body, {
      grainAxis: [1, 0, 0],
      thicknessAxis: [0, 0, 1],
    })).toMatchObject({ length: 72, width: 11.25, thickness: 0.75 });
    expect(extentAlong(body, [2, 0, 0])).toBe(72);
  });

  it('measures a rotated body deterministically', () => {
    const source = createBoxBody({
      width: 6,
      depth: 2,
      height: 0.75,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'source');
    const rotated = transformVertexPositions(
      source,
      new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(20, 10, -3),
      'rotated'
    );

    const measured = measureOrientedBoard(rotated, {
      grainAxis: [0, 1, 0],
      thicknessAxis: [0, 0, 1],
    });
    expect(measured.length).toBe(6);
    expect(measured.width).toBe(2);
    expect(measured.thickness).toBe(0.75);
    expect(measured.axes.width).toEqual([-1, 0, 0]);
  });

  it('uses exact inch/millimeter conversion and stable formatting', () => {
    expect(convertLength(1, 'in', 'mm')).toBe(25.4);
    expect(convertLength(25.4, 'mm', 'in')).toBe(1);
    expect(formatLength(1.5, 'in')).toBe('1.5 in');
    expect(formatLength(1.5, 'mm', 1)).toBe('38.1 mm');
  });

  it('measures manufacturing invariants directly from planar B-Rep entities', () => {
    const body = createBoxBody({
      width: 2,
      depth: 3,
      height: 4,
      anchorMode: 'corner',
      origin: [-1, 5, 10],
    }, 'measured-box');
    const measurement = measureBRepBody(body);

    expect(measurement).toMatchObject({
      bodyId: 'measured-box',
      bounds: {
        min: [-1, 5, 10],
        max: [1, 8, 14],
        size: [2, 3, 4],
      },
      vertexCount: 8,
      edgeCount: 12,
      faceCount: 6,
      totalEdgeLength: 36,
      surfaceArea: 52,
      volume: 24,
    });
    expect(measurement.faces.map((face) => face.faceId)).toEqual(
      [...measurement.faces.map((face) => face.faceId)].sort()
    );
    expect(projectedRangeAlong(body, [1, 0, 0])).toEqual({
      min: -1,
      max: 1,
      extent: 2,
    });
  });

  it('fails closed when B-Rep face references are damaged', () => {
    const body = createBoxBody({
      width: 2, depth: 3, height: 4, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'damaged');
    body.edges.delete(body.faces.values().next().value!.boundaryEdgeIds[0]!);
    expect(() => measureBRepBody(body)).toThrow(/missing edge|non-existent edge/);
  });

  it('rejects open shells and non-planar face vertices', () => {
    const open = createBoxBody({
      width: 2, depth: 3, height: 4, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'open');
    open.faces.delete('+Z');
    expect(() => measureBRepBody(open)).toThrow('not a closed planar solid');

    const warped = createBoxBody({
      width: 2, depth: 3, height: 4, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'warped');
    warped.vertices.get('+X+Y+Z')!.position[2] += 0.01;
    expect(() => measureBRepBody(warped)).toThrow('outside its supporting plane');
  });

  it('fails closed for empty bodies, invalid axes and invalid numbers', () => {
    const body = createBoxBody({
      width: 1, depth: 2, height: 3, anchorMode: 'corner', origin: [0, 0, 0],
    });
    expect(() => measureOrientedBoard(body, {
      grainAxis: [0, 0, 0], thicknessAxis: [0, 0, 1],
    })).toThrow('grainAxis must be a non-zero vector');
    expect(() => measureOrientedBoard(body, {
      grainAxis: [1, 0, 0], thicknessAxis: [1, 0, 0],
    })).toThrow('must be perpendicular');
    expect(() => convertLength(Number.NaN, 'in', 'mm')).toThrow('Length must be finite');
  });
});
