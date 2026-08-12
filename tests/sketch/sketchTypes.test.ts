/**
 * Tests for SketchTypes.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorldPlaneRef,
  createFacePlaneRef,
  createRectangleEntity,
  createSketchDimension,
  createSketch,
  addEntityToSketch,
  getRectangleCorners,
  validateRectangle,
  getRectangles,
  serializeSketch,
  deserializeSketch,
} from '../../src/sketch';

describe('SketchTypes', () => {
  describe('createWorldPlaneRef', () => {
    it('should create a world XY plane reference', () => {
      const ref = createWorldPlaneRef('xy', 0);
      expect(ref.type).toBe('world');
      expect(ref.worldPlane).toBe('xy');
      expect(ref.offset).toBe(0);
      expect(ref.id).toBeDefined();
    });

    it('should create a world XZ plane reference with offset', () => {
      const ref = createWorldPlaneRef('xz', 5);
      expect(ref.type).toBe('world');
      expect(ref.worldPlane).toBe('xz');
      expect(ref.offset).toBe(5);
    });

    it('should create a world YZ plane reference', () => {
      const ref = createWorldPlaneRef('yz');
      expect(ref.type).toBe('world');
      expect(ref.worldPlane).toBe('yz');
      expect(ref.offset).toBe(0);
    });
  });

  describe('createFacePlaneRef', () => {
    it('should create a face plane reference', () => {
      const ref = createFacePlaneRef('face-1', 'body-1', 'feature-1');
      expect(ref.type).toBe('face');
      expect(ref.faceId).toBe('face-1');
      expect(ref.bodyId).toBe('body-1');
      expect(ref.featureId).toBe('feature-1');
      expect(ref.id).toBeDefined();
    });

    it('keeps legacy body-only face references readable', () => {
      const ref = createFacePlaneRef('face-1', 'body-1');
      expect(ref.featureId).toBeUndefined();
    });
  });

  describe('createRectangleEntity', () => {
    it('should create a rectangle entity', () => {
      const rect = createRectangleEntity([0, 0], 2, 3);
      expect(rect.type).toBe('rectangle');
      expect(rect.origin).toEqual([0, 0]);
      expect(rect.width).toBe(2);
      expect(rect.height).toBe(3);
      expect(rect.rotation).toBe(0);
      expect(rect.id).toBeDefined();
    });

    it('should create a rotated rectangle', () => {
      const rect = createRectangleEntity([1, 1], 2, 2, Math.PI / 4);
      expect(rect.rotation).toBe(Math.PI / 4);
    });

    it('should use provided ID', () => {
      const rect = createRectangleEntity([0, 0], 1, 1, 0, 'custom-id');
      expect(rect.id).toBe('custom-id');
    });
  });

  describe('createSketch', () => {
    it('should create an empty sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef, 'Test Sketch');
      expect(sketch.name).toBe('Test Sketch');
      expect(sketch.planeRef).toBe(planeRef);
      expect(sketch.entities).toEqual([]);
      expect(sketch.dimensions).toEqual([]);
      expect(sketch.id).toBeDefined();
    });

    it('should use default name', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      expect(sketch.name).toBe('Sketch');
    });
  });

  describe('addEntityToSketch', () => {
    it('should add entity to sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const rect = createRectangleEntity([0, 0], 1, 1);
      const updated = addEntityToSketch(sketch, rect);
      expect(updated.entities).toHaveLength(1);
      expect(updated.entities[0]).toBe(rect);
    });

    it('should not modify original sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const rect = createRectangleEntity([0, 0], 1, 1);
      addEntityToSketch(sketch, rect);
      expect(sketch.entities).toHaveLength(0);
    });
  });

  describe('createSketchDimension', () => {
    it('should create a width dimension', () => {
      const rect = createRectangleEntity([0, 0], 1, 1);
      const dim = createSketchDimension('width', rect.id, 2);
      expect(dim.type).toBe('width');
      expect(dim.entityId).toBe(rect.id);
      expect(dim.value).toBe(2);
      expect(dim.id).toBeDefined();
    });

    it('should create dimension with name', () => {
      const dim = createSketchDimension('height', 'entity-1', 3, 'Board Height');
      expect(dim.name).toBe('Board Height');
    });

    it('should create dimension without name', () => {
      const dim = createSketchDimension('distance', 'entity-1', 5);
      expect(dim.name).toBeUndefined();
    });
  });

  describe('getRectangleCorners', () => {
    it('should return four corners in CCW order', () => {
      const rect = createRectangleEntity([0, 0], 2, 3, 0);
      const corners = getRectangleCorners(rect);
      expect(corners).toHaveLength(4);
      expect(corners[0]).toEqual([0, 0]);
      expect(corners[1]).toEqual([2, 0]);
      expect(corners[2]).toEqual([2, 3]);
      expect(corners[3]).toEqual([0, 3]);
    });

    it('should handle offset rectangle', () => {
      const rect = createRectangleEntity([1, 1], 2, 2, 0);
      const corners = getRectangleCorners(rect);
      expect(corners[0]).toEqual([1, 1]);
      expect(corners[2]).toEqual([3, 3]);
    });
  });

  describe('validateRectangle', () => {
    it('should return empty array for valid rectangle', () => {
      const rect = createRectangleEntity([0, 0], 1, 1);
      const errors = validateRectangle(rect);
      expect(errors).toHaveLength(0);
    });

    it('should error on zero width', () => {
      const rect = createRectangleEntity([0, 0], 0, 1);
      const errors = validateRectangle(rect);
      expect(errors).toContain('Width must be greater than 0');
    });

    it('should error on negative width', () => {
      const rect = createRectangleEntity([0, 0], -1, 1);
      const errors = validateRectangle(rect);
      expect(errors).toContain('Width must be greater than 0');
    });

    it('should error on zero height', () => {
      const rect = createRectangleEntity([0, 0], 1, 0);
      const errors = validateRectangle(rect);
      expect(errors).toContain('Height must be greater than 0');
    });
  });

  describe('getRectangles', () => {
    it('should return only rectangles from sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const rect1 = createRectangleEntity([0, 0], 1, 1);
      const rect2 = createRectangleEntity([2, 2], 1, 1);
      const updated = addEntityToSketch(addEntityToSketch(sketch, rect1), rect2);
      const rects = getRectangles(updated);
      expect(rects).toHaveLength(2);
    });

    it('should return empty array for empty sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const rects = getRectangles(sketch);
      expect(rects).toHaveLength(0);
    });
  });

  describe('serialize/deserialize', () => {
    it('should round-trip sketch through serialization', () => {
      const planeRef = createWorldPlaneRef('xy', 2);
      const sketch = createSketch(planeRef, 'Test');
      const rect = createRectangleEntity([0, 0], 1, 2);
      const withEntity = addEntityToSketch(sketch, rect);

      const serialized = serializeSketch(withEntity);
      const deserialized = deserializeSketch(serialized as unknown as Parameters<typeof deserializeSketch>[0]);

      expect(deserialized.name).toBe('Test');
      expect(deserialized.entities).toHaveLength(1);
      expect(deserialized.planeRef.worldPlane).toBe('xy');
      expect(deserialized.planeRef.offset).toBe(2);
    });

    it('round-trips face ownership', () => {
      const sketch = createSketch(
        createFacePlaneRef('face-1', 'body-1', 'feature-1'),
        'Face sketch'
      );

      const deserialized = deserializeSketch(
        serializeSketch(sketch) as Parameters<typeof deserializeSketch>[0]
      );

      expect(deserialized.planeRef).toMatchObject({
        type: 'face',
        faceId: 'face-1',
        bodyId: 'body-1',
        featureId: 'feature-1',
      });
    });
  });
});
