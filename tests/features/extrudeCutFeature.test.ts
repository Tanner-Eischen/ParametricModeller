import { describe, it, expect } from 'vitest';
import {
  createExtrudeCutFeature,
  validateExtrudeCutParams,
  rebuildExtrudeCut,
  rebuildExtrudeCutWithAdapter,
  getExtrudeCutParams,
  updateExtrudeCutDistance,
  updateExtrudeCutMode,
  updateExtrudeCutFlip,
  createBodyRef,
  defaultExtrudeCutParams,
  EXTRUDE_CUT_FEATURE_TYPE,
  type ExtrudeCutParams,
} from '../../src/features/cut';
import { createSketchFeature } from '../../src/features/sketch';
import { createFacePlaneRef, createWorldPlaneRef, createRectangleEntity } from '../../src/sketch';
import { prismaticSolidBooleanAdapter } from '../../src/features/extrude';
import type { FeatureRecord } from '../../src/features';
import {
  createBoxFeature,
  createRebuildContext,
  createRebuildEngine,
  rebuildBox,
  rebuildSketch,
} from '../../src/features';

describe('ExtrudeCutFeature', () => {
  describe('defaultExtrudeCutParams', () => {
    it('should have correct default values', () => {
      expect(defaultExtrudeCutParams.targetBodyRef.bodyId).toBe('');
      expect(defaultExtrudeCutParams.targetBodyRef.featureId).toBe('');
      expect(defaultExtrudeCutParams.sketchId).toBe('');
      expect(defaultExtrudeCutParams.profileIndex).toBe(0);
      expect(defaultExtrudeCutParams.mode).toBe('distance');
      expect(defaultExtrudeCutParams.distance).toBe(0.5);
      expect(defaultExtrudeCutParams.flip).toBe(false);
    });
  });

  describe('createBodyRef', () => {
    it('should create a body reference', () => {
      const ref = createBodyRef('body123', 'feature456');
      expect(ref.bodyId).toBe('body123');
      expect(ref.featureId).toBe('feature456');
    });
  });

  describe('validateExtrudeCutParams', () => {
    it('should return errors for empty params', () => {
      const diagnostics = validateExtrudeCutParams({});
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some(d => d.code === 'MISSING_TARGET_BODY')).toBe(true);
      expect(diagnostics.some(d => d.code === 'MISSING_SKETCH_ID')).toBe(true);
    });

    it('should validate missing target body ref', () => {
      const params: Partial<ExtrudeCutParams> = {
        sketchId: 'sketch123',
        mode: 'distance',
        distance: 1,
      };
      const diagnostics = validateExtrudeCutParams(params);
      expect(diagnostics.some(d => d.code === 'MISSING_TARGET_BODY')).toBe(true);
    });

    it('should validate missing body ID in body ref', () => {
      const params: Partial<ExtrudeCutParams> = {
        targetBodyRef: { bodyId: '', featureId: 'feature123' },
        sketchId: 'sketch123',
        mode: 'distance',
        distance: 1,
      };
      const diagnostics = validateExtrudeCutParams(params);
      expect(diagnostics.some(d => d.code === 'MISSING_TARGET_BODY')).toBe(true);
    });

    it('should validate missing sketch ID', () => {
      const params: Partial<ExtrudeCutParams> = {
        targetBodyRef: { bodyId: 'body123', featureId: 'feature123' },
        mode: 'distance',
        distance: 1,
      };
      const diagnostics = validateExtrudeCutParams(params);
      expect(diagnostics.some(d => d.code === 'MISSING_SKETCH_ID')).toBe(true);
    });

    it('should validate negative profile index', () => {
      const params: Partial<ExtrudeCutParams> = {
        targetBodyRef: { bodyId: 'body123', featureId: 'feature123' },
        sketchId: 'sketch123',
        profileIndex: -1,
        mode: 'distance',
        distance: 1,
      };
      const diagnostics = validateExtrudeCutParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_PROFILE_INDEX')).toBe(true);
    });

    it('should validate invalid distance mode', () => {
      const params: Partial<ExtrudeCutParams> = {
        targetBodyRef: { bodyId: 'body123', featureId: 'feature123' },
        sketchId: 'sketch123',
        mode: 'distance',
        distance: 0,
      };
      const diagnostics = validateExtrudeCutParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_DISTANCE')).toBe(true);
    });

    it('should validate unsupported mode', () => {
      const params: Partial<ExtrudeCutParams> = {
        targetBodyRef: { bodyId: 'body123', featureId: 'feature123' },
        sketchId: 'sketch123',
        mode: 'invalidMode' as 'distance',
        distance: 1,
      };
      const diagnostics = validateExtrudeCutParams(params);
      expect(diagnostics.some(d => d.code === 'UNSUPPORTED_MODE')).toBe(true);
    });

    it('should return no errors for valid params', () => {
      const params: Partial<ExtrudeCutParams> = {
        targetBodyRef: { bodyId: 'body123', featureId: 'feature123' },
        sketchId: 'sketch123',
        profileIndex: 0,
        mode: 'distance',
        distance: 1,
        flip: false,
      };
      const diagnostics = validateExtrudeCutParams(params);
      expect(diagnostics.length).toBe(0);
    });

    it('should accept through mode without distance', () => {
      const params: Partial<ExtrudeCutParams> = {
        targetBodyRef: { bodyId: 'body123', featureId: 'feature123' },
        sketchId: 'sketch123',
        mode: 'through',
      };
      const diagnostics = validateExtrudeCutParams(params);
      // Should not have INVALID_DISTANCE for through mode
      expect(diagnostics.some(d => d.code === 'INVALID_DISTANCE')).toBe(false);
    });
  });

  describe('createExtrudeCutFeature', () => {
    it('should create a feature with correct type', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature);

      expect(feature.type).toBe(EXTRUDE_CUT_FEATURE_TYPE);
      expect(feature.name).toBe('Extrude Cut');
      expect(feature.suppressed).toBe(false);
    });

    it('should create a feature with custom name', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature, 'distance', 0.5, false, 'Pocket');

      expect(feature.name).toBe('Pocket');
    });

    it('should create a feature with refs to target and sketch', () => {
      const bodyRef = createBodyRef('body123', 'targetFeature');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature);

      expect(feature.refsIn).toContain('targetFeature');
      expect(feature.refsIn).toContain(sketchFeature.id);
    });

    it('should reference live sketch data instead of caching a snapshot', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature);
      const params = feature.parameters as unknown as ExtrudeCutParams;

      expect(params.sketchData).toBeUndefined();
    });

    it('should create feature with distance mode by default', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature);
      const params = feature.parameters as unknown as ExtrudeCutParams;

      expect(params.mode).toBe('distance');
    });

    it('should create feature with through mode', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature, 'through');
      const params = feature.parameters as unknown as ExtrudeCutParams;

      expect(params.mode).toBe('through');
    });
  });

  describe('updateExtrudeCutDistance', () => {
    it('should update distance for extrude cut feature', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature, 'distance', 0.5);
      const updated = updateExtrudeCutDistance(feature, 2.0);
      const params = updated.parameters as unknown as ExtrudeCutParams;

      expect(params.distance).toBe(2.0);
      expect(params.mode).toBe('distance');
    });

    it('should return unchanged feature for non-cut type', () => {
      const feature: FeatureRecord = {
        id: '123',
        type: 'box',
        name: 'Box',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };

      const updated = updateExtrudeCutDistance(feature, 2.0);
      expect(updated).toBe(feature);
    });
  });

  describe('updateExtrudeCutMode', () => {
    it('should update mode to through', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature, 'distance');
      const updated = updateExtrudeCutMode(feature, 'through');
      const params = updated.parameters as unknown as ExtrudeCutParams;

      expect(params.mode).toBe('through');
    });

    it('should update mode to distance', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature, 'through');
      const updated = updateExtrudeCutMode(feature, 'distance');
      const params = updated.parameters as unknown as ExtrudeCutParams;

      expect(params.mode).toBe('distance');
    });
  });

  describe('updateExtrudeCutFlip', () => {
    it('should update flip direction', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature);
      const updated = updateExtrudeCutFlip(feature, true);
      const params = updated.parameters as unknown as ExtrudeCutParams;

      expect(params.flip).toBe(true);
    });
  });

  describe('getExtrudeCutParams', () => {
    it('should return params for extrude cut feature', () => {
      const bodyRef = createBodyRef('body123', 'feature123');
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const feature = createExtrudeCutFeature(bodyRef, sketchFeature, 'distance', 1.5);
      const params = getExtrudeCutParams(feature);

      expect(params).not.toBeNull();
      expect(params?.targetBodyRef.bodyId).toBe('body123');
      expect(params?.sketchId).toBe(sketchFeature.id);
      expect(params?.distance).toBe(1.5);
    });

    it('should return null for non-cut feature', () => {
      const feature: FeatureRecord = {
        id: '123',
        type: 'box',
        name: 'Box',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };

      const params = getExtrudeCutParams(feature);
      expect(params).toBeNull();
    });
  });

  describe('rebuildExtrudeCut', () => {
    it('cuts inward from an outward-facing attached sketch plane', () => {
      const box = createBoxFeature({ width: 20, depth: 20, height: 1 });
      const sketch = createSketchFeature({
        planeRef: createFacePlaneRef('+Z', `${box.id}_body`, box.id, [10, 10, 1]),
        entities: [createRectangleEntity([-2.5, -2.5], 5, 5, 0, 'face-cut-rect')],
        dimensions: [],
      });
      const cut = createExtrudeCutFeature(
        createBodyRef(`${box.id}_body`, box.id),
        sketch,
        'distance',
        0.5,
        true
      );
      const engine = createRebuildEngine();
      engine.registerHandler('box', rebuildBox);
      engine.registerHandler('sketch', rebuildSketch);
      engine.registerHandler(EXTRUDE_CUT_FEATURE_TYPE, (feature, context) =>
        rebuildExtrudeCutWithAdapter(feature, context, prismaticSolidBooleanAdapter)
      );

      const result = engine.rebuild([box, sketch, cut]);

      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
    });

    it('uses the current sketch output on every rebuild', () => {
      const box = createBoxFeature({ width: 2, depth: 2, height: 2 });
      const rect = createRectangleEntity([0.25, 0.25], 0.5, 0.5, 0, 'cut-rect');
      const sketch = createSketchFeature({
        planeRef: createWorldPlaneRef('xy', 0),
        entities: [rect],
        dimensions: [],
      });
      const cut = createExtrudeCutFeature(
        createBodyRef(`${box.id}_body`, box.id),
        sketch,
        'distance',
        0.5
      );
      const engine = createRebuildEngine();
      engine.registerHandler('box', rebuildBox);
      engine.registerHandler('sketch', rebuildSketch);
      engine.registerHandler(EXTRUDE_CUT_FEATURE_TYPE, rebuildExtrudeCut);

      const first = engine.rebuild([box, sketch, cut]);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const firstCutXs = Array.from(first.bodies[0]!.vertices.values())
        .filter((vertex) => !vertex.id.startsWith('+') && !vertex.id.startsWith('-'))
        .map((vertex) => vertex.position[0]);
      expect(Math.max(...firstCutXs)).toBe(0.75);

      sketch.parameters = {
        ...sketch.parameters,
        entities: [{ ...rect, width: 1.25 }],
      };
      const second = engine.rebuild([box, sketch, cut]);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const secondCutXs = Array.from(second.bodies[0]!.vertices.values())
        .filter((vertex) => !vertex.id.startsWith('+') && !vertex.id.startsWith('-'))
        .map((vertex) => vertex.position[0]);
      expect(Math.max(...secondCutXs)).toBe(1.5);
    });

    it('should fail with missing sketch data', () => {
      const feature: FeatureRecord = {
        id: 'cut123',
        type: EXTRUDE_CUT_FEATURE_TYPE,
        name: 'Cut',
        parameters: {
          targetBodyRef: { bodyId: 'body123', featureId: 'feature123' },
          sketchId: 'sketch123',
          profileIndex: 0,
          mode: 'distance',
          distance: 1,
          flip: false,
          // Note: no sketchData!
        },
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };

      const context = createRebuildContext();
      const result = rebuildExtrudeCut(feature, context);

      expect(result.ok).toBe(false);
      // Should have either SKETCH_NOT_FOUND or validation error
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it('should fail with missing target body', () => {
      const planeRef = createWorldPlaneRef('xy', 0);
      const rect = createRectangleEntity([0, 0], 1, 1, 0);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const bodyRef = createBodyRef('nonexistent', 'feature123');
      const feature = createExtrudeCutFeature(bodyRef, sketchFeature);

      const context = createRebuildContext();
      const result = rebuildExtrudeCut(feature, context);

      expect(result.ok).toBe(false);
      expect(result.diagnostics.some(d => d.code === 'TARGET_BODY_NOT_FOUND')).toBe(true);
    });
  });
});
