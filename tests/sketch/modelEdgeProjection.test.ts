import { describe, expect, it } from 'vitest';
import {
  addEdge,
  addVertex,
  createBody,
  createEdge,
  createVertex,
  createWorldConstructionPlane,
  type EdgeRef,
} from '../../src/geometry';
import {
  getProjectedModelEdgeSourceFeatureIds,
  projectModelEdgeToSketch,
  refreshProjectedModelEdges,
  type NormalizedSketchGeometry,
} from '../../src/sketch';

function emptyGeometry(): NormalizedSketchGeometry {
  return { schemaVersion: 1, points: [], segments: [] };
}

function planarBody() {
  const body = createBody('body-a', 'Projection source');
  addVertex(body, createVertex([1, 2, 0], 'vertex-a'));
  addVertex(body, createVertex([5, 2, 0], 'vertex-b'));
  addEdge(body, createEdge('vertex-a', 'vertex-b', 'edge-a'));
  return body;
}

const edgeRef: EdgeRef = {
  featureId: 'feature-a',
  bodyId: 'body-a',
  edgeId: 'edge-a',
};

describe('model edge projection', () => {
  it('projects a planar B-Rep edge with deterministic IDs and a stable source reference', () => {
    const source = emptyGeometry();
    const body = planarBody();
    const plane = createWorldConstructionPlane('xy', 0, 'plane-a');

    const result = projectModelEdgeToSketch(source, edgeRef, body, plane);

    expect(result.ok).toBe(true);
    expect(source).toEqual(emptyGeometry());
    if (!result.ok) return;
    expect(result.geometry.points.map((point) => point.position)).toEqual([[1, 2], [5, 2]]);
    expect(result.geometry.segments).toEqual([expect.objectContaining({
      id: result.createdSegmentId,
      construction: true,
      sourceRef: {
        kind: 'model-edge',
        featureId: 'feature-a',
        bodyId: 'body-a',
        edgeId: 'edge-a',
        vertexIds: ['vertex-a', 'vertex-b'],
      },
    })]);
    expect(projectModelEdgeToSketch(source, edgeRef, body, plane)).toEqual(result);
  });

  it('respects arbitrary orthonormal sketch-plane coordinates', () => {
    const body = createBody('body-a');
    addVertex(body, createVertex([3, 0, 2], 'vertex-a'));
    addVertex(body, createVertex([3, 0, 7], 'vertex-b'));
    addEdge(body, createEdge('vertex-a', 'vertex-b', 'edge-a'));
    const plane = createWorldConstructionPlane('xz', 0, 'plane-xz');

    const result = projectModelEdgeToSketch(emptyGeometry(), edgeRef, body, plane);

    expect(result.ok && result.geometry.points.map((point) => point.position)).toEqual([[3, 2], [3, 7]]);
  });

  it('fails closed for mismatched, missing, off-plane, and degenerate source topology', () => {
    const plane = createWorldConstructionPlane('xy', 0, 'plane-a');
    expect(projectModelEdgeToSketch(
      emptyGeometry(), { ...edgeRef, bodyId: 'other' }, planarBody(), plane
    )).toMatchObject({ ok: false, error: { code: 'BODY_REFERENCE_MISMATCH' } });
    expect(projectModelEdgeToSketch(
      emptyGeometry(), { ...edgeRef, edgeId: 'missing' }, planarBody(), plane
    )).toMatchObject({ ok: false, error: { code: 'EDGE_NOT_FOUND' } });

    const missingVertex = planarBody();
    missingVertex.vertices.delete('vertex-b');
    expect(projectModelEdgeToSketch(emptyGeometry(), edgeRef, missingVertex, plane))
      .toMatchObject({ ok: false, error: { code: 'VERTEX_NOT_FOUND' } });

    const offPlane = planarBody();
    offPlane.vertices.set('vertex-b', createVertex([5, 2, 0.01], 'vertex-b'));
    expect(projectModelEdgeToSketch(emptyGeometry(), edgeRef, offPlane, plane))
      .toMatchObject({ ok: false, error: { code: 'EDGE_OFF_PLANE' } });

    const degenerate = planarBody();
    degenerate.vertices.set('vertex-b', createVertex([1, 2, 0], 'vertex-b'));
    expect(projectModelEdgeToSketch(emptyGeometry(), edgeRef, degenerate, plane))
      .toMatchObject({ ok: false, error: { code: 'DEGENERATE_EDGE' } });
  });

  it('rejects incomplete references, invalid planes, and unsupported edge topology', () => {
    const plane = createWorldConstructionPlane('xy', 0, 'plane-a');
    expect(projectModelEdgeToSketch(
      emptyGeometry(), { ...edgeRef, featureId: '' }, planarBody(), plane
    )).toMatchObject({ ok: false, error: { code: 'INVALID_REFERENCE' } });

    const invalidPlane = { ...plane, normal: [0, 0, 0] as [number, number, number] };
    expect(projectModelEdgeToSketch(emptyGeometry(), edgeRef, planarBody(), invalidPlane))
      .toMatchObject({ ok: false, error: { code: 'INVALID_PLANE' } });

    const unsupported = planarBody();
    unsupported.edges.set('edge-a', {
      ...unsupported.edges.get('edge-a')!,
      vertexIds: ['vertex-a', 'vertex-b', 'vertex-c'],
    } as never);
    expect(projectModelEdgeToSketch(emptyGeometry(), edgeRef, unsupported, plane))
      .toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_EDGE_GEOMETRY' } });
  });

  it('rejects duplicate projection IDs and invalid target geometry without mutation', () => {
    const body = planarBody();
    const plane = createWorldConstructionPlane('xy', 0, 'plane-a');
    const first = projectModelEdgeToSketch(emptyGeometry(), edgeRef, body, plane);
    if (!first.ok) throw new Error(first.error.message);
    const before = JSON.stringify(first.geometry);

    expect(projectModelEdgeToSketch(first.geometry, edgeRef, body, plane))
      .toMatchObject({ ok: false, error: { code: 'ID_COLLISION' } });
    expect(JSON.stringify(first.geometry)).toBe(before);

    const invalid: NormalizedSketchGeometry = {
      schemaVersion: 1,
      points: [{ id: 'same', position: [0, 0] }],
      segments: [{
        id: 'bad',
        type: 'line',
        startPointId: 'same',
        endPointId: 'same',
        construction: false,
      }],
    };
    expect(projectModelEdgeToSketch(invalid, edgeRef, body, plane))
      .toMatchObject({ ok: false, error: { code: 'INVALID_TARGET_GEOMETRY' } });
  });

  it('refreshes live source coordinates deterministically and reports required dependencies', () => {
    const plane = createWorldConstructionPlane('xy', 0, 'plane-a');
    const projected = projectModelEdgeToSketch(emptyGeometry(), edgeRef, planarBody(), plane);
    if (!projected.ok) throw new Error(projected.error.message);
    const editedBody = planarBody();
    editedBody.vertices.set('vertex-a', createVertex([2, 3, 0], 'vertex-a'));
    editedBody.vertices.set('vertex-b', createVertex([8, 3, 0], 'vertex-b'));
    const bodiesByFeature = new Map([['feature-a', [editedBody]]]);

    const runs = Array.from({ length: 10 }, () =>
      refreshProjectedModelEdges(projected.geometry, plane, bodiesByFeature)
    );

    expect(runs.every((result) => result.ok)).toBe(true);
    expect(runs.every((result) => JSON.stringify(result) === JSON.stringify(runs[0]))).toBe(true);
    expect(runs[0]).toMatchObject({
      ok: true,
      geometry: { points: [{ position: [2, 3] }, { position: [8, 3] }] },
    });
    expect(getProjectedModelEdgeSourceFeatureIds(projected.geometry)).toEqual(['feature-a']);
  });

  it('fails closed when a projected source body or stable endpoint topology is broken', () => {
    const plane = createWorldConstructionPlane('xy', 0, 'plane-a');
    const projected = projectModelEdgeToSketch(emptyGeometry(), edgeRef, planarBody(), plane);
    if (!projected.ok) throw new Error(projected.error.message);

    expect(refreshProjectedModelEdges(projected.geometry, plane, new Map()))
      .toMatchObject({ ok: false, error: { code: 'SOURCE_BODY_NOT_FOUND' } });

    const changedTopology = planarBody();
    addVertex(changedTopology, createVertex([7, 2, 0], 'replacement'));
    changedTopology.edges.set('edge-a', createEdge('vertex-a', 'replacement', 'edge-a'));
    expect(refreshProjectedModelEdges(
      projected.geometry,
      plane,
      new Map([['feature-a', [changedTopology]]])
    )).toMatchObject({
      ok: false,
      segmentId: projected.createdSegmentId,
      error: { code: 'SOURCE_TOPOLOGY_CHANGED' },
    });
  });
});
