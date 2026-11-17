import type { Body } from '../geometry/Body';
import { triangulateFace } from '../geometry/Triangulator';
import { validateClosedManifoldBody } from '../geometry/Validation';
import { DEFAULT_TOLERANCE_POLICY } from '../geometry/TolerancePolicy';

/** Documents store inches; manufacturing exports write millimeters. */
export const MILLIMETERS_PER_INCH = 25.4;
export type ExportPoint = [number, number, number];
export interface ExportMesh {
  vertices: ExportPoint[];
  triangles: [number, number, number][];
}

/** Unlike viewport triangulation, export must never omit an invalid face. */
export function buildExportMesh(body: Body): ExportMesh {
  const validation = validateClosedManifoldBody(body);
  if (!validation.ok || body.faces.size === 0) {
    throw new Error(`Cannot export body ${body.id}: ${validation.errors[0]?.message ?? 'empty shell'}`);
  }
  const sourceVertices = [...body.vertices.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (sourceVertices.some((vertex) => vertex.position.some((value) => !Number.isFinite(value)))) {
    throw new Error(`Cannot export body ${body.id}: non-finite coordinates`);
  }
  const vertices = sourceVertices.map((vertex) => vertex.position.map(
    (value) => value * MILLIMETERS_PER_INCH
  ) as ExportPoint);
  const triangles: ExportMesh['triangles'] = [];
  const tolerance = DEFAULT_TOLERANCE_POLICY.linear;
  for (const [faceId, face] of [...body.faces].sort(([a], [b]) => a.localeCompare(b))) {
    const mesh = triangulateFace(body, face, faceId);
    if (!mesh || mesh.indices.length === 0) {
      throw new Error(`Cannot export body ${body.id}: face ${faceId} cannot be triangulated`);
    }
    // Reference authoritative shared vertices instead of rounding each face's
    // projection independently and creating cracks along neighboring faces.
    const mapped: number[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const index = sourceVertices.findIndex(({ position }) => Math.hypot(
        position[0] - mesh.positions[i]!,
        position[1] - mesh.positions[i + 1]!,
        position[2] - mesh.positions[i + 2]!
      ) <= tolerance);
      if (index < 0) throw new Error(`Cannot export body ${body.id}: unmatched face vertex`);
      mapped.push(index);
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const triangle = mesh.indices.slice(i, i + 3).map((index) => mapped[index]!) as [number, number, number];
      triangleNormal(...triangle.map((index) => vertices[index]!) as [ExportPoint, ExportPoint, ExportPoint]);
      triangles.push(triangle);
    }
  }
  const edges = new Map<string, { count: number; balance: number }>();
  let volume = 0;
  const origin = vertices[0]!;
  for (const triangle of triangles) {
    for (let i = 0; i < 3; i++) {
      const a = triangle[i]!;
      const b = triangle[(i + 1) % 3]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const edge = edges.get(key) ?? { count: 0, balance: 0 };
      edge.count++;
      edge.balance += a < b ? 1 : -1;
      edges.set(key, edge);
    }
    const [a, b, c] = triangle.map((index) => vertices[index]!.map((value, axis) => value - origin[axis]!) as ExportPoint);
    volume += a![0] * (b![1] * c![2] - b![2] * c![1])
      + a![1] * (b![2] * c![0] - b![0] * c![2])
      + a![2] * (b![0] * c![1] - b![1] * c![0]);
  }
  if (new Set(triangles.flat()).size !== vertices.length
      || [...edges.values()].some((edge) => edge.count !== 2 || edge.balance !== 0) || !(volume > 0)) {
    throw new Error(`Cannot export body ${body.id}: mesh is not a closed outward-oriented solid`);
  }
  return { vertices, triangles };
}

export function triangleNormal(a: ExportPoint, b: ExportPoint, c: ExportPoint): ExportPoint {
  const u = b.map((value, i) => value - a[i]!) as ExportPoint;
  const v = c.map((value, i) => value - a[i]!) as ExportPoint;
  const normal: ExportPoint = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...normal);
  if (!Number.isFinite(length) || length === 0) throw new Error('Cannot export a degenerate triangle');
  return normal.map((value) => value / length) as ExportPoint;
}

export function requireBodies(bodies: readonly Body[]): void {
  if (bodies.length === 0) throw new Error('Select at least one solid to export');
}
