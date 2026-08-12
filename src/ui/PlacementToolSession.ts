import type { InstanceFaceRef, MateConstraint } from '../assembly/AssemblyTypes';
import type {
  ConstraintSolverContext,
  ConstraintSolverResult,
} from '../assembly/constraints/ConstraintSolver';
import { solveConstraints } from '../assembly/constraints/ConstraintSolver';
import type { Matrix4Tuple, Vector3Tuple } from '../geometry/CoordinateFrame3D';
import type { BodyRef, SubObjectType } from '../geometry/SubObjectTypes';
import type { Diagnostic } from '../features/Diagnostics';
import { error } from '../features/Diagnostics';
import type { RebuildContext } from '../features/RebuildContext';
import type {
  FacePlacementRef,
  Placement,
  PlacementPointRef,
  PlacementReference,
} from '../features/placement';
import {
  createAlignPlacement,
  createPointToPointPlacement,
  solvePlacementMatrix,
} from '../features/placement';
import { PreviewTransaction, type PreviewCancelResult } from '../interaction/PreviewTransaction';
import type { ToolSession, ToolSessionPhase } from '../interaction/ToolSession';

export type PlacementToolKind = 'point-to-point' | 'align';
export type PlacementToolStage =
  | 'source-selection'
  | 'source-datum'
  | 'target-datum'
  | 'numeric-preview';

export type PlacementDatumKind = PlacementReference['kind'];

/**
 * A picker request owned by a tool. Hosts should filter the next pick using
 * this request without changing the user's persistent/global selection mode.
 */
export interface PlacementReferenceRequest {
  stage: PlacementToolStage;
  requestedSelectionMode: SubObjectType;
  acceptedKinds: readonly PlacementDatumKind[];
  prompt: string;
}

export interface PlacementAlignOptions {
  gap: number;
  opposed: boolean;
  quarterTurns: number;
}

export interface PlacementPreview {
  sourceBodyRefs: readonly BodyRef[];
  mode: 'move' | 'copy';
  placement: Placement;
  matrix: Matrix4Tuple;
}

export interface PlacementCommit extends PlacementPreview {
  label: string;
}

export interface DocumentTransactionAdapter<TSnapshot> {
  capture: () => TSnapshot;
  restore: (snapshot: TSnapshot) => void;
  serialize: (snapshot: TSnapshot) => string;
}

export interface PlacementToolSessionOptions<TSnapshot> {
  id: string;
  kind: PlacementToolKind;
  mode: 'move' | 'copy';
  document: DocumentTransactionAdapter<TSnapshot>;
  getPlacementContext: () => Pick<RebuildContext, 'bodiesByFeature'>;
  initialSourceBodyRefs?: readonly BodyRef[];
  onReferenceRequest?: (request: PlacementReferenceRequest | null) => void;
  onPreview: (preview: PlacementPreview) => boolean | void;
  onClearPreview?: () => void;
  onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
  /** Create exactly one Transform Bodies feature and one history entry. */
  onCommit: (commit: PlacementCommit) => boolean | void;
  onCancel?: (result: PreviewCancelResult) => void;
}

const POINT_DATUM_KINDS = ['vertex', 'edgePoint', 'faceCenter'] as const;

/**
 * Staged, preview-first placement interaction. Geometry is solved by the same
 * pure placement solver used by Transform Bodies rebuilds before a preview is
 * handed to the viewport.
 */
export class PlacementToolSession<TSnapshot> implements ToolSession {
  readonly kind = 'placement';
  readonly id: string;

  private readonly options: PlacementToolSessionOptions<TSnapshot>;
  private sessionPhase: ToolSessionPhase = 'awaiting-input';
  private sessionStage: PlacementToolStage = 'source-selection';
  private sourceBodyRefs: BodyRef[] = [];
  private sourceDatum: PlacementPointRef | FacePlacementRef | null = null;
  private targetDatum: PlacementPointRef | FacePlacementRef | null = null;
  private pointOffset: Vector3Tuple = [0, 0, 0];
  private alignOptions: PlacementAlignOptions = {
    gap: 0,
    opposed: true,
    quarterTurns: 0,
  };
  private transaction: PreviewTransaction<TSnapshot, PlacementPreview> | null = null;
  private acceptedPreview: PlacementPreview | null = null;
  private diagnostics: Diagnostic[] = [];
  private ended = false;

  constructor(options: PlacementToolSessionOptions<TSnapshot>) {
    this.options = {
      ...options,
      ...(options.initialSourceBodyRefs
        ? { initialSourceBodyRefs: options.initialSourceBodyRefs.map(cloneBodyRef) }
        : {}),
    };
    this.id = options.id;
  }

  get phase(): ToolSessionPhase {
    return this.sessionPhase;
  }

  get stage(): PlacementToolStage {
    return this.sessionStage;
  }

  start = (): void => {
    this.assertActive();
    this.createTransaction();
    const initialSources = this.options.initialSourceBodyRefs ?? [];
    if (initialSources.length > 0) {
      this.selectSources(initialSources);
      return;
    }
    this.requestCurrentReference();
  };

  selectSources(refs: readonly BodyRef[]): boolean {
    this.assertActive();
    if (this.sessionStage !== 'source-selection') {
      return this.reject('PLACEMENT_WRONG_STAGE', 'Select source bodies before selecting a datum.');
    }
    const normalized = uniqueBodyRefs(refs);
    if (normalized.length === 0 || normalized.some((ref) => !ref.featureId || !ref.bodyId)) {
      return this.reject(
        'PLACEMENT_SOURCE_REQUIRED',
        'Select at least one exact source body before choosing placement datums.'
      );
    }

    this.sourceBodyRefs = normalized;
    this.sessionStage = 'source-datum';
    this.clearDiagnostics();
    this.requestCurrentReference();
    return true;
  }

  selectDatum(ref: PlacementReference): boolean {
    this.assertActive();
    if (this.sessionStage !== 'source-datum' && this.sessionStage !== 'target-datum') {
      return this.reject(
        'PLACEMENT_DATUM_NOT_REQUESTED',
        'The placement tool is not currently requesting a datum.'
      );
    }
    const source = this.sessionStage === 'source-datum';
    if (!this.acceptsDatum(ref)) {
      const label = this.options.kind === 'align'
        ? 'an exact planar face'
        : 'a vertex, edge point, or face center';
      return this.reject('PLACEMENT_DATUM_KIND_INVALID', `Select ${label} for this placement.`);
    }
    if (source && !this.sourceBodyRefs.some((bodyRef) => sameBody(bodyRef, ref))) {
      return this.reject(
        'PLACEMENT_SOURCE_DATUM_MISMATCH',
        'The source datum must belong to one of the selected source bodies.'
      );
    }

    const datum = clonePlacementReference(ref) as PlacementPointRef | FacePlacementRef;
    if (source) {
      this.sourceDatum = datum;
      this.sessionStage = 'target-datum';
      this.clearDiagnostics();
      this.requestCurrentReference();
      return true;
    }

    this.targetDatum = datum;
    this.sessionStage = 'numeric-preview';
    this.options.onReferenceRequest?.(null);
    return this.updatePreview();
  }

  setPointOffset(offset: Vector3Tuple): boolean {
    this.assertActive();
    if (this.options.kind !== 'point-to-point') {
      return this.reject('PLACEMENT_OFFSET_UNAVAILABLE', 'Vector offset is only available for point placement.');
    }
    if (!isFiniteVector(offset)) {
      return this.reject('INVALID_POINT_OFFSET', 'Point offset must contain three finite values.');
    }
    this.pointOffset = [...offset];
    return this.updatePreview();
  }

  setAlignOptions(options: Partial<PlacementAlignOptions>): boolean {
    this.assertActive();
    if (this.options.kind !== 'align') {
      return this.reject('PLACEMENT_ALIGN_OPTIONS_UNAVAILABLE', 'Face alignment options require Align placement.');
    }
    const next = { ...this.alignOptions, ...options };
    if (!Number.isFinite(next.gap)) {
      return this.reject('INVALID_ALIGN_GAP', 'Alignment gap must be a finite signed distance.');
    }
    if (!Number.isInteger(next.quarterTurns)) {
      return this.reject('INVALID_ALIGN_QUARTER_TURNS', 'Alignment twist must be an integer number of quarter turns.');
    }
    this.alignOptions = next;
    return this.updatePreview();
  }

  /** Numeric and pointer drags share this path, so both preview identical math. */
  previewSignedDistance(value: number): boolean {
    if (this.options.kind !== 'align') {
      return this.reject(
        'PLACEMENT_SIGNED_DISTANCE_UNAVAILABLE',
        'Point placement uses an XYZ offset; provide a three-axis drag or numeric vector.'
      );
    }
    return this.setAlignOptions({ gap: value });
  }

  /** Pointer translation for point placement follows the same preview path as numeric XYZ input. */
  previewDragOffset(offset: Vector3Tuple): boolean {
    return this.setPointOffset(offset);
  }

  readState(): {
    stage: PlacementToolStage;
    sourceBodyRefs: BodyRef[];
    sourceDatum: PlacementPointRef | FacePlacementRef | null;
    targetDatum: PlacementPointRef | FacePlacementRef | null;
    diagnostics: Diagnostic[];
    preview: PlacementPreview | null;
  } {
    return {
      stage: this.sessionStage,
      sourceBodyRefs: this.sourceBodyRefs.map(cloneBodyRef),
      sourceDatum: this.sourceDatum ? clonePlacementReference(this.sourceDatum) as PlacementPointRef | FacePlacementRef : null,
      targetDatum: this.targetDatum ? clonePlacementReference(this.targetDatum) as PlacementPointRef | FacePlacementRef : null,
      diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      preview: this.acceptedPreview ? clonePlacementPreview(this.acceptedPreview) : null,
    };
  }

  commit = (): boolean => {
    this.assertActive();
    if (!this.acceptedPreview || !this.transaction || this.transaction.state !== 'active') {
      return this.reject(
        'PLACEMENT_PREVIEW_REQUIRED',
        'Choose valid source and target datums before committing placement.'
      );
    }

    this.sessionPhase = 'committing';
    const label = this.options.mode === 'copy' ? 'Copy Bodies' : 'Move Bodies';
    const commit = { ...clonePlacementPreview(this.acceptedPreview), label };
    try {
      if (this.options.onCommit(commit) === false) {
        this.rollbackRejectedCommit();
        return this.reject('PLACEMENT_COMMIT_REJECTED', 'Placement could not be committed; the document was restored.');
      }
    } catch (caught) {
      this.rollbackRejectedCommit();
      return this.reject(
        'PLACEMENT_COMMIT_FAILED',
        caught instanceof Error ? caught.message : String(caught)
      );
    }

    this.transaction.commit(label);
    this.options.onClearPreview?.();
    this.options.onReferenceRequest?.(null);
    this.ended = true;
    return true;
  };

  cancel = (): void => {
    if (this.ended) return;
    const result = this.transaction?.state === 'active'
      ? this.transaction.cancel()
      : byteEquivalentNoop(this.options.document);
    this.options.onClearPreview?.();
    this.options.onReferenceRequest?.(null);
    this.options.onCancel?.(result);
    this.ended = true;
  };

  private createTransaction(): void {
    this.transaction = new PreviewTransaction<TSnapshot, PlacementPreview>({
      ...this.options.document,
      applyPreview: (preview) => this.options.onPreview(clonePlacementPreview(preview)),
    });
  }

  private rollbackRejectedCommit(): void {
    if (this.transaction?.state === 'active') this.transaction.cancel();
    this.options.onClearPreview?.();
    this.acceptedPreview = null;
    this.sessionPhase = 'awaiting-input';
    this.createTransaction();
  }

  private updatePreview(): boolean {
    if (this.sessionStage !== 'numeric-preview' || !this.sourceDatum || !this.targetDatum) {
      return this.reject(
        'PLACEMENT_REFERENCES_INCOMPLETE',
        'Select both source and target datums before previewing placement.'
      );
    }

    const placement = this.buildPlacement();
    const solved = solvePlacementMatrix(
      placement,
      this.options.getPlacementContext(),
      this.id
    );
    if (!solved.ok) return this.publishDiagnostics(solved.diagnostics);

    const preview: PlacementPreview = {
      sourceBodyRefs: this.sourceBodyRefs.map(cloneBodyRef),
      mode: this.options.mode,
      placement: clonePlacement(placement),
      matrix: solved.matrix.toArray() as Matrix4Tuple,
    };
    const accepted = this.transaction?.preview(preview) !== false;
    if (!accepted) {
      return this.reject('PLACEMENT_PREVIEW_REJECTED', 'The viewport could not display this placement preview.');
    }
    this.acceptedPreview = preview;
    this.sessionPhase = 'previewing';
    this.clearDiagnostics();
    return true;
  }

  private buildPlacement(): Placement {
    if (this.options.kind === 'align') {
      return createAlignPlacement(
        this.sourceDatum as FacePlacementRef,
        this.targetDatum as FacePlacementRef,
        this.alignOptions.gap,
        this.alignOptions.quarterTurns,
        this.alignOptions.opposed
      );
    }
    return createPointToPointPlacement(
      this.sourceDatum as PlacementPointRef,
      this.targetDatum as PlacementPointRef,
      this.pointOffset
    );
  }

  private acceptsDatum(ref: PlacementReference): boolean {
    return this.options.kind === 'align'
      ? ref.kind === 'face'
      : POINT_DATUM_KINDS.includes(ref.kind as typeof POINT_DATUM_KINDS[number]);
  }

  private requestCurrentReference(): void {
    if (!this.options.onReferenceRequest) return;
    if (this.sessionStage === 'source-selection') {
      this.options.onReferenceRequest({
        stage: this.sessionStage,
        requestedSelectionMode: 'body',
        acceptedKinds: ['body'],
        prompt: 'Select one or more source bodies.',
      });
      return;
    }
    if (this.sessionStage === 'source-datum' || this.sessionStage === 'target-datum') {
      const source = this.sessionStage === 'source-datum';
      this.options.onReferenceRequest({
        stage: this.sessionStage,
        requestedSelectionMode: this.options.kind === 'align' ? 'face' : 'vertex',
        acceptedKinds: this.options.kind === 'align' ? ['face'] : POINT_DATUM_KINDS,
        prompt: `Select the ${source ? 'source' : 'target'} ${
          this.options.kind === 'align' ? 'face' : 'point datum'
        }.`,
      });
    }
  }

  private reject(code: string, message: string): false {
    return this.publishDiagnostics([error(code, message, this.id)]);
  }

  private publishDiagnostics(diagnostics: readonly Diagnostic[]): false {
    this.diagnostics = diagnostics.map((diagnostic) => ({ ...diagnostic }));
    this.acceptedPreview = null;
    this.sessionPhase = 'awaiting-input';
    this.options.onDiagnostics?.(this.diagnostics);
    return false;
  }

  private clearDiagnostics(): void {
    this.diagnostics = [];
    this.options.onDiagnostics?.([]);
  }

  private assertActive(): void {
    if (this.ended) throw new Error('Placement tool session has ended');
  }
}

export function createPlacementToolSession<TSnapshot>(
  options: PlacementToolSessionOptions<TSnapshot>
): PlacementToolSession<TSnapshot> {
  return new PlacementToolSession(options);
}

export type MateToolStage = 'first-face' | 'second-face' | 'numeric-preview';

export interface MateReferenceRequest {
  stage: 'first-face' | 'second-face';
  requestedSelectionMode: 'face';
  acceptedKinds: readonly ['instanceFace'];
  prompt: string;
}

export interface MatePreview {
  constraint: MateConstraint;
  solve: ConstraintSolverResult;
}

export interface MateToolSessionOptions<TSnapshot> {
  id: string;
  type: 'flush' | 'offset';
  document: DocumentTransactionAdapter<TSnapshot>;
  getSolverContext: () => ConstraintSolverContext;
  initialOffset?: number;
  driving?: boolean;
  onReferenceRequest?: (request: MateReferenceRequest | null) => void;
  onPreview: (preview: MatePreview) => boolean | void;
  onClearPreview?: () => void;
  onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
  /** Persist the constraint and solved instance transforms as one history edit. */
  onCommit: (preview: MatePreview) => boolean | void;
  onCancel?: (result: PreviewCancelResult) => void;
}

/** Transactional exact-face mate creation backed by the production solver. */
export class MateToolSession<TSnapshot> implements ToolSession {
  readonly kind = 'mate';
  readonly id: string;

  private readonly options: MateToolSessionOptions<TSnapshot>;
  private sessionPhase: ToolSessionPhase = 'awaiting-input';
  private sessionStage: MateToolStage = 'first-face';
  private firstFace: InstanceFaceRef | null = null;
  private secondFace: InstanceFaceRef | null = null;
  private offset: number;
  private driving: boolean;
  private transaction: PreviewTransaction<TSnapshot, MatePreview> | null = null;
  private acceptedPreview: MatePreview | null = null;
  private diagnostics: Diagnostic[] = [];
  private ended = false;

  constructor(options: MateToolSessionOptions<TSnapshot>) {
    this.options = options;
    this.id = options.id;
    this.offset = options.type === 'flush' ? 0 : options.initialOffset ?? 0;
    this.driving = options.driving ?? true;
  }

  get phase(): ToolSessionPhase {
    return this.sessionPhase;
  }

  get stage(): MateToolStage {
    return this.sessionStage;
  }

  start = (): void => {
    this.assertActive();
    this.transaction = new PreviewTransaction<TSnapshot, MatePreview>({
      ...this.options.document,
      applyPreview: (preview) => this.options.onPreview(cloneMatePreview(preview)),
    });
    this.requestFace();
  };

  selectFace(ref: InstanceFaceRef): boolean {
    this.assertActive();
    if (this.sessionStage === 'numeric-preview') {
      return this.reject('MATE_FACE_NOT_REQUESTED', 'Both mate faces are already selected.');
    }
    if (!ref.instanceId || !ref.bodyId || !ref.faceId) {
      return this.reject('MATE_FACE_INVALID', 'Select an exact face on a component instance.');
    }
    if (this.sessionStage === 'first-face') {
      this.firstFace = cloneInstanceFaceRef(ref);
      this.sessionStage = 'second-face';
      this.clearDiagnostics();
      this.requestFace();
      return true;
    }
    if (ref.instanceId === this.firstFace?.instanceId) {
      return this.reject('MATE_SAME_INSTANCE', 'Select the second face on a different instance.');
    }
    this.secondFace = cloneInstanceFaceRef(ref);
    this.sessionStage = 'numeric-preview';
    this.options.onReferenceRequest?.(null);
    return this.updatePreview();
  }

  setSignedOffset(offset: number): boolean {
    this.assertActive();
    if (this.options.type === 'flush' && offset !== 0) {
      return this.reject('FLUSH_OFFSET_MUST_BE_ZERO', 'A flush mate has zero offset; use an offset mate for a signed gap.');
    }
    if (!Number.isFinite(offset)) {
      return this.reject('MATE_OFFSET_INVALID', 'Mate offset must be a finite signed distance.');
    }
    this.offset = offset;
    return this.updatePreview();
  }

  setDriving(driving: boolean): boolean {
    this.assertActive();
    this.driving = driving;
    return this.updatePreview();
  }

  readState(): {
    stage: MateToolStage;
    firstFace: InstanceFaceRef | null;
    secondFace: InstanceFaceRef | null;
    offset: number;
    driving: boolean;
    diagnostics: Diagnostic[];
  } {
    return {
      stage: this.sessionStage,
      firstFace: this.firstFace ? cloneInstanceFaceRef(this.firstFace) : null,
      secondFace: this.secondFace ? cloneInstanceFaceRef(this.secondFace) : null,
      offset: this.offset,
      driving: this.driving,
      diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    };
  }

  commit = (): boolean => {
    this.assertActive();
    if (!this.acceptedPreview || !this.transaction || this.transaction.state !== 'active') {
      return this.reject('MATE_PREVIEW_REQUIRED', 'Select two valid instance faces before committing the mate.');
    }
    this.sessionPhase = 'committing';
    try {
      if (this.options.onCommit(cloneMatePreview(this.acceptedPreview)) === false) {
        this.rollbackRejectedCommit();
        return this.reject('MATE_COMMIT_REJECTED', 'Mate could not be committed; the document was restored.');
      }
    } catch (caught) {
      this.rollbackRejectedCommit();
      return this.reject(
        'MATE_COMMIT_FAILED',
        caught instanceof Error ? caught.message : String(caught)
      );
    }
    this.transaction.commit(this.acceptedPreview.constraint.name);
    this.options.onClearPreview?.();
    this.options.onReferenceRequest?.(null);
    this.ended = true;
    return true;
  };

  cancel = (): void => {
    if (this.ended) return;
    const result = this.transaction?.state === 'active'
      ? this.transaction.cancel()
      : byteEquivalentNoop(this.options.document);
    this.options.onClearPreview?.();
    this.options.onReferenceRequest?.(null);
    this.options.onCancel?.(result);
    this.ended = true;
  };

  private updatePreview(): boolean {
    if (this.sessionStage !== 'numeric-preview' || !this.firstFace || !this.secondFace) {
      return this.reject('MATE_REFERENCES_INCOMPLETE', 'Select two exact instance faces before previewing a mate.');
    }

    const constraint = this.createConstraint();
    const baseContext = this.options.getSolverContext();
    const solve = solveConstraints({
      ...baseContext,
      constraints: [...baseContext.constraints, constraint],
    });
    if (!solve.ok || !solve.committed) {
      return this.publishDiagnostics(constraintDiagnostics(constraint, solve));
    }

    const runtime = solve.constraintStatuses.get(constraint.id);
    const resolvedConstraint: MateConstraint = {
      ...constraint,
      satisfied: runtime?.state === 'satisfied',
      status: runtime?.state ?? 'unsolved',
      ...(runtime?.message ? { errorMessage: runtime.message } : {}),
    };
    const preview = { constraint: resolvedConstraint, solve };
    const accepted = this.transaction?.preview(preview) !== false;
    if (!accepted) {
      return this.reject('MATE_PREVIEW_REJECTED', 'The viewport could not display this mate preview.');
    }
    this.acceptedPreview = preview;
    this.sessionPhase = 'previewing';
    this.clearDiagnostics();
    return true;
  }

  private rollbackRejectedCommit(): void {
    if (this.transaction?.state === 'active') this.transaction.cancel();
    this.options.onClearPreview?.();
    this.acceptedPreview = null;
    this.sessionPhase = 'awaiting-input';
    this.transaction = new PreviewTransaction<TSnapshot, MatePreview>({
      ...this.options.document,
      applyPreview: (preview) => this.options.onPreview(cloneMatePreview(preview)),
    });
  }

  private createConstraint(): MateConstraint {
    return {
      id: this.id,
      name: this.options.type === 'flush' ? 'Flush Mate' : 'Offset Mate',
      type: this.options.type,
      refA: cloneInstanceFaceRef(this.firstFace!),
      refB: cloneInstanceFaceRef(this.secondFace!),
      offset: this.options.type === 'flush' ? 0 : this.offset,
      satisfied: false,
      suppressed: false,
      driving: this.driving,
      status: 'unsolved',
    };
  }

  private requestFace(): void {
    if (this.sessionStage !== 'first-face' && this.sessionStage !== 'second-face') return;
    this.options.onReferenceRequest?.({
      stage: this.sessionStage,
      requestedSelectionMode: 'face',
      acceptedKinds: ['instanceFace'],
      prompt: `Select the ${this.sessionStage === 'first-face' ? 'first' : 'second'} instance face.`,
    });
  }

  private reject(code: string, message: string): false {
    return this.publishDiagnostics([error(code, message, this.id)]);
  }

  private publishDiagnostics(diagnostics: readonly Diagnostic[]): false {
    this.diagnostics = diagnostics.map((diagnostic) => ({ ...diagnostic }));
    this.acceptedPreview = null;
    this.sessionPhase = 'awaiting-input';
    this.options.onDiagnostics?.(this.diagnostics);
    return false;
  }

  private clearDiagnostics(): void {
    this.diagnostics = [];
    this.options.onDiagnostics?.([]);
  }

  private assertActive(): void {
    if (this.ended) throw new Error('Mate tool session has ended');
  }
}

export function createMateToolSession<TSnapshot>(
  options: MateToolSessionOptions<TSnapshot>
): MateToolSession<TSnapshot> {
  return new MateToolSession(options);
}

function uniqueBodyRefs(refs: readonly BodyRef[]): BodyRef[] {
  const byKey = new Map<string, BodyRef>();
  for (const ref of refs) byKey.set(`${ref.featureId}\u0000${ref.bodyId}`, cloneBodyRef(ref));
  return [...byKey.values()];
}

function cloneBodyRef(ref: BodyRef): BodyRef {
  return { featureId: ref.featureId, bodyId: ref.bodyId };
}

function sameBody(left: BodyRef, right: { featureId: string; bodyId: string }): boolean {
  return left.featureId === right.featureId && left.bodyId === right.bodyId;
}

function clonePlacementReference(ref: PlacementReference): PlacementReference {
  return structuredClone(ref);
}

function clonePlacement(placement: Placement): Placement {
  return structuredClone(placement);
}

function clonePlacementPreview(preview: PlacementPreview): PlacementPreview {
  return {
    sourceBodyRefs: preview.sourceBodyRefs.map(cloneBodyRef),
    mode: preview.mode,
    placement: clonePlacement(preview.placement),
    matrix: [...preview.matrix] as Matrix4Tuple,
  };
}

function cloneInstanceFaceRef(ref: InstanceFaceRef): InstanceFaceRef {
  return { instanceId: ref.instanceId, bodyId: ref.bodyId, faceId: ref.faceId };
}

function cloneMatePreview(preview: MatePreview): MatePreview {
  return structuredClone(preview);
}

function constraintDiagnostics(
  constraint: MateConstraint,
  solve: ConstraintSolverResult
): Diagnostic[] {
  const messages = [...solve.errors]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([constraintId, message]) => error(
      'MATE_SOLVE_FAILED',
      message,
      constraint.id,
      constraintId
    ));
  return messages.length > 0
    ? messages
    : [error('MATE_SOLVE_FAILED', 'The mate solver rejected this preview.', constraint.id)];
}

function isFiniteVector(value: Vector3Tuple): boolean {
  return value.length === 3 && value.every(Number.isFinite);
}

function byteEquivalentNoop<TSnapshot>(
  adapter: DocumentTransactionAdapter<TSnapshot>
): PreviewCancelResult {
  const snapshot = adapter.capture();
  const bytes = adapter.serialize(snapshot);
  return { byteEquivalent: true, before: bytes, after: bytes };
}
