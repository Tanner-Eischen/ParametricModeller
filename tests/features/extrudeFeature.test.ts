/**
 * Tests for ExtrudeFeature.
 */
import { describe, it, expect } from 'vitest';
import {
  EXTRUDE_FEATURE_TYPE,
  validateExtrudeParams,
  createExtrudeFeature,
  updateExtrudeDistance,
  updateExtrudeFlip,
  getExtrudeParams,
  defaultExtrudeParams,
  rebuildExtrude,
  type ExtrudeParams,
} from '../../src/features';
import {
  createSketchFeature,
  type SketchParams,
} from '../../src/features';
import { createWorldPlaneRef, createRectangleEntity } from '../../src/sketch';
import { createRebuildContext } from '../../src/features';
import type { FeatureRecord } from '../../src/features';

describe('ExtrudeFeature', () => {
  describe('EXTRUDE_FEATURE_TYPE', () => {
    it('should be "extrude"', () => {
      expect(EXTRUDE_FEATURE_TYPE).toBe('extrude');
    });
  });

  describe('defaultExtrudeParams', () => {
    it('should have default values', () => {
      expect(defaultExtrudeParams.sketchId).toBe('');
      expect(defaultExtrudeParams.profileIndex).toBe(0);
      expect(defaultExtrudeParams.distance).toBe(1);
      expect(defaultExtrudeParams.flip).toBe(false);
      expect(defaultExtrudeParams.mode).toBe('newBody');
    });
  });

  describe('validateExtrudeParams', () => {
    it('should return empty array for valid params', () => {
      const params: ExtrudeParams = {
        sketchId: 'sketch-1',
        profileIndex: 0,
        distance: 1,
        flip: false,
        mode: 'newBody',
      };
      const diagnostics = validateExtrudeParams(params);
      expect(diagnostics).toHaveLength(0);
    });

    it('should error on missing sketch ID', () => {
      const diagnostics = validateExtrudeParams({});
      expect(diagnostics.some(d => d.code === 'MISSING_SKETCH_ID')).toBe(true);
    });

    it('should error on negative profile index', () => {
      const diagnostics = validateExtrudeParams({
        sketchId: 'sketch-1',
        profileIndex: -1,
      });
      expect(diagnostics.some(d => d.code === 'INVALID_PROFILE_INDEX')).toBe(true);
    });

    it('should error on zero distance', () => {
      const diagnostics = validateExtrudeParams({
        sketchId: 'sketch-1',
        distance: 0,
      });
      expect(diagnostics.some(d => d.code === 'INVALID_DISTANCE')).toBe(true);
    });

    it('should error on negative distance', () => {
      const diagnostics = validateExtrudeParams({
        sketchId: 'sketch-1',
        distance: -1,
      });
      expect(diagnostics.some(d => d.code === 'INVALID_DISTANCE')).toBe(true);
    });

    it('should error on unsupported mode', () => {
      const diagnostics = validateExtrudeParams({
        sketchId: 'sketch-1',
        mode: 'addToBody' as 'newBody',
      });
      expect(diagnostics.some(d => d.code === 'UNSUPPORTED_MODE')).toBe(true);
    });
  });

  describe('createExtrudeFeature', () => {
    it('should create an extrude feature', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [createRectangleEntity([0, 0], 1, 1)],
        dimensions: [],
      });

      const extrudeFeature = createExtrudeFeature(sketchFeature, 0, 2, false, 'Extrude 1');

      expect(extrudeFeature.type).toBe('extrude');
      expect(extrudeFeature.id).toBeDefined();
      expect(extrudeFeature.name).toBe('Extrude 1');
      expect(extrudeFeature.refsIn).toContain(sketchFeature.id);
    });

    it('should store sketch data for rebuild', () => {
      const planeRef = createWorldPlaneRef('xy');
      const rect = createRectangleEntity([0, 0], 1, 1);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });

      const extrudeFeature = createExtrudeFeature(sketchFeature);
      const params = extrudeFeature.parameters as unknown as ExtrudeParams & { sketchData?: SketchParams };

      expect(params.sketchId).toBe(sketchFeature.id);
      expect(params.sketchData).toBeDefined();
      expect(params.sketchData?.entities).toHaveLength(1);
    });

    it('should use default values', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [createRectangleEntity([0, 0], 1, 1)],
        dimensions: [],
      });

      const extrudeFeature = createExtrudeFeature(sketchFeature);
      const params = getExtrudeParams(extrudeFeature);

      expect(params?.profileIndex).toBe(0);
      expect(params?.distance).toBe(1);
      expect(params?.flip).toBe(false);
    });
  });

  describe('updateExtrudeDistance', () => {
    it('should update distance', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [createRectangleEntity([0, 0], 1, 1)],
        dimensions: [],
      });
      const extrudeFeature = createExtrudeFeature(sketchFeature);

      const updated = updateExtrudeDistance(extrudeFeature, 5);
      const params = getExtrudeParams(updated);

      expect(params?.distance).toBe(5);
    });

    it('should not modify non-extrude feature', () => {
      const feature: FeatureRecord = {
        id: '1',
        type: 'box',
        name: 'Test',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };

      const updated = updateExtrudeDistance(feature, 5);
      expect(updated).toBe(feature);
    });
  });

  describe('updateExtrudeFlip', () => {
    it('should update flip direction', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [createRectangleEntity([0, 0], 1, 1)],
        dimensions: [],
      });
      const extrudeFeature = createExtrudeFeature(sketchFeature);

      const updated = updateExtrudeFlip(extrudeFeature, true);
      const params = getExtrudeParams(updated);

      expect(params?.flip).toBe(true);
    });
  });

  describe('getExtrudeParams', () => {
    it('should return params for extrude feature', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [createRectangleEntity([0, 0], 1, 1)],
        dimensions: [],
      });
      const extrudeFeature = createExtrudeFeature(sketchFeature, 0, 3, true);

      const params = getExtrudeParams(extrudeFeature);
      expect(params?.distance).toBe(3);
      expect(params?.flip).toBe(true);
    });

    it('should return null for non-extrude feature', () => {
      const feature: FeatureRecord = {
        id: '1',
        type: 'box',
        name: 'Test',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };

      const params = getExtrudeParams(feature);
      expect(params).toBeNull();
    });
  });

  describe('rebuildExtrude', () => {
    it('should create body from valid sketch and extrude', () => {
      const planeRef = createWorldPlaneRef('xy');
      const rect = createRectangleEntity([0, 0], 2, 3);
      const sketchFeature = createSketchFeature({
        planeRef,
        entities: [rect],
        dimensions: [],
      });
      const extrudeFeature = createExtrudeFeature(sketchFeature, 0, 1, false);
      const context = createRebuildContext();

      const result = rebuildExtrude(extrudeFeature, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.bodies).toHaveLength(1);

        const body = result.bodies[0];
        expect(body).toBeDefined();
        if (body) {
          expect(body.name).toBe('Prism');
          // Rectangle 2x3 should have 4 vertices
          expect(body.vertices.size).toBe(8); // 4 bottom + 4 top
          expect(body.faces.size).toBe(6); // bottom, top, 4 sides
        }
      }
    });

    it('should return error for missing sketch data', () => {
      const feature: FeatureRecord = {
        id: '1',
        type: 'extrude',
        name: 'Test',
        parameters: { sketchId: 'missing' },
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };
      const context = createRebuildContext();

      const result = rebuildExtrude(feature, context);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.some(d => d.code === 'SKETCH_NOT_FOUND')).toBe(true);
    });

    it('should return error for invalid params', () => {
      const feature: FeatureRecord = {
        id: '1',
        type: 'extrude',
        name: 'Test',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };
      const context = createRebuildContext();

      const result = rebuildExtrude(feature, context);
      expect(result.ok).toBe(false);
    });
  });
});
