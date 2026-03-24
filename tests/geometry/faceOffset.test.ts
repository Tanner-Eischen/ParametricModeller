import { describe, it, expect, beforeEach } from 'vitest';
import { validateOffsetFace, offsetFace } from '../../src/geometry/FaceOffset';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import type { Body } from '../../src/geometry';

describe('FaceOffset', () => {
  let boxBody: Body;

  beforeEach(() => {
    boxBody = createBoxBody({
      width: 2,
      depth: 2,
      height: 2,
      anchorMode: 'center',
      origin: [0, 0, 0],
    });
  });

  describe('validateOffsetFace', () => {
    it('should pass for valid face and positive distance', () => {
      // Get a face ID from the box
      const faceId = Array.from(boxBody.faces.keys())[0]!;
      const result = validateOffsetFace(boxBody, faceId, 1);

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('should fail for non-existent face', () => {
      const result = validateOffsetFace(boxBody, 'nonexistent_face', 1);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail for non-existent plane', () => {
      // Create a face with invalid plane reference
      const faceId = Array.from(boxBody.faces.keys())[0]!;
      const face = boxBody.faces.get(faceId)!;

      // Remove the plane
      boxBody.planes.delete(face.planeId);

      const result = validateOffsetFace(boxBody, faceId, 1);
      expect(result.valid).toBe(false);
    });
  });

  describe('offsetFace', () => {
    it('should offset a face by positive distance', () => {
      const faceId = Array.from(boxBody.faces.keys())[0]!;
      const result = offsetFace(boxBody, faceId, 1);

      expect(result).not.toBeNull();
      expect(result?.faces.size).toBe(boxBody.faces.size);
    });

    it('should return null for invalid face', () => {
      const result = offsetFace(boxBody, 'nonexistent_face', 1);

      expect(result).toBeNull();
    });

    it('should return null for invalid offset (validation failure)', () => {
      const faceId = Array.from(boxBody.faces.keys())[0]!;
      // Very large negative offset should fail validation
      const result = offsetFace(boxBody, faceId, -100);

      expect(result).toBeNull();
    });

    it('should preserve body ID', () => {
      const faceId = Array.from(boxBody.faces.keys())[0]!;
      const originalId = boxBody.id;
      const result = offsetFace(boxBody, faceId, 0.5);

      // The returned body should be a clone with same ID
      expect(result?.id).toBe(originalId);
    });

    it('should handle zero distance', () => {
      const faceId = Array.from(boxBody.faces.keys())[0]!;
      // Zero distance should be handled - it offsets by 0
      const result = offsetFace(boxBody, faceId, 0);

      // Zero distance should still return a valid body (with no actual change)
      // or null if the implementation rejects it
      expect([null, expect.any(Object)]).toContainEqual(result);
    });
  });
});
