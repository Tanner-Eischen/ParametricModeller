import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import {
  canonicalizeGeometry,
  hashBodyGeometry,
  hashGeometry,
  measureBody,
} from '../../src/geometry/GeometryHash';
import { transformVertexPositions } from '../../src/geometry/TransformUtils';
import type { Body } from '../../src/geometry/Body';

function reverseMap<Value>(map: Map<string, Value>): Map<string, Value> {
  return new Map(Array.from(map.entries()).reverse());
}

function reverseBodyMapInsertionOrder(body: Body): Body {
  return {
    ...body,
    vertices: reverseMap(body.vertices),
    edges: reverseMap(body.edges),
    faces: reverseMap(body.faces),
    planes: reverseMap(body.planes),
  };
}

describe('GeometryHash', () => {
  it('is independent of body and topology Map insertion order', () => {
    const first = createBoxBody({
      width: 2,
      depth: 3,
      height: 4,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'first');
    const second = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'center',
      origin: [10, 0, 0],
    }, 'second');

    const reversedFirst = reverseBodyMapInsertionOrder(first);
    const reversedSecond = reverseBodyMapInsertionOrder(second);

    expect(canonicalizeGeometry([first, second]))
      .toBe(canonicalizeGeometry([reversedSecond, reversedFirst]));
    expect(hashGeometry([first, second]))
      .toBe(hashGeometry([reversedSecond, reversedFirst]));
  });

  it('ignores generated topology IDs across repeated transforms', () => {
    const source = createBoxBody({
      width: 2,
      depth: 1,
      height: 3,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'source');
    const matrix = new THREE.Matrix4()
      .makeRotationZ(Math.PI / 2)
      .setPosition(10, -4, 2);

    const hashes = Array.from({ length: 10 }, () =>
      hashBodyGeometry(transformVertexPositions(source, matrix, 'transformed'))
    );

    expect(new Set(hashes).size).toBe(1);
  });

  it('changes when model geometry changes', () => {
    const base = createBoxBody({
      width: 2,
      depth: 3,
      height: 4,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'base');
    const changed = createBoxBody({
      width: 2.01,
      depth: 3,
      height: 4,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'changed');

    expect(hashBodyGeometry(changed)).not.toBe(hashBodyGeometry(base));
  });

  it('measures a closed rectangular solid', () => {
    const body = createBoxBody({
      width: 2,
      depth: 3,
      height: 4,
      anchorMode: 'corner',
      origin: [-1, 2, 0.5],
    }, 'measured');

    expect(measureBody(body)).toEqual({
      boundingBox: {
        min: [-1, 2, 0.5],
        max: [1, 5, 4.5],
        size: [2, 3, 4],
      },
      vertexCount: 8,
      edgeCount: 12,
      faceCount: 6,
      totalEdgeLength: 36,
      surfaceArea: 52,
      volume: 24,
    });
  });

  it('rejects invalid canonicalization precision', () => {
    const body = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'box');

    expect(() => hashBodyGeometry(body, { precision: 16 }))
      .toThrow('Geometry hash precision must be an integer from 0 to 15');
  });
});
