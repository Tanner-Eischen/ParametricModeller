/**
 * Tests for MirrorFeature
 * Milestone 05: Patterning
 */

import { describe, it, expect } from 'vitest';
import {
  validateMirrorParams,
  rebuildMirror,
  createMirrorFeature,
  updateMirrorPlaneRef,
  getMirrorParams,
  MIRROR_FEATURE_TYPE,
  defaultMirrorParams,
  type MirrorParams,
} from '../../src/features/pattern/MirrorFeature';
import { createBoxFeature, rebuildBox, createRebuildContext, registerBodies } from '../../src/features';
import { createWorldPlaneRef } from '../../src/sketch';
import type { FeatureRecord } from '../../src/features';

describe('MirrorFeature', () => {
  describe('validateMirrorParams', () => {
    it('should pass for valid world plane reference', () => {
      const params: MirrorParams = {
        sourceFeatureId: 'feature-1',
        planeRef: {
          type: 'world',
          worldPlane: 'yz',
          offset: 0,
        },
      };

      const diagnostics = validateMirrorParams(params);
      expect(diagnostics).toHaveLength(0);
    });

    it('should pass for valid face plane reference', () => {
      const params: MirrorParams = {
        sourceFeatureId: 'feature-1',
        planeRef: {
          type: 'face',
          faceId: 'face-1',
          bodyId: 'body-1',
        },
      };

      const diagnostics = validateMirrorParams(params);
      expect(diagnostics).toHaveLength(0);
    });

    it('should fail when source feature ID is missing', () => {
      const params = {
        planeRef: {
          type: 'world',
          worldPlane: 'yz',
          offset: 0,
        },
      } as Partial<MirrorParams>;

      const diagnostics = validateMirrorParams(params);
      expect(diagnostics.some(d => d.code === 'MISSING_SOURCE_FEATURE')).toBe(true);
    });

    it('should fail when plane reference is missing', () => {
      const params = {
        sourceFeatureId: 'feature-1',
      } as Partial<MirrorParams>;

      const diagnostics = validateMirrorParams(params);
      expect(diagnostics.some(d => d.code === 'MISSING_PLANE_REF')).toBe(true);
    });

    it('should fail when world plane type is missing', () => {
      const params = {
        sourceFeatureId: 'feature-1',
        planeRef: {
          type: 'world',
          offset: 0,
        },
      } as unknown as MirrorParams;

      const diagnostics = validateMirrorParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_PLANE_REF')).toBe(true);
    });

    it('should fail when face reference is incomplete', () => {
      const params = {
        sourceFeatureId: 'feature-1',
        planeRef: {
          type: 'face',
          faceId: 'face-1',
          // missing bodyId
        },
      } as unknown as MirrorParams;

      const diagnostics = validateMirrorParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_PLANE_REF')).toBe(true);
    });
  });

  describe('createMirrorFeature', () => {
    it('should create a mirror feature with world plane', () => {
      const planeRef = createWorldPlaneRef('yz', 0);
      const feature = createMirrorFeature('source-1', planeRef, 'Test Mirror');

      expect(feature.type).toBe(MIRROR_FEATURE_TYPE);
      expect(feature.name).toBe('Test Mirror');
      expect(feature.refsIn).toContain('source-1');
    });

    it('should generate unique IDs', () => {
      const planeRef = createWorldPlaneRef('yz', 0);
      const feature1 = createMirrorFeature('source-1', planeRef);
      const feature2 = createMirrorFeature('source-1', planeRef);

      expect(feature1.id).not.toBe(feature2.id);
    });
  });

  describe('updateMirrorPlaneRef', () => {
    it('should update the plane reference', () => {
      const planeRef1 = createWorldPlaneRef('yz', 0);
      const feature = createMirrorFeature('source-1', planeRef1);

      const planeRef2 = createWorldPlaneRef('xy', 5);
      const updated = updateMirrorPlaneRef(feature, planeRef2);

      const params = getMirrorParams(updated);
      expect(params?.planeRef.worldPlane).toBe('xy');
      expect(params?.planeRef.offset).toBe(5);
    });

    it('should not modify non-mirror features', () => {
      const feature = {
        id: 'test',
        type: 'box',
        name: 'Box',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      } as unknown as FeatureRecord;

      const planeRef = createWorldPlaneRef('yz', 0);
      const updated = updateMirrorPlaneRef(feature, planeRef);

      expect(updated).toBe(feature);
    });
  });

  describe('getMirrorParams', () => {
    it('should return params for mirror feature', () => {
      const planeRef = createWorldPlaneRef('yz', 0);
      const feature = createMirrorFeature('source-1', planeRef);

      const params = getMirrorParams(feature);
      expect(params).not.toBeNull();
      expect(params?.sourceFeatureId).toBe('source-1');
    });

    it('should return null for non-mirror feature', () => {
      const feature = {
        id: 'test',
        type: 'box',
        name: 'Box',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      } as unknown as FeatureRecord;

      const params = getMirrorParams(feature);
      expect(params).toBeNull();
    });
  });

  describe('rebuildMirror', () => {
    it('should create a mirrored instance of source body', () => {
      const sourceFeature = createBoxFeature({
        width: 2,
        depth: 2,
        height: 2,
      });

      const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
      expect(sourceResult.ok).toBe(true);

      let context = createRebuildContext();
      context = registerBodies(context, sourceFeature.id, sourceResult.bodies);

      const planeRef = createWorldPlaneRef('yz', 0);
      const mirrorFeature = createMirrorFeature(sourceFeature.id, planeRef);
      mirrorFeature.id = 'mirror-1';

      const result = rebuildMirror(mirrorFeature, context);
      expect(result.ok).toBe(true);
      expect(result.bodies).toHaveLength(1);

      // Mirrored body should have mirrored ID
      expect(result.bodies[0]?.id).toContain('_mirror');
    });

    it('should mirror across YZ plane (reflect X)', () => {
      const sourceFeature = createBoxFeature({
        width: 2,
        depth: 2,
        height: 2,
        origin: [1, 0, 0], // Offset in X so mirroring has visible effect
      });

      const sourceResult = rebuildBox(sourceFeature, createRebuildContext());

      let context = createRebuildContext();
      context = registerBodies(context, sourceFeature.id, sourceResult.bodies);

      const planeRef = createWorldPlaneRef('yz', 0);
      const mirrorFeature = createMirrorFeature(sourceFeature.id, planeRef);
      mirrorFeature.id = 'mirror-1';

      const result = rebuildMirror(mirrorFeature, context);
      expect(result.ok).toBe(true);

      // Verify vertices are mirrored
      const mirroredBody = result.bodies[0];
      if (mirroredBody) {
        const positions = Array.from(mirroredBody.vertices.values()).map(v => v.position[0]);
        // All X positions should be negative (mirrored from positive to negative)
        const allNegativeOrZero = positions.every(x => x <= 0.01);
        expect(allNegativeOrZero).toBe(true);
      }
    });

    it('should fail when source feature not found', () => {
      const planeRef = createWorldPlaneRef('yz', 0);
      const mirrorFeature = createMirrorFeature('non-existent-feature', planeRef);
      mirrorFeature.id = 'mirror-1';

      const result = rebuildMirror(mirrorFeature, createRebuildContext());

      expect(result.ok).toBe(false);
      expect(result.diagnostics.some(d => d.code === 'SOURCE_NOT_FOUND')).toBe(true);
    });

    it('should fail with invalid parameters', () => {
      const mirrorFeature = {
        id: 'mirror-1',
        type: MIRROR_FEATURE_TYPE,
        name: 'Invalid Mirror',
        parameters: {
          sourceFeatureId: '',
          planeRef: null,
        },
        refsIn: [],
        refsOut: [],
        suppressed: false,
      } as unknown as FeatureRecord;

      const result = rebuildMirror(mirrorFeature, createRebuildContext());

      expect(result.ok).toBe(false);
    });
  });

  describe('defaultMirrorParams', () => {
    it('should have expected defaults', () => {
      expect(defaultMirrorParams.planeRef.type).toBe('world');
      expect(defaultMirrorParams.planeRef.worldPlane).toBe('yz');
    });
  });
});
