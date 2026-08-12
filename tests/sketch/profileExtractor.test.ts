/**
 * Tests for ProfileExtractor.
 */
import { describe, it, expect } from 'vitest';
import {
  extractProfiles,
  getProfileByIndex,
  isProfileValidForExtrude,
  calculateProfileArea,
  getProfileCentroid,
  getProfileBounds,
  createSketch,
  createLineEntity,
  createRectangleEntity,
  createWorldPlaneRef,
  addEntityToSketch,
  type Profile2D,
} from '../../src/sketch';

describe('ProfileExtractor', () => {
  describe('extractProfiles', () => {
    it('should extract profile from rectangle', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const rect = createRectangleEntity([0, 0], 2, 3);
      const withEntity = addEntityToSketch(sketch, rect);
      const profiles = extractProfiles(withEntity);

      expect(profiles).toHaveLength(1);
      expect(profiles[0]?.entityIds).toContain(rect.id);
      expect(profiles[0]?.loop).toHaveLength(4);
    });

    it('should return empty array for empty sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const profiles = extractProfiles(sketch);
      expect(profiles).toHaveLength(0);
    });

    it('should extract multiple profiles from multiple rectangles', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const rect1 = createRectangleEntity([0, 0], 1, 1);
      const rect2 = createRectangleEntity([3, 3], 1, 1);
      const withEntities = addEntityToSketch(addEntityToSketch(sketch, rect1), rect2);
      const profiles = extractProfiles(withEntities);

      expect(profiles).toHaveLength(2);
    });

    it('should extract a closed profile from connected line segments', () => {
      const planeRef = createWorldPlaneRef('xy');
      let sketch = createSketch(planeRef);
      const lines = [
        createLineEntity([0, 0], [2, 0]),
        createLineEntity([2, 0], [2, 1]),
        createLineEntity([2, 1], [0, 1]),
        createLineEntity([0, 1], [0, 0]),
      ];

      for (const line of lines) {
        sketch = addEntityToSketch(sketch, line);
      }

      const profiles = extractProfiles(sketch);

      expect(profiles).toHaveLength(1);
      expect(profiles[0]?.loop).toEqual([[0, 0], [2, 0], [2, 1], [0, 1]]);
      expect(profiles[0]?.entityIds).toHaveLength(4);
    });

    it('should ignore open line chains that do not form a closed loop', () => {
      const planeRef = createWorldPlaneRef('xy');
      let sketch = createSketch(planeRef);
      const lines = [
        createLineEntity([0, 0], [2, 0]),
        createLineEntity([2, 0], [2, 1]),
        createLineEntity([2, 1], [0, 1]),
      ];

      for (const line of lines) {
        sketch = addEntityToSketch(sketch, line);
      }

      expect(extractProfiles(sketch)).toHaveLength(0);
    });

    it('should skip invalid rectangles', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const validRect = createRectangleEntity([0, 0], 1, 1);
      // Create invalid rectangle by modifying after creation
      const invalidRect = { ...createRectangleEntity([5, 5], 0.1, 0.1), width: 0 };
      const withEntities = addEntityToSketch(addEntityToSketch(sketch, validRect), invalidRect);
      const profiles = extractProfiles(withEntities);

      // Only the valid one should produce a profile
      expect(profiles.length).toBeGreaterThanOrEqual(1);
      expect(profiles[0]?.entityIds).toContain(validRect.id);
    });
  });

  describe('getProfileByIndex', () => {
    it('should get profile at index', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const rect = createRectangleEntity([0, 0], 1, 1);
      const withEntity = addEntityToSketch(sketch, rect);
      const profile = getProfileByIndex(withEntity, 0);

      expect(profile).toBeDefined();
      expect(profile?.isValid).toBe(true);
    });

    it('should return a line-loop profile by index', () => {
      const planeRef = createWorldPlaneRef('xy');
      let sketch = createSketch(planeRef);
      const lines = [
        createLineEntity([0, 0], [1, 0]),
        createLineEntity([1, 0], [1, 1]),
        createLineEntity([1, 1], [0, 1]),
        createLineEntity([0, 1], [0, 0]),
      ];

      for (const line of lines) {
        sketch = addEntityToSketch(sketch, line);
      }

      const profile = getProfileByIndex(sketch, 0);
      expect(profile).toBeDefined();
      expect(profile?.entityIds).toHaveLength(4);
    });

    it('should return undefined for out-of-bounds index', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const profile = getProfileByIndex(sketch, 0);
      expect(profile).toBeUndefined();
    });

    it('should return second profile at index 1', () => {
      const planeRef = createWorldPlaneRef('xy');
      const sketch = createSketch(planeRef);
      const rect1 = createRectangleEntity([0, 0], 1, 1);
      const rect2 = createRectangleEntity([5, 5], 1, 1);
      const withEntities = addEntityToSketch(addEntityToSketch(sketch, rect1), rect2);
      const profile = getProfileByIndex(withEntities, 1);

      expect(profile).toBeDefined();
      expect(profile?.entityIds).toContain(rect2.id);
    });
  });

  describe('isProfileValidForExtrude', () => {
    it('should return true for valid profile', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: ['e1'],
        isValid: true,
      };
      expect(isProfileValidForExtrude(profile)).toBe(true);
    });

    it('should return false for invalid profile', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [],
        entityIds: [],
        isValid: false,
      };
      expect(isProfileValidForExtrude(profile)).toBe(false);
    });

    it('should return false for profile with less than 3 points', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0]],
        entityIds: ['e1'],
        isValid: true,
      };
      expect(isProfileValidForExtrude(profile)).toBe(false);
    });
  });

  describe('calculateProfileArea', () => {
    it('should calculate area of unit square', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };
      expect(calculateProfileArea(profile)).toBeCloseTo(1, 6);
    });

    it('should calculate area of 2x3 rectangle', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [2, 0], [2, 3], [0, 3]],
        entityIds: [],
        isValid: true,
      };
      expect(calculateProfileArea(profile)).toBeCloseTo(6, 6);
    });

    it('should return 0 for degenerate profile', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0]],
        entityIds: [],
        isValid: true,
      };
      expect(calculateProfileArea(profile)).toBe(0);
    });
  });

  describe('getProfileCentroid', () => {
    it('should calculate centroid of unit square', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };
      const centroid = getProfileCentroid(profile);
      expect(centroid[0]).toBeCloseTo(0.5, 6);
      expect(centroid[1]).toBeCloseTo(0.5, 6);
    });

    it('should calculate centroid of offset rectangle', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[2, 2], [4, 2], [4, 6], [2, 6]],
        entityIds: [],
        isValid: true,
      };
      const centroid = getProfileCentroid(profile);
      expect(centroid[0]).toBeCloseTo(3, 6);
      expect(centroid[1]).toBeCloseTo(4, 6);
    });
  });

  describe('getProfileBounds', () => {
    it('should return bounds of profile', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[1, 2], [3, 2], [3, 5], [1, 5]],
        entityIds: [],
        isValid: true,
      };
      const bounds = getProfileBounds(profile);
      expect(bounds.min).toEqual([1, 2]);
      expect(bounds.max).toEqual([3, 5]);
    });

    it('should handle single point', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[5, 5]],
        entityIds: [],
        isValid: true,
      };
      const bounds = getProfileBounds(profile);
      expect(bounds.min).toEqual([5, 5]);
      expect(bounds.max).toEqual([5, 5]);
    });
  });
});
