/**
 * Push/Pull gizmo for direct face manipulation.
 * Milestone 03: Push/Pull as a Feature
 */

import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { FaceRef } from '../features/offsetFace';
import { snapToGrid, type SnapSettings, defaultSnapSettings } from './Snapping';
import { resolveActiveCamera, type ActiveCameraSource } from './ActiveCameraSource';
import { DEFAULT_TOLERANCE_POLICY } from '../geometry/TolerancePolicy';

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
  /** Notify the viewport when this gizmo acquires or releases pointer ownership. */
  onDraggingChange?: (dragging: boolean) => void;
}

/**
 * Default options.
 */
const defaultGizmoOptions: Required<PushPullGizmoOptions> = {
  arrowColor: 0x00aaff,
  arrowLength: 0.5,
  previewColor: 0xffff00,
  snapSettings: defaultSnapSettings,
  onDraggingChange: () => undefined,
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
  /** Pointer currently owned by the gizmo, if the drag came from the viewport. */
  activePointerId: number | null;
}

/**
 * Gizmo for push/pull direct manipulation.
 */
export class PushPullGizmo {
  private scene: THREE.Scene | null = null;
  private cameraSource: ActiveCameraSource | null = null;
  private domElement: HTMLElement | null = null;

  private options: Required<PushPullGizmoOptions>;

  /** Arrow indicator for drag direction */
  private arrow: THREE.ArrowHelper | null = null;

  /** Preview line showing current offset */
  private previewLine: THREE.Line | null = null;

  /** Current state */
  private state: PushPullState | null = null;

  /** Event handlers bound to this instance */
  private boundPointerDown: (event: PointerEvent) => void;
  private boundPointerMove: (event: PointerEvent) => void;
  private boundPointerUp: (event: PointerEvent) => void;

  constructor(options?: PushPullGizmoOptions) {
    this.options = { ...defaultGizmoOptions, ...options };

    // Bind event handlers
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
  }

  /**
   * Initialize with Three.js scene and camera.
   */
  attach(scene: THREE.Scene, camera: ActiveCameraSource, domElement: HTMLElement): void {
    this.scene = scene;
    this.cameraSource = camera;
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
      activePointerId: null,
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
      // Capture establishes ownership before OrbitControls receives the same
      // pointerdown on the viewport container.
      this.domElement.addEventListener('pointerdown', this.boundPointerDown, true);
      this.domElement.addEventListener('pointermove', this.boundPointerMove, true);
      this.domElement.addEventListener('pointerup', this.boundPointerUp, true);
      this.domElement.addEventListener('pointercancel', this.boundPointerUp, true);
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
      this.domElement.removeEventListener('pointerdown', this.boundPointerDown, true);
      this.domElement.removeEventListener('pointermove', this.boundPointerMove, true);
      this.domElement.removeEventListener('pointerup', this.boundPointerUp, true);
      this.domElement.removeEventListener('pointercancel', this.boundPointerUp, true);
    }
    if (this.state?.isDragging) {
      this.options.onDraggingChange(false);
      this.releasePointerCapture(this.state.activePointerId);
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
  updateDelta(delta: number, snap = true): void {
    if (!this.state || !this.previewLine) return;
    if (!Number.isFinite(delta)) {
      log.warn('Ignored non-finite push/pull distance', { delta });
      return;
    }

    // Apply snapping if enabled
    const snappedDelta = snap && this.options.snapSettings.enabled
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
      message: `Push/Pull: ${snappedDelta.toFixed(3)}`,
      announce: false,
    });
  }

  /**
   * Commit the current offset.
   */
  commit(apply?: (faceRef: FaceRef, distance: number) => boolean): boolean {
    if (!this.state) return false;

    const { faceRef, currentDelta } = this.state;

    if (Number.isFinite(currentDelta) && Math.abs(currentDelta) > DEFAULT_TOLERANCE_POLICY.linear) {
      if (apply && !apply(faceRef, currentDelta)) {
        log.warn('Push/pull application rejected; preview remains active', { faceRef, distance: currentDelta });
        return false;
      }
      if (!apply) {
        eventBus.emit('pushpull:commit', {
          faceRef,
          distance: currentDelta,
        });
      }

      log.info('Push/pull committed', { faceRef, distance: currentDelta });
    } else {
      log.warn('Cannot commit with a zero or invalid distance', { currentDelta });
      return false;
    }

    this.hide();
    return true;
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

  /** True only for the pointer sequence that began on the arrow handle. */
  ownsPointer(pointerId: number): boolean {
    return this.state?.isDragging === true && this.state.activePointerId === pointerId;
  }

  setSnapSettings(settings: SnapSettings): void {
    this.options.snapSettings = { ...settings };
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.hide();
    this.scene = null;
    this.cameraSource = null;
    this.domElement = null;
    log.debug('Disposed');
  }

  /**
   * Handle mouse move during drag.
   */
  private handlePointerMove(event: PointerEvent): void {
    const camera = this.cameraSource ? resolveActiveCamera(this.cameraSource) : null;
    if (!this.state?.isDragging || !camera) return;
    if (this.state.activePointerId !== null && this.state.activePointerId !== event.pointerId) return;

    // Calculate mouse position in normalized device coordinates
    const rect = this.domElement?.getBoundingClientRect();
    if (!rect) return;

    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Ray from camera through mouse position
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Find the closest point on the face-normal line to the pointer ray.
    // Solving the two-line closest-points system preserves the signed axis
    // parameter. Intersecting the ray with the normal itself would force the
    // subsequent axis projection to zero by construction.
    const lineOrigin = this.state.startPosition;
    const lineDirection = this.state.normal;
    const rayOrigin = raycaster.ray.origin;
    const rayDir = raycaster.ray.direction;
    const betweenOrigins = rayOrigin.clone().sub(lineOrigin);
    const rayAxisDot = rayDir.dot(lineDirection);
    const denominator = 1 - rayAxisDot * rayAxisDot;

    if (denominator <= 1e-6) return;

    const rayOriginProjection = rayDir.dot(betweenOrigins);
    const axisOriginProjection = lineDirection.dot(betweenOrigins);
    const delta = (
      axisOriginProjection - rayAxisDot * rayOriginProjection
    ) / denominator;
    this.updateDelta(delta);
    event.preventDefault();
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.state || this.state.isDragging || !this.isHandleHit(event)) return;
    this.state.activePointerId = event.pointerId;
    this.startDrag();
    this.capturePointer(event.pointerId);
    event.preventDefault();
  }

  /** Handle pointer release or cancellation without committing the preview. */
  private handlePointerUp(event: PointerEvent): void {
    if (!this.state?.isDragging) return;
    if (this.state.activePointerId !== null && this.state.activePointerId !== event.pointerId) return;

    const pointerId = this.state.activePointerId;
    this.state.isDragging = false;
    this.state.activePointerId = null;
    this.options.onDraggingChange(false);
    this.releasePointerCapture(pointerId);
    event.preventDefault();
    eventBus.emit('ui:status', {
      message: Math.abs(this.state.currentDelta) > DEFAULT_TOLERANCE_POLICY.linear
        ? `Push/Pull preview: ${this.state.currentDelta.toFixed(3)} - press Enter to commit or Escape to cancel`
        : 'Push/Pull needs a non-zero distance - drag again or press Escape to cancel',
    });
  }

  /**
   * Start a drag operation.
   */
  startDrag(): void {
    if (this.state && !this.state.isDragging) {
      this.state.isDragging = true;
      this.options.onDraggingChange(true);
      log.debug('Drag started');
    }
  }

  private isHandleHit(event: PointerEvent): boolean {
    const camera = this.cameraSource ? resolveActiveCamera(this.cameraSource) : null;
    const rect = this.domElement?.getBoundingClientRect();
    if (!camera || !rect || rect.width <= 0 || rect.height <= 0 || !this.arrow) return false;

    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: Math.max(this.options.arrowLength * 0.12, 0.04) };
    raycaster.setFromCamera(pointer, camera);
    this.arrow.updateMatrixWorld(true);
    return raycaster.intersectObject(this.arrow, true).length > 0;
  }

  private capturePointer(pointerId: number): void {
    try {
      this.domElement?.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture can fail if the browser has already canceled the press.
    }
  }

  private releasePointerCapture(pointerId: number | null): void {
    if (pointerId === null) return;
    try {
      this.domElement?.releasePointerCapture?.(pointerId);
    } catch {
      // Releasing an already-lost pointer is harmless.
    }
  }
}

/**
 * Create a PushPullGizmo instance.
 */
export function createPushPullGizmo(options?: PushPullGizmoOptions): PushPullGizmo {
  return new PushPullGizmo(options);
}
