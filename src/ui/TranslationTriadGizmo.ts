import * as THREE from 'three';
import type { BodyRef } from '../geometry/SubObjectTypes';
import {
  parseNumericInput,
  resolveNumericInput,
  type NumericInputResult,
  type NumericUnit,
} from '../interaction/NumericInput';
import { resolveActiveCamera, type ActiveCameraSource } from './ActiveCameraSource';

export type TranslationAxis = 'x' | 'y' | 'z';
export type TranslationMode = 'move' | 'copy';

export interface TranslationTriadEditSession {
  sourceBodyRef: BodyRef;
  mode: TranslationMode;
  objects: readonly THREE.Object3D[];
  origin?: [number, number, number];
  initialTranslation?: [number, number, number];
  onPreview?: (translation: [number, number, number]) => boolean | void;
  onDraggingChange?: (dragging: boolean) => void;
}

export type TranslationNumericResult =
  | { ok: true; translation: [number, number, number]; parsed: Extract<NumericInputResult, { ok: true }> }
  | { ok: false; error: string };

interface ObjectBaseline {
  object: THREE.Object3D;
  position: THREE.Vector3;
}

/** Preview-only world-axis translation triad. ToolSession owns commit and cancel. */
export class TranslationTriadGizmo {
  private scene: THREE.Scene | null = null;
  private cameraSource: ActiveCameraSource | null = null;
  private domElement: HTMLElement | null = null;
  private session: TranslationTriadEditSession | null = null;
  private baselines: ObjectBaseline[] = [];
  private arrows: THREE.ArrowHelper[] = [];
  private activeAxis: TranslationAxis = 'x';
  private currentTranslation: [number, number, number] = [0, 0, 0];
  private lastAcceptedTranslation: [number, number, number] = [0, 0, 0];
  private dragStart: { x: number; y: number; translation: [number, number, number] } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly handlePointerDown = (event: PointerEvent): void => this.onPointerDown(event);
  private readonly handlePointerMove = (event: PointerEvent): void => this.onPointerMove(event);
  private readonly handlePointerUp = (event: PointerEvent): void => this.onPointerUp(event);

  attach(scene: THREE.Scene, camera?: ActiveCameraSource, domElement?: HTMLElement): void {
    if (this.scene === scene && this.cameraSource === (camera ?? null) && this.domElement === (domElement ?? null)) return;
    this.detachPointerEvents();
    this.hide();
    this.scene = scene;
    this.cameraSource = camera ?? null;
    this.domElement = domElement ?? null;
    this.attachPointerEvents();
  }

  showEditor(session: TranslationTriadEditSession): void {
    if (!this.scene) throw new Error('TranslationTriadGizmo must be attached before use');
    if (session.objects.length === 0) throw new Error('Translation triad requires at least one preview object');
    this.hide();
    this.session = {
      ...session,
      sourceBodyRef: { ...session.sourceBodyRef },
      objects: [...session.objects],
      ...(session.origin ? { origin: [...session.origin] } : {}),
      ...(session.initialTranslation
        ? { initialTranslation: [...session.initialTranslation] }
        : {}),
    };
    this.baselines = session.objects.map((object) => ({
      object,
      position: object.position.clone(),
    }));
    this.currentTranslation = session.initialTranslation
      ? [...session.initialTranslation]
      : [0, 0, 0];
    this.lastAcceptedTranslation = [...this.currentTranslation];
    this.createArrows(session.origin ?? this.computeOrigin(session.objects));
    this.applyVisualTranslation(this.currentTranslation);
  }

  isActive(): boolean {
    return this.session !== null;
  }

  setAxis(axis: TranslationAxis): void {
    this.activeAxis = axis;
  }

  getAxis(): TranslationAxis {
    return this.activeAxis;
  }

  readTranslation(): [number, number, number] {
    return [...this.currentTranslation];
  }

  previewTranslation(translation: [number, number, number]): boolean {
    if (!this.session || !translation.every(Number.isFinite)) return false;
    this.applyVisualTranslation(translation);
    const accepted = this.session.onPreview?.([...translation]);
    if (accepted === false) {
      this.applyVisualTranslation(this.lastAcceptedTranslation);
      this.currentTranslation = [...this.lastAcceptedTranslation];
      return false;
    }
    this.currentTranslation = [...translation];
    this.lastAcceptedTranslation = [...translation];
    return true;
  }

  submitNumeric(raw: string, defaultUnit: NumericUnit = 'in'): TranslationNumericResult {
    const parsed = parseNumericInput(raw, { defaultUnit });
    if (!parsed.ok) return parsed;
    const index = axisIndex(this.activeAxis);
    const translation = [...this.currentTranslation] as [number, number, number];
    translation[index] = resolveNumericInput(translation[index], parsed);
    if (!this.previewTranslation(translation)) {
      return { ok: false, error: 'Translation preview was rejected' };
    }
    return { ok: true, translation, parsed };
  }

  resetPreview(): boolean {
    if (!this.session) return false;
    this.applyVisualTranslation([0, 0, 0]);
    this.currentTranslation = [0, 0, 0];
    this.lastAcceptedTranslation = [0, 0, 0];
    return true;
  }

  hide(restorePreview = true): void {
    if (this.dragStart) this.session?.onDraggingChange?.(false);
    this.dragStart = null;
    if (restorePreview && this.session) this.resetPreview();
    for (const arrow of this.arrows) {
      this.scene?.remove(arrow);
      arrow.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose();
      });
    }
    this.arrows = [];
    this.session = null;
    this.baselines = [];
    this.currentTranslation = [0, 0, 0];
    this.lastAcceptedTranslation = [0, 0, 0];
  }

  dispose(): void {
    this.hide();
    this.detachPointerEvents();
    this.scene = null;
    this.cameraSource = null;
    this.domElement = null;
  }

  private applyVisualTranslation(translation: [number, number, number]): void {
    for (const baseline of this.baselines) {
      baseline.object.position.copy(baseline.position).add(new THREE.Vector3(...translation));
      baseline.object.updateMatrixWorld(true);
    }
  }

  private createArrows(origin: [number, number, number]): void {
    const specs: Array<[THREE.Vector3, number]> = [
      [new THREE.Vector3(1, 0, 0), 0xe74c3c],
      [new THREE.Vector3(0, 1, 0), 0x2ecc71],
      [new THREE.Vector3(0, 0, 1), 0x3498db],
    ];
    const axes: TranslationAxis[] = ['x', 'y', 'z'];
    this.arrows = specs.map(([direction, color], index) => {
      const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(...origin), 1.25, color, 0.3, 0.18);
      arrow.traverse((object) => {
        object.userData.translationAxis = axes[index];
      });
      return arrow;
    });
    this.arrows.forEach((arrow) => this.scene!.add(arrow));
  }

  private computeOrigin(objects: readonly THREE.Object3D[]): [number, number, number] {
    const center = objects.reduce(
      (sum, object) => sum.add(object.getWorldPosition(new THREE.Vector3())),
      new THREE.Vector3()
    ).multiplyScalar(1 / objects.length);
    return [center.x, center.y, center.z];
  }

  private attachPointerEvents(): void {
    this.domElement?.addEventListener('pointerdown', this.handlePointerDown);
    this.domElement?.addEventListener('pointermove', this.handlePointerMove);
    this.domElement?.addEventListener('pointerup', this.handlePointerUp);
    this.domElement?.addEventListener('pointercancel', this.handlePointerUp);
  }

  private detachPointerEvents(): void {
    this.domElement?.removeEventListener('pointerdown', this.handlePointerDown);
    this.domElement?.removeEventListener('pointermove', this.handlePointerMove);
    this.domElement?.removeEventListener('pointerup', this.handlePointerUp);
    this.domElement?.removeEventListener('pointercancel', this.handlePointerUp);
    this.dragStart = null;
  }

  private onPointerDown(event: PointerEvent): void {
    const camera = this.cameraSource ? resolveActiveCamera(this.cameraSource) : null;
    if (!this.session || !camera || !this.domElement) return;
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.params.Line = { threshold: 0.12 };
    this.raycaster.setFromCamera(this.pointer, camera);
    const hit = this.raycaster.intersectObjects(this.arrows, true)[0]?.object;
    const axis = hit?.userData.translationAxis as TranslationAxis | undefined;
    if (!axis) return;
    this.activeAxis = axis;
    this.dragStart = { x: event.clientX, y: event.clientY, translation: this.readTranslation() };
    this.session.onDraggingChange?.(true);
    this.domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  private onPointerMove(event: PointerEvent): void {
    const camera = this.cameraSource ? resolveActiveCamera(this.cameraSource) : null;
    if (!this.dragStart || !camera || !this.domElement || this.arrows.length === 0) return;
    const rect = this.domElement.getBoundingClientRect();
    const origin = this.arrows[0]!.position.clone();
    const axisVector = this.activeAxis === 'x'
      ? new THREE.Vector3(1, 0, 0)
      : this.activeAxis === 'y'
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
    const projectedOrigin = origin.clone().project(camera);
    const projectedEnd = origin.clone().add(axisVector).project(camera);
    const screenAxis = new THREE.Vector2(
      (projectedEnd.x - projectedOrigin.x) * rect.width / 2,
      -(projectedEnd.y - projectedOrigin.y) * rect.height / 2
    );
    if (screenAxis.lengthSq() < 1e-6) return;
    screenAxis.normalize();
    const pixels = (event.clientX - this.dragStart.x) * screenAxis.x
      + (event.clientY - this.dragStart.y) * screenAxis.y;
    const next = [...this.dragStart.translation] as [number, number, number];
    next[axisIndex(this.activeAxis)] += pixels / 80;
    this.previewTranslation(next);
    event.preventDefault();
    event.stopPropagation();
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.dragStart) return;
    this.dragStart = null;
    this.session?.onDraggingChange?.(false);
    this.domElement?.releasePointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }
}

function axisIndex(axis: TranslationAxis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}
