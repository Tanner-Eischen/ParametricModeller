import { describe, it, expect } from 'vitest';
import {
  createFeatureRecord,
  updateFeatureParameters,
  setFeatureSuppressed,
  addOutputRef,
  isBaseFeature,
} from '../../src/features';

describe('FeatureRecord', () => {
  describe('createFeatureRecord', () => {
    it('should create a feature record with required fields', () => {
      const feature = createFeatureRecord('box', 'My Box', { width: 2 });

      expect(feature.type).toBe('box');
      expect(feature.name).toBe('My Box');
      expect(feature.parameters).toEqual({ width: 2 });
      expect(feature.id).toBeDefined();
      expect(feature.refsIn).toEqual([]);
      expect(feature.refsOut).toEqual([]);
      expect(feature.suppressed).toBe(false);
    });

    it('should create a feature with custom options', () => {
      const feature = createFeatureRecord('extrude', 'My Extrude', { distance: 10 }, {
        id: 'custom-id',
        refsIn: ['sketch-1'],
        suppressed: true,
      });

      expect(feature.id).toBe('custom-id');
      expect(feature.refsIn).toEqual(['sketch-1']);
      expect(feature.suppressed).toBe(true);
    });
  });

  describe('updateFeatureParameters', () => {
    it('should update parameters', () => {
      const feature = createFeatureRecord('box', 'Box', { width: 1, height: 1 });
      const updated = updateFeatureParameters(feature, { width: 2, height: 2 });

      expect(updated.parameters).toEqual({ width: 2, height: 2 });
      // Original should be unchanged (immutable)
      expect(feature.parameters).toEqual({ width: 1, height: 1 });
    });
  });

  describe('setFeatureSuppressed', () => {
    it('should set suppressed state', () => {
      const feature = createFeatureRecord('box', 'Box', {});
      const suppressed = setFeatureSuppressed(feature, true);
      const unsuppressed = setFeatureSuppressed(suppressed, false);

      expect(suppressed.suppressed).toBe(true);
      expect(unsuppressed.suppressed).toBe(false);
    });
  });

  describe('addOutputRef', () => {
    it('should add output reference', () => {
      const feature = createFeatureRecord('box', 'Box', {});
      const withRef = addOutputRef(feature, 'body-1');

      expect(withRef.refsOut).toContain('body-1');
    });

    it('should not duplicate output refs', () => {
      const feature = createFeatureRecord('box', 'Box', {});
      const withRef = addOutputRef(feature, 'body-1');
      const duplicate = addOutputRef(withRef, 'body-1');

      expect(duplicate.refsOut).toHaveLength(1);
    });
  });

  describe('isBaseFeature', () => {
    it('should return true for features with no dependencies', () => {
      const feature = createFeatureRecord('box', 'Box', {});
      expect(isBaseFeature(feature)).toBe(true);
    });

    it('should return false for features with dependencies', () => {
      const feature = createFeatureRecord('extrude', 'Extrude', {}, { refsIn: ['sketch-1'] });
      expect(isBaseFeature(feature)).toBe(false);
    });
  });
});
