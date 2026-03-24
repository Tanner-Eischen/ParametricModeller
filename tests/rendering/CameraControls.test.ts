/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CameraControls } from '../../src/rendering/CameraControls';
import { createWorldConstructionPlane } from '../../src/geometry/ConstructionPlane';
import * as THREE from 'three';

describe('CameraControls', () => {
  let container: HTMLElement;
  let cameraControls: CameraControls;

  beforeEach(() => {
    // Create a container element for testing
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    cameraControls = new CameraControls(container);
  });

  afterEach(() => {
    cameraControls.dispose();
    document.body.removeChild(container);
  });

  describe('constructor', () => {
    it('should create camera controls with default options', () => {
      expect(cameraControls.camera).toBeDefined();
      expect(cameraControls.orbitControls).toBeDefined();
    });

    it('should start with perspective projection', () => {
      expect(cameraControls.getProjection()).toBe('perspective');
    });
  });

  describe('setProjection', () => {
    it('should switch to orthographic projection', () => {
      cameraControls.setProjection('orthographic');
      expect(cameraControls.getProjection()).toBe('orthographic');
    });

    it('should switch to perspective projection', () => {
      cameraControls.setProjection('orthographic');
      cameraControls.setProjection('perspective');
      expect(cameraControls.getProjection()).toBe('perspective');
    });

    it('should not change if already in requested projection', () => {
      cameraControls.setProjection('perspective');
      cameraControls.setProjection('perspective');
      expect(cameraControls.getProjection()).toBe('perspective');
    });
  });

  describe('toggleProjection', () => {
    it('should toggle between projections', () => {
      cameraControls.toggleProjection();
      expect(cameraControls.getProjection()).toBe('orthographic');

      cameraControls.toggleProjection();
      expect(cameraControls.getProjection()).toBe('perspective');
    });
  });

  describe('reset', () => {
    it('should reset camera to default position', () => {
      cameraControls.camera.position.set(0, 0, 0);
      cameraControls.reset();

      expect(cameraControls.camera.position.x).toBeCloseTo(60, 5);
      expect(cameraControls.camera.position.y).toBeCloseTo(45, 5);
      expect(cameraControls.camera.position.z).toBeCloseTo(60, 5);
    });
  });

  describe('alignToPlane', () => {
    it('should align camera to XY plane', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      cameraControls.alignToPlane(plane, 10);

      expect(cameraControls.getProjection()).toBe('orthographic');
      expect(cameraControls.camera.position.z).toBeCloseTo(10, 5);
    });

    it('should align camera to XZ plane', () => {
      const plane = createWorldConstructionPlane('xz', 0);
      cameraControls.alignToPlane(plane, 10);

      expect(cameraControls.getProjection()).toBe('orthographic');
      expect(cameraControls.camera.position.y).toBeCloseTo(10, 5);
    });

    it('should align camera to YZ plane', () => {
      const plane = createWorldConstructionPlane('yz', 0);
      cameraControls.alignToPlane(plane, 10);

      expect(cameraControls.getProjection()).toBe('orthographic');
      expect(cameraControls.camera.position.x).toBeCloseTo(10, 5);
    });

    it('should save previous state before aligning', () => {
      cameraControls.camera.position.set(20, 20, 20);
      const plane = createWorldConstructionPlane('xy', 0);
      cameraControls.alignToPlane(plane, 10);

      expect(cameraControls.isInSketchMode()).toBe(true);
    });
  });

  describe('restoreFromSketch', () => {
    it('should restore camera state after sketch mode', () => {
      // Set initial state
      cameraControls.camera.position.set(20, 20, 20);
      cameraControls.setProjection('perspective');

      // Enter sketch mode
      const plane = createWorldConstructionPlane('xy', 0);
      cameraControls.alignToPlane(plane, 10);

      expect(cameraControls.getProjection()).toBe('orthographic');

      // Exit sketch mode
      cameraControls.restoreFromSketch();

      expect(cameraControls.getProjection()).toBe('perspective');
      expect(cameraControls.camera.position.x).toBeCloseTo(20, 5);
      expect(cameraControls.camera.position.y).toBeCloseTo(20, 5);
      expect(cameraControls.camera.position.z).toBeCloseTo(20, 5);
    });

    it('should do nothing if not in sketch mode', () => {
      cameraControls.restoreFromSketch();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('isInSketchMode', () => {
    it('should return false initially', () => {
      expect(cameraControls.isInSketchMode()).toBe(false);
    });

    it('should return true after alignToPlane', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      cameraControls.alignToPlane(plane, 10);

      expect(cameraControls.isInSketchMode()).toBe(true);
    });

    it('should return false after restoreFromSketch', () => {
      const plane = createWorldConstructionPlane('xy', 0);
      cameraControls.alignToPlane(plane, 10);
      cameraControls.restoreFromSketch();

      expect(cameraControls.isInSketchMode()).toBe(false);
    });
  });

  describe('fitToView', () => {
    it('should position camera to view the box', () => {
      const box = new THREE.Box3(
        new THREE.Vector3(-5, -5, -5),
        new THREE.Vector3(5, 5, 5)
      );

      cameraControls.fitToView(box);

      // Camera should be positioned to see the box
      expect(cameraControls.camera.position.length()).toBeGreaterThan(0);
    });
  });

  describe('setSize', () => {
    it('should update camera aspect ratio', () => {
      cameraControls.setSize(1024, 768);

      const aspect = (cameraControls.camera as THREE.PerspectiveCamera).aspect;
      expect(aspect).toBeCloseTo(1024 / 768, 5);
    });
  });
});
