/**
 * Push/Pull gizmo for direct face manipulation.
 * Milestone 03: Push/Pull as a Feature
 */

import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { FaceRef } from '../features/offsetFace';
import { snapToGrid, type SnapSettings, defaultSnapSettings } from './Snapping';

const log = createModuleLogger('PushPullGizmo');

/**
 * Options for PushPullGizmo.
 */
export interface PushPullGizmoOptions {
  /** Arrow color */
  arrowColor?: number;
  /** Arrow length */
  arrowLength?: number;
  /** Preview line color */
  previewColor?: number;
  /** Snap settings */
  snapSettings?: SnapSettings;
}

/**
 * Default options.
 */
const defaultGizmoOptions: Required<Omit<PushPullGizmoOptions, 'snapSettings'>> & { snapSettings: SnapSettings } = {
  arrowColor: 0x00aaff,
  arrowLength: 0.5,
  previewColor: 0xffff00,
  snapSettings: defaultSnapSettings,
};

/**
 * State for push/pull operation.
 */
interface PushPullState {
  /** Face being pushed/pulled */
  faceRef: FaceRef;
  /** Starting position */
  startPosition: THREE.Vector3;
  /** Face normal direction */
  normal: THREE.Vector3;
  /** Current delta distance */
  currentDelta: number;
  /** Is currently dragging */
  isDragging: boolean;
}

/**
 * Gizmo for push/pull direct manipulation.
 */
export class PushPullGizmo {
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private domElement: HTMLElement | null = null;

  private options: Required<Omit<PushPullGizmoOptions, 'snapSettings'>> & { snapSettings: SnapSettings };

  /** Arrow indicator for drag direction */
  private arrow: THREE.ArrowHelper | null = null;

  /** Preview line showing current offset */
  private previewLine: THREE.Line | null = null;

  /** Current state */
  private state: PushPullState | null = null;

  /** Event handlers bound to this instance */
  private boundMouseMove: (event: MouseEvent) => void;
  private boundMouseUp: (event: MouseEvent) => void;
  private boundKeyDown: (event: KeyboardEvent) => void;

  constructor(options?: PushPullGizmoOptions) {
    this.options = { ...defaultGizmoOptions, ...options };

    // Bind event handlers
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Initialize with Three.js scene and camera.
   */
  attach(scene: THREE.Scene, camera: THREE.Camera, domElement: HTMLElement): void {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    log.debug('Attached to scene');
  }

  /**
   * Show the gizmo for a face.
   */
  show(faceRef: FaceRef, startPosition: [number, number, number], normal: [number, number, number]): void {
    if (!this.scene) {
      log.warn('Cannot show gizmo - not attached to scene');
      return;
    }

    // Hide any existing gizmo
    this.hide();

    // Create state
    this.state = {
      faceRef,
      startPosition: new THREE.Vector3(...startPosition),
      normal: new THREE.Vector3(...normal).normalize(),
      currentDelta: 0,
      isDragging: false,
    };

    // Create arrow indicator
    const dir = this.state.normal;
    const origin = this.state.startPosition;
    const length = this.options.arrowLength;
    const color = this.options.arrowColor;

    this.arrow = new THREE.ArrowHelper(dir, origin, length, color, length * 0.3, length * 0.15);
    this.scene.add(this.arrow);

    // Create preview line
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      origin.x, origin.y, origin.z,
      origin.x, origin.y, origin.z,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: this.options.previewColor,
      linewidth: 2,
    });

    this.previewLine = new THREE.Line(geometry, material);
    this.scene.add(this.previewLine);

    // Add event listeners
    if (this.domElement) {
      this.domElement.addEventListener('mousemove', this.boundMouseMove);
      this.domElement.addEventListener('mouseup', this.boundMouseUp);
      this.domElement.addEventListener('keydown', this.boundKeyDown);
    }

    // Emit event
    eventBus.emit('pushpull:enter', { faceRef });

    log.debug('Gizmo shown', { faceRef });
  }

  /**
   * Hide the gizmo.
   */
  hide(): void {
    // Remove event listeners
    if (this.domElement) {
      this.domElement.removeEventListener('mousemove', this.boundMouseMove);
      this.domElement.removeEventListener('mouseup', this.boundMouseUp);
      this.domElement.removeEventListener('keydown', this.boundKeyDown);
    }

    // Remove arrow
    if (this.arrow && this.scene) {
      this.scene.remove(this.arrow);
      this.arrow = null;
    }

    // Remove preview line
    if (this.previewLine && this.scene) {
      this.scene.remove(this.previewLine);
      this.previewLine.geometry.dispose();
      (this.previewLine.material as THREE.Material).dispose();
      this.previewLine = null;
    }

    // Clear state
    this.state = null;

    log.debug('Gizmo hidden');
  }

  /**
   * Update the delta distance during drag.
   */
  updateDelta(delta: number): void {
    if (!this.state || !this.previewLine) return;

    // Apply snapping if enabled
    const snappedDelta = this.options.snapSettings.enabled
      ? snapToGrid(delta, this.options.snapSettings.gridStep)
      : delta;

    this.state.currentDelta = snappedDelta;

    // Update preview line
    const endPosition = this.state.startPosition.clone().add(
      this.state.normal.clone().multiplyScalar(snappedDelta)
    );

    const positions = this.previewLine.geometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(1, endPosition.x, endPosition.y, endPosition.z);
    positions.needsUpdate = true;

    // Update arrow position
    if (this.arrow) {
      this.arrow.position.copy(endPosition);
    }

    // Emit update event
    eventBus.emit('pushpull:update', {
      faceRef: this.state.faceRef,
      delta: snappedDelta,
    });

    // Update status bar
    eventBus.emit('ui:status', {
      message: `Push/Pull: ${snappedDelta.toFixed(3)}"`,
    });
  }

  /**
   * Commit the current offset.
   */
  commit(): void {
    if (!this.state) return;

    const { faceRef, currentDelta } = this.state;

    if (currentDelta > 0) {
      eventBus.emit('pushpull:commit', {
        faceRef,
        distance: currentDelta,
      });

      log.info('Push/pull committed', { faceRef, distance: currentDelta });
    } else {
      log.warn('Cannot commit with non-positive distance', { currentDelta });
    }

    this.hide();
  }

  /**
   * Cancel the operation.
   */
  cancel(): void {
    if (this.state) {
      eventBus.emit('pushpull:cancel', {
        faceRef: this.state.faceRef,
      });

      log.info('Push/pull cancelled', { faceRef: this.state.faceRef });
    }

    this.hide();
  }

  /**
   * Check if the gizmo is active.
   */
  isActive(): boolean {
    return this.state !== null;
  }

  /**
   * Get the current delta.
   */
  getCurrentDelta(): number {
    return this.state?.currentDelta ?? 0;
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.hide();
    this.scene = null;
    this.camera = null;
    this.domElement = null;
    log.debug('Disposed');
  }

  /**
   * Handle mouse move during drag.
   */
  private handleMouseMove(event: MouseEvent): void {
    if (!this.state || !this.camera) return;

    // Calculate mouse position in normalized device coordinates
    const rect = this.domElement?.getBoundingClientRect();
    if (!rect) return;

    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Ray from camera through mouse position
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Project onto the normal line
    const lineOrigin = this.state.startPosition;
    const lineDirection = this.state.normal;

    // Calculate distance along normal
    const rayOrigin = raycaster.ray.origin;
    const rayDir = raycaster.ray.direction;

    // Project ray onto normal line
    const diff = lineOrigin.clone().sub(rayOrigin);
    const denom = rayDir.dot(lineDirection);

    if (Math.abs(denom) > 0.001) {
      const t = diff.dot(lineDirection) / denom;
      const point = rayOrigin.clone().add(rayDir.multiplyScalar(t));
      const delta = point.clone().sub(lineOrigin).dot(lineDirection);

      this.updateDelta(delta);
    }
  }

  /**
   * Handle mouse up to end drag.
   */
  private handleMouseUp(event: MouseEvent): void {
    if (event.button === 0 && this.state?.isDragging) {
      this.state.isDragging = false;

      // Commit if we have a positive delta
      if (this.state.currentDelta > 0) {
        this.commit();
      } else {
        this.cancel();
      }
    }
  }

  /**
   * Handle keyboard events.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.state) return;

    switch (event.key) {
      case 'Escape':
        this.cancel();
        break;
      case 'Enter':
        this.commit();
        break;
    }
  }

  /**
   * Start a drag operation.
   */
  startDrag(): void {
    if (this.state) {
      this.state.isDragging = true;
      log.debug('Drag started');
    }
  }
}

/**
 * Create a PushPullGizmo instance.
 */
export function createPushPullGizmo(options?: PushPullGizmoOptions): PushPullGizmo {
  return new PushPullGizmo(options);
}
