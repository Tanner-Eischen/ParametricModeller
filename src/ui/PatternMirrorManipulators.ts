import type { BodyRef } from '../geometry/SubObjectTypes';
import type { LinearPatternParams } from '../features/pattern/LinearPatternFeature';
import type { MirrorParams } from '../features/pattern/MirrorFeature';
import {
  parseNumericInput,
  resolveNumericInput,
  type NumericUnit,
} from '../interaction/NumericInput';
import type { ToolSession, ToolSessionPhase } from '../interaction/ToolSession';
import type { PlaneRef } from '../sketch/SketchTypes';

export interface LinearPatternPreviewOptions {
  id: string;
  sourceBodyRef: BodyRef;
  count?: number;
  spacing?: number;
  direction?: [number, number, number];
  symmetric?: boolean;
  defaultUnit?: NumericUnit;
  onPreview: (params: LinearPatternParams) => boolean | void;
  onCommit: (params: LinearPatternParams) => boolean | void;
  onCancel?: () => void;
}

export class LinearPatternPreviewManipulator implements ToolSession {
  readonly kind = 'linear-pattern';
  readonly id: string;
  private readonly options: LinearPatternPreviewOptions;
  private readonly baseline: LinearPatternParams;
  private current: LinearPatternParams;
  private sessionPhase: ToolSessionPhase = 'awaiting-input';
  private accepted = false;
  private ended = false;

  constructor(options: LinearPatternPreviewOptions) {
    this.options = options;
    this.id = options.id;
    this.baseline = {
      sourceFeatureId: options.sourceBodyRef.featureId,
      sourceBodyRef: { ...options.sourceBodyRef },
      count: options.count ?? 3,
      spacing: options.spacing ?? 1,
      direction: normalizeDirection(options.direction ?? [1, 0, 0]),
      symmetric: options.symmetric ?? false,
    };
    this.current = cloneLinearPatternParams(this.baseline);
  }

  get phase(): ToolSessionPhase {
    return this.sessionPhase;
  }

  start = (): void => {
    this.assertActive();
    this.accepted = this.options.onPreview(this.readParams()) !== false;
    this.sessionPhase = this.accepted ? 'previewing' : 'awaiting-input';
  };

  previewCount(count: number): boolean {
    if (!Number.isInteger(count) || count < 2) return false;
    return this.apply({ ...this.current, count });
  }

  previewSpacing(spacing: number): boolean {
    if (!Number.isFinite(spacing) || spacing <= 0) return false;
    return this.apply({ ...this.current, spacing });
  }

  submitSpacing(raw: string, defaultUnit = this.options.defaultUnit ?? 'in'):
    { ok: true; spacing: number } | { ok: false; error: string } {
    const parsed = parseNumericInput(raw, { defaultUnit });
    if (!parsed.ok) return parsed;
    const spacing = resolveNumericInput(this.current.spacing, parsed);
    return this.previewSpacing(spacing)
      ? { ok: true, spacing }
      : { ok: false, error: 'Pattern spacing preview was rejected' };
  }

  previewDirection(direction: [number, number, number]): boolean {
    if (!direction.every(Number.isFinite) || Math.hypot(...direction) <= 1e-9) return false;
    return this.apply({ ...this.current, direction: normalizeDirection(direction) });
  }

  previewSymmetric(symmetric: boolean): boolean {
    return this.apply({ ...this.current, symmetric });
  }

  readParams(): LinearPatternParams {
    return cloneLinearPatternParams(this.current);
  }

  commit = (): boolean => {
    this.assertActive();
    if (!this.accepted) return false;
    this.sessionPhase = 'committing';
    if (this.options.onCommit(this.readParams()) === false) {
      this.sessionPhase = 'previewing';
      return false;
    }
    this.ended = true;
    return true;
  };

  cancel = (): void => {
    if (this.ended) return;
    this.current = cloneLinearPatternParams(this.baseline);
    this.options.onPreview(this.readParams());
    this.options.onCancel?.();
    this.ended = true;
  };

  private apply(candidate: LinearPatternParams): boolean {
    this.assertActive();
    const next = cloneLinearPatternParams(candidate);
    if (this.options.onPreview(next) === false) return false;
    this.current = next;
    this.accepted = true;
    this.sessionPhase = 'previewing';
    return true;
  }

  private assertActive(): void {
    if (this.ended) throw new Error('Linear pattern preview session has ended');
  }
}

export interface MirrorPreviewOptions {
  id: string;
  sourceBodyRef: BodyRef;
  planeRef: PlaneRef;
  defaultUnit?: NumericUnit;
  onPreview: (params: MirrorParams) => boolean | void;
  onCommit: (params: MirrorParams) => boolean | void;
  onCancel?: () => void;
}

export class MirrorPreviewManipulator implements ToolSession {
  readonly kind = 'mirror';
  readonly id: string;
  private readonly options: MirrorPreviewOptions;
  private readonly baseline: MirrorParams;
  private current: MirrorParams;
  private sessionPhase: ToolSessionPhase = 'awaiting-input';
  private accepted = false;
  private ended = false;

  constructor(options: MirrorPreviewOptions) {
    this.options = options;
    this.id = options.id;
    this.baseline = {
      sourceFeatureId: options.sourceBodyRef.featureId,
      sourceBodyRef: { ...options.sourceBodyRef },
      planeRef: { ...options.planeRef },
    };
    this.current = cloneMirrorParams(this.baseline);
  }

  get phase(): ToolSessionPhase {
    return this.sessionPhase;
  }

  start = (): void => {
    this.assertActive();
    this.accepted = this.options.onPreview(this.readParams()) !== false;
    this.sessionPhase = this.accepted ? 'previewing' : 'awaiting-input';
  };

  previewPlaneRef(planeRef: PlaneRef): boolean {
    this.assertActive();
    const candidate = { ...this.current, planeRef: { ...planeRef } };
    if (this.options.onPreview(cloneMirrorParams(candidate)) === false) return false;
    this.current = candidate;
    this.accepted = true;
    this.sessionPhase = 'previewing';
    return true;
  }

  submitWorldPlaneOffset(raw: string, defaultUnit = this.options.defaultUnit ?? 'in'):
    { ok: true; offset: number } | { ok: false; error: string } {
    if (this.current.planeRef.type !== 'world') {
      return { ok: false, error: 'Only world mirror planes support numeric offsets' };
    }
    const parsed = parseNumericInput(raw, { defaultUnit });
    if (!parsed.ok) return parsed;
    const offset = resolveNumericInput(this.current.planeRef.offset ?? 0, parsed);
    return this.previewPlaneRef({ ...this.current.planeRef, offset })
      ? { ok: true, offset }
      : { ok: false, error: 'Mirror plane preview was rejected' };
  }

  readParams(): MirrorParams {
    return cloneMirrorParams(this.current);
  }

  commit = (): boolean => {
    this.assertActive();
    if (!this.accepted) return false;
    this.sessionPhase = 'committing';
    if (this.options.onCommit(this.readParams()) === false) {
      this.sessionPhase = 'previewing';
      return false;
    }
    this.ended = true;
    return true;
  };

  cancel = (): void => {
    if (this.ended) return;
    this.current = cloneMirrorParams(this.baseline);
    this.options.onPreview(this.readParams());
    this.options.onCancel?.();
    this.ended = true;
  };

  private assertActive(): void {
    if (this.ended) throw new Error('Mirror preview session has ended');
  }
}

function normalizeDirection(direction: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...direction);
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function cloneLinearPatternParams(params: LinearPatternParams): LinearPatternParams {
  return {
    ...params,
    ...(params.sourceBodyRef ? { sourceBodyRef: { ...params.sourceBodyRef } } : {}),
    direction: [...params.direction],
  };
}

function cloneMirrorParams(params: MirrorParams): MirrorParams {
  return {
    ...params,
    ...(params.sourceBodyRef ? { sourceBodyRef: { ...params.sourceBodyRef } } : {}),
    planeRef: { ...params.planeRef },
  };
}

