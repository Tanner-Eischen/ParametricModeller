import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/geometry-golden-scenes.json';
import { createBoxBody, type BoxParams } from '../../src/features/primitives/BoxFeature';
import { buildRectangularPrism } from '../../src/features/extrude/PrismBuilder';
import { createWorldConstructionPlane } from '../../src/geometry/ConstructionPlane';
import { hashBodyGeometry, measureBody, type BodyMeasurements } from '../../src/geometry/GeometryHash';
import { transformVertexPositions } from '../../src/geometry/TransformUtils';
import type { Body } from '../../src/geometry/Body';

type BoxFixture = {
  id: string;
  kind: 'box';
  parameters: BoxParams;
  expectedHash: string;
  expectedMeasurements: BodyMeasurements;
};

type ExtrudeFixture = {
  id: string;
  kind: 'extrude';
  parameters: {
    plane: 'xy' | 'xz' | 'yz';
    planeOffset: number;
    origin: [number, number];
    width: number;
    height: number;
    distance: number;
    flip: boolean;
  };
  expectedHash: string;
  expectedMeasurements: BodyMeasurements;
};

type TransformFixture = {
  id: string;
  kind: 'transform';
  parameters: {
    width: number;
    depth: number;
    height: number;
    rotationZDegrees: number;
    translation: [number, number, number];
  };
  expectedHash: string;
  expectedMeasurements: BodyMeasurements;
};

type GoldenFixture = BoxFixture | ExtrudeFixture | TransformFixture;

function buildFixture(fixture: GoldenFixture): Body {
  switch (fixture.kind) {
    case 'box':
      return createBoxBody(fixture.parameters, fixture.id);
    case 'extrude': {
      const parameters = fixture.parameters;
      const plane = createWorldConstructionPlane(
        parameters.plane,
        parameters.planeOffset,
        `${fixture.id}_plane`
      );
      return buildRectangularPrism(
        plane,
        parameters.origin,
        parameters.width,
        parameters.height,
        parameters.distance,
        parameters.flip,
        fixture.id
      );
    }
    case 'transform': {
      const parameters = fixture.parameters;
      const source = createBoxBody({
        width: parameters.width,
        depth: parameters.depth,
        height: parameters.height,
        anchorMode: 'corner',
        origin: [0, 0, 0],
      }, `${fixture.id}_source`);
      const matrix = new THREE.Matrix4()
        .makeRotationZ(THREE.MathUtils.degToRad(parameters.rotationZDegrees))
        .setPosition(...parameters.translation);
      return transformVertexPositions(source, matrix, fixture.id);
    }
  }
}

describe('geometry golden scenes', () => {
  for (const fixtureData of fixtures) {
    const fixture = fixtureData as GoldenFixture;

    it(`${fixture.id} matches its canonical hash and measurement invariants`, () => {
      const body = buildFixture(fixture);

      expect(hashBodyGeometry(body)).toBe(fixture.expectedHash);
      expect(measureBody(body)).toEqual(fixture.expectedMeasurements);
    });
  }
});
