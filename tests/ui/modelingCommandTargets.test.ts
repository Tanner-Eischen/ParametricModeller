import { describe, expect, it } from 'vitest';
import { createFeatureRecord } from '../../src/features';
import { createBoxBody, defaultBoxParams } from '../../src/features/primitives/BoxFeature';
import { createSketchFeature } from '../../src/features/sketch/SketchFeature';
import { createWorldPlaneRef } from '../../src/sketch';
import {
  createEmptyFaceSketchFeature,
  getDefaultCutFlipForSketch,
  resolveExplicitBodyTarget,
  resolveExplicitSketchTarget,
} from '../../src/ui/ModelingCommandTargets';

describe('modeling command target resolution', () => {
  it('creates an empty face-backed sketch for the editor to populate', () => {
    const sketch = createEmptyFaceSketchFeature({
      faceId: '+Z',
      bodyId: 'body-selected',
      featureId: 'box-feature',
      origin: [10, 10, 1],
    }, 'Sketch on Face');

    expect(sketch.type).toBe('sketch');
    expect(sketch.parameters.entities).toEqual([]);
    expect(sketch.parameters.dimensions).toEqual([]);
    expect(sketch.parameters.planeRef).toMatchObject({
      type: 'face',
      faceId: '+Z',
      bodyId: 'body-selected',
      featureId: 'box-feature',
      origin: [10, 10, 1],
    });
    expect(getDefaultCutFlipForSketch(sketch)).toBe(true);
  });

  it('keeps world-plane cuts in their existing forward direction', () => {
    const sketch = createSketchFeature({
      planeRef: createWorldPlaneRef('xy'),
      entities: [],
      dimensions: [],
    });

    expect(getDefaultCutFlipForSketch(sketch)).toBe(false);
    expect(getDefaultCutFlipForSketch(createFeatureRecord('box', 'Box', {}))).toBe(false);
  });

  it('accepts only an explicitly selected sketch feature', () => {
    const sketch = createFeatureRecord('sketch', 'Sketch', {});
    const box = createFeatureRecord('box', 'Box', {});

    expect(resolveExplicitSketchTarget(sketch)).toBe(sketch);
    expect(resolveExplicitSketchTarget(box)).toBeNull();
    expect(resolveExplicitSketchTarget(null)).toBeNull();
  });

  it('resolves the active body only while it remains explicitly selected', () => {
    const body = createBoxBody(defaultBoxParams, 'body-selected');
    const feature = createFeatureRecord('box', 'Box', {}, { id: 'box-feature' });
    const getFeatureByBodyId = (bodyId: string) => bodyId === body.id ? feature : null;

    expect(resolveExplicitBodyTarget({
      activeBodyId: body.id,
      selectedBodyIds: new Set([body.id]),
      bodies: [body],
      getFeatureByBodyId,
    })).toEqual({ body, feature });

    expect(resolveExplicitBodyTarget({
      activeBodyId: body.id,
      selectedBodyIds: new Set(),
      bodies: [body],
      getFeatureByBodyId,
    })).toBeNull();

    expect(resolveExplicitBodyTarget({
      activeBodyId: body.id,
      selectedBodyIds: new Set([body.id, 'another-body']),
      bodies: [body],
      getFeatureByBodyId,
    })).toBeNull();
  });

  it('never falls back to the newest body or to an unresolved feature', () => {
    const body = createBoxBody(defaultBoxParams, 'body-latest');

    expect(resolveExplicitBodyTarget({
      activeBodyId: null,
      selectedBodyIds: new Set(),
      bodies: [body],
      getFeatureByBodyId: () => createFeatureRecord('box', 'Box', {}),
    })).toBeNull();

    expect(resolveExplicitBodyTarget({
      activeBodyId: body.id,
      selectedBodyIds: new Set([body.id]),
      bodies: [body],
      getFeatureByBodyId: () => null,
    })).toBeNull();
  });
});
