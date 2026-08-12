import { describe, expect, it } from 'vitest';
import {
  createMiterCutFeature,
  rebuildMiterCut,
  validateMiterCutParams,
} from '../../src/features/miter';
import { createBoxBody, createBoxFeature } from '../../src/features/primitives';
import { createFaceRef } from '../../src/features/offsetFace';
import { createRebuildContext } from '../../src/features';
import {
  getFaceVertexIds,
  getOrderedLoopVertices,
  hashBodyGeometry,
  triangulateBody,
  validateClosedManifoldBody,
  type Body,
} from '../../src/geometry';

function createFixture(resultMode: 'split' | 'trim' = 'split') {
  const sourceFeature = createBoxFeature({
    width: 4,
    depth: 2,
    height: 1,
    anchorMode: 'corner',
    origin: [0, 0, 0],
  }, 'Board');
  sourceFeature.id = 'board-feature';
  const body = createBoxBody(sourceFeature.parameters as never, 'board-body');
  const feature = createMiterCutFeature(
    createFaceRef('+X', body.id, sourceFeature.id),
    { angleDegrees: 45, inset: 0, tiltAxis: 'u', resultMode },
    'Miter Cut 1'
  );
  feature.id = 'miter-feature';
  const context = createRebuildContext([sourceFeature, feature]);
  context.bodiesByFeature.set(sourceFeature.id, [body]);
  context.allBodies = [body];
  return { sourceFeature, body, feature, context };
}

function createThreeWayFixture(resultMode: 'split' | 'trim' = 'trim') {
  const fixture = createFixture(resultMode);
  fixture.sourceFeature.parameters.depth = 1;
  fixture.sourceFeature.parameters.height = 1;
  fixture.body = createBoxBody(fixture.sourceFeature.parameters as never, 'board-body');
  fixture.context.bodiesByFeature.set(fixture.sourceFeature.id, [fixture.body]);
  fixture.context.allBodies = [fixture.body];
  fixture.feature.parameters.cutStyle = 'threeWay';
  fixture.feature.parameters.threeWayCorner = 'corner0';
  const face = fixture.body.faces.get('+X')!;
  const cornerIds = getOrderedLoopVertices(fixture.body, face.boundaryEdgeIds).map((vertex) => vertex.id);
  fixture.feature.parameters.threeWayVertexId = cornerIds[0]!;
  fixture.feature.parameters.threeWayVertexIds = cornerIds as [string, string, string, string];
  return fixture;
}

function bodyVolume(body: Body): number {
  const mesh = triangulateBody(body);
  let volume = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index]! * 3;
    const b = mesh.indices[index + 1]! * 3;
    const c = mesh.indices[index + 2]! * 3;
    volume += (
      mesh.positions[a]! * (mesh.positions[b + 1]! * mesh.positions[c + 2]! - mesh.positions[b + 2]! * mesh.positions[c + 1]!)
      - mesh.positions[a + 1]! * (mesh.positions[b]! * mesh.positions[c + 2]! - mesh.positions[b + 2]! * mesh.positions[c]!)
      + mesh.positions[a + 2]! * (mesh.positions[b]! * mesh.positions[c + 1]! - mesh.positions[b + 1]! * mesh.positions[c]!)
    ) / 6;
  }
  return Math.abs(volume);
}

describe('MiterCutFeature', () => {
  it('keeps two closed pieces for a split result', () => {
    const { body, feature, context } = createFixture('split');
    const sourceHash = hashBodyGeometry(body);
    const result = rebuildMiterCut(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bodies).toHaveLength(2);
    expect(result.bodies.map((candidate) => candidate.id)).toEqual([
      'board-body',
      'miter-feature_offcut',
    ]);
    expect(result.replacedBodyIds).toEqual(['board-body']);
    expect(result.bodies.every((candidate) => validateClosedManifoldBody(candidate).ok)).toBe(true);
    expect(hashBodyGeometry(body)).toBe(sourceHash);
  });

  it('keeps the inward piece and discards the offcut for a trim result', () => {
    const { feature, context } = createFixture('trim');
    const result = rebuildMiterCut(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0]?.id).toBe('board-body');
    expect(result.bodies[0]?.faces.has('miter:miter-feature:cutFace')).toBe(true);
  });

  it('resolves only the explicitly referenced feature, body, and face', () => {
    const { feature, context } = createFixture();
    feature.parameters.sourceBodyRef = {
      featureId: 'missing-feature',
      bodyId: 'board-body',
    };
    feature.parameters.faceRef = {
      featureId: 'missing-feature',
      bodyId: 'board-body',
      faceId: '+X',
    };
    expect(rebuildMiterCut(feature, context)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'BODY_NOT_FOUND' }],
    });

    feature.parameters.sourceBodyRef = {
      featureId: 'board-feature',
      bodyId: 'board-body',
    };
    feature.parameters.faceRef = {
      featureId: 'board-feature',
      bodyId: 'board-body',
      faceId: 'missing-face',
    };
    expect(rebuildMiterCut(feature, context)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'FACE_NOT_FOUND' }],
    });
  });

  it('validates angle, inset, axis, result mode, and face reference', () => {
    const diagnostics = validateMiterCutParams({
      sourceBodyRef: { featureId: '', bodyId: '' },
      faceRef: { featureId: '', bodyId: '', faceId: '' },
      angleDegrees: 0,
      inset: -1,
      tiltAxis: 'bad' as never,
      resultMode: 'bad' as never,
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'MISSING_FEATURE_ID',
      'MISSING_BODY_REF',
      'MISSING_BODY_ID',
      'MISSING_FACE_ID',
      'INVALID_ANGLE',
      'INVALID_INSET',
      'INVALID_TILT_AXIS',
      'INVALID_RESULT_MODE',
    ]));
  });

  it('rebuilds identical geometry and topology ten times', () => {
    const { feature, context } = createFixture('split');
    const snapshots = Array.from({ length: 10 }, () => {
      const result = rebuildMiterCut(feature, context);
      expect(result.ok).toBe(true);
      if (!result.ok) return null;
      return result.bodies.map((body) => ({
        id: body.id,
        hash: hashBodyGeometry(body),
        vertices: [...body.vertices.keys()],
        edges: [...body.edges.keys()],
        faces: [...body.faces.keys()],
      }));
    });
    expect(new Set(snapshots.map((snapshot) => JSON.stringify(snapshot))).size).toBe(1);
  });

  it('uses the angle sign to miter toward the opposite side of the face', () => {
    const positive = createFixture('trim');
    const negative = createFixture('trim');
    negative.feature.parameters.angleDegrees = -45;
    const positiveResult = rebuildMiterCut(positive.feature, positive.context);
    const negativeResult = rebuildMiterCut(negative.feature, negative.context);
    expect(positiveResult.ok).toBe(true);
    expect(negativeResult.ok).toBe(true);
    if (!positiveResult.ok || !negativeResult.ok) return;
    expect(hashBodyGeometry(positiveResult.bodies[0]!)).not.toBe(
      hashBodyGeometry(negativeResult.bodies[0]!)
    );
  });

  it('retains the inward side for every box face, angle sign, and face axis', () => {
    const oppositeFace: Record<string, string> = {
      '+X': '-X', '-X': '+X',
      '+Y': '-Y', '-Y': '+Y',
      '+Z': '-Z', '-Z': '+Z',
    };
    for (const faceId of Object.keys(oppositeFace)) {
      for (const angleDegrees of [-10, 10]) {
        for (const tiltAxis of ['u', 'v'] as const) {
          const fixture = createFixture('trim');
          fixture.feature.parameters.faceRef = {
            featureId: fixture.sourceFeature.id,
            bodyId: fixture.body.id,
            faceId,
          };
          fixture.feature.parameters.angleDegrees = angleDegrees;
          fixture.feature.parameters.tiltAxis = tiltAxis;
          fixture.feature.parameters.inset = 0.05;
          const selectedVertexIds = getFaceVertexIds(fixture.body, faceId);
          const inwardVertexIds = getFaceVertexIds(fixture.body, oppositeFace[faceId]!);

          const result = rebuildMiterCut(fixture.feature, fixture.context);
          expect(result.ok, `${faceId} ${angleDegrees} ${tiltAxis}`).toBe(true);
          if (!result.ok) continue;
          const main = result.bodies[0]!;
          expect(inwardVertexIds.every((id) => main.vertices.has(id))).toBe(true);
          expect(selectedVertexIds.some((id) => !main.vertices.has(id))).toBe(true);
        }
      }
    }
  });

  it('creates an exact two-plane 45-degree three-way miter end', () => {
    const { body, feature, context } = createThreeWayFixture('trim');
    const face = body.faces.get('+X')!;
    const sourcePlane = body.planes.get(face.planeId)!;
    const ordered = getOrderedLoopVertices(body, face.boundaryEdgeIds);
    const selectedCorner = ordered[0]!;
    const result = rebuildMiterCut(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bodies).toHaveLength(1);
    const main = result.bodies[0]!;
    expect(validateClosedManifoldBody(main).ok).toBe(true);
    const firstCap = main.planes.get('miter:miter-feature:threeWay:first:cutFace');
    const secondCap = main.planes.get('miter:miter-feature:threeWay:second:cutFace');
    expect(firstCap).toBeDefined();
    expect(secondCap).toBeDefined();
    for (const cap of [firstCap!, secondCap!]) {
      const cosine = cap.normal[0] * sourcePlane.normal[0]
        + cap.normal[1] * sourcePlane.normal[1]
        + cap.normal[2] * sourcePlane.normal[2];
      expect(cosine).toBeCloseTo(Math.SQRT1_2, 8);
    }
    expect(main.vertices.has(selectedCorner.id)).toBe(true);
    expect(ordered.slice(1).every((vertex) => !main.vertices.has(vertex.id))).toBe(true);
  });

  it('can keep the main and both deterministic three-way offcuts', () => {
    const { body, feature, context } = createThreeWayFixture('split');
    const result = rebuildMiterCut(feature, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bodies.map((candidate) => candidate.id)).toEqual([
      'board-body',
      'miter-feature_offcut_u',
      'miter-feature_offcut_v',
    ]);
    expect(result.bodies.every((candidate) => validateClosedManifoldBody(candidate).ok)).toBe(true);
    expect(result.bodies.reduce((sum, candidate) => sum + bodyVolume(candidate), 0))
      .toBeCloseTo(bodyVolume(body), 8);
  });

  it('supports all four three-way end corners deterministically', () => {
    const snapshots = ['corner0', 'corner1', 'corner2', 'corner3'].map((corner) => {
      const fixture = createThreeWayFixture('trim');
      fixture.feature.parameters.threeWayCorner = corner;
      const face = fixture.body.faces.get('+X')!;
      const ordered = getOrderedLoopVertices(fixture.body, face.boundaryEdgeIds);
      const cornerIndex = Number(corner.slice('corner'.length));
      fixture.feature.parameters.threeWayVertexId = ordered[cornerIndex]!.id;
      const result = rebuildMiterCut(fixture.feature, fixture.context);
      expect(result.ok).toBe(true);
      if (!result.ok) return null;
      expect(result.bodies[0]!.vertices.has(ordered[cornerIndex]!.id)).toBe(true);
      return hashBodyGeometry(result.bodies[0]!);
    });
    expect(new Set(snapshots).size).toBe(4);

    const fixture = createThreeWayFixture('split');
    const repeated = Array.from({ length: 10 }, () => {
      const result = rebuildMiterCut(fixture.feature, fixture.context);
      expect(result.ok).toBe(true);
      return result.ok
        ? result.bodies.map((body) => ({ hash: hashBodyGeometry(body), ids: [...body.faces.keys()] }))
        : null;
    });
    expect(new Set(repeated.map((value) => JSON.stringify(value))).size).toBe(1);
  });

  it('fails closed when a three-way miter is requested on rectangular stock', () => {
    const fixture = createFixture('trim');
    fixture.feature.parameters.cutStyle = 'threeWay';
    const face = fixture.body.faces.get('+X')!;
    fixture.feature.parameters.threeWayVertexId = getOrderedLoopVertices(
      fixture.body,
      face.boundaryEdgeIds
    )[0]!.id;
    const result = rebuildMiterCut(fixture.feature, fixture.context);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'THREE_WAY_REQUIRES_SQUARE_END' }],
    });
  });

  it('ignores single-miter angle and axis fields for a three-way end', () => {
    const diagnostics = validateMiterCutParams({
      sourceBodyRef: { featureId: 'board-feature', bodyId: 'board-body' },
      faceRef: { featureId: 'board-feature', bodyId: 'board-body', faceId: '+X' },
      cutStyle: 'threeWay',
      threeWayCorner: 'corner0',
      angleDegrees: Number.NaN,
      tiltAxis: 'invalid' as never,
      inset: 0,
      resultMode: 'trim',
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('INVALID_ANGLE');
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('INVALID_TILT_AXIS');
  });

  it('fails closed when square stock is too short to contain the end treatment', () => {
    const fixture = createThreeWayFixture('trim');
    fixture.sourceFeature.parameters.width = 0.75;
    fixture.body = createBoxBody(fixture.sourceFeature.parameters as never, 'board-body');
    fixture.context.bodiesByFeature.set(fixture.sourceFeature.id, [fixture.body]);
    fixture.context.allBodies = [fixture.body];

    const result = rebuildMiterCut(fixture.feature, fixture.context);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ message: expect.stringContaining('too short') }],
    });
  });

  it('accepts the exact minimum square-stock length without degeneracy', () => {
    const fixture = createThreeWayFixture('trim');
    fixture.sourceFeature.parameters.width = 1;
    fixture.body = createBoxBody(fixture.sourceFeature.parameters as never, 'board-body');
    fixture.context.bodiesByFeature.set(fixture.sourceFeature.id, [fixture.body]);
    fixture.context.allBodies = [fixture.body];
    const face = fixture.body.faces.get('+X')!;
    fixture.feature.parameters.threeWayVertexId = getOrderedLoopVertices(
      fixture.body,
      face.boundaryEdgeIds
    )[0]!.id;

    const result = rebuildMiterCut(fixture.feature, fixture.context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateClosedManifoldBody(result.bodies[0]!).ok).toBe(true);
  });

  it('fails closed when a three-way feature has no stable corner reference', () => {
    const fixture = createThreeWayFixture('trim');
    delete fixture.feature.parameters.threeWayVertexId;
    expect(rebuildMiterCut(fixture.feature, fixture.context)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MISSING_THREE_WAY_CORNER_REF' }],
    });
  });

  it('keeps the chosen physical corner when the face boundary start changes', () => {
    const fixture = createThreeWayFixture('trim');
    const face = fixture.body.faces.get('+X')!;
    const originalOrder = getOrderedLoopVertices(fixture.body, face.boundaryEdgeIds);
    const stableVertexId = originalOrder[0]!.id;
    fixture.feature.parameters.threeWayVertexId = stableVertexId;
    face.boundaryEdgeIds = [...face.boundaryEdgeIds.slice(1), face.boundaryEdgeIds[0]!];
    expect(getOrderedLoopVertices(fixture.body, face.boundaryEdgeIds)[0]!.id).not.toBe(stableVertexId);

    const result = rebuildMiterCut(fixture.feature, fixture.context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodies[0]!.vertices.has(stableVertexId)).toBe(true);
  });

  it('fails closed when a saved three-way corner vertex is lost', () => {
    const fixture = createThreeWayFixture('trim');
    fixture.feature.parameters.threeWayVertexId = 'missing-corner';
    expect(rebuildMiterCut(fixture.feature, fixture.context)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'THREE_WAY_CORNER_LOST' }],
    });
  });
});
