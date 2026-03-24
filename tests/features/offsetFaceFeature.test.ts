import { describe, it, expect, beforeEach } from 'vitest';
import {
  createOffsetFaceFeature,
  validateOffsetFaceParams,
  rebuildOffsetFace,
  updateOffsetFaceDistance,
  getOffsetFaceParams,
  createFaceRef,
  OFFSET_FACE_FEATURE_TYPE,
  defaultOffsetFaceParams,
  type OffsetFaceParams,
} from '../../src/features/offsetFace';
import { createRebuildContext, registerBodies, type RebuildContext } from '../../src/features/RebuildContext';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';

describe('OffsetFaceFeature', () => {
  let validFaceRef: ReturnType<typeof createFaceRef>;

  beforeEach(() => {
    validFaceRef = createFaceRef('+X', 'body_1', 'feature_1');
  });

  describe('createOffsetFaceFeature', () => {
    it('should create a feature with default values', () => {
      const feature = createOffsetFaceFeature(validFaceRef, 1);

      expect(feature.type).toBe(OFFSET_FACE_FEATURE_TYPE);
      expect(feature.name).toBe('Push/Pull');
      expect(feature.suppressed).toBe(false);
      expect(feature.refsIn).toContain('feature_1');
    });

    it('should create a feature with custom name', () => {
      const feature = createOffsetFaceFeature(validFaceRef, 1, 'Custom Offset');

      expect(feature.name).toBe('Custom Offset');
    });

    it('should store face reference in parameters', () => {
      const feature = createOffsetFaceFeature(validFaceRef, 2.5);
      const params = getOffsetFaceParams(feature);

      expect(params).not.toBeNull();
      expect(params?.faceRef.faceId).toBe('+X');
      expect(params?.faceRef.bodyId).toBe('body_1');
      expect(params?.distance).toBe(2.5);
      expect(params?.mode).toBe('addMaterial');
    });

    it('should generate unique IDs', () => {
      const feature1 = createOffsetFaceFeature(validFaceRef, 1);
      const feature2 = createOffsetFaceFeature(validFaceRef, 1);

      expect(feature1.id).not.toBe(feature2.id);
    });
  });

  describe('validateOffsetFaceParams', () => {
    it('should pass for valid parameters', () => {
      const params: OffsetFaceParams = {
        faceRef: validFaceRef,
        distance: 1,
        mode: 'addMaterial',
      };

      const diagnostics = validateOffsetFaceParams(params);
      expect(diagnostics).toHaveLength(0);
    });

    it('should fail for missing faceRef', () => {
      const params = { distance: 1 } as Partial<OffsetFaceParams>;
      const diagnostics = validateOffsetFaceParams(params);

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some(d => d.code === 'MISSING_FACE_REF')).toBe(true);
    });

    it('should fail for missing faceId', () => {
      const params: Partial<OffsetFaceParams> = {
        faceRef: { faceId: '', bodyId: 'body', featureId: 'feature' },
        distance: 1,
      };
      const diagnostics = validateOffsetFaceParams(params);

      expect(diagnostics.some(d => d.code === 'MISSING_FACE_ID')).toBe(true);
    });

    it('should fail for missing bodyId', () => {
      const params: Partial<OffsetFaceParams> = {
        faceRef: { faceId: 'face', bodyId: '', featureId: 'feature' },
        distance: 1,
      };
      const diagnostics = validateOffsetFaceParams(params);

      expect(diagnostics.some(d => d.code === 'MISSING_BODY_ID')).toBe(true);
    });

    it('should fail for invalid distance (<= 0)', () => {
      const params: Partial<OffsetFaceParams> = {
        faceRef: validFaceRef,
        distance: 0,
      };
      const diagnostics = validateOffsetFaceParams(params);

      expect(diagnostics.some(d => d.code === 'INVALID_DISTANCE')).toBe(true);
    });

    it('should fail for negative distance', () => {
      const params: Partial<OffsetFaceParams> = {
        faceRef: validFaceRef,
        distance: -1,
      };
      const diagnostics = validateOffsetFaceParams(params);

      expect(diagnostics.some(d => d.code === 'INVALID_DISTANCE')).toBe(true);
    });

    it('should fail for unsupported mode', () => {
      const params = {
        faceRef: validFaceRef,
        distance: 1,
        mode: 'removeMaterial',
      } as unknown as OffsetFaceParams;
      const diagnostics = validateOffsetFaceParams(params);

      expect(diagnostics.some(d => d.code === 'UNSUPPORTED_MODE')).toBe(true);
    });

    it('should fail for non-finite distance', () => {
      const params: Partial<OffsetFaceParams> = {
        faceRef: validFaceRef,
        distance: Infinity,
      };
      const diagnostics = validateOffsetFaceParams(params);

      expect(diagnostics.some(d => d.code === 'INVALID_DISTANCE')).toBe(true);
    });
  });

  describe('updateOffsetFaceDistance', () => {
    it('should update distance', () => {
      const feature = createOffsetFaceFeature(validFaceRef, 1);
      const updated = updateOffsetFaceDistance(feature, 2.5);
      const params = getOffsetFaceParams(updated);

      expect(params?.distance).toBe(2.5);
    });

    it('should preserve other parameters', () => {
      const feature = createOffsetFaceFeature(validFaceRef, 1);
      const updated = updateOffsetFaceDistance(feature, 3);
      const params = getOffsetFaceParams(updated);

      expect(params?.faceRef).toEqual(validFaceRef);
      expect(params?.mode).toBe('addMaterial');
    });

    it('should return same feature for non-offsetFace type', () => {
      const nonOffsetFeature = {
        id: 'test',
        type: 'other',
        name: 'Other',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };

      const updated = updateOffsetFaceDistance(nonOffsetFeature, 2);
      expect(updated).toBe(nonOffsetFeature);
    });
  });

  describe('getOffsetFaceParams', () => {
    it('should return params for offsetFace feature', () => {
      const feature = createOffsetFaceFeature(validFaceRef, 1.5);
      const params = getOffsetFaceParams(feature);

      expect(params).not.toBeNull();
      expect(params?.distance).toBe(1.5);
    });

    it('should return null for non-offsetFace feature', () => {
      const otherFeature = {
        id: 'test',
        type: 'box',
        name: 'Box',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };

      const params = getOffsetFaceParams(otherFeature);
      expect(params).toBeNull();
    });
  });

  describe('createFaceRef', () => {
    it('should create face reference with all fields', () => {
      const ref = createFaceRef('face_1', 'body_1', 'feature_1');

      expect(ref.faceId).toBe('face_1');
      expect(ref.bodyId).toBe('body_1');
      expect(ref.featureId).toBe('feature_1');
    });
  });

  describe('defaultOffsetFaceParams', () => {
    it('should have default distance', () => {
      expect(defaultOffsetFaceParams.distance).toBe(0.5);
    });

    it('should have addMaterial mode', () => {
      expect(defaultOffsetFaceParams.mode).toBe('addMaterial');
    });
  });
});

describe('rebuildOffsetFace', () => {
  let context: RebuildContext;

  beforeEach(() => {
    context = createRebuildContext();
    // Create a box body and register it
    const boxBody = createBoxBody({
      width: 2,
      depth: 2,
      height: 2,
      anchorMode: 'center',
      origin: [0, 0, 0],
    });
    context = registerBodies(context, 'box_feature', [boxBody]);
  });

  it('should fail for invalid parameters', () => {
    const feature = {
      id: 'test',
      type: OFFSET_FACE_FEATURE_TYPE,
      name: 'Invalid',
      parameters: { distance: -1 }, // Invalid
      refsIn: [],
      refsOut: [],
      suppressed: false,
    };

    const result = rebuildOffsetFace(feature, context);
    expect(result.ok).toBe(false);
  });

  it('should fail for missing body', () => {
    const faceRef = createFaceRef('+X', 'nonexistent_body', 'box_feature');
    const feature = createOffsetFaceFeature(faceRef, 1);

    const result = rebuildOffsetFace(feature, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not found');
    }
  });

  it('should fail for missing face', () => {
    const body = createBoxBody({
      width: 2,
      depth: 2,
      height: 2,
      anchorMode: 'center',
      origin: [0, 0, 0],
    });
    context = registerBodies(context, 'box_feature_2', [body]);

    const faceRef = createFaceRef('nonexistent_face', body.id, 'box_feature_2');
    const feature = createOffsetFaceFeature(faceRef, 1);

    const result = rebuildOffsetFace(feature, context);
    expect(result.ok).toBe(false);
  });
});
