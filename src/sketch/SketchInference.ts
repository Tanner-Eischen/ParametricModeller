import type { Point2D } from './SketchTypes';
import type { SketchConstraint } from './SketchConstraints';

export interface InferenceSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  /** Persistent endpoint IDs are optional for legacy tuple geometry. */
  startPointId?: string;
  endPointId?: string;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export type SketchProjector = (point: Point2D) => ScreenPoint;

export type SketchInferenceKind =
  | 'coincident'
  | 'endpoint'
  | 'midpoint'
  | 'horizontal'
  | 'vertical'
  | 'grid';

export interface SketchInferenceOptions {
  projector: SketchProjector;
  pixelTolerance: number;
  anchor?: Point2D;
  /** Persistent point at `anchor`, when the active tool has one. */
  anchorPointId?: string;
  gridStep?: number;
}

/**
 * Persistence-ready relation represented by an inference. The active tool
 * supplies the new point or segment ID only when the preview is committed.
 */
export type SketchInferenceRelationInput =
  | { type: 'coincident'; targetPointId: string }
  | { type: 'horizontal' }
  | { type: 'vertical' };

export interface SketchInferenceCandidate {
  id: string;
  kind: SketchInferenceKind;
  point: Point2D;
  distancePixels: number;
  entityIds: string[];
  message: string;
  relationInput?: SketchInferenceRelationInput;
}

export interface CommitSketchInferenceInput {
  /** Stable operation namespace used for relation IDs. */
  operationId: string;
  candidate: SketchInferenceCandidate | null;
  /** New or moved point committed at the inferred location. */
  pointId?: string;
  /** New or edited segment committed with horizontal/vertical inference. */
  segmentId?: string;
}

export type PersistentSketchInferenceInput =
  | {
      id: string;
      type: 'coincident';
      pointId: string;
      targetPointId: string;
    }
  | {
      id: string;
      type: 'horizontal' | 'vertical';
      segmentId: string;
    };

const PRIORITY: Record<SketchInferenceKind, number> = {
  coincident: 0,
  endpoint: 1,
  midpoint: 2,
  horizontal: 3,
  vertical: 3,
  grid: 4,
};

/**
 * Return every inference within the screen-space tolerance, best candidate first.
 * A projector is supplied by the caller so ranking remains correct at any zoom,
 * camera orientation, or device pixel ratio.
 */
export function findSketchInferences(
  cursor: Point2D,
  segments: readonly InferenceSegment[],
  options: SketchInferenceOptions
): SketchInferenceCandidate[] {
  if (!Number.isFinite(options.pixelTolerance) || options.pixelTolerance < 0) {
    return [];
  }

  const candidates: SketchInferenceCandidate[] = [];
  const sortedSegments = [...segments].sort((a, b) => a.id.localeCompare(b.id));

  for (const segment of sortedSegments) {
    addProjectedCandidate(candidates, cursor, options, {
      id: `endpoint:${segment.id}:start`,
      kind: 'endpoint',
      point: segment.start,
      entityIds: [segment.id],
      message: 'Snap to endpoint',
      ...(segment.startPointId
        ? {
            relationInput: {
              type: 'coincident',
              targetPointId: segment.startPointId,
            } as const,
          }
        : {}),
    });
    addProjectedCandidate(candidates, cursor, options, {
      id: `endpoint:${segment.id}:end`,
      kind: 'endpoint',
      point: segment.end,
      entityIds: [segment.id],
      message: 'Snap to endpoint',
      ...(segment.endPointId
        ? {
            relationInput: {
              type: 'coincident',
              targetPointId: segment.endPointId,
            } as const,
          }
        : {}),
    });
    const midpoint: Point2D = [
      (segment.start[0] + segment.end[0]) / 2,
      (segment.start[1] + segment.end[1]) / 2,
    ];
    addProjectedCandidate(candidates, cursor, options, {
      id: `midpoint:${segment.id}`,
      kind: 'midpoint',
      point: midpoint,
      entityIds: [segment.id],
      message: 'Snap to midpoint',
    });

    if (options.anchor) {
      for (const [endpointName, point] of [
        ['start', segment.start],
        ['end', segment.end],
      ] as const) {
        addProjectedCandidate(candidates, cursor, options, {
          id: `coincident:${segment.id}:${endpointName}`,
          kind: 'coincident',
          point,
          entityIds: [segment.id],
          message: 'Make endpoint coincident',
          ...(endpointName === 'start' && segment.startPointId
            ? {
                relationInput: {
                  type: 'coincident',
                  targetPointId: segment.startPointId,
                } as const,
              }
            : endpointName === 'end' && segment.endPointId
              ? {
                  relationInput: {
                    type: 'coincident',
                    targetPointId: segment.endPointId,
                  } as const,
                }
              : {}),
        });
      }
    }
  }

  if (options.anchor) {
    addProjectedCandidate(candidates, cursor, options, {
      id: 'horizontal:anchor',
      kind: 'horizontal',
      point: [cursor[0], options.anchor[1]],
      entityIds: [],
      message: 'Keep horizontal with the previous point',
      relationInput: { type: 'horizontal' },
    });
    addProjectedCandidate(candidates, cursor, options, {
      id: 'vertical:anchor',
      kind: 'vertical',
      point: [options.anchor[0], cursor[1]],
      entityIds: [],
      message: 'Keep vertical with the previous point',
      relationInput: { type: 'vertical' },
    });
  }

  if (typeof options.gridStep === 'number'
    && Number.isFinite(options.gridStep)
    && options.gridStep > 0) {
    addProjectedCandidate(candidates, cursor, options, {
      id: 'grid',
      kind: 'grid',
      point: [
        Math.round(cursor[0] / options.gridStep) * options.gridStep,
        Math.round(cursor[1] / options.gridStep) * options.gridStep,
      ],
      entityIds: [],
      message: 'Snap to grid',
    });
  }

  return candidates.sort(compareCandidates);
}

export function getBestSketchInference(
  cursor: Point2D,
  segments: readonly InferenceSegment[],
  options: SketchInferenceOptions
): SketchInferenceCandidate | null {
  return findSketchInferences(cursor, segments, options)[0] ?? null;
}

/**
 * Convert a committed inference into a persistent solver relation.
 *
 * Endpoint and alignment snaps without persistent topology IDs remain visual
 * snaps only and intentionally return no relation.
 */
export function createSketchInferenceRelations(
  input: CommitSketchInferenceInput
): SketchConstraint[] {
  const persistentInput = createPersistentSketchInferenceInput(input);
  return persistentInput
    ? [materializePersistentSketchInferenceRelation(persistentInput)]
    : [];
}

/** Capture only the stable topology needed to rebuild an inferred relation. */
export function createPersistentSketchInferenceInput(
  input: CommitSketchInferenceInput
): PersistentSketchInferenceInput | null {
  const relationInput = input.candidate?.relationInput;
  if (!relationInput || !input.operationId.trim()) return null;

  switch (relationInput.type) {
    case 'coincident':
      if (
        !input.pointId
        || input.pointId === relationInput.targetPointId
      ) {
        return null;
      }
      return {
        id: `${input.operationId}:inference:coincident`,
        type: 'coincident',
        pointId: input.pointId,
        targetPointId: relationInput.targetPointId,
      };
    case 'horizontal':
    case 'vertical':
      return input.segmentId
        ? {
            id: `${input.operationId}:inference:${relationInput.type}`,
            type: relationInput.type,
            segmentId: input.segmentId,
          }
        : null;
  }
}

export function materializePersistentSketchInferenceRelation(
  input: PersistentSketchInferenceInput
): SketchConstraint {
  return input.type === 'coincident'
    ? {
        id: input.id,
        type: 'coincident',
        pointAId: input.pointId,
        pointBId: input.targetPointId,
      }
    : {
        id: input.id,
        type: input.type,
        segmentId: input.segmentId,
      };
}

function addProjectedCandidate(
  candidates: SketchInferenceCandidate[],
  cursor: Point2D,
  options: SketchInferenceOptions,
  candidate: Omit<SketchInferenceCandidate, 'distancePixels'>
): void {
  const cursorScreen = options.projector(cursor);
  const candidateScreen = options.projector(candidate.point);
  if (!isFiniteScreenPoint(cursorScreen) || !isFiniteScreenPoint(candidateScreen)) {
    return;
  }
  const distancePixels = Math.hypot(
    cursorScreen.x - candidateScreen.x,
    cursorScreen.y - candidateScreen.y
  );
  if (distancePixels <= options.pixelTolerance) {
    candidates.push({
      ...candidate,
      point: [candidate.point[0], candidate.point[1]],
      entityIds: [...candidate.entityIds].sort(),
      distancePixels,
    });
  }
}

function compareCandidates(
  a: SketchInferenceCandidate,
  b: SketchInferenceCandidate
): number {
  return PRIORITY[a.kind] - PRIORITY[b.kind]
    || a.distancePixels - b.distancePixels
    || a.id.localeCompare(b.id);
}

function isFiniteScreenPoint(point: ScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
