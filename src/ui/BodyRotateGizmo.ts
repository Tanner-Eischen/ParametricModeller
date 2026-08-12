import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { CameraControls } from '../rendering/CameraControls';
import { resolveActiveCamera } from './ActiveCameraSource';

const log = createModuleLogger('BodyRotateGizmo');

type RotationDegrees = [number, number, number];
type Pivot = [number, number, number];

export interface BodyRotateGizmoOptions {
  snapEnabled?: boolean;
  snapAngleDegrees?: number;
  markerColor?: number;
  activeMarkerColor?: number;
  /**
   * Notifies the owner when the TransformControls drag starts/ends. The owner
   * centralizes camera-navigation suppression across all gizmos so one gizmo
   * never re-enables orbit while another is still dragging.
   */
  onDraggingChange?: (dragging: boolean) => void;
  /**
   * Notifies the owner when the editor session is shown/hidden. Rotate is a
   * modal operation, so the owner keeps the camera locked for the whole session
   * (not only while dragging) to guarantee ring drags never fall through to
   * orbit.
   */
  onActiveChange?: (active: boolean) => void;
}

export interface BodyRotateEditSession {
  featureId: string;
  bodyId: string;
  pivot: Pivot;
  rotationDegrees: RotationDegrees;
  /** Rendered body groups changed only for the lifetime of this preview. */
  objects?: readonly THREE.Object3D[];
  onSessionStart?: (featureId: string) => void;
  onPreview?: (featureId: string, rotationDegrees: RotationDegrees) => boolean;
  onCommit?: (featureId: string, rotationDegrees: RotationDegrees) => boolean;
}

interface ObjectTransformState {
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

const DEFAULT_OPTIONS: Required<BodyRotateGizmoOptions> = {
  snapEnabled: true,
  snapAngleDegrees: 15,
  markerColor: 0xffb054,
  activeMarkerColor: 0x59c2ff,
  onDraggingChange: () => undefined,
  onActiveChange: () => undefined,
};

export class BodyRotateGizmo {
  private scene: THREE.Scene | null = null;
  private cameraControls: CameraControls | null = null;
  private unsubscribeProjection: (() => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transformControls: any = null;
  private transformControlsHelper: THREE.Object3D | null = null;
  private readonly anchor = new THREE.Object3D();
  private readonly marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly options: Required<BodyRotateGizmoOptions>;
  private session: BodyRotateEditSession | null = null;
  private isDragging = false;
  private isInternalUpdate = false;
  private lastAcceptedRotation: RotationDegrees = [0, 0, 0];
  private previewBaselines: ObjectTransformState[] = [];

  constructor(options: BodyRotateGizmoOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    const geometry = new THREE.SphereGeometry(0.09, 20, 20);
    const material = new THREE.MeshStandardMaterial({
      color: this.options.markerColor,
      emissive: this.options.markerColor,
      emissiveIntensity: 0.25,
      metalness: 0.15,
      roughness: 0.35,
      transparent: true,
      opacity: 0.9,
    });

    this.marker = new THREE.Mesh(geometry, material);
    this.marker.visible = false;
    this.marker.renderOrder = 2;
    this.anchor.visible = false;
    this.anchor.add(this.marker);
  }

  attach(scene: THREE.Scene, cameraControls: CameraControls, domElement: HTMLElement): void {
    this.scene = scene;
    this.cameraControls = cameraControls;

    this.transformControls = new TransformControls(cameraControls.camera, domElement);
    this.transformControlsHelper = this.transformControls.getHelper();
    this.transformControls.setMode('rotate');
    this.transformControls.setSpace('world');
    this.transformControls.setSize(0.95);
    this.updateSnap();

    this.transformControls.addEventListener('dragging-changed', (event: { value: boolean }) => {
      this.handleDraggingChanged(event.value);
    });
    this.transformControls.addEventListener('change', () => {
      this.handleTransformChange();
    });
    this.unsubscribeProjection = eventBus.on('camera:projection', () => {
      if (this.transformControls && this.cameraControls) {
        this.transformControls.camera = resolveActiveCamera(this.cameraControls);
      }
    });

    scene.add(this.anchor);
    if (this.transformControlsHelper) {
      scene.add(this.transformControlsHelper);
    }

    log.debug('BodyRotateGizmo attached');
  }

  showEditor(session: BodyRotateEditSession): void {
    if (!this.transformControls) {
      return;
    }

    this.resetPreview();
    this.session = {
      ...session,
      pivot: [...session.pivot],
      rotationDegrees: [...session.rotationDegrees],
      ...(session.objects ? { objects: [...session.objects] } : {}),
    };
    this.previewBaselines = (session.objects ?? []).map((object) => ({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    }));
    this.lastAcceptedRotation = [...session.rotationDegrees];
    this.setMarkerColor(this.options.activeMarkerColor);
    this.setAnchorState(session.pivot, session.rotationDegrees);
    this.anchor.visible = true;
    this.marker.visible = true;

    if (this.transformControls.object !== this.anchor) {
      this.transformControls.attach(this.anchor);
    }

    this.options.onActiveChange(true);
    eventBus.emit('ui:status', {
      message: 'Rotate gizmo active - drag the colored rings or fine-tune X/Y/Z in Properties.',
    });
  }

  hide(): void {
    this.resetPreview();
    this.session = null;
    const wasDragging = this.isDragging;
    this.isDragging = false;
    this.lastAcceptedRotation = [0, 0, 0];
    this.previewBaselines = [];
    if (this.transformControls) {
      this.transformControls.detach();
    }
    if (wasDragging) {
      this.options.onDraggingChange(false);
    }
    this.options.onActiveChange(false);
    this.anchor.visible = false;
    this.marker.visible = false;
  }

  resetPreview(): boolean {
    const restoredObjects = this.previewBaselines.length > 0;
    for (const baseline of this.previewBaselines) {
      baseline.object.position.copy(baseline.position);
      baseline.object.quaternion.copy(baseline.quaternion);
      baseline.object.scale.copy(baseline.scale);
      baseline.object.updateMatrixWorld(true);
    }
    if (this.session) {
      this.lastAcceptedRotation = [...this.session.rotationDegrees];
      this.setAnchorState(this.session.pivot, this.session.rotationDegrees);
    }
    return restoredObjects;
  }

  setSnapEnabled(enabled: boolean, snapAngleDegrees?: number): void {
    this.options.snapEnabled = enabled;
    if (typeof snapAngleDegrees === 'number' && snapAngleDegrees > 0) {
      this.options.snapAngleDegrees = snapAngleDegrees;
    }
    this.updateSnap();
  }

  dispose(): void {
    this.hide();

    if (this.transformControlsHelper && this.scene) {
      this.scene.remove(this.transformControlsHelper);
    }
    if (this.scene) {
      this.scene.remove(this.anchor);
    }
    if (this.transformControls) {
      this.transformControls.dispose();
    }
    this.marker.geometry.dispose();
    this.marker.material.dispose();

    this.transformControls = null;
    this.transformControlsHelper = null;
    this.unsubscribeProjection?.();
    this.unsubscribeProjection = null;
    this.scene = null;
    this.cameraControls = null;
  }

  private handleDraggingChanged(isDragging: boolean): void {
    this.isDragging = isDragging;
    // Orbit suppression is centralized in the owning App (see applyOrbitSuppression)
    // so that every active gizmo agrees on whether the camera may move.
    this.options.onDraggingChange(isDragging);

    if (isDragging && this.session) {
      this.session.onSessionStart?.(this.session.featureId);
    } else if (!isDragging && this.session) {
      eventBus.emit('ui:status', {
        message: `Rotation preview ready for ${this.session.bodyId} - press Enter to commit or Escape to cancel.`,
      });
    }
  }

  private handleTransformChange(): void {
    if (
      !this.session ||
      !this.isDragging ||
      !this.transformControls?.object ||
      this.isInternalUpdate
    ) {
      return;
    }

    const rotationDegrees = this.readRotationFromAnchor();
    const accepted = this.session.onPreview?.(this.session.featureId, rotationDegrees) ?? true;

    if (accepted) {
      this.applyVisualRotation(rotationDegrees);
      this.lastAcceptedRotation = [...rotationDegrees];
      eventBus.emit('ui:status', {
        message: `Rotating ${this.session.bodyId}: X ${rotationDegrees[0].toFixed(1)} deg, Y ${rotationDegrees[1].toFixed(1)} deg, Z ${rotationDegrees[2].toFixed(1)} deg`,
        announce: false,
      });
      return;
    }

    this.setAnchorState(this.session.pivot, this.lastAcceptedRotation);
    this.applyVisualRotation(this.lastAcceptedRotation);
  }

  private applyVisualRotation(rotationDegrees: RotationDegrees): void {
    if (!this.session || this.previewBaselines.length === 0) return;
    const delta = rotationDegrees.map((value, index) =>
      THREE.MathUtils.degToRad(value - this.session!.rotationDegrees[index]!)
    ) as RotationDegrees;
    const pivot = new THREE.Vector3(...this.session.pivot);
    const worldDelta = new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...delta, 'XYZ')))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));

    for (const baseline of this.previewBaselines) {
      baseline.object.parent?.updateMatrixWorld(true);
      const baselineLocal = new THREE.Matrix4().compose(
        baseline.position,
        baseline.quaternion,
        baseline.scale
      );
      const parentWorld = baseline.object.parent?.matrixWorld ?? new THREE.Matrix4();
      const baselineWorld = parentWorld.clone().multiply(baselineLocal);
      const nextLocal = parentWorld.clone().invert().multiply(worldDelta).multiply(baselineWorld);
      nextLocal.decompose(baseline.object.position, baseline.object.quaternion, baseline.object.scale);
      baseline.object.updateMatrixWorld(true);
    }
  }

  private readRotationFromAnchor(): RotationDegrees {
    const degrees: RotationDegrees = [
      THREE.MathUtils.radToDeg(this.anchor.rotation.x),
      THREE.MathUtils.radToDeg(this.anchor.rotation.y),
      THREE.MathUtils.radToDeg(this.anchor.rotation.z),
    ];

    return this.options.snapEnabled
      ? degrees.map((value) => this.snapAngle(value)) as RotationDegrees
      : degrees;
  }

  private snapAngle(value: number): number {
    const step = this.options.snapAngleDegrees;
    return Math.round(value / step) * step;
  }

  private setAnchorState(pivot: Pivot, rotationDegrees: RotationDegrees): void {
    this.isInternalUpdate = true;
    this.anchor.position.set(pivot[0], pivot[1], pivot[2]);
    this.anchor.rotation.set(
      THREE.MathUtils.degToRad(rotationDegrees[0]),
      THREE.MathUtils.degToRad(rotationDegrees[1]),
      THREE.MathUtils.degToRad(rotationDegrees[2]),
      'XYZ'
    );
    this.anchor.updateMatrixWorld(true);
    this.isInternalUpdate = false;
  }

  private updateSnap(): void {
    if (!this.transformControls) {
      return;
    }

    this.transformControls.setRotationSnap(
      this.options.snapEnabled ? THREE.MathUtils.degToRad(this.options.snapAngleDegrees) : null
    );
  }

  private setMarkerColor(color: number): void {
    this.marker.material.color.setHex(color);
    this.marker.material.emissive.setHex(color);
  }
}
