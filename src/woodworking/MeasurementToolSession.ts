import type { Body } from '../geometry/Body';
import type { Edge } from '../geometry/Edge';
import type { Plane } from '../geometry/Plane';
import type { TolerancePolicy } from '../geometry/TolerancePolicy';
import {
  DEFAULT_TOLERANCE_POLICY,
  quantizeToTolerance,
} from '../geometry/TolerancePolicy';
import type { ToolSession, ToolSessionPhase } from '../interaction/ToolSession';
import type { BoardOrientation } from './Measurements';
import { measureBRepBody, measureOrientedBoard } from './Measurements';
import type { Vertex } from '../geometry/Vertex';

export type MeasurementKind =
  | 'bodyDimensions'
  | 'edgeLength'
  | 'faceProperties'
  | 'vertexToVertex'
  | 'vertexToFace'
  | 'parallelFaceDistance'
  | 'edgeAngle'
  | 'faceAngle';

export type MeasurementReferenceKind = 'body' | 'vertex' | 'edge' | 'face';

interface MeasurementReferenceBase {
  featureId: string;
  bodyId: string;
}

export type MeasurementReference =
  | (MeasurementReferenceBase & { kind: 'body' })
  | (MeasurementReferenceBase & { kind: 'vertex'; vertexId: string })
  | (MeasurementReferenceBase & { kind: 'edge'; edgeId: string })
  | (MeasurementReferenceBase & { kind: 'face'; faceId: string });

interface MeasurementResultBase {
  id: string;
  kind: MeasurementKind;
  references: MeasurementReference[];
  label: string;
}

export type MeasurementResult =
  | (MeasurementResultBase & {
      kind: 'bodyDimensions';
      length: number;
      width: number;
      thickness: number;
    })
  | (MeasurementResultBase & { kind: 'edgeLength'; length: number })
  | (MeasurementResultBase & { kind: 'faceProperties'; area: number; perimeter: number })
  | (MeasurementResultBase & {
      kind: 'vertexToVertex';
      distance: number;
      delta: readonly [number, number, number];
    })
  | (MeasurementResultBase & { kind: 'vertexToFace'; distance: number })
  | (MeasurementResultBase & { kind: 'parallelFaceDistance'; distance: number })
  | (MeasurementResultBase & {
      kind: 'edgeAngle' | 'faceAngle';
      radians: number;
      degrees: number;
    });

export interface MeasurementDiagnostic {
  code:
    | 'REFERENCE_KIND_MISMATCH'
    | 'REFERENCE_NOT_FOUND'
    | 'DUPLICATE_REFERENCE'
    | 'INCOMPLETE_SELECTION'
    | 'NON_PARALLEL_FACES'
    | 'DEGENERATE_GEOMETRY';
  message: string;
  referenceIndex?: number;
}

export interface MeasurementEvaluationContext {
  bodies: readonly Body[] | ReadonlyMap<string, Body>;
  getBodyOrientation?: (bodyId: string) => BoardOrientation | undefined;
  getOwningFeatureId?: (bodyId: string) => string | undefined;
  tolerance?: Readonly<TolerancePolicy>;
}

export interface MeasurementToolSessionState {
  phase: ToolSessionPhase;
  kind: MeasurementKind;
  references: MeasurementReference[];
  expectedReferenceKind: MeasurementReferenceKind | null;
  instruction: string;
  result: MeasurementResult | null;
  diagnostics: MeasurementDiagnostic[];
  canCommit: boolean;
}

export interface MeasurementToolSessionOptions extends MeasurementEvaluationContext {
  id: string;
  kind: MeasurementKind;
  onStateChange?: (state: MeasurementToolSessionState) => void;
  onCommit?: (result: MeasurementResult) => void;
  onCancel?: () => void;
}

const REQUIRED_REFERENCE_KINDS: Record<MeasurementKind, readonly MeasurementReferenceKind[]> = {
  bodyDimensions: ['body'],
  edgeLength: ['edge'],
  faceProperties: ['face'],
  vertexToVertex: ['vertex', 'vertex'],
  vertexToFace: ['vertex', 'face'],
  parallelFaceDistance: ['face', 'face'],
  edgeAngle: ['edge', 'edge'],
  faceAngle: ['face', 'face'],
};

/**
 * A non-destructive staged measurement session. The host controls picking and
 * feeds only exact stable B-Rep references requested by `expectedReferenceKind`.
 */
export class MeasurementToolSession implements ToolSession {
  readonly id: string;
  readonly kind = 'measurement';
  private sessionPhase: ToolSessionPhase = 'awaiting-input';
  private readonly measurementKind: MeasurementKind;
  private readonly options: MeasurementToolSessionOptions;
  private references: MeasurementReference[] = [];
  private result: MeasurementResult | null = null;
  private diagnostics: MeasurementDiagnostic[] = [];

  constructor(options: MeasurementToolSessionOptions) {
    this.id = options.id;
    this.measurementKind = options.kind;
    this.options = options;
  }

  get phase(): ToolSessionPhase {
    return this.sessionPhase;
  }

  start = (): void => {
    this.publish();
  };

  addReference(reference: MeasurementReference): boolean {
    const expected = this.expectedReferenceKind();
    if (!expected || reference.kind !== expected) {
      this.diagnostics = [{
        code: 'REFERENCE_KIND_MISMATCH',
        message: expected
          ? `Select one ${expected}; ${reference.kind} is not valid at this stage.`
          : 'This measurement already has all required references.',
        referenceIndex: this.references.length,
      }];
      this.publish();
      return false;
    }
    if (this.references.some((candidate) => referenceKey(candidate) === referenceKey(reference))) {
      this.diagnostics = [{
        code: 'DUPLICATE_REFERENCE',
        message: 'Choose a different reference for the second measurement target.',
        referenceIndex: this.references.length,
      }];
      this.publish();
      return false;
    }
    this.references = [...this.references, cloneReference(reference)];
    this.evaluateIfComplete();
    this.publish();
    return this.diagnostics.length === 0;
  }

  removeLastReference(): void {
    this.references = this.references.slice(0, -1);
    this.result = null;
    this.diagnostics = [];
    this.sessionPhase = 'awaiting-input';
    this.publish();
  }

  clearReferences(): void {
    this.references = [];
    this.result = null;
    this.diagnostics = [];
    this.sessionPhase = 'awaiting-input';
    this.publish();
  }

  getState(): MeasurementToolSessionState {
    const expected = this.expectedReferenceKind();
    return {
      phase: this.sessionPhase,
      kind: this.measurementKind,
      references: this.references.map(cloneReference),
      expectedReferenceKind: expected,
      instruction: instructionFor(this.measurementKind, this.references.length, expected),
      result: this.result ? cloneMeasurementResult(this.result) : null,
      diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      canCommit: this.result !== null && this.diagnostics.length === 0,
    };
  }

  commit = (): boolean => {
    if (!this.result || this.diagnostics.length > 0) {
      if (this.references.length < REQUIRED_REFERENCE_KINDS[this.measurementKind].length) {
        this.diagnostics = [{
          code: 'INCOMPLETE_SELECTION',
          message: instructionFor(
            this.measurementKind,
            this.references.length,
            this.expectedReferenceKind()
          ),
        }];
      }
      this.publish();
      return false;
    }
    this.sessionPhase = 'committing';
    this.publish();
    this.options.onCommit?.(cloneMeasurementResult(this.result));
    return true;
  };

  cancel = (): void => {
    this.references = [];
    this.result = null;
    this.diagnostics = [];
    this.sessionPhase = 'awaiting-input';
    this.options.onCancel?.();
    this.publish();
  };

  private expectedReferenceKind(): MeasurementReferenceKind | null {
    return REQUIRED_REFERENCE_KINDS[this.measurementKind][this.references.length] ?? null;
  }

  private evaluateIfComplete(): void {
    if (this.references.length !== REQUIRED_REFERENCE_KINDS[this.measurementKind].length) {
      this.result = null;
      this.diagnostics = [];
      this.sessionPhase = 'awaiting-input';
      return;
    }
    const evaluated = evaluateMeasurement(
      this.id,
      this.measurementKind,
      this.references,
      this.options
    );
    if (evaluated.ok) {
      this.result = evaluated.result;
      this.diagnostics = [];
      this.sessionPhase = 'previewing';
    } else {
      this.result = null;
      this.diagnostics = evaluated.diagnostics;
      this.sessionPhase = 'awaiting-input';
    }
  }

  private publish(): void {
    this.options.onStateChange?.(this.getState());
  }
}

export type MeasurementEvaluationResult =
  | { ok: true; result: MeasurementResult }
  | { ok: false; diagnostics: MeasurementDiagnostic[] };

/** Evaluate exact B-Rep references without render-triangle measurements. */
export function evaluateMeasurement(
  id: string,
  kind: MeasurementKind,
  references: readonly MeasurementReference[],
  context: MeasurementEvaluationContext
): MeasurementEvaluationResult {
  const required = REQUIRED_REFERENCE_KINDS[kind];
  if (references.length !== required.length) {
    return failure('INCOMPLETE_SELECTION', `Measurement ${kind} requires ${required.length} reference(s).`);
  }
  for (let index = 0; index < required.length; index++) {
    if (references[index]?.kind !== required[index]) {
      return failure(
        'REFERENCE_KIND_MISMATCH',
        `Reference ${index + 1} must be a ${required[index]}.`,
        index
      );
    }
  }

  const tolerance = context.tolerance ?? DEFAULT_TOLERANCE_POLICY;
  const resolved: ResolvedReference[] = [];
  for (let index = 0; index < references.length; index++) {
    const candidate = resolveReference(references[index]!, index, context);
    if (!candidate.ok) return { ok: false, diagnostics: [candidate.diagnostic] };
    resolved.push(candidate);
  }

  try {
    const refs = references.map(cloneReference);
    if (kind === 'bodyDimensions') {
      const body = resolved[0]!.body;
      const orientation = context.getBodyOrientation?.(body.id) ?? {
        grainAxis: [1, 0, 0] as const,
        thicknessAxis: [0, 0, 1] as const,
      };
      const dimensions = measureOrientedBoard(body, orientation, tolerance);
      return success({
        id,
        kind,
        references: refs,
        label: 'Body length, width, and thickness',
        length: dimensions.length,
        width: dimensions.width,
        thickness: dimensions.thickness,
      });
    }
    if (kind === 'edgeLength') {
      const edge = resolved[0]!.edge!;
      const body = resolved[0]!.body;
      const start = body.vertices.get(edge.vertexIds[0])!;
      const end = body.vertices.get(edge.vertexIds[1])!;
      return success({
        id, kind, references: refs, label: 'Edge length',
        length: canonical(vectorLength(subtract(end.position, start.position)), tolerance.linear),
      });
    }
    if (kind === 'faceProperties') {
      const faceId = (references[0] as Extract<MeasurementReference, { kind: 'face' }>).faceId;
      const measured = measureBRepBody(resolved[0]!.body, tolerance)
        .faces.find((face) => face.faceId === faceId)!;
      return success({
        id, kind, references: refs, label: 'Face area and perimeter',
        area: measured.area,
        perimeter: measured.perimeter,
      });
    }
    if (kind === 'vertexToVertex') {
      const first = resolved[0]!.vertex!.position;
      const second = resolved[1]!.vertex!.position;
      const delta = subtract(second, first).map((value) =>
        canonical(value, tolerance.linear)
      ) as [number, number, number];
      return success({
        id, kind, references: refs, label: 'Point-to-point distance',
        distance: canonical(vectorLength(delta), tolerance.linear),
        delta,
      });
    }
    if (kind === 'vertexToFace') {
      const position = resolved[0]!.vertex!.position;
      const plane = resolved[1]!.plane!;
      const normal = normalized(plane.normal, tolerance);
      const distance = Math.abs(dot(subtract(position, plane.origin), normal));
      return success({
        id, kind, references: refs, label: 'Point-to-face perpendicular distance',
        distance: canonical(distance, tolerance.linear),
      });
    }
    if (kind === 'parallelFaceDistance') {
      const first = resolved[0]!.plane!;
      const second = resolved[1]!.plane!;
      const firstNormal = normalized(first.normal, tolerance);
      const secondNormal = normalized(second.normal, tolerance);
      if (1 - Math.abs(dot(firstNormal, secondNormal)) > tolerance.angular) {
        return failure('NON_PARALLEL_FACES', 'Select two parallel planar faces.');
      }
      return success({
        id, kind, references: refs, label: 'Parallel-face perpendicular distance',
        distance: canonical(
          Math.abs(dot(subtract(second.origin, first.origin), firstNormal)),
          tolerance.linear
        ),
      });
    }
    const firstDirection = kind === 'edgeAngle'
      ? edgeDirection(resolved[0]!, tolerance)
      : normalized(resolved[0]!.plane!.normal, tolerance);
    const secondDirection = kind === 'edgeAngle'
      ? edgeDirection(resolved[1]!, tolerance)
      : normalized(resolved[1]!.plane!.normal, tolerance);
    // Edges and unoriented measurement planes describe axes, so report the
    // deterministic smaller angle in the inclusive 0-90 degree range.
    const radians = Math.acos(clamp(Math.abs(dot(firstDirection, secondDirection)), -1, 1));
    return success({
      id,
      kind,
      references: refs,
      label: kind === 'edgeAngle' ? 'Edge-to-edge angle' : 'Face-to-face angle',
      radians: canonical(radians, tolerance.angular),
      degrees: canonical(radians * 180 / Math.PI, tolerance.angular),
    });
  } catch (error) {
    return failure(
      'DEGENERATE_GEOMETRY',
      error instanceof Error ? error.message : 'The selected geometry cannot be measured.'
    );
  }
}

/** Validate one exact persisted reference without guessing a replacement. */
export function validateMeasurementReference(
  reference: MeasurementReference,
  context: MeasurementEvaluationContext
): MeasurementDiagnostic | null {
  const resolved = resolveReference(reference, 0, context);
  return resolved.ok ? null : resolved.diagnostic;
}

interface ResolvedReference {
  ok: true;
  body: Body;
  vertex?: Vertex;
  edge?: Edge;
  plane?: Plane;
}

function resolveReference(
  reference: MeasurementReference,
  index: number,
  context: MeasurementEvaluationContext
): ResolvedReference | { ok: false; diagnostic: MeasurementDiagnostic } {
  const body = getBody(context.bodies, reference.bodyId);
  if (!body || (
    context.getOwningFeatureId
    && context.getOwningFeatureId(reference.bodyId) !== reference.featureId
  )) {
    return brokenReference(index, 'body');
  }
  if (reference.kind === 'body') return { ok: true, body };
  if (reference.kind === 'vertex') {
    const vertex = body.vertices.get(reference.vertexId);
    return vertex ? { ok: true, body, vertex } : brokenReference(index, 'vertex');
  }
  if (reference.kind === 'edge') {
    const edge = body.edges.get(reference.edgeId);
    return edge ? { ok: true, body, edge } : brokenReference(index, 'edge');
  }
  const face = body.faces.get(reference.faceId);
  const plane = face ? body.planes.get(face.planeId) : undefined;
  return face && plane ? { ok: true, body, plane } : brokenReference(index, 'face');
}

function brokenReference(
  index: number,
  entity: MeasurementReferenceKind
): { ok: false; diagnostic: MeasurementDiagnostic } {
  return {
    ok: false,
    diagnostic: {
      code: 'REFERENCE_NOT_FOUND',
      message: `Measurement reference ${index + 1} no longer resolves to its exact ${entity}.`,
      referenceIndex: index,
    },
  };
}

function getBody(
  bodies: readonly Body[] | ReadonlyMap<string, Body>,
  bodyId: string
): Body | undefined {
  return Array.isArray(bodies)
    ? (bodies as readonly Body[]).find((candidate) => candidate.id === bodyId)
    : (bodies as ReadonlyMap<string, Body>).get(bodyId);
}

function edgeDirection(
  reference: ResolvedReference,
  tolerance: Readonly<TolerancePolicy>
): [number, number, number] {
  const edge = reference.edge!;
  const start = reference.body.vertices.get(edge.vertexIds[0])!;
  const end = reference.body.vertices.get(edge.vertexIds[1])!;
  return normalized(subtract(end.position, start.position), tolerance);
}

function success(result: MeasurementResult): MeasurementEvaluationResult {
  return { ok: true, result };
}

function failure(
  code: MeasurementDiagnostic['code'],
  message: string,
  referenceIndex?: number
): MeasurementEvaluationResult {
  return {
    ok: false,
    diagnostics: [{ code, message, ...(referenceIndex === undefined ? {} : { referenceIndex }) }],
  };
}

function instructionFor(
  kind: MeasurementKind,
  selectedCount: number,
  expected: MeasurementReferenceKind | null
): string {
  if (!expected) return 'Measurement preview is ready. Press Enter to pin or Escape to cancel.';
  const role = selectedCount === 0 ? 'first' : 'second';
  if (kind === 'vertexToFace') {
    return selectedCount === 0 ? 'Select a vertex.' : 'Select a planar face.';
  }
  if (REQUIRED_REFERENCE_KINDS[kind].length === 1) return `Select one ${expected}.`;
  return `Select the ${role} ${expected}.`;
}

function referenceKey(reference: MeasurementReference): string {
  const topologyId = reference.kind === 'body'
    ? ''
    : reference.kind === 'vertex'
      ? reference.vertexId
      : reference.kind === 'edge'
        ? reference.edgeId
        : reference.faceId;
  return `${reference.kind}:${reference.featureId}:${reference.bodyId}:${topologyId}`;
}

function cloneReference(reference: MeasurementReference): MeasurementReference {
  return { ...reference };
}

function cloneMeasurementResult(result: MeasurementResult): MeasurementResult {
  return {
    ...result,
    references: result.references.map(cloneReference),
    ...(result.kind === 'vertexToVertex' ? { delta: [...result.delta] as [number, number, number] } : {}),
  } as MeasurementResult;
}

function subtract(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function vectorLength(vector: readonly [number, number, number]): number {
  return Math.hypot(...vector);
}

function normalized(
  vector: readonly [number, number, number],
  tolerance: Readonly<TolerancePolicy>
): [number, number, number] {
  const length = vectorLength(vector);
  if (!Number.isFinite(length) || length <= tolerance.linear) {
    throw new Error('The selected geometry has a degenerate direction.');
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function canonical(value: number, tolerance: number): number {
  const quantized = quantizeToTolerance(value, tolerance);
  return Object.is(quantized, -0) ? 0 : quantized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
