import { describe, it, expect } from 'vitest';
import {
  isPolygonPlanar,
  distanceFromPlane,
  PLANARITY_TOLERANCE,
} from '../../src/geometry/PlanarityGuard';

describe('PlanarityGuard', () => {
  describe('isPolygonPlanar', () => {
    it('should return true for 3 or fewer points (always planar)', () => {
      expect(isPolygonPlanar([[0, 0, 0]])).toBe(true);
      expect(isPolygonPlanar([[0, 0, 0], [1, 0, 0]])).toBe(true);
      expect(isPolygonPlanar([[0, 0, 0], [1, 0, 0], [1, 1, 0]])).toBe(true);
    });

    it('should return true for planar rectangles on XY plane', () => {
      const rect = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ];
      expect(isPolygonPlanar(rect)).toBe(true);
    });

    it('should return true for planar rectangles on XZ plane', () => {
      const rect = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ];
      expect(isPolygonPlanar(rect)).toBe(true);
    });

    it('should return true for planar rectangles on YZ plane', () => {
      const rect = [
        [0, 0, 0],
        [0, 1, 0],
        [0, 1, 1],
        [0, 0, 1],
      ];
      expect(isPolygonPlanar(rect)).toBe(true);
    });

    it('should return true for planar pentagon', () => {
      const pentagon = [
        [0, 0, 0],
        [1, 0, 0],
        [1.5, 1, 0],
        [0.5, 1.5, 0],
        [-0.5, 1, 0],
      ];
      expect(isPolygonPlanar(pentagon)).toBe(true);
    });

    it('should return true for planar hexagon', () => {
      const hexagon = [
        [1, 0, 0],
        [0.5, 0.866, 0],
        [-0.5, 0.866, 0],
        [-1, 0, 0],
        [-0.5, -0.866, 0],
        [0.5, -0.866, 0],
      ];
      expect(isPolygonPlanar(hexagon)).toBe(true);
    });

    it('should return false for non-planar quadrilateral', () => {
      const nonPlanar = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0.5], // Lifted out of plane
        [0, 1, 0],
      ];
      expect(isPolygonPlanar(nonPlanar)).toBe(false);
    });

    it('should return false for significantly non-planar polygon', () => {
      const nonPlanar = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0.5, 0.5, 1], // Significantly out of plane
        [0, 1, 0],
      ];
      expect(isPolygonPlanar(nonPlanar)).toBe(false);
    });

    it('should use tolerance parameter', () => {
      const slightlyNonPlanar = [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0.0005], // Slightly out of plane
        [0, 1, 0],
      ];
      // Should be planar with default tolerance
      expect(isPolygonPlanar(slightlyNonPlanar, PLANARITY_TOLERANCE)).toBe(true);
      // Should be non-planar with tighter tolerance
      expect(isPolygonPlanar(slightlyNonPlanar, 0.0001)).toBe(false);
    });

    it('should return true for coplanar points on arbitrary plane', () => {
      // Points on a tilted plane (z = x + y)
      const coplanar = [
        [0, 0, 0],
        [1, 0, 1],
        [1, 1, 2],
        [0, 1, 1],
      ];
      expect(isPolygonPlanar(coplanar)).toBe(true);
    });
  });

  describe('distanceFromPlane', () => {
    it('should return 0 for point on plane', () => {
      const normal: [number, number, number] = [0, 0, 1];
      const d = 0; // z = 0 plane
      expect(distanceFromPlane([0, 0, 0], normal, d)).toBe(0);
      expect(distanceFromPlane([5, 5, 0], normal, d)).toBe(0);
    });

    it('should return correct distance for point above plane', () => {
      const normal: [number, number, number] = [0, 0, 1];
      const d = 0;
      expect(distanceFromPlane([0, 0, 5], normal, d)).toBe(5);
      expect(distanceFromPlane([0, 0, 0.001], normal, d)).toBe(0.001);
    });

    it('should return correct distance for point below plane', () => {
      const normal: [number, number, number] = [0, 0, 1];
      const d = 0;
      expect(distanceFromPlane([0, 0, -5], normal, d)).toBe(5);
    });

    it('should work with offset plane', () => {
      const normal: [number, number, number] = [0, 0, 1];
      const d = -2; // z = 2 plane
      expect(distanceFromPlane([0, 0, 2], normal, d)).toBe(0);
      expect(distanceFromPlane([0, 0, 5], normal, d)).toBe(3);
    });
  });

  describe('PLANARITY_TOLERANCE', () => {
    it('should be a small positive number', () => {
      expect(PLANARITY_TOLERANCE).toBeGreaterThan(0);
      expect(PLANARITY_TOLERANCE).toBeLessThan(0.1);
    });
  });
});
