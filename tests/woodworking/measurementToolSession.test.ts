import { describe, expect, it, vi } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import {
  MeasurementToolSession,
  evaluateMeasurement,
  type MeasurementReference,
} from '../../src/woodworking';

const box = createBoxBody({
  width: 2,
  depth: 3,
  height: 4,
  anchorMode: 'corner',
  origin: [0, 0, 0],
}, 'box');

const ref = <T extends MeasurementReference>(reference: T): T => reference;

describe('MeasurementToolSession', () => {
  it('stages exact reference kinds, previews, commits, and cancels without document mutation', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const session = new MeasurementToolSession({
      id: 'distance-1',
      kind: 'vertexToVertex',
      bodies: [box],
      onCommit,
      onCancel,
    });
    const snapshot = JSON.stringify([...box.vertices]);

    expect(session.getState()).toMatchObject({
      phase: 'awaiting-input',
      expectedReferenceKind: 'vertex',
      canCommit: false,
    });
    expect(session.addReference(ref({
      kind: 'edge', featureId: 'box-feature', bodyId: 'box', edgeId: '+Y+Z',
    }))).toBe(false);
    session.clearReferences();
    expect(session.addReference(ref({
      kind: 'vertex', featureId: 'box-feature', bodyId: 'box', vertexId: '-X-Y-Z',
    }))).toBe(true);
    expect(session.addReference(ref({
      kind: 'vertex', featureId: 'box-feature', bodyId: 'box', vertexId: '+X+Y+Z',
    }))).toBe(true);

    expect(session.getState().result).toMatchObject({
      kind: 'vertexToVertex',
      delta: [2, 3, 4],
      distance: 5.385165,
    });
    expect(session.commit()).toBe(true);
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: 'distance-1' }));
    session.cancel();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(JSON.stringify([...box.vertices])).toBe(snapshot);
  });

  it('measures every supported planar B-Rep mode', () => {
    const evaluate = (kind: Parameters<typeof evaluateMeasurement>[1], refs: MeasurementReference[]) => {
      const result = evaluateMeasurement(`measurement-${kind}`, kind, refs, {
        bodies: [box],
        getBodyOrientation: () => ({ grainAxis: [1, 0, 0], thicknessAxis: [0, 0, 1] }),
      });
      if (!result.ok) throw new Error(result.diagnostics[0]?.message);
      return result.result;
    };
    const bodyRef = ref({ kind: 'body', featureId: 'box-feature', bodyId: 'box' });
    const edgeX = ref({ kind: 'edge', featureId: 'box-feature', bodyId: 'box', edgeId: '+Y+Z' });
    const edgeY = ref({ kind: 'edge', featureId: 'box-feature', bodyId: 'box', edgeId: '+X+Z' });
    const faceX = ref({ kind: 'face', featureId: 'box-feature', bodyId: 'box', faceId: '+X' });
    const faceNegX = ref({ kind: 'face', featureId: 'box-feature', bodyId: 'box', faceId: '-X' });
    const faceY = ref({ kind: 'face', featureId: 'box-feature', bodyId: 'box', faceId: '+Y' });
    const vertex = ref({ kind: 'vertex', featureId: 'box-feature', bodyId: 'box', vertexId: '-X-Y-Z' });
    const opposite = ref({ kind: 'vertex', featureId: 'box-feature', bodyId: 'box', vertexId: '+X+Y+Z' });

    expect(evaluate('bodyDimensions', [bodyRef])).toMatchObject({ length: 2, width: 3, thickness: 4 });
    expect(evaluate('edgeLength', [edgeX])).toMatchObject({ length: 2 });
    expect(evaluate('faceProperties', [faceX])).toMatchObject({ area: 12, perimeter: 14 });
    expect(evaluate('vertexToVertex', [vertex, opposite])).toMatchObject({ delta: [2, 3, 4] });
    expect(evaluate('vertexToFace', [vertex, faceX])).toMatchObject({ distance: 2 });
    expect(evaluate('parallelFaceDistance', [faceX, faceNegX])).toMatchObject({ distance: 2 });
    expect(evaluate('edgeAngle', [edgeX, edgeY])).toMatchObject({ degrees: 90 });
    expect(evaluate('faceAngle', [faceX, faceY])).toMatchObject({ degrees: 90 });
  });

  it('fails closed for broken references, duplicate selections, and non-parallel faces', () => {
    const faceX = ref({ kind: 'face', featureId: 'box-feature', bodyId: 'box', faceId: '+X' });
    const faceY = ref({ kind: 'face', featureId: 'box-feature', bodyId: 'box', faceId: '+Y' });
    expect(evaluateMeasurement('bad', 'parallelFaceDistance', [faceX, faceY], { bodies: [box] }))
      .toMatchObject({ ok: false, diagnostics: [{ code: 'NON_PARALLEL_FACES' }] });
    expect(evaluateMeasurement('bad', 'edgeLength', [ref({
      kind: 'edge', featureId: 'box-feature', bodyId: 'box', edgeId: 'missing',
    })], { bodies: [box] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'REFERENCE_NOT_FOUND', referenceIndex: 0 }],
    });

    const session = new MeasurementToolSession({
      id: 'duplicate', kind: 'faceAngle', bodies: [box],
    });
    expect(session.addReference(faceX)).toBe(true);
    expect(session.addReference(faceX)).toBe(false);
    expect(session.getState().diagnostics[0]?.code).toBe('DUPLICATE_REFERENCE');
  });
});
