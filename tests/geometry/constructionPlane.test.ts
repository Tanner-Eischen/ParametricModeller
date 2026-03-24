/**
 * Tests for ConstructionPlane.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorldConstructionPlane,
  getDefaultSketchPlane,
  getStandardWorldPlanes,
  sketchToWorld,
  worldToSketch,
  sketchPointsToWorld,
  worldPointsToSketch,
  offsetConstructionPlane,
  flipConstructionPlane,
  planesAreEquivalent,
} from '../../src/geometry';

describe('ConstructionPlane', () => {
  describe('createWorldConstructionPlane', () => {
    it('should create XY construction plane', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      expect(plane.id).toBeDefined();
      expect(plane.ref.type).toBe('world');
      expect(plane.ref.worldPlane).toBe('xy');
      expect(plane.normal).toEqual([0, 0, 1]);
      expect(plane.uAxis).toEqual([1, 0, 0]);
      expect(plane.vAxis).toEqual([0, 1, 0]);
    });

    it('should create XZ construction plane', () => {
      const plane = createWorldConstructionPlane('xz', 0);
      expect(plane.normal).toEqual([0, 1, 0]);
    });

    it('should create YZ construction plane', () => {
      const plane = createWorldConstructionPlane('yz', 0);
      expect(plane.normal).toEqual([1, 0, 0]);
    });

    it('should create plane with offset', () => {
      const plane = createWorldConstructionPlane('xy', 5);
      expect(plane.origin).toEqual([0, 0, 5]);
    });

    it('should use provided ID', () => {
      const plane = createWorldConstructionPlane('xy', 0, 'my-plane');
      expect(plane.id).toBe('my-plane');
    });
  });

  describe('getDefaultSketchPlane', () => {
    it('should return XY plane at z=0', () => {
      const plane = getDefaultSketchPlane();
      expect(plane.ref.worldPlane).toBe('xy');
      expect(plane.origin).toEqual([0, 0, 0]);
    });
  });

  describe('getStandardWorldPlanes', () => {
    it('should return three world planes', () => {
      const planes = getStandardWorldPlanes();
      expect(planes).toHaveLength(3);
      expect(planes[0]?.ref.worldPlane).toBe('xy');
      expect(planes[1]?.ref.worldPlane).toBe('xz');
      expect(planes[2]?.ref.worldPlane).toBe('yz');
    });
  });

  describe('sketchToWorld', () => {
    it('should convert 2D point to 3D on XY plane', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const point3D = sketchToWorld(plane, [2, 3]);
      expect(point3D).toEqual([2, 3, 0]);
    });

    it('should convert 2D point to 3D on XY plane with offset', () => {
      const plane = createWorldConstructionPlane('xy', 5);
      const point3D = sketchToWorld(plane, [2, 3]);
      expect(point3D).toEqual([2, 3, 5]);
    });

    it('should convert 2D point to 3D on XZ plane', () => {
      const plane = createWorldConstructionPlane('xz', 0);
      const point3D = sketchToWorld(plane, [2, 3]);
      // On XZ plane: u is X, v is Z, so [2, 3] becomes [2, 0, 3]
      expect(point3D[0]).toBeCloseTo(2, 6);
      expect(point3D[1]).toBeCloseTo(0, 6);
      expect(point3D[2]).toBeCloseTo(3, 6);
    });
  });

  describe('worldToSketch', () => {
    it('should convert 3D point to 2D on XY plane', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const point2D = worldToSketch(plane, [2, 3, 0]);
      expect(point2D).toEqual([2, 3]);
    });

    it('should project 3D point onto plane', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      // Point above the plane
      const point2D = worldToSketch(plane, [2, 3, 10]);
      // Should project to [2, 3]
      expect(point2D).toEqual([2, 3]);
    });

    it('should work with offset plane', () => {
      const plane = createWorldConstructionPlane('xy', 5);
      const point2D = worldToSketch(plane, [2, 3, 5]);
      expect(point2D).toEqual([2, 3]);
    });
  });

  describe('sketchPointsToWorld', () => {
    it('should convert multiple points', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const points2D = [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][];
      const points3D = sketchPointsToWorld(plane, points2D);

      expect(points3D).toHaveLength(4);
      expect(points3D[0]).toEqual([0, 0, 0]);
      expect(points3D[1]).toEqual([1, 0, 0]);
      expect(points3D[2]).toEqual([1, 1, 0]);
      expect(points3D[3]).toEqual([0, 1, 0]);
    });
  });

  describe('worldPointsToSketch', () => {
    it('should convert multiple 3D points to 2D', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const points3D: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
      const points2D = worldPointsToSketch(plane, points3D);

      expect(points2D).toHaveLength(4);
      expect(points2D[0]).toEqual([0, 0]);
      expect(points2D[1]).toEqual([1, 0]);
    });
  });

  describe('offsetConstructionPlane', () => {
    it('should offset plane along normal', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const offset = offsetConstructionPlane(plane, 5);
      expect(offset.origin).toEqual([0, 0, 5]);
    });

    it('should preserve other properties', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const offset = offsetConstructionPlane(plane, 5);
      expect(offset.normal).toEqual(plane.normal);
      expect(offset.id).toBe(plane.id);
    });
  });

  describe('flipConstructionPlane', () => {
    it('should flip normal direction', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const flipped = flipConstructionPlane(plane);
      expect(flipped.normal[0]).toBeCloseTo(0, 6);
      expect(flipped.normal[1]).toBeCloseTo(0, 6);
      expect(flipped.normal[2]).toBeCloseTo(-1, 6);
    });

    it('should swap u and v axes', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const flipped = flipConstructionPlane(plane);
      expect(flipped.uAxis).toEqual(plane.vAxis);
      expect(flipped.vAxis).toEqual(plane.uAxis);
    });
  });

  describe('planesAreEquivalent', () => {
    it('should return true for same plane', () => {
      const plane1 = createWorldConstructionPlane('xy', 0);
      const plane2 = createWorldConstructionPlane('xy', 0);
      expect(planesAreEquivalent(plane1, plane2)).toBe(true);
    });

    it('should return true for flipped planes (same geometric plane)', () => {
      const plane1 = createWorldConstructionPlane('xy', 0);
      const plane2 = flipConstructionPlane(plane1);
      expect(planesAreEquivalent(plane1, plane2)).toBe(true);
    });

    it('should return false for planes at different offsets', () => {
      const plane1 = createWorldConstructionPlane('xy', 0);
      const plane2 = createWorldConstructionPlane('xy', 5);
      expect(planesAreEquivalent(plane1, plane2)).toBe(false);
    });

    it('should return false for perpendicular planes', () => {
      const plane1 = createWorldConstructionPlane('xy', 0);
      const plane2 = createWorldConstructionPlane('xz', 0);
      expect(planesAreEquivalent(plane1, plane2)).toBe(false);
    });
  });
});
