import { eventBus } from '../core/eventBus';
import { createModuleLogger } from '../core/logger';
import {
  type ConstructionPlane,
  createWorldConstructionPlane,
  getConstructionPlaneFromRef,
  getDefaultSketchPlane,
} from '../geometry';
import type { PlaneRef } from '../sketch';
import type { Body } from '../geometry';

const log = createModuleLogger('SketchModeController');

/**
 * Controller for managing sketch mode state and transitions.
 */
export class SketchModeController {
  private _isActive = false;
  private _currentPlane: ConstructionPlane | null = null;
  private _currentSketchId: string | null = null;

  /**
   * Whether sketch mode is currently active.
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * The current sketch plane (null if not in sketch mode).
   */
  get currentPlane(): ConstructionPlane | null {
    return this._currentPlane;
  }

  /**
   * The current sketch feature ID (null if not in sketch mode).
   */
  get currentSketchId(): string | null {
    return this._currentSketchId;
  }

  /**
   * Enter sketch mode on a plane.
   */
  enter(planeRef: PlaneRef, sketchId: string, bodies: Body[] = []): void {
    if (this._isActive) {
      log.warn('Already in sketch mode, exiting first');
      this.exit();
    }

    // Resolve the plane
    const plane = getConstructionPlaneFromRef(planeRef, bodies);
    if (!plane) {
      // Fall back to world plane
      if (planeRef.type === 'world' && planeRef.worldPlane) {
        this._currentPlane = createWorldConstructionPlane(
          planeRef.worldPlane,
          planeRef.offset ?? 0
        );
      } else {
        this._currentPlane = getDefaultSketchPlane();
      }
    } else {
      this._currentPlane = plane;
    }

    this._currentSketchId = sketchId;
    this._isActive = true;

    log.info('Entered sketch mode', { sketchId, planeRef });

    eventBus.emit('sketch:enter', {
      planeRef: planeRef as { id: string; type: 'world' | 'face'; worldPlane?: 'xy' | 'xz' | 'yz'; offset?: number; faceId?: string; bodyId?: string },
      sketchId,
    });

    eventBus.emit('sketch:mode:changed', {
      isActive: true,
      sketchId,
    });
  }

  /**
   * Exit sketch mode.
   */
  exit(): void {
    if (!this._isActive) {
      return;
    }

    const previousSketchId = this._currentSketchId;

    this._isActive = false;
    this._currentPlane = null;
    this._currentSketchId = null;

    log.info('Exited sketch mode', { sketchId: previousSketchId });

    if (previousSketchId) {
      eventBus.emit('sketch:exit', { sketchId: previousSketchId });
    }

    eventBus.emit('sketch:mode:changed', {
      isActive: false,
    });
  }

  /**
   * Toggle sketch mode.
   */
  toggle(planeRef?: PlaneRef, sketchId?: string, bodies?: Body[]): void {
    if (this._isActive) {
      this.exit();
    } else if (planeRef && sketchId) {
      this.enter(planeRef, sketchId, bodies);
    }
  }

  /**
   * Reset the controller state.
   */
  reset(): void {
    if (this._isActive) {
      this.exit();
    }
    this._currentPlane = null;
    this._currentSketchId = null;
  }

  /**
   * Dispose of the controller.
   */
  dispose(): void {
    this.reset();
    log.info('SketchModeController disposed');
  }
}

/**
 * Create a new sketch mode controller.
 */
export function createSketchModeController(): SketchModeController {
  return new SketchModeController();
}
