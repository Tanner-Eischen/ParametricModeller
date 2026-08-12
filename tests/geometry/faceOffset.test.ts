import { describe, it, expect, beforeEach } from 'vitest';
import { validateOffsetFace, offsetFace } from '../../src/geometry/FaceOffset';
import { validateClosedManifoldBody } from '../../src/geometry/Validation';
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

    it('allows inward travel but rejects collapse and pass-through', () => {
      expect(validateOffsetFace(boxBody, '+X', -0.5).valid).toBe(true);
      expect(validateOffsetFace(boxBody, '+X', -1.998).valid).toBe(true);
      expect(validateOffsetFace(boxBody, '+X', -1.9995).valid).toBe(false);
      expect(validateOffsetFace(boxBody, '+X', -2).valid).toBe(false);
      expect(validateOffsetFace(boxBody, '+X', -3).valid).toBe(false);
    });

    it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid distance %s',
      (distance) => {
        expect(validateOffsetFace(boxBody, '+X', distance).valid).toBe(false);
      }
    );

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

    it.each([
      ['+X', 0], ['-X', 0], ['+Y', 1], ['-Y', 1], ['+Z', 2], ['-Z', 2],
    ] as const)('offsets %s in both signed directions', (faceId, _axis) => {
      for (const distance of [0.5, -0.5]) {
        const original = new Map(
          [...boxBody.vertices].map(([id, vertex]) => [id, [...vertex.position]])
        );
        const result = offsetFace(boxBody, faceId, distance);

        expect(result).not.toBeNull();
        expect(validateClosedManifoldBody(result!).ok).toBe(true);
        const face = boxBody.faces.get(faceId)!;
        const plane = boxBody.planes.get(face.planeId)!;
        const movedIds = new Set(
          face.boundaryEdgeIds.flatMap((edgeId) => boxBody.edges.get(edgeId)!.vertexIds)
        );
        for (const [id, vertex] of result!.vertices) {
          const before = original.get(id)!;
          for (const component of [0, 1, 2] as const) {
            const displacement = vertex.position[component] - before[component]!;
            expect(displacement).toBeCloseTo(
              movedIds.has(id) ? plane.normal[component] * distance : 0
            );
            expect(boxBody.vertices.get(id)?.position[component]).toBe(before[component]);
          }
        }
        expect(result!.planes.get(face.planeId)?.origin).toEqual(
          plane.origin.map((value, component) => value + plane.normal[component]! * distance)
        );
        expect([...result!.vertices.keys()]).toEqual([...boxBody.vertices.keys()]);
        expect([...result!.edges.keys()]).toEqual([...boxBody.edges.keys()]);
        expect([...result!.faces.keys()]).toEqual([...boxBody.faces.keys()]);
      }
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

    it('should reject zero distance', () => {
      const faceId = Array.from(boxBody.faces.keys())[0]!;
      // Zero distance should be handled - it offsets by 0
      const result = offsetFace(boxBody, faceId, 0);

      expect(result).toBeNull();
    });
  });
});
