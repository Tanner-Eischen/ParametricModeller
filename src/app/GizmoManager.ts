import type { CameraControls } from '../rendering/CameraControls';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('GizmoManager');

export type GizmoDragKey = 'pushPull' | 'bodyRotate' | 'moveVertex' | 'instance' | 'moveCopy';

/**
 * Owns per-gizmo drag state and the centralized camera-navigation suppression
 * shared by every gizmo. Orbit is suppressed whenever ANY gizmo is dragging or
 * a modal rotate session is open, so one gizmo ending a drag can never
 * re-enable the camera while another is still mid-drag — the former
 * rotate-gizmo-steals-camera bug.
 *
 * The gizmo instances themselves remain owned by App (their editor callbacks
 * are tool-specific); this class only coordinates the navigation claim.
 */
export class GizmoManager {
  private readonly dragState: Record<GizmoDragKey, boolean> = {
    pushPull: false,
    bodyRotate: false,
    moveVertex: false,
    instance: false,
    moveCopy: false,
  };
  /** Rotate is modal: the camera stays locked for the whole editor session. */
  private rotateSessionActive = false;
  private readonly getCameraControls: () => CameraControls;

  constructor(deps: { getCameraControls: () => CameraControls }) {
    this.getCameraControls = deps.getCameraControls;
  }

  /** True while any gizmo is dragging or the modal rotate session is open. */
  isAnyOwningNavigation(): boolean {
    return this.rotateSessionActive
      || (Object.values(this.dragState) as boolean[]).some(Boolean);
  }

  /** Record a gizmo drag-state change and re-evaluate camera suppression. */
  setDragState(key: GizmoDragKey, dragging: boolean): void {
    this.dragState[key] = dragging;
    this.applyOrbitSuppression();
  }

  /** Toggle the modal rotate-session camera lock. */
  setRotateSessionActive(active: boolean): void {
    this.rotateSessionActive = active;
    this.applyOrbitSuppression();
  }

  /** Clear every gizmo navigation claim (used when a tool session ends). */
  releaseAll(): void {
    (Object.keys(this.dragState) as GizmoDragKey[]).forEach((key) => {
      this.dragState[key] = false;
    });
    this.rotateSessionActive = false;
    this.applyOrbitSuppression();
    log.debug('Released all gizmo navigation claims');
  }

  private applyOrbitSuppression(): void {
    this.getCameraControls().orbitControls.enabled = !this.isAnyOwningNavigation();
  }
}
