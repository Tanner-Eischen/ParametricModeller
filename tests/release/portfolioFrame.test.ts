import { describe, expect, it } from 'vitest';
import savedScene from '../../examples/white-oak-frame.scene.json';
import {
  bodyMetadataForPortfolioFrame,
  createPortfolioFrameDocument,
  editPortfolioFrameLength,
  PORTFOLIO_FRAME_IDS,
  rebuildPortfolioFrameDocument,
} from '../../src/examples/portfolioFrame';
import { rebuildWithComponents } from '../../src/assembly/ComponentRebuilder';
import { createRebuildEngine } from '../../src/features/RebuildEngine';
import { rebuildBox } from '../../src/features/primitives/BoxFeature';
import { createMoveVertexFeature, rebuildMoveVertex } from '../../src/features/vertex/MoveVertexFeature';
import { hashGeometry } from '../../src/geometry/GeometryHash';
import type { Body } from '../../src/geometry/Body';
import { deserialize, serialize } from '../../src/persistence/serializer';
import { createDefaultBody, type Document } from '../../src/types';
import { measureBRepBody, measureOrientedBoard } from '../../src/woodworking/Measurements';

function rebuild(document: Document) {
  const result = rebuildPortfolioFrameDocument(document);
  expect(result.ok, result.error).toBe(true);
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  return result;
}

function topology(bodies: Body[]) {
  return bodies.map(body => ({
    id: body.id,
    vertices: [...body.vertices.keys()].sort(),
    edges: [...body.edges.keys()].sort(),
    faces: [...body.faces.keys()].sort(),
    planes: [...body.planes.keys()].sort(),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

function measurements(bodies: Body[]) {
  const measured = bodies.map(body => measureBRepBody(body));
  const allVertices = bodies.flatMap(body => [...body.vertices.values()]);
  const min = [0, 1, 2].map(axis => Math.min(...allVertices.map(vertex => vertex.position[axis]!)));
  const max = [0, 1, 2].map(axis => Math.max(...allVertices.map(vertex => vertex.position[axis]!)));
  const volume = measured.reduce((total, body) => total + body.volume, 0);
  // Each authored piece is a rectangular prism. Its8B-Rep corners give its
  // exact center; volume weighting gives the independent assembly centroid.
  const centroid = [0, 1, 2].map(axis => bodies.reduce((total, body, index) => {
    const center = [...body.vertices.values()].reduce((sum, vertex) => sum + vertex.position[axis]!, 0) / body.vertices.size;
    return total + center * measured[index]!.volume;
  }, 0) / volume);
  return { measured, min, max, size: max.map((value, axis) => value - min[axis]!), volume,
    surfaceArea: measured.reduce((total, body) => total + body.surfaceArea, 0), centroid };
}

function expectVector(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
}

describe('white oak four-instance portfolio frame', () => {
  it('rebuilds exactly4manufactured boards with independent bounds/volume/surface/centroid', () => {
    const document = createPortfolioFrameDocument();
    const result = rebuild(document);
    expect(document.features).toHaveLength(1);
    expect(document.components).toHaveLength(1);
    expect(document.componentInstances).toHaveLength(4);
    expect(result.bodies).toHaveLength(4);
    expect(result.bodies.map(body => body.id)).not.toContain(PORTFOLIO_FRAME_IDS.sourceBody);
    expect(result.componentSourceBodyIds.get(PORTFOLIO_FRAME_IDS.component)).toEqual([PORTFOLIO_FRAME_IDS.sourceBody]);
    const actual = measurements(result.bodies);
    expectVector(actual.min, [0, 0, 0]);
    expectVector(actual.max, [24, 18, 0.75]);
    expectVector(actual.size, [24, 18, 0.75]);
    expect(actual.volume).toBeCloseTo(162, 9);
    expect(actual.surfaceArea).toBeCloseTo(558, 9); //Individual boards, not a fused540in² exterior.
    expectVector(actual.centroid, [12, 9, 0.375]);
    expect(actual.measured.every(body => body.vertexCount === 8 && body.edgeCount === 12 && body.faceCount === 6)).toBe(true);
    const expectedBounds = {
      bottom: [[3, 0, 0], [21, 3, 0.75]], top: [[3, 15, 0], [21, 18, 0.75]],
      left: [[0, 0, 0], [3, 18, 0.75]], right: [[21, 0, 0], [24, 18, 0.75]],
    };
    for (const part of ['bottom', 'top', 'left', 'right'] as const) {
      const body = result.instanceBodies.get(PORTFOLIO_FRAME_IDS[part])![0]!;
      const bounds = measureBRepBody(body).bounds;
      expectVector(bounds.min, expectedBounds[part][0]!);
      expectVector(bounds.max, expectedBounds[part][1]!);
      expect(measureBRepBody(body).volume).toBeCloseTo(40.5, 9);
    }
    // Bounds above leave precisely x3..21,y3..15; no board occupies its interior.
    expect(24 - 2 * 3).toBe(18);
    expect(18 - 2 * 3).toBe(12);
    expect(result.bodies.every(body => ![...body.vertices.values()].some(vertex => vertex.position[0] > 3 && vertex.position[0] < 21 && vertex.position[1] > 3 && vertex.position[1] < 15))).toBe(true);
  });

  it('preserves physical grain orientation/material tags without counting the source', () => {
    const document = createPortfolioFrameDocument();
    const result = rebuild(document);
    const metadata = bodyMetadataForPortfolioFrame(document, result);
    expect(Object.keys(metadata)).toHaveLength(4);
    for (const part of ['bottom', 'top', 'left', 'right'] as const) {
      const body = result.instanceBodies.get(PORTFOLIO_FRAME_IDS[part])![0]!;
      const tag = metadata[body.id]!;
      expect(tag.material).toEqual({ id: 'white-oak', species: 'White oak' });
      expect(tag.grainAxis).toEqual(part === 'bottom' || part === 'top' ? [1, 0, 0] : [0, 1, 0]);
      expect(tag.thicknessAxis).toEqual([0, 0, 1]);
      expect(measureOrientedBoard(body, tag)).toMatchObject({ length: 18, width: 3, thickness: 0.75 });
      expect(document.bodyMetadata?.[body.id]).toEqual(tag);
    }
  });

  it('serializes editable history and deterministically reconstructs geometry/topology/metadata', () => {
    const document = createPortfolioFrameDocument();
    const first = rebuild(document);
    const saved = serialize(document);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    const loaded = deserialize(saved.json);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.error);
    const again = rebuild(loaded.document);
    expect(hashGeometry(again.bodies)).toBe(hashGeometry(first.bodies));
    expect(topology(again.bodies)).toEqual(topology(first.bodies));
    expect(loaded.document.features).toEqual(document.features);
    expect(loaded.document.components).toEqual(document.components);
    expect(loaded.document.componentInstances).toEqual(document.componentInstances);
    expect(loaded.document.bodyMetadata).toEqual(document.bodyMetadata);
    expect(serialize(createPortfolioFrameDocument())).toEqual(saved);
    for (let run = 0; run < 3; run++) expect(hashGeometry(rebuild(loaded.document).bodies)).toBe(hashGeometry(first.bodies));
  });

  it('rebuilds the checked-in scene through feature history, ignoring unrelated body cache descriptors', () => {
    const json = JSON.stringify(savedScene);
    const loaded = deserialize(json);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(JSON.parse(json)).toEqual(JSON.parse((serialize(createPortfolioFrameDocument()) as { ok: true; json: string }).json));
    loaded.document.bodies = [createDefaultBody('fabricated-cache', 'Not a manufacturing source')];
    expect(measurements(rebuild(loaded.document).bodies).volume).toBeCloseTo(162, 9);
  });

  it('edits source length AND derived placements explicitly, preserving all instance and topology IDs', () => {
    const original = createPortfolioFrameDocument();
    const before = rebuild(original);
    const edited = editPortfolioFrameLength(original, 20);
    const after = rebuild(edited);
    expect(original.features[0]!.parameters.width).toBe(18);
    expect(edited.features[0]!.parameters.width).toBe(20);
    expect(edited.componentInstances.map(instance => instance.id)).toEqual(original.componentInstances.map(instance => instance.id));
    expect(topology(after.bodies)).toEqual(topology(before.bodies));
    const actual = measurements(after.bodies);
    expectVector(actual.size, [26, 20, 0.75]);
    expect(actual.volume).toBeCloseTo(180, 9);
    expectVector(actual.centroid, [13, 10, 0.375]);
    expect(26 - 6).toBe(20); expect(20 - 6).toBe(14);
    const saved = serialize(edited);
    if (!saved.ok) throw new Error(saved.error);
    const loaded = deserialize(saved.json);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(hashGeometry(rebuild(loaded.document).bodies)).toBe(hashGeometry(after.bodies));
  });

  it('rejects a real nonplanar corner move through the production feature handler with no physical output', () => {
    const document = createPortfolioFrameDocument();
    const move = createMoveVertexFeature({ vertexRef: { featureId: PORTFOLIO_FRAME_IDS.sourceFeature, bodyId: PORTFOLIO_FRAME_IDS.sourceBody, vertexId: '+X+Y+Z' }, translation: [0, 0, 0.25] });
    const engine = createRebuildEngine();
    engine.registerHandler('box', rebuildBox);
    engine.registerHandler('moveVertex', rebuildMoveVertex);
    const failed = engine.rebuild([...document.features, move]);
    expect(failed.ok).toBe(false);
    expect(failed.diagnostics.some(diagnostic => diagnostic.code === 'PLANARITY_VIOLATION')).toBe(true);
    const result = rebuildWithComponents(failed, document.components, document.componentInstances);
    expect(result.ok).toBe(false);
    expect(result.bodies).toEqual([]);
  });

  it.each([0, 6, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid bounded-example length %s', length => {
    expect(() => createPortfolioFrameDocument(length)).toThrow(/length/);
    expect(() => editPortfolioFrameLength(createPortfolioFrameDocument(), length)).toThrow(/length/);
  });
});
