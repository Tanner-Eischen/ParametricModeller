import { describe, it, expect } from 'vitest';
import {
  MOVE_VERTEX_FEATURE_TYPE,
  createMoveVertexFeature,
  validateMoveVertexParams,
  defaultMoveVertexParams,
} from '../../src/features/vertex';
import type { VertexRef } from '../../src/geometry/SubObjectTypes';

describe('MoveVertex Feature', () => {
  describe('MOVE_VERTEX_FEATURE_TYPE', () => {
    it('should be "moveVertex"', () => {
      expect(MOVE_VERTEX_FEATURE_TYPE).toBe('moveVertex');
    });
  });

  describe('defaultMoveVertexParams', () => {
    it('should have default values', () => {
      expect(defaultMoveVertexParams.vertexRef).toEqual({
        featureId: '',
        bodyId: '',
        vertexId: '',
      });
      expect(defaultMoveVertexParams.translation).toEqual([0, 0, 0]);
      expect(defaultMoveVertexParams.constrainAxis).toBeUndefined();
      expect(defaultMoveVertexParams.constrainToPlane).toBeFalsy();
    });
  });

  describe('validateMoveVertexParams', () => {
    it('should return error for missing vertexRef', () => {
      const diagnostics = validateMoveVertexParams({});
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some(d => d.code === 'MISSING_VERTEX_REF')).toBe(true);
    });

    it('should return error for incomplete vertexRef', () => {
      const diagnostics = validateMoveVertexParams({
        vertexRef: { featureId: 'f1', bodyId: '', vertexId: '' },
      });
      expect(diagnostics.some(d => d.code === 'MISSING_BODY_ID')).toBe(true);
      expect(diagnostics.some(d => d.code === 'MISSING_VERTEX_ID')).toBe(true);
    });

    it('should return error for missing translation', () => {
      const diagnostics = validateMoveVertexParams({
        vertexRef: { featureId: 'f1', bodyId: 'b1', vertexId: 'v1' },
      });
      expect(diagnostics.some(d => d.code === 'MISSING_TRANSLATION')).toBe(true);
    });

    it('should return error for invalid translation array', () => {
      const diagnostics = validateMoveVertexParams({
        vertexRef: { featureId: 'f1', bodyId: 'b1', vertexId: 'v1' },
        translation: [1, 2] as unknown as [number, number, number],
      });
      expect(diagnostics.some(d => d.code === 'INVALID_TRANSLATION')).toBe(true);
    });

    it('should return error for non-finite translation values', () => {
      const diagnostics = validateMoveVertexParams({
        vertexRef: { featureId: 'f1', bodyId: 'b1', vertexId: 'v1' },
        translation: [1, Infinity, 0],
      });
      expect(diagnostics.some(d => d.code === 'INVALID_TRANSLATION')).toBe(true);
    });

    it('should return error for conflicting constraints', () => {
      const diagnostics = validateMoveVertexParams({
        vertexRef: { featureId: 'f1', bodyId: 'b1', vertexId: 'v1' },
        translation: [1, 0, 0],
        constrainToPlane: true,
        constrainAxis: 'x',
      });
      expect(diagnostics.some(d => d.code === 'INVALID_CONSTRAINT')).toBe(true);
    });

    it('should return error for invalid constraint axis', () => {
      const diagnostics = validateMoveVertexParams({
        vertexRef: { featureId: 'f1', bodyId: 'b1', vertexId: 'v1' },
        translation: [1, 0, 0],
        constrainAxis: 'w' as 'x' | 'y' | 'z',
      });
      expect(diagnostics.some(d => d.code === 'INVALID_CONSTRAINT_AXIS')).toBe(true);
    });

    it('should return empty array for valid params', () => {
      const diagnostics = validateMoveVertexParams({
        vertexRef: { featureId: 'f1', bodyId: 'b1', vertexId: 'v1' },
        translation: [1, 2, 3],
      });
      expect(diagnostics.length).toBe(0);
    });

    it('should accept valid constraint axis', () => {
      for (const axis of ['x', 'y', 'z'] as const) {
        const diagnostics = validateMoveVertexParams({
          vertexRef: { featureId: 'f1', bodyId: 'b1', vertexId: 'v1' },
          translation: [1, 0, 0],
          constrainAxis: axis,
        });
        expect(diagnostics.length).toBe(0);
      }
    });
  });

  describe('createMoveVertexFeature', () => {
    it('should create a feature with default values', () => {
      const feature = createMoveVertexFeature({});

      expect(feature.type).toBe(MOVE_VERTEX_FEATURE_TYPE);
      expect(feature.name).toBe('Move Vertex');
      expect(feature.refsIn).toEqual([]);
    });

    it('should create a feature with custom name', () => {
      const feature = createMoveVertexFeature({}, 'Custom Move');
      expect(feature.name).toBe('Custom Move');
    });

    it('should include featureId in refsIn', () => {
      const vertexRef: VertexRef = {
        featureId: 'source-feature',
        bodyId: 'body-1',
        vertexId: 'vertex-1',
      };

      const feature = createMoveVertexFeature({
        vertexRef,
        translation: [0.5, 0, 0],
      });

      expect(feature.refsIn).toContain('source-feature');
    });

    it('should store vertexRef in parameters', () => {
      const vertexRef: VertexRef = {
        featureId: 'feature-1',
        bodyId: 'body-1',
        vertexId: 'vertex-1',
      };

      const feature = createMoveVertexFeature({
        vertexRef,
        translation: [1, 0, 0],
      });

      expect(feature.parameters.vertexRef).toEqual(vertexRef);
      expect(feature.parameters.translation).toEqual([1, 0, 0]);
    });

    it('should store constraint axis in parameters', () => {
      const feature = createMoveVertexFeature({
        vertexRef: { featureId: 'f1', bodyId: 'b1', vertexId: 'v1' },
        translation: [1, 0, 0],
        constrainAxis: 'x',
      });

      expect(feature.parameters.constrainAxis).toBe('x');
    });
  });

  // Note: Rebuild tests require a more complex setup with actual body geometry.
  // The rebuild functionality is tested through integration tests and manual verification.
  // Unit tests for the geometry utilities (planarity checks, etc.) are in subObjectUtils.test.ts
});
