import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { eventBus } from '../core/eventBus';
import { createModuleLogger } from '../core/logger';
import type { ConstructionPlane } from '../geometry';
import {
  notifySketchCameraChanged,
  registerSketchCamera,
} from './SketchProjector';

const log = createModuleLogger('CameraControls');

export interface CameraControlsOptions {
  enableDamping?: boolean;
  dampingFactor?: number;
  minDistance?: number;
  maxDistance?: number;
  maxPolarAngle?: number;
}

const DEFAULT_OPTIONS: CameraControlsOptions = {
  enableDamping: true,
  dampingFactor: 0.05,
  minDistance: 0.1,
  maxDistance: 1000,
  maxPolarAngle: Math.PI,
};

export class CameraControls {
  private _container: HTMLElement;
  private perspectiveCamera: THREE.PerspectiveCamera;
  private orthographicCamera: THREE.OrthographicCamera;
  private activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private unregisterSketchCamera: (() => void) | null = null;
  private projection: 'perspective' | 'orthographic' = 'perspective';
  private savedState: {
    position: THREE.Vector3;
    target: THREE.Vector3;
    up: THREE.Vector3;
    projection: 'perspective' | 'orthographic';
  } | null = null;

  constructor(container: HTMLElement, options: CameraControlsOptions = {}) {
    this._container = container;

    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Create perspective camera
    // For woodworking CAD: 1 unit = 1 inch, typical objects 6"-96"
    // Position camera to see ~48" comfortably at default
    this.perspectiveCamera = new THREE.PerspectiveCamera(
      45,
      this._container.clientWidth / this._container.clientHeight,
      0.01,
      10000
    );
    this.perspectiveCamera.position.set(60, 45, 60); // ~100 units from origin, good for 24-48" objects
    this.perspectiveCamera.lookAt(0, 0, 0);

    // Create orthographic camera with larger bounds for woodworking scale
    this.orthographicCamera = new THREE.OrthographicCamera(
      -50, 50, 50, -50, // 100" view width at default
      0.01,
      10000
    );
    this.orthographicCamera.position.set(60, 45, 60);
    this.orthographicCamera.lookAt(0, 0, 0);

    // Set active camera
    this.activeCamera = this.perspectiveCamera;

    // Create orbit controls
    this.controls = new OrbitControls(this.activeCamera, this._container);
    this.unregisterSketchCamera = registerSketchCamera(this._container, () => this.activeCamera);
    this.controls.enableDamping = opts.enableDamping ?? true;
    this.controls.dampingFactor = opts.dampingFactor ?? 0.05;
    this.controls.minDistance = opts.minDistance ?? 0.1;
    this.controls.maxDistance = opts.maxDistance ?? 1000;
    this.controls.maxPolarAngle = opts.maxPolarAngle ?? Math.PI;

    // Emit camera move events
    this.controls.addEventListener('change', () => {
      eventBus.emit('camera:move', {
        position: [
          this.activeCamera.position.x,
          this.activeCamera.position.y,
          this.activeCamera.position.z,
        ],
        target: [
          this.controls.target.x,
          this.controls.target.y,
          this.controls.target.z,
        ],
      });
      notifySketchCameraChanged(this._container);
    });

    log.info('CameraControls initialized');
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.activeCamera;
  }

  get orbitControls(): OrbitControls {
    return this.controls;
  }

  setSize(width: number, height: number): void {
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();

    const aspect = width / height;
    const frustumSize = 20;
    this.orthographicCamera.left = -frustumSize * aspect;
    this.orthographicCamera.right = frustumSize * aspect;
    this.orthographicCamera.top = frustumSize;
    this.orthographicCamera.bottom = -frustumSize;
    this.orthographicCamera.updateProjectionMatrix();
    notifySketchCameraChanged(this._container);
  }

  toggleProjection(): void {
    if (this.projection === 'perspective') {
      this.setProjection('orthographic');
    } else {
      this.setProjection('perspective');
    }
  }

  setProjection(type: 'perspective' | 'orthographic'): void {
    if (this.projection === type) return;

    // Copy position and target
    const position = this.activeCamera.position.clone();
    const target = this.controls.target.clone();

    this.projection = type;

    if (type === 'perspective') {
      this.activeCamera = this.perspectiveCamera;
    } else {
      this.activeCamera = this.orthographicCamera;
    }

    this.activeCamera.position.copy(position);
    this.activeCamera.up.copy(this.controls.object.up);
    this.controls.object = this.activeCamera;
    this.controls.target.copy(target);
    this.controls.update();

    eventBus.emit('camera:projection', { type });
    log.info(`Switched to ${type} projection`);
  }

  getProjection(): 'perspective' | 'orthographic' {
    return this.projection;
  }

  fitToView(box: THREE.Box3): void {
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.05);
    const padding = 1.3;

    let distance: number;
    if (this.activeCamera instanceof THREE.PerspectiveCamera) {
      const verticalHalfFov = THREE.MathUtils.degToRad(this.activeCamera.fov) / 2;
      const aspect = Number.isFinite(this.activeCamera.aspect) && this.activeCamera.aspect > 0
        ? this.activeCamera.aspect
        : 1;
      if (this.activeCamera.aspect !== aspect) {
        this.activeCamera.aspect = aspect;
        this.activeCamera.updateProjectionMatrix();
      }
      const horizontalHalfFov = Math.atan(
        Math.tan(verticalHalfFov) * aspect,
      );
      const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
      distance = radius * padding / Math.sin(limitingHalfFov);
    } else {
      const halfWidth = (this.activeCamera.right - this.activeCamera.left) / 2;
      const halfHeight = (this.activeCamera.top - this.activeCamera.bottom) / 2;
      this.activeCamera.zoom = Math.min(halfWidth, halfHeight) / (radius * padding);
      this.activeCamera.updateProjectionMatrix();
      distance = Math.max(radius * 4, 1);
    }

    // Position camera to view the box
    const direction = this.activeCamera.position.clone().sub(this.controls.target).normalize();
    this.activeCamera.position.copy(center).add(direction.multiplyScalar(distance));
    this.controls.target.copy(center);
    this.controls.update();

    log.debug('Camera fitted to view', { center, distance });
  }

  reset(): void {
    this.activeCamera.position.set(60, 45, 60);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    log.info('Camera reset to default');
  }

  update(): void {
    this.controls.update();
  }

  /**
   * Align camera to a construction plane for sketch mode.
   * Saves current state and switches to orthographic projection.
   */
  alignToPlane(plane: ConstructionPlane, distance = 50): void {
    // Save current state if not already saved
    if (!this.savedState) {
      this.savedState = {
        position: this.activeCamera.position.clone(),
        target: this.controls.target.clone(),
        up: this.activeCamera.up.clone(),
        projection: this.projection,
      };
      log.debug('Camera state saved for sketch mode');
    }

    // Position camera along plane normal, looking at origin
    const normal = new THREE.Vector3(...plane.normal);
    const origin = new THREE.Vector3(...plane.origin);

    // Calculate camera position (distance along normal from origin)
    const cameraPosition = origin.clone().add(normal.clone().multiplyScalar(distance));

    // Switch to orthographic first
    if (this.projection !== 'orthographic') {
      this.setProjection('orthographic');
    }

    // Set camera position and target
    this.activeCamera.position.copy(cameraPosition);
    this.activeCamera.up.set(...plane.vAxis).normalize();
    this.controls.target.copy(origin);
    this.controls.update();

    log.info('Camera aligned to plane', {
      origin: plane.origin,
      normal: plane.normal,
      distance,
    });
  }

  /**
   * Restore camera to state before sketch mode.
   */
  restoreFromSketch(): void {
    if (!this.savedState) {
      log.debug('No saved camera state to restore');
      return;
    }

    // Restore projection if needed
    if (this.savedState.projection !== this.projection) {
      this.setProjection(this.savedState.projection);
    }

    // Restore position and target
    this.activeCamera.position.copy(this.savedState.position);
    this.activeCamera.up.copy(this.savedState.up);
    this.controls.target.copy(this.savedState.target);
    this.controls.update();

    // Clear saved state
    this.savedState = null;

    log.info('Camera restored from sketch mode');
  }

  /**
   * Check if camera is in sketch mode (has saved state).
   */
  isInSketchMode(): boolean {
    return this.savedState !== null;
  }

  dispose(): void {
    this.unregisterSketchCamera?.();
    this.unregisterSketchCamera = null;
    this.controls.dispose();
    log.info('CameraControls disposed');
  }
}
