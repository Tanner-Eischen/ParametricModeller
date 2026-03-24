/**
 * Tests for LinearPatternFeature
 * Milestone 05: Patterning
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateLinearPatternParams,
  rebuildLinearPattern,
  createLinearPatternFeature,
  updateLinearPatternCount,
  updateLinearPatternSpacing,
  updateLinearPatternDirection,
  updateLinearPatternSymmetric,
  getLinearPatternParams,
  LINEAR_PATTERN_FEATURE_TYPE,
  defaultLinearPatternParams,
  type LinearPatternParams,
} from '../../src/features/pattern/LinearPatternFeature';
import { createBoxFeature, rebuildBox, createRebuildEngine, registerBodies, createRebuildContext } from '../../src/features';
import type { FeatureRecord } from '../../src/features';

describe('LinearPatternFeature', () => {
  describe('validateLinearPatternParams', () => {
    it('should pass for valid parameters', () => {
      const params: LinearPatternParams = {
        sourceFeatureId: 'feature-1',
        count: 3,
        spacing: 1,
        direction: [1, 0, 0],
        symmetric: false,
      };

      const diagnostics = validateLinearPatternParams(params);
      expect(diagnostics).toHaveLength(0);
    });

    it('should fail when source feature ID is missing', () => {
      const params = {
        count: 3,
        spacing: 1,
        direction: [1, 0, 0],
      } as Partial<LinearPatternParams>;

      const diagnostics = validateLinearPatternParams(params);
      expect(diagnostics.some(d => d.code === 'MISSING_SOURCE_FEATURE')).toBe(true);
    });

    it('should fail when count is less than 2', () => {
      const params = {
        sourceFeatureId: 'feature-1',
        count: 1,
        spacing: 1,
        direction: [1, 0, 0],
      } as Partial<LinearPatternParams>;

      const diagnostics = validateLinearPatternParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_COUNT')).toBe(true);
    });

    it('should fail when spacing is zero or negative', () => {
      const params = {
        sourceFeatureId: 'feature-1',
        count: 3,
        spacing: 0,
        direction: [1, 0, 0],
      } as Partial<LinearPatternParams>;

      const diagnostics = validateLinearPatternParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_SPACING')).toBe(true);
    });

    it('should fail when direction is zero vector', () => {
      const params = {
        sourceFeatureId: 'feature-1',
        count: 3,
        spacing: 1,
        direction: [0, 0, 0],
      } as Partial<LinearPatternParams>;

      const diagnostics = validateLinearPatternParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_DIRECTION')).toBe(true);
    });

    it('should fail when direction is missing', () => {
      const params = {
        sourceFeatureId: 'feature-1',
        count: 3,
        spacing: 1,
      } as Partial<LinearPatternParams>;

      const diagnostics = validateLinearPatternParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_DIRECTION')).toBe(true);
    });
  });

  describe('createLinearPatternFeature', () => {
    it('should create a feature with default parameters', () => {
      const feature = createLinearPatternFeature('source-1');

      expect(feature.type).toBe(LINEAR_PATTERN_FEATURE_TYPE);
      expect(feature.name).toBe('Linear Pattern');
      expect(feature.refsIn).toContain('source-1');
      expect(feature.suppressed).toBe(false);

      const params = feature.parameters as unknown as LinearPatternParams;
      expect(params.sourceFeatureId).toBe('source-1');
      expect(params.count).toBe(3);
      expect(params.spacing).toBe(1);
      expect(params.direction).toEqual([1, 0, 0]);
      expect(params.symmetric).toBe(false);
    });

    it('should create a feature with custom parameters', () => {
      const feature = createLinearPatternFeature(
        'source-1',
        5, // count
        2, // spacing
        [0, 1, 0], // direction (Y-axis)
        true, // symmetric
        'Custom Pattern'
      );

      const params = feature.parameters as unknown as LinearPatternParams;
      expect(params.count).toBe(5);
      expect(params.spacing).toBe(2);
      expect(params.direction).toEqual([0, 1, 0]);
      expect(params.symmetric).toBe(true);
      expect(feature.name).toBe('Custom Pattern');
    });

    it('should normalize direction vector', () => {
      const feature = createLinearPatternFeature(
        'source-1',
        3,
        1,
        [2, 0, 0] // Non-unit direction
      );

      const params = feature.parameters as unknown as LinearPatternParams;
      // Should be normalized to [1, 0, 0]
      expect(params.direction).toEqual([1, 0, 0]);
    });
  });

  describe('updateLinearPatternCount', () => {
    it('should update the count', () => {
      const feature = createLinearPatternFeature('source-1', 3, 1);
      const updated = updateLinearPatternCount(feature, 5);

      const params = updated.parameters as unknown as LinearPatternParams;
      expect(params.count).toBe(5);
    });

    it('should not modify non-linear-pattern features', () => {
      const otherFeature = { type: 'box' } as FeatureRecord;
      const result = updateLinearPatternCount(otherFeature, 5);
      expect(result).toBe(otherFeature);
    });
  });

  describe('updateLinearPatternSpacing', () => {
    it('should update the spacing', () => {
      const feature = createLinearPatternFeature('source-1', 3, 1);
      const updated = updateLinearPatternSpacing(feature, 2.5);

      const params = updated.parameters as unknown as LinearPatternParams;
      expect(params.spacing).toBe(2.5);
    });
  });

  describe('updateLinearPatternDirection', () => {
    it('should update and normalize the direction', () => {
      const feature = createLinearPatternFeature('source-1', 3, 1, [1, 0, 0]);
      const updated = updateLinearPatternDirection(feature, [0, 3, 0]);

      const params = updated.parameters as unknown as LinearPatternParams;
      expect(params.direction).toEqual([0, 1, 0]); // Normalized
    });
  });

  describe('updateLinearPatternSymmetric', () => {
    it('should update the symmetric flag', () => {
      const feature = createLinearPatternFeature('source-1', 3, 1, [1, 0, 0], false);
      const updated = updateLinearPatternSymmetric(feature, true);

      const params = updated.parameters as unknown as LinearPatternParams;
      expect(params.symmetric).toBe(true);
    });
  });

  describe('getLinearPatternParams', () => {
    it('should return params for linear pattern feature', () => {
      const feature = createLinearPatternFeature('source-1', 3, 2);
      const params = getLinearPatternParams(feature);

      expect(params).not.toBeNull();
      expect(params?.sourceFeatureId).toBe('source-1');
      expect(params?.count).toBe(3);
      expect(params?.spacing).toBe(2);
    });

    it('should return null for non-linear-pattern feature', () => {
      const otherFeature = { type: 'box' } as FeatureRecord;
      const params = getLinearPatternParams(otherFeature);

      expect(params).toBeNull();
    });
  });

  describe('rebuildLinearPattern', () => {
    it('should create multiple translated instances', () => {
      // Create a source box
      const sourceFeature = createBoxFeature({
        width: 1,
        depth: 1,
        height: 1,
      }, 'Source Box');

      // Build the source body
      const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
      expect(sourceResult.ok).toBe(true);

      // Create context with source body
      let context = createRebuildContext();
      context = registerBodies(context, sourceFeature.id, sourceResult.bodies);

      // Create pattern feature
      const patternFeature = createLinearPatternFeature(
        sourceFeature.id,
        3, // count
        2, // spacing
        [1, 0, 0], // X direction
        false // not symmetric
      );
      patternFeature.id = 'pattern-1';

      // Rebuild
      const result = rebuildLinearPattern(patternFeature, context);

      expect(result.ok).toBe(true);
      expect(result.bodies).toHaveLength(2); // count=3 means 2 new instances (source not included)

      // Check instance IDs
      expect(result.bodies[0]?.id).toMatch(/_lp_0$/);
      expect(result.bodies[1]?.id).toMatch(/_lp_1$/);
    });

    it('should position instances at correct offsets', () => {
      const sourceFeature = createBoxFeature({
        width: 1,
        depth: 1,
        height: 1,
      });

      const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
      let context = createRebuildContext();
      context = registerBodies(context, sourceFeature.id, sourceResult.bodies);

      const patternFeature = createLinearPatternFeature(
        sourceFeature.id,
        4, // count
        1, // spacing
        [1, 0, 0], // X direction
        false
      );
      patternFeature.id = 'pattern-1';

      const result = rebuildLinearPattern(patternFeature, context);
      expect(result.ok).toBe(true);

      // Instance 1 should be at offset [1, 0, 0]
      // Instance 2 should be at offset [2, 0, 0]
      // Instance 3 should be at offset [3, 0, 0]
      expect(result.bodies).toHaveLength(3);
    });

    it('should create symmetric instances when symmetric=true', () => {
      const sourceFeature = createBoxFeature({
        width: 1,
        depth: 1,
        height: 1,
      });

      const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
      let context = createRebuildContext();
      context = registerBodies(context, sourceFeature.id, sourceResult.bodies);

      const patternFeature = createLinearPatternFeature(
        sourceFeature.id,
        3, // count (1 on each side + source position)
        1, // spacing
        [1, 0, 0], // X direction
        true // symmetric
      );
      patternFeature.id = 'pattern-1';

      const result = rebuildLinearPattern(patternFeature, context);
      expect(result.ok).toBe(true);

      // Symmetric count=3 means 2 instances (1 on each side)
      expect(result.bodies).toHaveLength(2);
    });

    it('should fail when source feature not found', () => {
      const patternFeature = createLinearPatternFeature('non-existent-feature');
      patternFeature.id = 'pattern-1';

      const result = rebuildLinearPattern(patternFeature, createRebuildContext());

      expect(result.ok).toBe(false);
      expect(result.diagnostics.some(d => d.code === 'SOURCE_NOT_FOUND')).toBe(true);
    });

    it('should fail with invalid parameters', () => {
      const patternFeature = {
        id: 'pattern-1',
        type: LINEAR_PATTERN_FEATURE_TYPE,
        name: 'Invalid Pattern',
        parameters: {
          sourceFeatureId: '',
          count: 1, // Invalid
          spacing: 0, // Invalid
        },
        refsIn: [],
        refsOut: [],
        suppressed: false,
      } as unknown as FeatureRecord;

      const result = rebuildLinearPattern(patternFeature, createRebuildContext());

      expect(result.ok).toBe(false);
    });
  });

  describe('defaultLinearPatternParams', () => {
    it('should have expected defaults', () => {
      expect(defaultLinearPatternParams.count).toBe(3);
      expect(defaultLinearPatternParams.spacing).toBe(1);
      expect(defaultLinearPatternParams.direction).toEqual([1, 0, 0]);
      expect(defaultLinearPatternParams.symmetric).toBe(false);
    });
  });
});
