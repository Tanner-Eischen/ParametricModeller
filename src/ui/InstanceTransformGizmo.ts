import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { ComponentInstance } from '../assembly/AssemblyTypes';
import { resolveActiveCamera, type ActiveCameraSource } from './ActiveCameraSource';

const log = createModuleLogger('InstanceTransformGizmo');

export interface InstanceTransformGizmoOptions {
  snapEnabled?: boolean;
  snapDistance?: number;
  snapAngle?: number;
}

export interface InstanceTransformEditSession {
  instance: ComponentInstance;
  /** Primary rendered object retained for backward compatibility. */
  mesh: THREE.Object3D;
  /** All rendered bodies belonging to the instance. Omit for a single-body instance. */
  meshes?: readonly THREE.Object3D[];
  onSessionStart?: (instanceId: string, baselineTransform: number[]) => void;
  onPreview?: (instanceId: string, transform: number[]) => boolean | void;
  /** Lets the owner suspend and restore viewport navigation around gizmo drags. */
  onDraggingChange?: (dragging: boolean) => void;
  /** Legacy compatibility hook. Invoked only by explicit commitTransform(). */
  onCommit?: (instanceId: string, transform: number[]) => boolean | void;
}

interface ObjectTransformState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface PreviewObjectBinding {
  object: THREE.Object3D;
  parent: THREE.Object3D | null;
  childIndex: number;
  baselineState: ObjectTransformState;
}

/** Preview-only transform manipulator. ToolSession owns Enter/Escape and history. */
export class InstanceTransformGizmo {
  private scene: THREE.Scene | null = null;
  private cameraSource: ActiveCameraSource | null = null;
  private unsubscribeProjection: (() => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transformControls: any = null;
  private transformControlsHelper: THREE.Object3D | null = null;
  private session: InstanceTransformEditSession | null = null;
  private baselineObjectState: ObjectTransformState | null = null;
  private lastAcceptedObjectState: ObjectTransformState | null = null;
  private baselineTransform: number[] | null = null;
  private previewRoot: THREE.Group | null = null;
  private previewBindings: PreviewObjectBinding[] = [];
  private baselineControlWorld: THREE.Matrix4 | null = null;
  private isDragging = false;
  private isInternalUpdate = false;

  private snapEnabled: boolean;
  private snapDistance: number;
  private snapAngle: number;

  constructor(options: InstanceTransformGizmoOptions = {}) {
    this.snapEnabled = options.snapEnabled ?? true;
    this.snapDistance = options.snapDistance ?? 0.25;
    this.snapAngle = options.snapAngle ?? Math.PI / 12;
    log.debug('InstanceTransformGizmo created');
  }

  attach(scene: THREE.Scene, camera: ActiveCameraSource, domElement: HTMLElement): void {
    this.scene = scene;
    this.cameraSource = camera;
    this.transformControls = new TransformControls(resolveActiveCamera(camera), domElement);
    this.transformControlsHelper = this.transformControls.getHelper();
    this.transformControls.setSize(0.75);
    this.transformControls.setSpace('world');
    this.updateSnap();

    if (this.transformControlsHelper) scene.add(this.transformControlsHelper);

    this.transformControls.addEventListener('dragging-changed', (event: { value: boolean }) => {
      this.handleDraggingChanged(event.value);
    });
    this.transformControls.addEventListener('change', () => {
      this.updateSnap();
      this.handleTransformChange();
    });
    this.unsubscribeProjection = eventBus.on('camera:projection', () => this.syncCamera());

    log.debug('Gizmo attached to scene');
  }

  /** Preferred session API for ToolSession integration. */
  showEditor(session: InstanceTransformEditSession): void {
    if (!this.transformControls) {
      log.warn('Gizmo not attached to scene');
      return;
    }

    const meshes = this.normalizeMeshes(session);
    this.session = {
      ...session,
      mesh: meshes[0]!,
      meshes: [...meshes],
      instance: {
        ...session.instance,
        transform: [...session.instance.transform],
        lockedAxes: { ...session.instance.lockedAxes },
      },
    };
    const controlObject = meshes.length === 1
      ? meshes[0]!
      : this.createPreviewRoot(meshes, session.instance.id);
    this.baselineObjectState = this.captureObjectState(controlObject);
    this.lastAcceptedObjectState = this.captureObjectState(controlObject);
    controlObject.updateMatrixWorld(true);
    this.baselineControlWorld = controlObject.matrixWorld.clone();
    this.baselineTransform = [...session.instance.transform];
    this.isDragging = false;
    this.transformControls.attach(controlObject);
    this.updateMode();

    eventBus.emit('ui:status', {
      message: `Transforming ${session.instance.name} - drag to preview, Enter to commit, Escape to cancel.`,
    });
    log.debug('Gizmo shown', { instanceId: session.instance.id });
  }

  /** Backward-compatible display API. The callback is never invoked implicitly. */
  show(
    instance: ComponentInstance,
    mesh: THREE.Object3D,
    onCommit?: (instanceId: string, transform: number[]) => boolean | void
  ): void {
    this.showEditor({ instance, mesh, ...(onCommit ? { onCommit } : {}) });
  }

  isActive(): boolean {
    return this.session !== null;
  }

  getIsDragging(): boolean {
    return this.isDragging;
  }

  readTransform(): number[] | null {
    const object = this.transformControls?.object as THREE.Object3D | undefined;
    if (!this.session || !object) return null;
    object.updateMatrixWorld(true);
    if (this.previewRoot && this.baselineControlWorld) {
      const delta = object.matrixWorld.clone().multiply(
        this.baselineControlWorld.clone().invert()
      );
      return Array.from(delta.elements);
    }
    return Array.from(object.matrixWorld.elements);
  }

  readBaselineTransform(): number[] | null {
    return this.baselineTransform ? [...this.baselineTransform] : null;
  }

  /** Restore only the visual preview. External document rollback remains ToolSession-owned. */
  resetPreview(): boolean {
    const object = this.transformControls?.object as THREE.Object3D | undefined;
    if (!object || !this.baselineObjectState) return false;
    this.restoreObjectState(object, this.baselineObjectState);
    this.lastAcceptedObjectState = this.cloneObjectState(this.baselineObjectState);
    return true;
  }

  /** Explicit Enter-path compatibility method. No pointer event calls this. */
  commitTransform(): boolean {
    if (!this.session) return false;
    const transform = this.readTransform();
    if (!transform) return false;

    const accepted = this.session.onCommit?.(this.session.instance.id, transform);
    if (accepted === false) return false;

    eventBus.emit('instance:transformed', {
      instanceId: this.session.instance.id,
      transform,
    });
    const object = this.transformControls.object as THREE.Object3D;
    this.baselineObjectState = this.captureObjectState(object);
    this.lastAcceptedObjectState = this.captureObjectState(object);
    this.baselineTransform = [...transform];
    if (this.previewRoot) {
      this.captureCommittedBindingStates();
      object.updateMatrixWorld(true);
      this.baselineControlWorld = object.matrixWorld.clone();
    }
    log.debug('Transform explicitly committed', { instanceId: this.session.instance.id });
    return true;
  }

  /** By default hiding is cancellation-safe and restores the visual baseline. */
  hide(restorePreview = true): void {
    if (restorePreview) this.resetPreview();
    this.session?.onDraggingChange?.(false);
    if (this.transformControls) this.transformControls.detach();
    this.releasePreviewRoot(restorePreview);
    this.session = null;
    this.baselineObjectState = null;
    this.lastAcceptedObjectState = null;
    this.baselineTransform = null;
    this.baselineControlWorld = null;
    this.isDragging = false;
    log.debug('Gizmo hidden');
  }

  setMode(mode: 'translate' | 'rotate'): void {
    if (!this.transformControls || !this.session) return;
    this.transformControls.setMode(mode);
    this.applyLockedAxes(mode);
    eventBus.emit('ui:status', { message: mode === 'translate' ? 'Translate mode' : 'Rotate mode' });
  }

  setSnapEnabled(enabled: boolean): void {
    this.snapEnabled = enabled;
    this.updateSnap();
  }

  dispose(): void {
    this.hide();
    if (this.transformControlsHelper && this.scene) this.scene.remove(this.transformControlsHelper);
    this.transformControls?.dispose();
    this.transformControls = null;
    this.transformControlsHelper = null;
    this.unsubscribeProjection?.();
    this.unsubscribeProjection = null;
    this.cameraSource = null;
    this.scene = null;
    log.debug('InstanceTransformGizmo disposed');
  }

  /** Keep TransformControls bound to the camera currently used by the viewport. */
  private syncCamera(): void {
    if (this.transformControls && this.cameraSource) {
      this.transformControls.camera = resolveActiveCamera(this.cameraSource);
    }
  }

  private handleDraggingChanged(dragging: boolean): void {
    this.isDragging = dragging;
    if (!this.session) return;
    this.session.onDraggingChange?.(dragging);

    if (dragging) {
      this.session.onSessionStart?.(
        this.session.instance.id,
        this.readBaselineTransform() ?? [...this.session.instance.transform]
      );
      return;
    }

    eventBus.emit('ui:status', {
      message: `Transform preview ready for ${this.session.instance.name} - press Enter to commit or Escape to cancel.`,
    });
  }

  private handleTransformChange(): void {
    if (!this.session || !this.isDragging || this.isInternalUpdate) return;
    const transform = this.readTransform();
    if (!transform) return;

    const accepted = this.session.onPreview?.(this.session.instance.id, transform);
    if (accepted === false) {
      const object = this.transformControls.object as THREE.Object3D;
      if (this.lastAcceptedObjectState) this.restoreObjectState(object, this.lastAcceptedObjectState);
      return;
    }

    const object = this.transformControls.object as THREE.Object3D;
    this.lastAcceptedObjectState = this.captureObjectState(object);
    eventBus.emit('ui:status', {
      message: `Previewing ${this.session.instance.name}: X ${transform[12]!.toFixed(3)}, Y ${transform[13]!.toFixed(3)}, Z ${transform[14]!.toFixed(3)}`,
    });
  }

  private updateMode(): void {
    if (!this.session) return;
    const locked = this.session.instance.lockedAxes;
    this.setMode(
      locked.translateX && locked.translateY && locked.translateZ ? 'rotate' : 'translate'
    );
  }

  private applyLockedAxes(mode: 'translate' | 'rotate'): void {
    if (!this.transformControls || !this.session) return;
    const locked = this.session.instance.lockedAxes;
    this.transformControls.showX = !(mode === 'translate' ? locked.translateX : locked.rotateX);
    this.transformControls.showY = !(mode === 'translate' ? locked.translateY : locked.rotateY);
    this.transformControls.showZ = !(mode === 'translate' ? locked.translateZ : locked.rotateZ);
  }

  private updateSnap(): void {
    if (!this.transformControls) return;
    this.transformControls.setTranslationSnap(this.snapEnabled ? this.snapDistance : null);
    this.transformControls.setRotationSnap(this.snapEnabled ? this.snapAngle : null);
  }

  private captureObjectState(object: THREE.Object3D): ObjectTransformState {
    return {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    };
  }

  private normalizeMeshes(session: InstanceTransformEditSession): THREE.Object3D[] {
    const candidates = session.meshes && session.meshes.length > 0
      ? session.meshes
      : [session.mesh];
    const unique = [...new Set(candidates)];
    return unique.length > 0 ? unique : [session.mesh];
  }

  private createPreviewRoot(objects: readonly THREE.Object3D[], instanceId: string): THREE.Group {
    const root = new THREE.Group();
    root.name = `instance-transform-preview:${instanceId}`;
    this.scene?.add(root);
    root.updateMatrixWorld(true);

    this.previewBindings = objects.map((object) => ({
      object,
      parent: object.parent,
      childIndex: object.parent?.children.indexOf(object) ?? -1,
      baselineState: this.captureObjectState(object),
    }));
    for (const object of objects) {
      object.updateMatrixWorld(true);
      root.attach(object);
    }
    root.updateMatrixWorld(true);
    this.previewRoot = root;
    return root;
  }

  private captureCommittedBindingStates(): void {
    for (const binding of this.previewBindings) {
      binding.object.updateMatrixWorld(true);
      const localMatrix = binding.object.matrixWorld.clone();
      if (binding.parent) {
        binding.parent.updateMatrixWorld(true);
        localMatrix.premultiply(binding.parent.matrixWorld.clone().invert());
      }
      binding.baselineState = this.decomposeObjectMatrix(localMatrix);
    }
  }

  private releasePreviewRoot(restoreBaseline: boolean): void {
    const root = this.previewRoot;
    if (!root) return;

    const bindings = [...this.previewBindings].sort((left, right) =>
      left.childIndex - right.childIndex
    );
    for (const binding of bindings) {
      if (restoreBaseline) {
        binding.parent?.add(binding.object);
        if (!binding.parent) root.remove(binding.object);
        this.restoreObjectState(binding.object, binding.baselineState);
      } else if (binding.parent) {
        binding.parent.attach(binding.object);
      } else {
        const worldMatrix = binding.object.matrixWorld.clone();
        root.remove(binding.object);
        this.restoreObjectState(binding.object, this.decomposeObjectMatrix(worldMatrix));
      }
      this.restoreChildIndex(binding);
    }
    root.removeFromParent();
    this.previewRoot = null;
    this.previewBindings = [];
  }

  private restoreChildIndex(binding: PreviewObjectBinding): void {
    const parent = binding.parent;
    if (!parent || binding.childIndex < 0) return;
    const currentIndex = parent.children.indexOf(binding.object);
    if (currentIndex < 0 || currentIndex === binding.childIndex) return;
    parent.children.splice(currentIndex, 1);
    parent.children.splice(
      Math.min(binding.childIndex, parent.children.length),
      0,
      binding.object
    );
  }

  private decomposeObjectMatrix(matrix: THREE.Matrix4): ObjectTransformState {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);
    return { position, quaternion, scale };
  }

  private cloneObjectState(state: ObjectTransformState): ObjectTransformState {
    return {
      position: state.position.clone(),
      quaternion: state.quaternion.clone(),
      scale: state.scale.clone(),
    };
  }

  private restoreObjectState(object: THREE.Object3D, state: ObjectTransformState): void {
    this.isInternalUpdate = true;
    object.position.copy(state.position);
    object.quaternion.copy(state.quaternion);
    object.scale.copy(state.scale);
    object.updateMatrixWorld(true);
    this.isInternalUpdate = false;
  }
}
