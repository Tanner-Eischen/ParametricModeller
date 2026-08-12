import { describe, expect, it } from 'vitest';
import {
  createExtrudeFeatureFromParams,
  createRebuildEngine,
  createSketchFeature,
  rebuildExtrude,
  rebuildSketch,
} from '../../src/features';
import { migrateSketchParams } from '../../src/features/sketch/SketchFeature';
import { measureBody } from '../../src/geometry';
import {
  analyzeNormalizedSketchRegions,
  createRectangleEntity,
  createWorldPlaneRef,
} from '../../src/sketch';

function createNestedRectangleSketch() {
  return createSketchFeature({
    planeRef: createWorldPlaneRef('xy'),
    entities: [
      createRectangleEntity([0, 0], 4, 4, 0, 'outer'),
      createRectangleEntity([1, 1], 2, 2, 0, 'hole'),
    ],
    dimensions: [],
  });
}

describe('Extrude stable sketch regions', () => {
  it('extrudes an outer loop with an inner hole', () => {
    const sketch = createNestedRectangleSketch();
    const params = migrateSketchParams(sketch.parameters);
    const analysis = analyzeNormalizedSketchRegions(sketch.id, params.geometry);
    expect(analysis.regions).toHaveLength(1);
    const regionRef = analysis.regions[0]!.ref;
    const extrude = createExtrudeFeatureFromParams(sketch, {
      regionRef,
      profileIndex: 0,
      distance: 2,
    });
    const engine = createRebuildEngine();
    engine.registerHandler('sketch', rebuildSketch);
    engine.registerHandler('extrude', rebuildExtrude);

    const result = engine.rebuild([sketch, extrude]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.bodies[0]!;
    expect(measureBody(body).volume).toBeCloseTo(24, 8);
    expect([...body.faces.values()].some((face) =>
      (face.innerBoundaryEdgeIds?.length ?? 0) === 1
    )).toBe(true);
  });

  it('fails closed when a stable region boundary disappears', () => {
    const sketch = createNestedRectangleSketch();
    const params = migrateSketchParams(sketch.parameters);
    const regionRef = analyzeNormalizedSketchRegions(sketch.id, params.geometry).regions[0]!.ref;
    const extrude = createExtrudeFeatureFromParams(sketch, {
      regionRef,
      profileIndex: 0,
      distance: 2,
    });
    const {
      geometry: _geometry,
      legacySourceSignature: _signature,
      ...legacyParams
    } = params;
    sketch.parameters = migrateSketchParams({
      ...legacyParams,
      entities: [createRectangleEntity([0, 0], 4, 4, 0, 'different-outer')],
    }) as unknown as Record<string, unknown>;
    const engine = createRebuildEngine();
    engine.registerHandler('sketch', rebuildSketch);
    engine.registerHandler('extrude', rebuildExtrude);

    const result = engine.rebuild([sketch, extrude]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((item) => item.code === 'SKETCH_REGION_NOT_FOUND')).toBe(true);
  });
});
