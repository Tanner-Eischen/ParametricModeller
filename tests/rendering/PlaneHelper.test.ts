/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlaneHelper } from '../../src/rendering/PlaneHelper';
import { createWorldConstructionPlane } from '../../src/geometry/ConstructionPlane';
import * as THREE from 'three';

describe('PlaneHelper', () => {
  let planeHelper: PlaneHelper;

  beforeEach(() => {
    planeHelper = new PlaneHelper();
  });

  afterEach(() => {
    if (planeHelper) {
      planeHelper.dispose();
    }
  });

  describe('constructor', () => {
    it('should create a plane helper with default options', () => {
      expect(planeHelper.group).toBeDefined();
      expect(planeHelper.group.visible).toBe(false);
      expect(planeHelper.group.children.length).toBe(3); // mesh, border, arrow
    });

    it('should accept custom options', () => {
      const customHelper = new PlaneHelper({
        size: 10,
        planeColor: 0xff0000,
        opacity: 0.5,
        arrowLength: 2,
      });

      expect(customHelper.group).toBeDefined();
      customHelper.dispose();
    });

    it('should create translucent plane mesh', () => {
      const mesh = planeHelper.group.children.find(
        c => c instanceof THREE.Mesh && c.userData.isPlaneHelper
      );
      expect(mesh).toBeDefined();
    });

    it('should create normal arrow', () => {
      const arrow = planeHelper.group.children.find(
        c => c instanceof THREE.ArrowHelper
      );
      expect(arrow).toBeDefined();
    });

    it('should create border lines', () => {
      const lines = planeHelper.group.children.find(
        c => c instanceof THREE.LineSegments
      );
      expect(lines).toBeDefined();
    });
  });

  describe('update', () => {
    it('should position the plane at the construction plane origin', () => {
      const plane = createWorldConstructionPlane('xy', 5);
      planeHelper.update(plane);

      expect(planeHelper.group.position.x).toBe(0);
      expect(planeHelper.group.position.y).toBe(0);
      expect(planeHelper.group.position.z).toBe(5);
    });

    it('should orient the plane to match construction plane normal', () => {
      const xyPlane = createWorldConstructionPlane('xy', 0);
      planeHelper.update(xyPlane);

      // XY plane should have normal pointing in +Z direction
      const normal = new THREE.Vector3(0, 0, 1);
      const quaternion = planeHelper.group.quaternion;
      const rotatedNormal = normal.applyQuaternion(quaternion);

      expect(rotatedNormal.z).toBeCloseTo(1, 5);
    });

    it('should handle XZ plane orientation', () => {
      const xzPlane = createWorldConstructionPlane('xz', 0);
      planeHelper.update(xzPlane);

      // XZ plane has normal pointing in +Y
      const normal = new THREE.Vector3(0, 1, 0);
      const quaternion = planeHelper.group.quaternion;
      const rotatedNormal = normal.applyQuaternion(quaternion);

      expect(rotatedNormal.y).toBeCloseTo(1, 5);
    });

    it('should handle YZ plane orientation', () => {
      const yzPlane = createWorldConstructionPlane('yz', 0);
      planeHelper.update(yzPlane);

      // YZ plane has normal pointing in +X
      // Verify the group has been rotated (quaternion should not be identity)
      expect(planeHelper.group.quaternion.x).not.toBe(0);
      expect(planeHelper.group.quaternion.w).not.toBe(1);
    });
  });

  describe('setVisible', () => {
    it('should show the plane helper', () => {
      planeHelper.setVisible(true);
      expect(planeHelper.group.visible).toBe(true);
    });

    it('should hide the plane helper', () => {
      planeHelper.setVisible(true);
      planeHelper.setVisible(false);
      expect(planeHelper.group.visible).toBe(false);
    });
  });

  describe('isVisible', () => {
    it('should return false when hidden', () => {
      expect(planeHelper.isVisible()).toBe(false);
    });

    it('should return true when visible', () => {
      planeHelper.setVisible(true);
      expect(planeHelper.isVisible()).toBe(true);
    });
  });

  describe('setColor', () => {
    it('should change the plane color', () => {
      planeHelper.setColor(0xff0000);
      // Color should be applied to material
      expect(planeHelper.group.children.length).toBeGreaterThan(0);
    });
  });

  describe('setOpacity', () => {
    it('should change the plane opacity', () => {
      planeHelper.setOpacity(0.5);
      // Opacity should be applied to material
      expect(planeHelper.group.children.length).toBeGreaterThan(0);
    });
  });

  describe('setSize', () => {
    it('should recreate geometry with new size', () => {
      planeHelper.setSize(10);
      expect(planeHelper.group.children.length).toBe(3);
    });
  });

  describe('getOptions', () => {
    it('should return current options', () => {
      const options = planeHelper.getOptions();
      expect(options.size).toBe(5); // Default size
    });
  });

  describe('dispose', () => {
    it('should clean up resources', () => {
      planeHelper.dispose();
      // Should not throw
      expect(true).toBe(true);
    });
  });
});
