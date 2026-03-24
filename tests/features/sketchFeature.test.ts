/**
 * Tests for SketchFeature.
 */
import { describe, it, expect } from 'vitest';
import {
  SKETCH_FEATURE_TYPE,
  validateSketchParams,
  createSketchFeature,
  rebuildSketch,
  addEntityToSketchFeature,
  createDefaultRectSketch,
  defaultSketchParams,
  type SketchParams,
} from '../../src/features';
import {
  createWorldPlaneRef,
  createRectangleEntity,
} from '../../src/sketch';
import { createRebuildContext } from '../../src/features';
import type { FeatureRecord } from '../../src/features';

describe('SketchFeature', () => {
  describe('SKETCH_FEATURE_TYPE', () => {
    it('should be "sketch"', () => {
      expect(SKETCH_FEATURE_TYPE).toBe('sketch');
    });
  });

  describe('defaultSketchParams', () => {
    it('should have default values', () => {
      expect(defaultSketchParams.planeRef.type).toBe('world');
      expect(defaultSketchParams.entities).toEqual([]);
      expect(defaultSketchParams.dimensions).toEqual([]);
    });
  });

  describe('validateSketchParams', () => {
    it('should return empty array for valid params', () => {
      const params: SketchParams = {
        planeRef: createWorldPlaneRef('xy'),
        entities: [createRectangleEntity([0, 0], 1, 1)],
        dimensions: [],
      };
      const diagnostics = validateSketchParams(params);
      expect(diagnostics).toHaveLength(0);
    });

    it('should error on missing plane ref', () => {
      const diagnostics = validateSketchParams({});
      expect(diagnostics.some(d => d.code === 'MISSING_PLANE_REF')).toBe(true);
    });

    it('should error on invalid world plane type', () => {
      const diagnostics = validateSketchParams({
        planeRef: { id: '1', type: 'world' },
      });
      expect(diagnostics.some(d => d.code === 'INVALID_PLANE_REF')).toBe(true);
    });

    it('should error on face plane without faceId', () => {
      const diagnostics = validateSketchParams({
        planeRef: { id: '1', type: 'face', bodyId: 'body-1' },
      });
      expect(diagnostics.some(d => d.code === 'INVALID_PLANE_REF')).toBe(true);
    });

    it('should error on face plane without bodyId', () => {
      const diagnostics = validateSketchParams({
        planeRef: { id: '1', type: 'face', faceId: 'face-1' },
      });
      expect(diagnostics.some(d => d.code === 'INVALID_PLANE_REF')).toBe(true);
    });

    it('should error on invalid rectangle entity', () => {
      const params: SketchParams = {
        planeRef: createWorldPlaneRef('xy'),
        entities: [{ ...createRectangleEntity([0, 0], 0, 1), width: 0 }],
        dimensions: [],
      };
      const diagnostics = validateSketchParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_ENTITY')).toBe(true);
    });
  });

  describe('createSketchFeature', () => {
    it('should create a sketch feature', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });

      expect(feature.type).toBe('sketch');
      expect(feature.id).toBeDefined();
      expect(feature.suppressed).toBe(false);
      expect(feature.refsIn).toEqual([]);
      expect(feature.refsOut).toContain(feature.id);
    });

    it('should use provided name', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] }, 'My Sketch');
      expect(feature.name).toBe('My Sketch');
    });

    it('should add dependency for face-based sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      planeRef.type = 'face';
      planeRef.faceId = 'face-1';
      planeRef.bodyId = 'body-1';

      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });
      expect(feature.refsIn).toContain('body-1');
    });

    it('should store entities in parameters', () => {
      const planeRef = createWorldPlaneRef('xy');
      const rect = createRectangleEntity([0, 0], 1, 1);
      const feature = createSketchFeature({ planeRef, entities: [rect], dimensions: [] });

      const params = feature.parameters as unknown as SketchParams;
      expect(params.entities).toHaveLength(1);
      expect(params.entities[0]?.id).toBe(rect.id);
    });
  });

  describe('rebuildSketch', () => {
    it('should return empty bodies array for valid sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });
      const context = createRebuildContext();

      const result = rebuildSketch(feature, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.bodies).toEqual([]);
      }
    });

    it('should return error for invalid params', () => {
      const feature: FeatureRecord = {
        id: '1',
        type: 'sketch',
        name: 'Test',
        parameters: {
          // planeRef with invalid world plane type
          planeRef: { id: '1', type: 'world' }, // missing worldPlane
          entities: [],
          dimensions: [],
        },
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };
      const context = createRebuildContext();

      const result = rebuildSketch(feature, context);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe('addEntityToSketchFeature', () => {
    it('should add entity to sketch feature', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });
      const rect = createRectangleEntity([0, 0], 1, 1);

      const updated = addEntityToSketchFeature(feature, rect);
      const params = updated.parameters as unknown as SketchParams;
      expect(params.entities).toHaveLength(1);
    });

    it('should not modify non-sketch feature', () => {
      const feature: FeatureRecord = {
        id: '1',
        type: 'box',
        name: 'Test',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };
      const rect = createRectangleEntity([0, 0], 1, 1);

      const updated = addEntityToSketchFeature(feature, rect);
      expect(updated).toBe(feature);
    });
  });

  describe('createDefaultRectSketch', () => {
    it('should create sketch with default rectangle', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createDefaultRectSketch(planeRef, 2, 3);

      expect(feature.type).toBe('sketch');
      const params = feature.parameters as unknown as SketchParams;
      expect(params.entities).toHaveLength(1);

      const rect = params.entities[0];
      expect(rect?.type).toBe('rectangle');
      if (rect?.type === 'rectangle') {
        expect(rect.width).toBe(2);
        expect(rect.height).toBe(3);
      }
    });
  });
});
