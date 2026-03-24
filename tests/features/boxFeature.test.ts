import { describe, it, expect } from 'vitest';
import {
  BOX_FEATURE_TYPE,
  defaultBoxParams,
  validateBoxParams,
  createBoxBody,
  createBoxFeature,
  rebuildBox,
} from '../../src/features/primitives';
import { createFeatureRecord } from '../../src/features';
import { createRebuildContext } from '../../src/features/RebuildContext';

describe('BoxFeature', () => {
  describe('BOX_FEATURE_TYPE', () => {
    it('should be "box"', () => {
      expect(BOX_FEATURE_TYPE).toBe('box');
    });
  });

  describe('defaultBoxParams', () => {
    it('should have default values', () => {
      expect(defaultBoxParams.width).toBe(1);
      expect(defaultBoxParams.depth).toBe(1);
      expect(defaultBoxParams.height).toBe(1);
      expect(defaultBoxParams.anchorMode).toBe('corner');
      expect(defaultBoxParams.origin).toEqual([0, 0, 0]);
    });
  });

  describe('validateBoxParams', () => {
    it('should pass valid parameters', () => {
      const diagnostics = validateBoxParams({
        width: 1,
        depth: 2,
        height: 3,
      });

      expect(diagnostics).toHaveLength(0);
    });

    it('should fail for zero width', () => {
      const diagnostics = validateBoxParams({ width: 0 });

      expect(diagnostics.some((d) => d.code === 'INVALID_DIMENSION')).toBe(true);
    });

    it('should fail for negative dimensions', () => {
      const diagnostics = validateBoxParams({
        width: -1,
        depth: -2,
        height: -3,
      });

      // All dimensions should fail with INVALID_DIMENSION code
      expect(diagnostics.length).toBe(3);
      expect(diagnostics.every((d) => d.code === 'INVALID_DIMENSION')).toBe(true);
    });
  });

  describe('createBoxBody', () => {
    it('should create a box with correct topology', () => {
      const body = createBoxBody({
        width: 2,
        depth: 3,
        height: 4,
        anchorMode: 'corner',
        origin: [0, 0, 0],
      });

      // Check vertex count (8 corners)
      expect(body.vertices.size).toBe(8);

      // Check edge count (12 edges)
      expect(body.edges.size).toBe(12);

      // Check face count (6 faces)
      expect(body.faces.size).toBe(6);

      // Check plane count (6 planes)
      expect(body.planes.size).toBe(6);
    });

    it('should have deterministic topology IDs', () => {
      const body = createBoxBody(defaultBoxParams);

      // Check face names
      expect(body.faces.has('+X')).toBe(true);
      expect(body.faces.has('-X')).toBe(true);
      expect(body.faces.has('+Y')).toBe(true);
      expect(body.faces.has('-Y')).toBe(true);
      expect(body.faces.has('+Z')).toBe(true);
      expect(body.faces.has('-Z')).toBe(true);
    });

    it('should position vertices correctly for corner anchor', () => {
      const body = createBoxBody({
        width: 2,
        depth: 3,
        height: 4,
        anchorMode: 'corner',
        origin: [0, 0, 0],
      });

      const bbox = { min: [Infinity, Infinity, Infinity] as [number, number, number], max: [-Infinity, -Infinity, -Infinity] as [number, number, number] };

      for (const vertex of body.vertices.values()) {
        bbox.min[0] = Math.min(bbox.min[0], vertex.position[0]);
        bbox.min[1] = Math.min(bbox.min[1], vertex.position[1]);
        bbox.min[2] = Math.min(bbox.min[2], vertex.position[2]);
        bbox.max[0] = Math.max(bbox.max[0], vertex.position[0]);
        bbox.max[1] = Math.max(bbox.max[1], vertex.position[1]);
        bbox.max[2] = Math.max(bbox.max[2], vertex.position[2]);
      }

      expect(bbox.min).toEqual([0, 0, 0]);
      expect(bbox.max).toEqual([2, 3, 4]);
    });

    it('should position vertices correctly for center anchor', () => {
      const body = createBoxBody({
        width: 2,
        depth: 2,
        height: 2,
        anchorMode: 'center',
        origin: [0, 0, 0],
      });

      const bbox = { min: [Infinity, Infinity, Infinity] as [number, number, number], max: [-Infinity, -Infinity, -Infinity] as [number, number, number] };

      for (const vertex of body.vertices.values()) {
        bbox.min[0] = Math.min(bbox.min[0], vertex.position[0]);
        bbox.min[1] = Math.min(bbox.min[1], vertex.position[1]);
        bbox.min[2] = Math.min(bbox.min[2], vertex.position[2]);
        bbox.max[0] = Math.max(bbox.max[0], vertex.position[0]);
        bbox.max[1] = Math.max(bbox.max[1], vertex.position[1]);
        bbox.max[2] = Math.max(bbox.max[2], vertex.position[2]);
      }

      expect(bbox.min).toEqual([-1, -1, -1]);
      expect(bbox.max).toEqual([1, 1, 1]);
    });
  });

  describe('createBoxFeature', () => {
    it('should create a box feature record', () => {
      const feature = createBoxFeature({ width: 2, depth: 3, height: 4 });

      expect(feature.type).toBe('box');
      expect(feature.name).toBe('Box');
      expect(feature.parameters.width).toBe(2);
      expect(feature.parameters.depth).toBe(3);
      expect(feature.parameters.height).toBe(4);
    });

    it('should merge with default parameters', () => {
      const feature = createBoxFeature({ width: 5 });

      expect(feature.parameters.width).toBe(5);
      expect(feature.parameters.depth).toBe(1);
      expect(feature.parameters.height).toBe(1);
    });
  });

  describe('rebuildBox', () => {
    it('should rebuild a valid box', () => {
      const feature = createBoxFeature({ width: 2, depth: 2, height: 2 });
      const context = createRebuildContext();

      const result = rebuildBox(feature, context);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.bodies).toHaveLength(1);
        expect(result.bodies[0]?.vertices.size).toBe(8);
      }
    });

    it('should fail for invalid parameters', () => {
      const feature = createFeatureRecord('box', 'Invalid Box', {
        width: -1,
        depth: 1,
        height: 1,
      });
      const context = createRebuildContext();

      const result = rebuildBox(feature, context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Invalid box parameters');
      }
    });
  });
});
