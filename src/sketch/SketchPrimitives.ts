import type { Point2D } from './SketchTypes';

export type SketchPrimitiveErrorCode =
  | 'NON_FINITE_POINT'
  | 'ZERO_SIZE'
  | 'INVALID_SIDE_COUNT';

export interface SketchPrimitiveError {
  code: SketchPrimitiveErrorCode;
  message: string;
}

export type SketchPrimitiveResult =
  | { ok: true; points: Point2D[] }
  | { ok: false; error: SketchPrimitiveError };

export interface SketchPrimitiveOptions {
  minimumSize?: number;
}

const DEFAULT_MINIMUM_SIZE = 1e-6;
const MAX_POLYGON_SIDES = 64;

/** Build a counter-clockwise rectangle from its center and any opposite corner. */
export function createCenterRectangle(
  center: Point2D,
  corner: Point2D,
  options: SketchPrimitiveOptions = {}
): SketchPrimitiveResult {
  const pointError = validatePoints(center, corner);
  if (pointError) {
    return pointError;
  }
  const minimumSize = resolveMinimumSize(options.minimumSize);
  const halfWidth = Math.abs(corner[0] - center[0]);
  const halfHeight = Math.abs(corner[1] - center[1]);
  if (halfWidth <= minimumSize || halfHeight <= minimumSize) {
    return {
      ok: false,
      error: {
        code: 'ZERO_SIZE',
        message: 'Center rectangle needs non-zero width and height.',
      },
    };
  }

  return {
    ok: true,
    points: [
      [center[0] - halfWidth, center[1] - halfHeight],
      [center[0] + halfWidth, center[1] - halfHeight],
      [center[0] + halfWidth, center[1] + halfHeight],
      [center[0] - halfWidth, center[1] + halfHeight],
    ],
  };
}

/**
 * Build a counter-clockwise regular polygon. The supplied vertex is preserved
 * as the deterministic first point.
 */
export function createRegularPolygon(
  center: Point2D,
  vertex: Point2D,
  sides: number,
  options: SketchPrimitiveOptions = {}
): SketchPrimitiveResult {
  const pointError = validatePoints(center, vertex);
  if (pointError) {
    return pointError;
  }
  if (!Number.isInteger(sides) || sides < 3 || sides > MAX_POLYGON_SIDES) {
    return {
      ok: false,
      error: {
        code: 'INVALID_SIDE_COUNT',
        message: `Regular polygon side count must be an integer from 3 to ${MAX_POLYGON_SIDES}.`,
      },
    };
  }

  const minimumSize = resolveMinimumSize(options.minimumSize);
  const dx = vertex[0] - center[0];
  const dy = vertex[1] - center[1];
  const radius = Math.hypot(dx, dy);
  if (radius <= minimumSize) {
    return {
      ok: false,
      error: {
        code: 'ZERO_SIZE',
        message: 'Regular polygon needs a vertex away from its center.',
      },
    };
  }

  const startAngle = Math.atan2(dy, dx);
  const angleStep = (Math.PI * 2) / sides;
  const points: Point2D[] = [];
  for (let index = 0; index < sides; index++) {
    const angle = startAngle + index * angleStep;
    points.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ]);
  }
  // Preserve the exact user-provided first point rather than its trig round-trip.
  points[0] = [vertex[0], vertex[1]];
  return { ok: true, points };
}

function validatePoints(...points: Point2D[]): { ok: false; error: SketchPrimitiveError } | null {
  if (points.some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
    return {
      ok: false,
      error: {
        code: 'NON_FINITE_POINT',
        message: 'Sketch primitive points must contain finite coordinates.',
      },
    };
  }
  return null;
}

function resolveMinimumSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_MINIMUM_SIZE;
}
