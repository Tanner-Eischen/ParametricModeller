import { describe, expect, it } from 'vitest';
import {
  appendSharedPointPolyline,
} from '../../src/sketch/SketchEditing';
import type { NormalizedSketchGeometry } from '../../src/sketch/NormalizedSketch';
import {
  analyzeNormalizedSketchRegions,
  createLegacySketchRegionRef,
  createSketchRegionRef,
  resolveSketchRegionRef,
} from '../../src/sketch/SketchRegions';

function emptyGeometry(): NormalizedSketchGeometry {
  return { schemaVersion: 1, points: [], segments: [] };
}

function rectangle(
  geometry: NormalizedSketchGeometry,
  id: string,
  min: number,
  max: number
): NormalizedSketchGeometry {
  const result = appendSharedPointPolyline(geometry, id, [
    [min, min],
    [max, min],
    [max, max],
    [min, max],
  ], { closed: true });
  if (!result.ok) throw new Error(result.error.message);
  return result.geometry;
}

describe('stable sketch regions', () => {
  it('creates a stable outer/hole reference independent of input insertion order', () => {
    const withOuter = rectangle(emptyGeometry(), 'outer', 0, 10);
    const geometry = rectangle(withOuter, 'hole', 2, 4);
    const reversed: NormalizedSketchGeometry = {
      ...geometry,
      points: [...geometry.points].reverse(),
      segments: [...geometry.segments].reverse(),
    };

    const forward = analyzeNormalizedSketchRegions('sketch', geometry);
    const backward = analyzeNormalizedSketchRegions('sketch', reversed);

    expect(backward).toEqual(forward);
    expect(forward.issues).toEqual([]);
    expect(forward.regions).toHaveLength(1);
    expect(forward.regions[0]).toMatchObject({
      area: 96,
      ref: {
        sketchId: 'sketch',
        outerSegmentIds: [
          'outer:segment:0',
          'outer:segment:1',
          'outer:segment:2',
          'outer:segment:3',
        ],
        holeSegmentIds: [[
          'hole:segment:0',
          'hole:segment:1',
          'hole:segment:2',
          'hole:segment:3',
        ]],
      },
    });
  });

  it('keeps a region reference stable when an unrelated closed profile is added', () => {
    const firstGeometry = rectangle(emptyGeometry(), 'stable', 0, 2);
    const first = analyzeNormalizedSketchRegions('sketch', firstGeometry);
    const ref = first.regions[0]!.ref;
    const withUnrelated = rectangle(firstGeometry, 'unrelated', 10, 11);
    const next = analyzeNormalizedSketchRegions('sketch', withUnrelated);

    expect(resolveSketchRegionRef(ref, next)?.id).toBe(ref.regionId);
  });

  it('canonicalizes explicit refs and supports profileIndex as a legacy fallback', () => {
    const geometry = rectangle(emptyGeometry(), 'profile', 0, 2);
    const analysis = analyzeNormalizedSketchRegions('sketch', geometry);
    const explicit = createSketchRegionRef(
      'sketch',
      ['profile:segment:3', 'profile:segment:1', 'profile:segment:0', 'profile:segment:2']
    );
    const legacy = createLegacySketchRegionRef('sketch', 0);

    expect(resolveSketchRegionRef(explicit, analysis)?.id).toBe(explicit.regionId);
    expect(resolveSketchRegionRef(legacy, analysis)?.id).toBe(analysis.regions[0]!.id);
    expect(resolveSketchRegionRef(
      { ...legacy, sketchId: 'different-sketch' },
      analysis
    )).toBeNull();
  });
});
