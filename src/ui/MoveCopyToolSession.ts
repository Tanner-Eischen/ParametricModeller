import type { BodyRef } from '../geometry/SubObjectTypes';
import type { MoveCopyMode, MoveCopyParams } from '../features/transform/MoveCopyFeature';
import type { NumericUnit } from '../interaction/NumericInput';
import type { ToolSession, ToolSessionPhase } from '../interaction/ToolSession';
import {
  TranslationTriadGizmo,
  type TranslationAxis,
  type TranslationNumericResult,
} from './TranslationTriadGizmo';
import type * as THREE from 'three';

export interface MoveCopyToolSessionOptions {
  id: string;
  sourceBodyRef: BodyRef;
  mode: MoveCopyMode;
  objects: readonly THREE.Object3D[];
  gizmo: TranslationTriadGizmo;
  origin?: [number, number, number];
  initialTranslation?: [number, number, number];
  defaultUnit?: NumericUnit;
  onPreview: (params: MoveCopyParams) => boolean | void;
  onDraggingChange?: (dragging: boolean) => void;
  onCommit: (params: MoveCopyParams) => boolean | void;
  onCancel?: () => void;
}

/** Ctrl+D-ready ToolSession adapter for preview-first Move/Copy. */
export class MoveCopyToolSession implements ToolSession {
  readonly kind = 'move-copy';
  readonly id: string;
  private readonly options: MoveCopyToolSessionOptions;
  private sessionPhase: ToolSessionPhase = 'awaiting-input';
  private hasAcceptedPreview = false;
  private ended = false;

  constructor(options: MoveCopyToolSessionOptions) {
    this.options = {
      ...options,
      sourceBodyRef: { ...options.sourceBodyRef },
      objects: [...options.objects],
      ...(options.origin ? { origin: [...options.origin] } : {}),
      ...(options.initialTranslation
        ? { initialTranslation: [...options.initialTranslation] }
        : {}),
    };
    this.id = options.id;
  }

  get phase(): ToolSessionPhase {
    return this.sessionPhase;
  }

  start = (): void => {
    this.assertNotEnded();
    const initialTranslation = this.options.initialTranslation ?? [0, 0, 0];
    this.options.gizmo.showEditor({
      sourceBodyRef: this.options.sourceBodyRef,
      mode: this.options.mode,
      objects: this.options.objects,
      ...(this.options.origin ? { origin: this.options.origin } : {}),
      initialTranslation,
      onPreview: (translation) => this.acceptPreview(translation),
      ...(this.options.onDraggingChange
        ? { onDraggingChange: this.options.onDraggingChange }
        : {}),
    });
    this.hasAcceptedPreview = this.options.onPreview(this.params(initialTranslation)) !== false;
    this.sessionPhase = this.hasAcceptedPreview ? 'previewing' : 'awaiting-input';
  };

  setAxis(axis: TranslationAxis): void {
    this.options.gizmo.setAxis(axis);
  }

  previewTranslation(translation: [number, number, number]): boolean {
    this.assertNotEnded();
    return this.options.gizmo.previewTranslation(translation);
  }

  submitNumeric(raw: string, defaultUnit = this.options.defaultUnit ?? 'in'): TranslationNumericResult {
    this.assertNotEnded();
    return this.options.gizmo.submitNumeric(raw, defaultUnit);
  }

  readParams(): MoveCopyParams {
    return this.params(this.options.gizmo.readTranslation());
  }

  commit = (): boolean => {
    this.assertNotEnded();
    if (!this.hasAcceptedPreview) return false;
    this.sessionPhase = 'committing';
    if (this.options.onCommit(this.readParams()) === false) {
      this.sessionPhase = 'previewing';
      return false;
    }
    this.options.gizmo.hide(false);
    this.ended = true;
    return true;
  };

  cancel = (): void => {
    if (this.ended) return;
    this.options.gizmo.hide(true);
    this.options.onCancel?.();
    this.ended = true;
  };

  private acceptPreview(translation: [number, number, number]): boolean {
    const accepted = this.options.onPreview(this.params(translation)) !== false;
    if (accepted) {
      this.hasAcceptedPreview = true;
      this.sessionPhase = 'previewing';
    }
    return accepted;
  }

  private params(translation: [number, number, number]): MoveCopyParams {
    return {
      sourceBodyRef: { ...this.options.sourceBodyRef },
      translation: [...translation],
      mode: this.options.mode,
    };
  }

  private assertNotEnded(): void {
    if (this.ended) throw new Error('Move/Copy tool session has ended');
  }
}

export function createCopyToolSession(
  options: Omit<MoveCopyToolSessionOptions, 'mode'>
): MoveCopyToolSession {
  return new MoveCopyToolSession({ ...options, mode: 'copy' });
}
