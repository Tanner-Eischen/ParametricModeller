/**
 * Tests for Assembly Types - Milestone 06
 */

import { describe, it, expect } from 'vitest';
import {
  createComponent,
  createComponentInstance,
  createMateConstraint,
  createInstanceFaceRef,
  createDefaultLockedAxes,
  createIdentityTransform,
  createTranslationTransform,
  createDefaultAssemblyData,
  lockedAxesConflict,
  mergeLockedAxes,
  type LockedAxes,
} from '../../src/assembly/AssemblyTypes';

describe('AssemblyTypes', () => {
  describe('createComponent', () => {
    it('should create a component with default values', () => {
      const component = createComponent('Test Component');

      expect(component.id).toBeDefined();
      expect(component.name).toBe('Test Component');
      expect(component.featureIds).toEqual([]);
      expect(component.bodyIds).toEqual([]);
    });

    it('should create a component with feature IDs', () => {
      const component = createComponent('Box Component', ['feat1', 'feat2'], ['body1']);

      expect(component.featureIds).toEqual(['feat1', 'feat2']);
      expect(component.bodyIds).toEqual(['body1']);
    });
  });

  describe('createComponentInstance', () => {
    it('should create an instance with default transform', () => {
      const instance = createComponentInstance('comp1', 'Instance 1');

      expect(instance.id).toBeDefined();
      expect(instance.componentId).toBe('comp1');
      expect(instance.name).toBe('Instance 1');
      expect(instance.transform).toEqual(createIdentityTransform());
      expect(instance.grounded).toBe(false);
    });

    it('should create an instance with custom transform', () => {
      const transform = createTranslationTransform(5, 0, 0);
      const instance = createComponentInstance('comp1', 'Instance 1', transform);

      expect(instance.transform).toBe(transform);
    });

    it('should have unlocked axes by default', () => {
      const instance = createComponentInstance('comp1', 'Instance 1');

      expect(instance.lockedAxes.translateX).toBe(false);
      expect(instance.lockedAxes.translateY).toBe(false);
      expect(instance.lockedAxes.translateZ).toBe(false);
      expect(instance.lockedAxes.rotateX).toBe(false);
      expect(instance.lockedAxes.rotateY).toBe(false);
      expect(instance.lockedAxes.rotateZ).toBe(false);
    });
  });

  describe('createMateConstraint', () => {
    it('should create a flush mate constraint', () => {
      const refA = createInstanceFaceRef('inst1', 'face1', 'body1');
      const refB = createInstanceFaceRef('inst2', 'face2', 'body2');

      const constraint = createMateConstraint('flush', refA, refB);

      expect(constraint.id).toBeDefined();
      expect(constraint.type).toBe('flush');
      expect(constraint.offset).toBe(0);
      expect(constraint.satisfied).toBe(false);
      expect(constraint.refA).toEqual(refA);
      expect(constraint.refB).toEqual(refB);
    });

    it('should create an offset mate constraint', () => {
      const refA = createInstanceFaceRef('inst1', 'face1', 'body1');
      const refB = createInstanceFaceRef('inst2', 'face2', 'body2');

      const constraint = createMateConstraint('offset', refA, refB, 2.5);

      expect(constraint.type).toBe('offset');
      expect(constraint.offset).toBe(2.5);
    });

    it('should create a constraint with custom name', () => {
      const refA = createInstanceFaceRef('inst1', 'face1', 'body1');
      const refB = createInstanceFaceRef('inst2', 'face2', 'body2');

      const constraint = createMateConstraint('flush', refA, refB, 0, 'Custom Name');

      expect(constraint.name).toBe('Custom Name');
    });
  });

  describe('createInstanceFaceRef', () => {
    it('should create an instance face reference', () => {
      const ref = createInstanceFaceRef('inst1', 'face1', 'body1');

      expect(ref.instanceId).toBe('inst1');
      expect(ref.faceId).toBe('face1');
      expect(ref.bodyId).toBe('body1');
    });
  });

  describe('createDefaultLockedAxes', () => {
    it('should return all unlocked axes', () => {
      const axes = createDefaultLockedAxes();

      expect(axes.translateX).toBe(false);
      expect(axes.translateY).toBe(false);
      expect(axes.translateZ).toBe(false);
      expect(axes.rotateX).toBe(false);
      expect(axes.rotateY).toBe(false);
      expect(axes.rotateZ).toBe(false);
    });
  });

  describe('createIdentityTransform', () => {
    it('should return a 4x4 identity matrix', () => {
      const matrix = createIdentityTransform();

      expect(matrix).toHaveLength(16);
      expect(matrix).toEqual([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
    });
  });

  describe('createTranslationTransform', () => {
    it('should create a translation matrix', () => {
      const matrix = createTranslationTransform(1, 2, 3);

      expect(matrix).toHaveLength(16);
      // Check translation components (column-major, so tx, ty, tz are at indices 12, 13, 14)
      expect(matrix[12]).toBe(1);
      expect(matrix[13]).toBe(2);
      expect(matrix[14]).toBe(3);
    });
  });

  describe('createDefaultAssemblyData', () => {
    it('should create empty assembly data', () => {
      const data = createDefaultAssemblyData();

      expect(data.components).toEqual([]);
      expect(data.instances).toEqual([]);
      expect(data.constraints).toEqual([]);
      expect(data.activeComponentId).toBeNull();
    });
  });

  describe('lockedAxesConflict', () => {
    it('should return false for non-conflicting axes', () => {
      const a: LockedAxes = { ...createDefaultLockedAxes(), translateX: true };
      const b: LockedAxes = { ...createDefaultLockedAxes(), translateY: true };

      expect(lockedAxesConflict(a, b)).toBe(false);
    });

    it('should return true for conflicting axes', () => {
      const a: LockedAxes = { ...createDefaultLockedAxes(), translateX: true };
      const b: LockedAxes = { ...createDefaultLockedAxes(), translateX: true };

      expect(lockedAxesConflict(a, b)).toBe(true);
    });

    it('should return false for two unlocked sets', () => {
      const a = createDefaultLockedAxes();
      const b = createDefaultLockedAxes();

      expect(lockedAxesConflict(a, b)).toBe(false);
    });

    it('should detect rotation conflicts', () => {
      const a: LockedAxes = { ...createDefaultLockedAxes(), rotateZ: true };
      const b: LockedAxes = { ...createDefaultLockedAxes(), rotateZ: true };

      expect(lockedAxesConflict(a, b)).toBe(true);
    });
  });

  describe('mergeLockedAxes', () => {
    it('should merge two locked axes sets', () => {
      const a: LockedAxes = { ...createDefaultLockedAxes(), translateX: true };
      const b: LockedAxes = { ...createDefaultLockedAxes(), translateY: true };

      const merged = mergeLockedAxes(a, b);

      expect(merged.translateX).toBe(true);
      expect(merged.translateY).toBe(true);
      expect(merged.translateZ).toBe(false);
    });

    it('should preserve all locks when merging', () => {
      const a: LockedAxes = {
        translateX: true,
        translateY: false,
        translateZ: true,
        rotateX: false,
        rotateY: true,
        rotateZ: false,
      };
      const b: LockedAxes = {
        translateX: false,
        translateY: true,
        translateZ: true,
        rotateX: true,
        rotateY: false,
        rotateZ: true,
      };

      const merged = mergeLockedAxes(a, b);

      expect(merged.translateX).toBe(true);
      expect(merged.translateY).toBe(true);
      expect(merged.translateZ).toBe(true);
      expect(merged.rotateX).toBe(true);
      expect(merged.rotateY).toBe(true);
      expect(merged.rotateZ).toBe(true);
    });
  });
});
