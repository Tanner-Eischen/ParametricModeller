import * as THREE from 'three';
import { DEFAULT_TOLERANCE_POLICY, type TolerancePolicy } from './TolerancePolicy';

export type PlanarPoint = [number, number];
export type PlanarLoop = PlanarPoint[];

export interface PlanarRegion {
  /** Counter-clockwise outer boundary after normalization. */
  outer: PlanarLoop;
  /** Clockwise hole boundaries after normalization. */
  holes: PlanarLoop[];
}

export type PlanarRegionDiagnosticCode =
  | 'INVALID_TOLERANCE'
  | 'NON_FINITE_POINT'
  | 'DEGENERATE_LOOP'
  | 'SELF_INTERSECTION'
  | 'LOOP_INTERSECTION'
  | 'HOLE_OUTSIDE_OUTER'
  | 'HOLE_OVERLAP';

export interface PlanarRegionDiagnostic {
  code: PlanarRegionDiagnosticCode;
  message: string;
  loopIndices: number[];
  point?: PlanarPoint;
}

export type PlanarRegionResult =
  | { ok: true; region: PlanarRegion }
  | { ok: false; diagnostics: PlanarRegionDiagnostic[] };

export interface PlanarTriangulation {
  points: PlanarPoint[];
  indices: number[];
}

/** Validate, orient, and canonically rotate a planar region without mutating input. */
export function normalizePlanarRegion(
  region: Readonly<{ outer: readonly PlanarPoint[]; holes?: readonly (readonly PlanarPoint[])[] }>,
  tolerance: Pick<TolerancePolicy, 'linear' | 'area'> = DEFAULT_TOLERANCE_POLICY
): PlanarRegionResult {
  if (!validTolerance(tolerance.linear) || !validTolerance(tolerance.area)) {
    return fail('INVALID_TOLERANCE', 'Planar tolerances must be finite and positive.', []);
  }
  const loops = [region.outer, ...(region.holes ?? [])].map((loop) =>
    removeClosingDuplicate(loop, tolerance.linear)
  );
  const diagnostics: PlanarRegionDiagnostic[] = [];
  loops.forEach((loop, loopIndex) => {
    if (loop.some((point) => !finitePoint(point))) {
      diagnostics.push({
        code: 'NON_FINITE_POINT',
        message: 'Planar loops require finite coordinates.',
        loopIndices: [loopIndex],
      });
      return;
    }
    if (loop.length < 3) {
      diagnostics.push({
        code: 'DEGENERATE_LOOP',
        message: 'Each boundary loop must enclose a non-zero area.',
        loopIndices: [loopIndex],
      });
      return;
    }
    if (loop.some((point, index) =>
      distance(point, loop[(index + 1) % loop.length]!) <= tolerance.linear
    )) {
      diagnostics.push({
        code: 'DEGENERATE_LOOP',
        message: 'Boundary loops cannot contain zero-length edges.',
        loopIndices: [loopIndex],
      });
      return;
    }
    const intersection = firstSelfIntersection(loop, tolerance.linear);
    if (intersection) {
      diagnostics.push({
        code: 'SELF_INTERSECTION',
        message: 'Boundary loops cannot cross, touch, or overlap themselves.',
        loopIndices: [loopIndex],
        point: intersection,
      });
      return;
    }
    if (Math.abs(signedArea(loop)) <= tolerance.area) {
      diagnostics.push({
        code: 'DEGENERATE_LOOP',
        message: 'Each boundary loop must enclose a non-zero area.',
        loopIndices: [loopIndex],
      });
    }
  });
  if (diagnostics.length > 0) return { ok: false, diagnostics: sortDiagnostics(diagnostics) };

  const outer = loops[0]!;
  for (let holeIndex = 1; holeIndex < loops.length; holeIndex++) {
    const hole = loops[holeIndex]!;
    if (!pointInPolygon(hole[0]!, outer, tolerance.linear)) {
      diagnostics.push({
        code: 'HOLE_OUTSIDE_OUTER',
        message: 'Every hole must lie strictly inside the outer boundary.',
        loopIndices: [0, holeIndex],
        point: copyPoint(hole[0]!),
      });
    }
    const outerContact = firstLoopContact(outer, hole, tolerance.linear);
    if (outerContact) {
      diagnostics.push({
        code: 'LOOP_INTERSECTION',
        message: 'Hole boundaries cannot touch or cross the outer boundary.',
        loopIndices: [0, holeIndex],
        point: outerContact,
      });
    }
    for (let otherIndex = 1; otherIndex < holeIndex; otherIndex++) {
      const other = loops[otherIndex]!;
      const contact = firstLoopContact(other, hole, tolerance.linear);
      if (contact || pointInPolygon(hole[0]!, other, tolerance.linear)
        || pointInPolygon(other[0]!, hole, tolerance.linear)) {
        diagnostics.push({
          code: 'HOLE_OVERLAP',
          message: 'Hole boundaries must be disjoint and cannot be nested.',
          loopIndices: [otherIndex, holeIndex],
          ...(contact ? { point: contact } : {}),
        });
      }
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics: sortDiagnostics(diagnostics) };

  return {
    ok: true,
    region: {
      outer: canonicalLoop(outer, true),
      holes: loops.slice(1).map((loop) => canonicalLoop(loop, false))
        .sort((left, right) => comparePoint(left[0]!, right[0]!)),
    },
  };
}

/** Deterministic concave/hole-capable triangulation for a validated planar region. */
export function triangulatePlanarRegion(region: PlanarRegion): PlanarTriangulation | null {
  const normalized = normalizePlanarRegion(region);
  if (!normalized.ok) return null;
  const contour = normalized.region.outer.map(([x, y]) => new THREE.Vector2(x, y));
  const holes = normalized.region.holes.map((loop) =>
    loop.map(([x, y]) => new THREE.Vector2(x, y))
  );
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  const points = [...normalized.region.outer, ...normalized.region.holes.flat()].map(copyPoint);
  const indices = triangles.flatMap((triangle) => [triangle[0]!, triangle[1]!, triangle[2]!]);
  if (indices.length === 0) return null;
  return { points, indices };
}

export function signedPlanarArea(loop: readonly PlanarPoint[]): number {
  return signedArea(loop);
}

export function isPointStrictlyInsideRegion(
  point: PlanarPoint,
  region: PlanarRegion,
  tolerance = DEFAULT_TOLERANCE_POLICY.linear
): boolean {
  return pointInPolygon(point, region.outer, tolerance)
    && !region.holes.some((hole) => pointInPolygon(point, hole, tolerance));
}

export function loopsContact(
  left: readonly PlanarPoint[],
  right: readonly PlanarPoint[],
  tolerance = DEFAULT_TOLERANCE_POLICY.linear
): PlanarPoint | null {
  return firstLoopContact(left, right, tolerance);
}

function canonicalLoop(loop: readonly PlanarPoint[], counterClockwise: boolean): PlanarLoop {
  let oriented = loop.map(copyPoint);
  if ((signedArea(oriented) > 0) !== counterClockwise) oriented = oriented.reverse();
  let start = 0;
  for (let index = 1; index < oriented.length; index++) {
    if (comparePoint(oriented[index]!, oriented[start]!) < 0) start = index;
  }
  return [...oriented.slice(start), ...oriented.slice(0, start)];
}

function removeClosingDuplicate(loop: readonly PlanarPoint[], tolerance: number): PlanarLoop {
  const copied = loop.map(copyPoint);
  if (copied.length > 1 && distance(copied[0]!, copied[copied.length - 1]!) <= tolerance) {
    copied.pop();
  }
  return copied;
}

function firstSelfIntersection(loop: readonly PlanarPoint[], tolerance: number): PlanarPoint | null {
  for (let left = 0; left < loop.length; left++) {
    for (let right = left + 1; right < loop.length; right++) {
      const adjacent = right === left + 1 || (left === 0 && right === loop.length - 1);
      if (adjacent) {
        const overlap = collinearOverlap(
          loop[left]!, loop[(left + 1) % loop.length]!,
          loop[right]!, loop[(right + 1) % loop.length]!, tolerance
        );
        if (overlap) return overlap;
        continue;
      }
      const contact = segmentContact(
        loop[left]!, loop[(left + 1) % loop.length]!,
        loop[right]!, loop[(right + 1) % loop.length]!, tolerance
      );
      if (contact) return contact;
    }
  }
  return null;
}

function collinearOverlap(
  a: PlanarPoint, b: PlanarPoint, c: PlanarPoint, d: PlanarPoint, tolerance: number
): PlanarPoint | null {
  const r: PlanarPoint = [b[0] - a[0], b[1] - a[1]];
  const s: PlanarPoint = [d[0] - c[0], d[1] - c[1]];
  if (Math.abs(cross(r, s)) > tolerance || Math.abs(cross([c[0] - a[0], c[1] - a[1]], r)) > tolerance) {
    return null;
  }
  const lengthSquared = dot(r, r);
  if (lengthSquared <= tolerance * tolerance) return null;
  const t0 = dot([c[0] - a[0], c[1] - a[1]], r) / lengthSquared;
  const t1 = dot([d[0] - a[0], d[1] - a[1]], r) / lengthSquared;
  const start = Math.max(0, Math.min(t0, t1));
  const end = Math.min(1, Math.max(t0, t1));
  if ((end - start) * Math.sqrt(lengthSquared) <= tolerance) return null;
  const midpoint = (start + end) / 2;
  return [a[0] + midpoint * r[0], a[1] + midpoint * r[1]];
}

function firstLoopContact(
  left: readonly PlanarPoint[], right: readonly PlanarPoint[], tolerance: number
): PlanarPoint | null {
  for (let a = 0; a < left.length; a++) {
    for (let b = 0; b < right.length; b++) {
      const contact = segmentContact(
        left[a]!, left[(a + 1) % left.length]!,
        right[b]!, right[(b + 1) % right.length]!, tolerance
      );
      if (contact) return contact;
    }
  }
  return null;
}

function segmentContact(
  a: PlanarPoint, b: PlanarPoint, c: PlanarPoint, d: PlanarPoint, tolerance: number
): PlanarPoint | null {
  const r: PlanarPoint = [b[0] - a[0], b[1] - a[1]];
  const s: PlanarPoint = [d[0] - c[0], d[1] - c[1]];
  const denominator = cross(r, s);
  const offset: PlanarPoint = [c[0] - a[0], c[1] - a[1]];
  if (Math.abs(denominator) <= tolerance) {
    if (Math.abs(cross(offset, r)) > tolerance) return null;
    const lengthSquared = dot(r, r);
    if (lengthSquared <= tolerance * tolerance) return copyPoint(a);
    const t0 = dot(offset, r) / lengthSquared;
    const t1 = dot([d[0] - a[0], d[1] - a[1]], r) / lengthSquared;
    const start = Math.max(0, Math.min(t0, t1));
    const end = Math.min(1, Math.max(t0, t1));
    if (end < start - tolerance) return null;
    const t = (start + end) / 2;
    return [a[0] + t * r[0], a[1] + t * r[1]];
  }
  const t = cross(offset, s) / denominator;
  const u = cross(offset, r) / denominator;
  if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

function pointInPolygon(point: PlanarPoint, loop: readonly PlanarPoint[], tolerance: number): boolean {
  if (loop.some((start, index) =>
    pointSegmentDistance(point, start, loop[(index + 1) % loop.length]!) <= tolerance
  )) return false;
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!;
    const b = loop[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function pointSegmentDistance(point: PlanarPoint, start: PlanarPoint, end: PlanarPoint): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
  ));
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}

function signedArea(loop: readonly PlanarPoint[]): number {
  return loop.reduce((sum, point, index) => {
    const next = loop[(index + 1) % loop.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function sortDiagnostics(diagnostics: PlanarRegionDiagnostic[]): PlanarRegionDiagnostic[] {
  return diagnostics.sort((left, right) =>
    left.code.localeCompare(right.code)
    || left.loopIndices.join('|').localeCompare(right.loopIndices.join('|'))
  );
}

function fail(
  code: PlanarRegionDiagnosticCode, message: string, loopIndices: number[]
): { ok: false; diagnostics: PlanarRegionDiagnostic[] } {
  return { ok: false, diagnostics: [{ code, message, loopIndices }] };
}

function validTolerance(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finitePoint(point: readonly number[]): point is PlanarPoint {
  return point.length === 2 && point.every(Number.isFinite);
}

function copyPoint(point: PlanarPoint): PlanarPoint { return [point[0], point[1]]; }
function comparePoint(left: PlanarPoint, right: PlanarPoint): number {
  return left[0] - right[0] || left[1] - right[1];
}
function distance(left: PlanarPoint, right: PlanarPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
function cross(left: PlanarPoint, right: PlanarPoint): number {
  return left[0] * right[1] - left[1] * right[0];
}
function dot(left: PlanarPoint, right: PlanarPoint): number {
  return left[0] * right[0] + left[1] * right[1];
}
