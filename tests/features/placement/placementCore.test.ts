import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  coordinateFrameToMatrix,
  createCoordinateFrame3D,
  isRightHandedCoordinateFrame,
  type Body,
} from '../../../src/geometry';
import {
  createAlignPlacement,
  createAxisAnglePlacement,
  createBodyPlacementRef,
  createBoxFeature,
  createEdgePlacementRef,
  createEdgePointPlacementRef,
  createFaceCenterPlacementRef,
  createFixedMatrixPlacement,
  createFreePlacement,
  createPointToPointPlacement,
  createRebuildContext,
  createTransformBodiesFeature,
  createVertexPlacementRef,
  deriveFaceCoordinateFrame,
  rebuildBox,
  rebuildTransformBodies,
  registerBodies,
  resolvePlacementFrame,
  resolvePlacementPoint,
  solvePlacementMatrix,
  type RebuildContext,
} from '../../../src/features';

interface BoxFixture {
  featureId: string;
  body: Body;
}

function createBoxFixture(
  featureId: string,
  origin: [number, number, number] = [0, 0, 0],
  dimensions: [number, number, number] = [1, 1, 1]
): BoxFixture {
  const feature = createBoxFeature({
    origin,
    width: dimensions[0],
    depth: dimensions[1],
    height: dimensions[2],
  });
  feature.id = featureId;
  const result = rebuildBox(feature, createRebuildContext());
  if (!result.ok) throw new Error(result.error);
  return { featureId, body: result.bodies[0]! };
}

function contextFor(...fixtures: BoxFixture[]): RebuildContext {
  return fixtures.reduce(
    (context, fixture) => registerBodies(
      context,
      fixture.featureId,
      [fixture.body]
    ),
    createRebuildContext()
  );
}

function bodyCenter(body: Body): THREE.Vector3 {
  const points = [...body.vertices.values()].map(
    (vertex) => new THREE.Vector3(...vertex.position)
  );
  return points.reduce(
    (sum, point) => sum.add(point),
    new THREE.Vector3()
  ).multiplyScalar(1 / points.length);
}

function containsPoint(body: Body, expected: THREE.Vector3): boolean {
  return [...body.vertices.values()].some((vertex) =>
    new THREE.Vector3(...vertex.position).distanceTo(expected) < 1e-9
  );
}

describe('CoordinateFrame3D', () => {
  it('constructs an orthonormal right-handed frame', () => {
    const frame = createCoordinateFrame3D(
      [4, 5, 6],
      [2, 0, 0],
      [1, 3, 0]
    );

    expect(isRightHandedCoordinateFrame(frame)).toBe(true);
    expect(new THREE.Vector3(...frame.xAxis).cross(
      new THREE.Vector3(...frame.yAxis)
    ).toArray()).toEqual(frame.zAxis);
    expect(new THREE.Vector3().setFromMatrixPosition(
      coordinateFrameToMatrix(frame)
    ).toArray()).toEqual([4, 5, 6]);
  });

  it('rejects parallel frame axes', () => {
    expect(() => createCoordinateFrame3D(
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0]
    )).toThrow(/must not be parallel/);
  });
});

describe('reference-based placement solver', () => {
  it('resolves stable body, face-center, and edge-point datums', () => {
    const source = createBoxFixture('source');
    const context = contextFor(source);
    const bodyFrame = resolvePlacementFrame(
      context,
      createBodyPlacementRef('source', source.body.id)
    );
    const faceCenter = resolvePlacementPoint(
      context,
      createFaceCenterPlacementRef('source', source.body.id, '+Z')
    );
    const edgePoint = resolvePlacementPoint(
      context,
      createEdgePointPlacementRef('source', source.body.id, '+Y+Z', 0.25)
    );

    expect(bodyFrame.ok && faceCenter.ok && edgePoint.ok).toBe(true);
    if (!bodyFrame.ok || !faceCenter.ok || !edgePoint.ok) return;
    expect(bodyFrame.value.origin).toEqual([0.5, 0.5, 0.5]);
    expect(faceCenter.value).toEqual([0.5, 0.5, 1]);
    expect(edgePoint.value).toEqual([0.25, 1, 1]);
  });

  it('moves an exact source vertex to an exact target vertex', () => {
    const source = createBoxFixture('source');
    const target = createBoxFixture('target', [10, 2, 3]);
    const context = contextFor(source, target);
    const placement = createPointToPointPlacement(
      createVertexPlacementRef('source', source.body.id, '+X+Y+Z'),
      createVertexPlacementRef('target', target.body.id, '-X-Y-Z')
    );
    const feature = createTransformBodiesFeature(
      [{ featureId: 'source', bodyId: source.body.id }],
      placement,
      'move',
      'Locate',
      'locate'
    );

    const result = rebuildTransformBodies(feature, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(containsPoint(result.bodies[0]!, new THREE.Vector3(10, 2, 3))).toBe(true);
    expect(result.replacedBodyIds).toEqual([source.body.id]);
  });

  it('aligns face frames with a signed gap and a quarter turn', () => {
    const source = createBoxFixture('source');
    const target = createBoxFixture('target', [5, 5, 0]);
    const context = contextFor(source, target);
    const sourceRef = {
      kind: 'face',
      featureId: 'source',
      bodyId: source.body.id,
      faceId: '+X',
    } as const;
    const targetRef = {
      kind: 'face',
      featureId: 'target',
      bodyId: target.body.id,
      faceId: '+Y',
    } as const;
    const solved = solvePlacementMatrix(
      createAlignPlacement(sourceRef, targetRef, -2, 1),
      context
    );

    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    const sourceFrame = deriveFaceCoordinateFrame(source.body, '+X');
    const targetFrame = deriveFaceCoordinateFrame(target.body, '+Y');
    expect(sourceFrame.ok && targetFrame.ok).toBe(true);
    if (!sourceFrame.ok || !targetFrame.ok) return;

    const movedOrigin = new THREE.Vector3(...sourceFrame.value.origin)
      .applyMatrix4(solved.matrix);
    const targetOrigin = new THREE.Vector3(...targetFrame.value.origin);
    const targetNormal = new THREE.Vector3(...targetFrame.value.zAxis);
    expect(movedOrigin.clone().sub(targetOrigin).dot(targetNormal)).toBeCloseTo(-2);

    const movedNormal = new THREE.Vector3(...sourceFrame.value.zAxis)
      .transformDirection(solved.matrix);
    expect(movedNormal.dot(targetNormal)).toBeCloseTo(1);

    const expectedQuarterTurnX = new THREE.Vector3(...targetFrame.value.xAxis)
      .applyAxisAngle(targetNormal, Math.PI / 2);
    const movedX = new THREE.Vector3(...sourceFrame.value.xAxis)
      .transformDirection(solved.matrix);
    expect(movedX.distanceTo(expectedQuarterTurnX)).toBeLessThan(1e-9);
  });

  it('rotates 45 degrees around an exact edge axis', () => {
    const source = createBoxFixture('source');
    const context = contextFor(source);
    const placement = createAxisAnglePlacement(
      createEdgePlacementRef('source', source.body.id, '+Y+Z'),
      45
    );
    const feature = createTransformBodiesFeature(
      [{ featureId: 'source', bodyId: source.body.id }],
      placement,
      'move',
      'Rotate',
      'rotate'
    );

    const result = rebuildTransformBodies(feature, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = new THREE.Vector3(0, 0, 0)
      .sub(new THREE.Vector3(0, 1, 1))
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4)
      .add(new THREE.Vector3(0, 1, 1));
    expect(containsPoint(result.bodies[0]!, expected)).toBe(true);
  });

  it.each(['move', 'copy'] as const)(
    'applies one rigid matrix to multiple bodies in %s mode',
    (mode) => {
      const first = createBoxFixture('first');
      const second = createBoxFixture('second', [5, 2, 0]);
      const context = contextFor(first, second);
      const feature = createTransformBodiesFeature(
        [
          { featureId: 'first', bodyId: first.body.id },
          { featureId: 'second', bodyId: second.body.id },
        ],
        createFreePlacement([2, -3, 4]),
        mode,
        'Group transform',
        'group-transform'
      );
      const spacingBefore = bodyCenter(first.body).distanceTo(bodyCenter(second.body));

      const result = rebuildTransformBodies(feature, context);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.bodies).toHaveLength(2);
      expect(bodyCenter(result.bodies[0]!).distanceTo(
        bodyCenter(result.bodies[1]!)
      )).toBeCloseTo(spacingBefore);
      expect(bodyCenter(result.bodies[0]!).sub(bodyCenter(first.body)).toArray())
        .toEqual([2, -3, 4]);
      if (mode === 'copy') {
        expect(result.replacedBodyIds).toBeUndefined();
        expect(result.bodies.map((body) => body.id)).toEqual([
          `${first.body.id}_group-transform_copy`,
          `${second.body.id}_group-transform_copy`,
        ]);
      } else {
        expect(result.replacedBodyIds).toEqual([first.body.id, second.body.id]);
      }
    }
  );

  it('rejects a non-rigid fixed matrix', () => {
    const solved = solvePlacementMatrix(
      createFixedMatrixPlacement(new THREE.Matrix4().makeScale(2, 1, 1)),
      createRebuildContext()
    );

    expect(solved).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'NON_RIGID_FIXED_MATRIX' }],
    });
  });
});

describe('Transform Bodies reference integrity and determinism', () => {
  it('fails closed on malformed persisted placement data', () => {
    const source = createBoxFixture('source');
    const feature = createTransformBodiesFeature(
      [{ featureId: 'source', bodyId: source.body.id }],
      createFreePlacement(),
      'move',
      'Move',
      'malformed'
    );
    feature.parameters.placement = {
      type: 'AxisAngle',
      angleDegrees: 45,
    };

    const result = rebuildTransformBodies(feature, contextFor(source));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'INVALID_PLACEMENT_REF', featureId: 'malformed' }],
    });
  });

  it('reports an actionable broken exact source-body reference', () => {
    const source = createBoxFixture('source');
    const feature = createTransformBodiesFeature(
      [{ featureId: 'source', bodyId: 'stale-body-id' }],
      createFreePlacement([1, 0, 0]),
      'move',
      'Move',
      'broken-source'
    );

    const result = rebuildTransformBodies(feature, contextFor(source));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{
        code: 'BROKEN_TRANSFORM_BODY_REF',
        featureId: 'broken-source',
        entityId: 'stale-body-id',
      }],
    });
    if (result.ok) return;
    expect(result.error).toContain('reselect');
  });

  it('reports an actionable broken datum reference', () => {
    const source = createBoxFixture('source');
    const target = createBoxFixture('target', [4, 0, 0]);
    const feature = createTransformBodiesFeature(
      [{ featureId: 'source', bodyId: source.body.id }],
      createPointToPointPlacement(
        createVertexPlacementRef('source', source.body.id, '+X+Y+Z'),
        createVertexPlacementRef('target', target.body.id, 'deleted-vertex')
      ),
      'move',
      'Move',
      'broken-datum'
    );

    const result = rebuildTransformBodies(feature, contextFor(source, target));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{
        code: 'BROKEN_PLACEMENT_VERTEX_REF',
        featureId: 'broken-datum',
        entityId: 'deleted-vertex',
      }],
    });
    if (result.ok) return;
    expect(result.error).toContain('reselect');
  });

  it('rebuilds copy topology and positions deterministically', () => {
    const first = createBoxFixture('first');
    const second = createBoxFixture('second', [3, 0, 0]);
    const context = contextFor(first, second);
    const feature = createTransformBodiesFeature(
      [
        { featureId: 'first', bodyId: first.body.id },
        { featureId: 'second', bodyId: second.body.id },
      ],
      createFixedMatrixPlacement(
        new THREE.Matrix4()
          .makeRotationZ(Math.PI / 4)
          .setPosition(7, 8, 9)
      ),
      'copy',
      'Deterministic copy',
      'stable-transform'
    );
    const snapshot = (bodies: Body[]) => JSON.stringify(bodies.map((body) => ({
      id: body.id,
      vertices: [...body.vertices].map(([id, vertex]) => [id, vertex.position]),
      edges: [...body.edges.keys()],
      faces: [...body.faces.keys()],
      planes: [...body.planes.keys()],
    })));

    const firstResult = rebuildTransformBodies(feature, context);
    const secondResult = rebuildTransformBodies(feature, context);

    expect(firstResult.ok && secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;
    expect(snapshot(firstResult.bodies)).toBe(snapshot(secondResult.bodies));
  });
});
