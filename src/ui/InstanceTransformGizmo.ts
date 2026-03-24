/**
 * Instance Transform Gizmo - Milestone 06: Assembly-lite
 *
 * Transform gizmo for component instances.
 * Allows translate and rotate operations, respecting locked axes.
 */

import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { ComponentInstance } from '../assembly/AssemblyTypes';

// Import TransformControls - it exists at runtime even if not in types
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const log = createModuleLogger('InstanceTransformGizmo');

/**
 * Options for the InstanceTransformGizmo.
 */
export interface InstanceTransformGizmoOptions {
  snapEnabled?: boolean;
  snapDistance?: number;
  snapAngle?: number;
}

/**
 * Transform gizmo for component instances.
 */
export class InstanceTransformGizmo {
  private scene: THREE.Scene | null = null;
  // Stored for potential future use (camera tracking, re-attachment, etc.)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private camera: THREE.Camera | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private domElement: HTMLElement | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transformControls: any = null;
  private currentInstance: ComponentInstance | null = null;

  private snapEnabled: boolean;
  private snapDistance: number;
  private snapAngle: number;

  private onTransformCommitted: ((instanceId: string, transform: number[]) => void) | null = null;

  constructor(options: InstanceTransformGizmoOptions = {}) {
    this.snapEnabled = options.snapEnabled ?? true;
    this.snapDistance = options.snapDistance ?? 0.25;
    this.snapAngle = options.snapAngle ?? Math.PI / 12; // 15 degrees

    log.debug('InstanceTransformGizmo created');
  }

  /**
   * Attach the gizmo to a scene.
   */
  attach(
    scene: THREE.Scene,
    camera: THREE.Camera,
    domElement: HTMLElement
  ): void {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;

    // Create TransformControls
    this.transformControls = new TransformControls(camera, domElement);

    // Configure
    this.transformControls.setSize(0.75);
    this.transformControls.setSpace('world');

    // Add to scene
    scene.add(this.transformControls);

    // Event listeners
    this.transformControls.addEventListener('dragging-changed', (event: { value: boolean }) => {
      if (!event.value) {
        // Dragging ended - commit the transform
        this.commitTransform();
      }
    });

    this.transformControls.addEventListener('change', () => {
      // Update during drag
      this.updateSnap();
    });

    // Keyboard shortcuts for mode
    domElement.addEventListener('keydown', (e) => this.handleKeyDown(e));

    log.debug('Gizmo attached to scene');
  }

  /**
   * Show the gizmo for an instance.
   */
  show(
    instance: ComponentInstance,
    mesh: THREE.Object3D,
    onCommit: (instanceId: string, transform: number[]) => void
  ): void {
    if (!this.transformControls) {
      log.warn('Gizmo not attached to scene');
      return;
    }

    this.currentInstance = instance;
    this.onTransformCommitted = onCommit;

    // Attach to the mesh
    this.transformControls.attach(mesh);

    // Set mode based on locked axes
    this.updateMode();

    eventBus.emit('ui:status', { message: `Transforming ${instance.name} (T: translate, R: rotate)` });
    log.debug('Gizmo shown', { instanceId: instance.id });
  }

  /**
   * Hide the gizmo.
   */
  hide(): void {
    if (this.transformControls) {
      this.transformControls.detach();
    }
    this.currentInstance = null;
    this.onTransformCommitted = null;
    log.debug('Gizmo hidden');
  }

  /**
   * Update the transform mode based on locked axes.
   */
  private updateMode(): void {
    if (!this.transformControls || !this.currentInstance) return;

    const locked = this.currentInstance.lockedAxes;

    // If all translation is locked, switch to rotate
    if (locked.translateX && locked.translateY && locked.translateZ) {
      this.transformControls.setMode('rotate');
    } else {
      this.transformControls.setMode('translate');
    }
  }

  /**
   * Update snap settings during drag.
   */
  private updateSnap(): void {
    if (!this.transformControls || !this.snapEnabled) return;

    // Apply snap based on mode
    const mode = this.transformControls.mode;
    if (mode === 'translate') {
      this.transformControls.setTranslationSnap(this.snapDistance);
    } else if (mode === 'rotate') {
      this.transformControls.setRotationSnap(this.snapAngle);
    }
  }

  /**
   * Handle keyboard input.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.transformControls || !this.currentInstance) return;

    switch (event.key.toLowerCase()) {
      case 't':
        this.transformControls.setMode('translate');
        eventBus.emit('ui:status', { message: 'Translate mode' });
        break;
      case 'r':
        this.transformControls.setMode('rotate');
        eventBus.emit('ui:status', { message: 'Rotate mode' });
        break;
      case 'escape':
        this.hide();
        break;
    }
  }

  /**
   * Commit the current transform.
   */
  private commitTransform(): void {
    if (!this.currentInstance || !this.transformControls || !this.onTransformCommitted) return;

    // Get the transform matrix
    const object = this.transformControls.object;
    if (!object) return;

    object.updateMatrixWorld(true);
    const matrix = object.matrixWorld.clone();

    // Convert to flat array of numbers
    const transform: number[] = Array.from(matrix.elements) as number[];

    // Notify
    this.onTransformCommitted(this.currentInstance.id, transform);

    // Emit event
    eventBus.emit('instance:transformed', {
      instanceId: this.currentInstance.id,
      transform,
    });

    log.debug('Transform committed', {
      instanceId: this.currentInstance.id,
      transform: transform.slice(12, 15), // Just translation for logging
    });
  }

  /**
   * Set snap enabled.
   */
  setSnapEnabled(enabled: boolean): void {
    this.snapEnabled = enabled;
    if (this.transformControls) {
      if (enabled) {
        this.transformControls.setTranslationSnap(this.snapDistance);
        this.transformControls.setRotationSnap(this.snapAngle);
      } else {
        this.transformControls.setTranslationSnap(null);
        this.transformControls.setRotationSnap(null);
      }
    }
  }

  /**
   * Dispose the gizmo.
   */
  dispose(): void {
    this.hide();
    if (this.transformControls && this.scene) {
      this.scene.remove(this.transformControls);
      this.transformControls.dispose();
    }
    this.transformControls = null;
    this.scene = null;
    this.camera = null;
    this.domElement = null;
    log.debug('InstanceTransformGizmo disposed');
  }
}
