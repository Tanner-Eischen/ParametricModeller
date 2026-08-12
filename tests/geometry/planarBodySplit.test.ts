import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import {
  createPlane,
  hashBodyGeometry,
  splitConvexBodyByPlane,
  triangulateBody,
  validateClosedManifoldBody,
  type Body,
} from '../../src/geometry';

function splitBox() {
  const body = createBoxBody({
    width: 1,
    depth: 1,
    height: 1,
    anchorMode: 'corner',
    origin: [0, 0, 0],
  }, 'board');
  const plane = createPlane([1, 0.5, 0.5], [1, 0, 1]);
  return {
    body,
    plane,
    result: splitConvexBodyByPlane(body, plane, {
      topologyPrefix: 'miter:test',
      negativeBodyId: 'board',
      positiveBodyId: 'miter:test:offcut',
      negativeName: 'Board main',
      positiveName: 'Board offcut',
    }),
  };
}

function bodyVolume(body: Body): number {
  const mesh = triangulateBody(body);
  let signedVolume = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const first = mesh.indices[index]! * 3;
    const second = mesh.indices[index + 1]! * 3;
    const third = mesh.indices[index + 2]! * 3;
    const ax = mesh.positions[first]!;
    const ay = mesh.positions[first + 1]!;
    const az = mesh.positions[first + 2]!;
    const bx = mesh.positions[second]!;
    const by = mesh.positions[second + 1]!;
    const bz = mesh.positions[second + 2]!;
    const cx = mesh.positions[third]!;
    const cy = mesh.positions[third + 1]!;
    const cz = mesh.positions[third + 2]!;
    signedVolume += (
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx)
    ) / 6;
  }
  return Math.abs(signedVolume);
}

describe('splitConvexBodyByPlane', () => {
  it('creates two closed solids from an angled cut and preserves the source body', () => {
    const { body, result } = splitBox();
    const sourceHash = hashBodyGeometry(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(validateClosedManifoldBody(result.negative).ok).toBe(true);
    expect(validateClosedManifoldBody(result.positive).ok).toBe(true);
    expect(result.negative.id).toBe('board');
    expect(result.positive.id).toBe('miter:test:offcut');
    expect(hashBodyGeometry(body)).toBe(sourceHash);
    expect(bodyVolume(result.negative) + bodyVolume(result.positive)).toBeCloseTo(1, 8);
  });

  it('gives the two new cut faces opposite outward normals', () => {
    const { result } = splitBox();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const negativeNormal = result.negative.planes.get('miter:test:cutFace')?.normal;
    const positiveNormal = result.positive.planes.get('miter:test:cutFace')?.normal;
    expect(negativeNormal).toBeDefined();
    expect(positiveNormal).toBeDefined();
    expect(
      negativeNormal![0] * positiveNormal![0] +
      negativeNormal![1] * positiveNormal![1] +
      negativeNormal![2] * positiveNormal![2]
    ).toBeCloseTo(-1, 8);
  });

  it('produces deterministic topology and geometry across repeated splits', () => {
    const snapshots = Array.from({ length: 10 }, () => {
      const { result } = splitBox();
      expect(result.ok).toBe(true);
      if (!result.ok) return null;
      return {
        negativeHash: hashBodyGeometry(result.negative),
        positiveHash: hashBodyGeometry(result.positive),
        negativeVertices: [...result.negative.vertices.keys()],
        positiveVertices: [...result.positive.vertices.keys()],
        negativeEdges: [...result.negative.edges.keys()],
        positiveEdges: [...result.positive.edges.keys()],
      };
    });
    expect(new Set(snapshots.map((snapshot) => JSON.stringify(snapshot))).size).toBe(1);
  });

  it('supports a plane through existing vertices and fails closed when it misses or is invalid', () => {
    const body = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'board');
    const options = {
      topologyPrefix: 'miter:test',
      negativeBodyId: 'board',
      positiveBodyId: 'offcut',
    };

    const missed = splitConvexBodyByPlane(body, createPlane([2, 0, 0], [1, 0, 0]), options);
    expect(missed).toMatchObject({ ok: false, code: 'CUT_DOES_NOT_SPLIT_BODY' });

    const throughVertices = splitConvexBodyByPlane(
      body,
      createPlane([0.5, 0.5, 0], [1, -1, 0]),
      options
    );
    expect(throughVertices.ok).toBe(true);
    if (throughVertices.ok) {
      expect(validateClosedManifoldBody(throughVertices.negative).ok).toBe(true);
      expect(validateClosedManifoldBody(throughVertices.positive).ok).toBe(true);
    }

    const invalid = splitConvexBodyByPlane(body, {
      origin: [0, 0, 0],
      normal: [0, 0, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 1, 0],
    }, options);
    expect(invalid).toMatchObject({ ok: false, code: 'INVALID_CUT_PLANE' });
  });

  it('keeps generated topology IDs distinct for adversarial source IDs', () => {
    const body = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'board');
    const plane = createPlane([1, 0.5, 0.5], [1, 0, 1]);
    const crossingEdges = [...body.edges.values()].filter((edge) => {
      const first = body.vertices.get(edge.vertexIds[0])!;
      const second = body.vertices.get(edge.vertexIds[1])!;
      const distance = (point: [number, number, number]) =>
        (point[0] - plane.origin[0]) * plane.normal[0]
        + (point[1] - plane.origin[1]) * plane.normal[1]
        + (point[2] - plane.origin[2]) * plane.normal[2];
      return distance(first.position) * distance(second.position) < 0;
    });
    expect(crossingEdges.length).toBeGreaterThanOrEqual(2);
    renameEdge(body, crossingEdges[0]!.id, '/');
    renameEdge(body, crossingEdges[1]!.id, '_2F');

    const result = splitConvexBodyByPlane(body, plane, {
      topologyPrefix: 'miter:collision',
      negativeBodyId: 'main',
      positiveBodyId: 'offcut',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateClosedManifoldBody(result.negative).ok).toBe(true);
    expect(validateClosedManifoldBody(result.positive).ok).toBe(true);
    expect(new Set(result.negative.vertices.keys()).size).toBe(result.negative.vertices.size);
    expect(new Set(result.positive.vertices.keys()).size).toBe(result.positive.vertices.size);
  });
});

function renameEdge(body: Body, oldId: string, newId: string): void {
  const edge = body.edges.get(oldId)!;
  body.edges.delete(oldId);
  body.edges.set(newId, { ...edge, id: newId });
  for (const vertex of body.vertices.values()) {
    vertex.edgeIds = vertex.edgeIds.map((id) => id === oldId ? newId : id);
  }
  for (const face of body.faces.values()) {
    face.boundaryEdgeIds = face.boundaryEdgeIds.map((id) => id === oldId ? newId : id);
  }
}
