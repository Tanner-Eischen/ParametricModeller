/**
 * Tests for PrismBuilder.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPrism,
  validatePrismParams,
  buildRectangularPrism,
  type PrismParams,
} from '../../src/features';
import { createWorldConstructionPlane } from '../../src/geometry';
import type { Profile2D } from '../../src/sketch';

describe('PrismBuilder', () => {
  describe('validatePrismParams', () => {
    it('should return empty array for valid params', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };
      const errors = validatePrismParams({ plane, profile, distance: 1, flip: false });
      expect(errors).toHaveLength(0);
    });

    it('should error on missing plane', () => {
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };
      const errors = validatePrismParams({ profile, distance: 1, flip: false } as Partial<PrismParams>);
      expect(errors).toContain('Construction plane is required');
    });

    it('should error on missing profile', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const errors = validatePrismParams({ plane, distance: 1, flip: false } as Partial<PrismParams>);
      expect(errors).toContain('Profile is required');
    });

    it('should error on invalid profile', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: false,
      };
      const errors = validatePrismParams({ plane, profile, distance: 1, flip: false });
      expect(errors).toContain('Profile is not valid');
    });

    it('should error on profile with less than 3 points', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0]],
        entityIds: [],
        isValid: true,
      };
      const errors = validatePrismParams({ plane, profile, distance: 1, flip: false });
      expect(errors).toContain('Profile must have at least 3 points');
    });

    it('should error on zero distance', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };
      const errors = validatePrismParams({ plane, profile, distance: 0, flip: false });
      expect(errors).toContain('Distance must be greater than 0');
    });

    it('should error on negative distance', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };
      const errors = validatePrismParams({ plane, profile, distance: -1, flip: false });
      expect(errors).toContain('Distance must be greater than 0');
    });
  });

  describe('buildPrism', () => {
    it('should create prism from square profile', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };

      const body = buildPrism({ plane, profile, distance: 2, flip: false });

      expect(body.id).toBeDefined();
      expect(body.name).toBe('Prism');

      // 4 corners x 2 (top and bottom) = 8 vertices
      expect(body.vertices.size).toBe(8);

      // 4 bottom + 4 top + 4 vertical = 12 edges
      expect(body.edges.size).toBe(12);

      // 1 bottom + 1 top + 4 sides = 6 faces
      expect(body.faces.size).toBe(6);
    });

    it('should create prism from triangle profile', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [0.5, 1]],
        entityIds: [],
        isValid: true,
      };

      const body = buildPrism({ plane, profile, distance: 1, flip: false });

      // 3 corners x 2 = 6 vertices
      expect(body.vertices.size).toBe(6);

      // 3 bottom + 3 top + 3 vertical = 9 edges
      expect(body.edges.size).toBe(9);

      // 1 bottom + 1 top + 3 sides = 5 faces
      expect(body.faces.size).toBe(5);
    });

    it('should use provided body ID', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };

      const body = buildPrism({ plane, profile, distance: 1, flip: false }, 'my-body');
      expect(body.id).toBe('my-body');
    });

    it('should have deterministic face IDs', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };

      const body = buildPrism({ plane, profile, distance: 1, flip: false });

      expect(body.faces.has('bottom')).toBe(true);
      expect(body.faces.has('top')).toBe(true);
      expect(body.faces.has('side_0')).toBe(true);
      expect(body.faces.has('side_1')).toBe(true);
      expect(body.faces.has('side_2')).toBe(true);
      expect(body.faces.has('side_3')).toBe(true);
    });

    it('orients side-face normals outward for a counter-clockwise profile', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };

      const body = buildPrism({ plane, profile, distance: 1, flip: false });

      const expectedNormals = [
        [0, -1, 0],
        [1, 0, 0],
        [0, 1, 0],
        [-1, 0, 0],
      ];

      expectedNormals.forEach((expected, index) => {
        const normal = body.planes.get(`side_${index}`)?.normal;
        expect(normal).toBeDefined();
        expected.forEach((component, componentIndex) => {
          expect(normal?.[componentIndex]).toBeCloseTo(component);
        });
      });
    });

    it('should flip extrusion direction when flip is true', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const profile: Profile2D = {
        id: '1',
        sketchId: 's1',
        loop: [[0, 0], [1, 0], [1, 1], [0, 1]],
        entityIds: [],
        isValid: true,
      };

      const bodyNormal = buildPrism({ plane, profile, distance: 1, flip: false });
      const bodyFlipped = buildPrism({ plane, profile, distance: 1, flip: true });

      // Get top vertex position from each
      const normalTop = bodyNormal.vertices.get('top_v0');
      const flippedTop = bodyFlipped.vertices.get('top_v0');

      expect(normalTop).toBeDefined();
      expect(flippedTop).toBeDefined();

      if (normalTop && flippedTop) {
        // Normal should go in +Z, flipped should go in -Z
        expect(normalTop.position[2]).toBeGreaterThan(0);
        expect(flippedTop.position[2]).toBeLessThan(0);
      }
    });
  });

  describe('buildRectangularPrism', () => {
    it('should create prism from rectangle parameters', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const body = buildRectangularPrism(plane, [0, 0], 2, 3, 1);

      expect(body.vertices.size).toBe(8);
      expect(body.faces.size).toBe(6);
    });

    it('should create prism with offset origin', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const body = buildRectangularPrism(plane, [1, 1], 1, 1, 1);

      // Bottom vertex 0 should be at [1, 1, 0]
      const v0 = body.vertices.get('bottom_v0');
      expect(v0).toBeDefined();
      if (v0) {
        expect(v0.position[0]).toBe(1);
        expect(v0.position[1]).toBe(1);
        expect(v0.position[2]).toBe(0);
      }
    });

    it('should use provided body ID', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      const body = buildRectangularPrism(plane, [0, 0], 1, 1, 1, false, 'custom-id');
      expect(body.id).toBe('custom-id');
    });
  });
});
