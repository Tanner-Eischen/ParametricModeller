import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { CameraControls } from '../rendering/CameraControls';
import type { VertexRef } from '../geometry/SubObjectTypes';
import { snapToGrid } from './Snapping';
import { resolveActiveCamera } from './ActiveCameraSource';

const log = createModuleLogger('MoveVertexGizmo');

type Translation = [number, number, number];
type AxisConstraint = 'x' | 'y' | 'z' | undefined;

export interface MoveVertexGizmoOptions {
  snapEnabled?: boolean;
  snapDistance?: number;
  markerColor?: number;
  activeMarkerColor?: number;
  markerRadius?: number;
  /** Notifies the owner to centralize camera-navigation suppression (see App). */
  onDraggingChange?: (dragging: boolean) => void;
}

export interface MoveVertexEditSession {
  featureId: string;
  vertexRef: VertexRef;
  basePosition: Translation;
  translation: Translation;
  constrainAxis?: AxisConstraint;
  /** Rendered body group deformed only for the lifetime of this preview. */
  object?: THREE.Object3D;
  onSessionStart?: (featureId: string) => void;
  onPreview?: (featureId: string, translation: Translation) => boolean;
  onCommit?: (featureId: string, translation: Translation) => boolean;
}

interface PositionAttributeBaseline {
  object: THREE.Object3D;
  attribute: THREE.BufferAttribute;
  values: Float32Array;
  localVertex: THREE.Vector3;
  geometry: THREE.BufferGeometry;
}

export interface MoveVertexTarget {
  vertexId: string;
  position: Translation;
}

const DEFAULT_OPTIONS: Required<MoveVertexGizmoOptions> = {
  snapEnabled: true,
  snapDistance: 0.0625,
  markerColor: 0xffd36d,
  activeMarkerColor: 0x59c2ff,
  markerRadius: 0.08,
  onDraggingChange: () => undefined,
};

export class MoveVertexGizmo {
  private scene: THREE.Scene | null = null;
  private cameraControls: CameraControls | null = null;
  private unsubscribeProjection: (() => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transformControls: any = null;
  private transformControlsHelper: THREE.Object3D | null = null;
  private readonly anchor = new THREE.Object3D();
  private readonly targetGroup = new THREE.Group();
  private readonly marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly targetGeometry: THREE.SphereGeometry;
  private readonly targetMaterial: THREE.MeshStandardMaterial;
  private readonly activeTargetMaterial: THREE.MeshStandardMaterial;
  private readonly options: Required<MoveVertexGizmoOptions>;
  private mode: 'hidden' | 'selection' | 'edit' = 'hidden';
  private session: MoveVertexEditSession | null = null;
  private isDragging = false;
  private isInternalUpdate = false;
  private lastAcceptedTranslation: Translation = [0, 0, 0];
  private previewBaselines: PositionAttributeBaseline[] = [];

  constructor(options: MoveVertexGizmoOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    const geometry = new THREE.SphereGeometry(this.options.markerRadius, 18, 18);
    const material = new THREE.MeshStandardMaterial({
      color: this.options.markerColor,
      emissive: this.options.markerColor,
      emissiveIntensity: 0.25,
      metalness: 0.15,
      roughness: 0.3,
      transparent: true,
      opacity: 0.95,
    });

    this.targetGeometry = new THREE.SphereGeometry(this.options.markerRadius * 0.52, 14, 14);
    this.targetMaterial = new THREE.MeshStandardMaterial({
      color: 0x7d95b3,
      emissive: 0x32465f,
      emissiveIntensity: 0.18,
      metalness: 0.12,
      roughness: 0.42,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.activeTargetMaterial = new THREE.MeshStandardMaterial({
      color: this.options.activeMarkerColor,
      emissive: this.options.activeMarkerColor,
      emissiveIntensity: 0.24,
      metalness: 0.1,
      roughness: 0.32,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
    });

    this.marker = new THREE.Mesh(geometry, material);
    this.marker.visible = false;
    this.marker.renderOrder = 2;
    this.anchor.visible = false;
    this.anchor.add(this.marker);
    this.targetGroup.visible = false;
  }

  attach(scene: THREE.Scene, cameraControls: CameraControls, domElement: HTMLElement): void {
    this.scene = scene;
    this.cameraControls = cameraControls;

    this.transformControls = new TransformControls(cameraControls.camera, domElement);
    this.transformControlsHelper = this.transformControls.getHelper();
    this.transformControls.setMode('translate');
    this.transformControls.setSpace('world');
    this.transformControls.setSize(0.8);

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
    scene.add(this.targetGroup);
    if (this.transformControlsHelper) {
      scene.add(this.transformControlsHelper);
    }

    log.debug('MoveVertexGizmo attached');
  }

  showSelection(position: Translation): void {
    if (!this.scene) {
      return;
    }

    this.mode = 'selection';
    this.session = null;
    this.lastAcceptedTranslation = [0, 0, 0];
    this.detachControls();
    this.setMarkerColor(this.options.markerColor);
    this.setAnchorPosition(position);
    this.anchor.visible = true;
    this.marker.visible = true;
  }

  showEditor(session: MoveVertexEditSession): void {
    if (!this.scene || !this.transformControls) {
      return;
    }

    this.resetPreview();
    this.mode = 'edit';
    this.session = {
      ...session,
      basePosition: [...session.basePosition],
      translation: [...session.translation],
    };
    this.lastAcceptedTranslation = [...session.translation];
    this.capturePreviewGeometry(session);
    this.setMarkerColor(this.options.activeMarkerColor);
    this.setAxisConstraint(session.constrainAxis);
    this.anchor.visible = true;
    this.marker.visible = true;
    this.setAnchorPosition(this.translatePosition(session.basePosition, session.translation));

    if (this.transformControls.object !== this.anchor) {
      this.transformControls.attach(this.anchor);
    }
  }

  hide(): void {
    this.resetPreview();
    this.mode = 'hidden';
    const wasDragging = this.isDragging;
    this.session = null;
    this.isDragging = false;
    this.lastAcceptedTranslation = [0, 0, 0];
    this.previewBaselines = [];
    this.detachControls();
    if (wasDragging) {
      this.options.onDraggingChange(false);
    }
    this.anchor.visible = false;
    this.marker.visible = false;
  }

  resetPreview(): boolean {
    const restoredGeometry = this.previewBaselines.length > 0;
    for (const baseline of this.previewBaselines) {
      baseline.attribute.array.set(baseline.values);
      baseline.attribute.needsUpdate = true;
      baseline.geometry.computeBoundingBox();
      baseline.geometry.computeBoundingSphere();
    }
    if (this.session) {
      this.lastAcceptedTranslation = [...this.session.translation];
      this.setAnchorPosition(this.translatePosition(
        this.session.basePosition,
        this.session.translation
      ));
    }
    return restoredGeometry;
  }

  setVertexTargets(targets: MoveVertexTarget[], activeVertexId: string | null): void {
    this.targetGroup.clear();
    if (!this.scene || targets.length === 0) {
      this.targetGroup.visible = false;
      return;
    }

    for (const target of targets) {
      const marker = new THREE.Mesh(
        this.targetGeometry,
        target.vertexId === activeVertexId ? this.activeTargetMaterial : this.targetMaterial
      );
      marker.position.set(target.position[0], target.position[1], target.position[2]);
      marker.renderOrder = 1;
      this.targetGroup.add(marker);
    }

    this.targetGroup.visible = true;
  }

  clearVertexTargets(): void {
    this.targetGroup.clear();
    this.targetGroup.visible = false;
  }

  setSnapEnabled(enabled: boolean, snapDistance?: number): void {
    this.options.snapEnabled = enabled;
    if (typeof snapDistance === 'number' && snapDistance > 0) {
      this.options.snapDistance = snapDistance;
    }
  }

  dispose(): void {
    this.hide();

    if (this.transformControlsHelper && this.scene) {
      this.scene.remove(this.transformControlsHelper);
    }
    if (this.scene) {
      this.scene.remove(this.anchor);
      this.scene.remove(this.targetGroup);
    }

    if (this.transformControls) {
      this.transformControls.dispose();
    }
    this.targetGeometry.dispose();
    this.targetMaterial.dispose();
    this.activeTargetMaterial.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();

    this.transformControls = null;
    this.transformControlsHelper = null;
    this.unsubscribeProjection?.();
    this.unsubscribeProjection = null;
    this.scene = null;
    this.cameraControls = null;

    log.debug('MoveVertexGizmo disposed');
  }

  private handleDraggingChanged(isDragging: boolean): void {
    this.isDragging = isDragging;
    // Orbit suppression is centralized in the owning App (see applyOrbitSuppression).
    this.options.onDraggingChange(isDragging);

    if (isDragging && this.mode === 'edit' && this.session) {
      this.session.onSessionStart?.(this.session.featureId);
    } else if (!isDragging && this.mode === 'edit' && this.session) {
      eventBus.emit('ui:status', {
        message: `Move preview ready for ${this.session.vertexRef.vertexId} - press Enter to commit or Escape to cancel.`,
      });
    }
  }

  private handleTransformChange(): void {
    if (
      this.mode !== 'edit' ||
      !this.session ||
      !this.isDragging ||
      !this.transformControls?.object ||
      this.isInternalUpdate
    ) {
      return;
    }

    const translation = this.readTranslationFromAnchor();
    const accepted = this.session.onPreview?.(this.session.featureId, translation) ?? true;

    if (accepted) {
      this.applyVisualTranslation(translation);
      this.lastAcceptedTranslation = [...translation];
      eventBus.emit('ui:status', {
        message: `Moving ${this.session.vertexRef.vertexId}: dX ${translation[0].toFixed(3)}, dY ${translation[1].toFixed(3)}, dZ ${translation[2].toFixed(3)}`,
        announce: false,
      });
      return;
    }

    this.setAnchorPosition(
      this.translatePosition(this.session.basePosition, this.lastAcceptedTranslation)
    );
    this.applyVisualTranslation(this.lastAcceptedTranslation);
  }

  private capturePreviewGeometry(session: MoveVertexEditSession): void {
    this.previewBaselines = [];
    if (!session.object) return;
    const currentWorldVertex = new THREE.Vector3(...this.translatePosition(
      session.basePosition,
      session.translation
    ));
    session.object.updateMatrixWorld(true);
    session.object.traverse((object) => {
      const geometry = (object as THREE.Mesh | THREE.LineSegments).geometry;
      const attribute = geometry?.getAttribute('position');
      if (!(attribute instanceof THREE.BufferAttribute)) return;
      object.updateMatrixWorld(true);
      this.previewBaselines.push({
        object,
        attribute,
        values: new Float32Array(attribute.array as ArrayLike<number>),
        localVertex: object.worldToLocal(currentWorldVertex.clone()),
        geometry,
      });
    });
  }

  private applyVisualTranslation(translation: Translation): void {
    if (!this.session) return;
    const delta = new THREE.Vector3(
      translation[0] - this.session.translation[0],
      translation[1] - this.session.translation[1],
      translation[2] - this.session.translation[2]
    );
    const epsilonSq = 1e-8;
    for (const baseline of this.previewBaselines) {
      baseline.object.updateMatrixWorld(true);
      const currentWorld = baseline.object.localToWorld(baseline.localVertex.clone());
      const localDelta = baseline.object.worldToLocal(currentWorld.add(delta)).sub(
        baseline.localVertex
      );
      baseline.attribute.array.set(baseline.values);
      for (let index = 0; index < baseline.attribute.count; index++) {
        const offset = index * baseline.attribute.itemSize;
        const point = new THREE.Vector3(
          baseline.values[offset]!,
          baseline.values[offset + 1]!,
          baseline.values[offset + 2]!
        );
        if (point.distanceToSquared(baseline.localVertex) <= epsilonSq) {
          baseline.attribute.setXYZ(
            index,
            point.x + localDelta.x,
            point.y + localDelta.y,
            point.z + localDelta.z
          );
        }
      }
      baseline.attribute.needsUpdate = true;
      baseline.geometry.computeBoundingBox();
      baseline.geometry.computeBoundingSphere();
    }
  }

  private readTranslationFromAnchor(): Translation {
    const session = this.session;
    if (!session) {
      return [0, 0, 0];
    }

    const translation: Translation = [
      this.anchor.position.x - session.basePosition[0],
      this.anchor.position.y - session.basePosition[1],
      this.anchor.position.z - session.basePosition[2],
    ];

    const constrained = this.applyAxisConstraint(translation, session.constrainAxis);
    const snapped = this.options.snapEnabled
      ? ([
          snapToGrid(constrained[0], this.options.snapDistance),
          snapToGrid(constrained[1], this.options.snapDistance),
          snapToGrid(constrained[2], this.options.snapDistance),
        ] as Translation)
      : constrained;

    const expectedPosition = this.translatePosition(session.basePosition, snapped);
    if (!this.positionsEqual(expectedPosition, [
      this.anchor.position.x,
      this.anchor.position.y,
      this.anchor.position.z,
    ])) {
      this.setAnchorPosition(expectedPosition);
    }

    return snapped;
  }

  private applyAxisConstraint(
    translation: Translation,
    axis: AxisConstraint
  ): Translation {
    if (!axis) {
      return [...translation];
    }

    if (axis === 'x') {
      return [translation[0], 0, 0];
    }
    if (axis === 'y') {
      return [0, translation[1], 0];
    }

    return [0, 0, translation[2]];
  }

  private setAnchorPosition(position: Translation): void {
    this.isInternalUpdate = true;
    this.anchor.position.set(position[0], position[1], position[2]);
    this.anchor.updateMatrixWorld(true);
    this.isInternalUpdate = false;
  }

  private translatePosition(base: Translation, translation: Translation): Translation {
    return [
      base[0] + translation[0],
      base[1] + translation[1],
      base[2] + translation[2],
    ];
  }

  private positionsEqual(left: Translation, right: Translation): boolean {
    const epsilon = 1e-6;
    return (
      Math.abs(left[0] - right[0]) <= epsilon &&
      Math.abs(left[1] - right[1]) <= epsilon &&
      Math.abs(left[2] - right[2]) <= epsilon
    );
  }

  private setAxisConstraint(axis: AxisConstraint): void {
    if (!this.transformControls) {
      return;
    }

    this.transformControls.showX = axis === undefined || axis === 'x';
    this.transformControls.showY = axis === undefined || axis === 'y';
    this.transformControls.showZ = axis === undefined || axis === 'z';
  }

  private setMarkerColor(color: number): void {
    this.marker.material.color.setHex(color);
    this.marker.material.emissive.setHex(color);
  }

  private detachControls(): void {
    if (this.transformControls) {
      this.transformControls.detach();
    }
  }
}
