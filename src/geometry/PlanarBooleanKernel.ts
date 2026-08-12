import polygonClipping, { type MultiPolygon } from 'polygon-clipping';
import type { Body } from './Body';
import { addEdge, addFace, addPlane, addVertex, createBody } from './Body';
import { createEdge } from './Edge';
import { createFace } from './Face';
import { createPlane, type Plane } from './Plane';
import { normalizePlanarRegion, type PlanarPoint, type PlanarRegion } from './PlanarRegion';
import { DEFAULT_TOLERANCE_POLICY, quantizeToTolerance, type TolerancePolicy } from './TolerancePolicy';
import { triangulateFace } from './Triangulator';
import { validateClosedManifoldBody } from './Validation';
import { createVertex } from './Vertex';

export type PlanarBooleanOperation = 'union' | 'difference' | 'intersection' | 'split';

export interface PlanarBooleanRequest {
  operation: PlanarBooleanOperation;
  operationId: string;
  target: Body;
  tools: readonly Body[];
  tolerance?: TolerancePolicy;
}

export type BooleanDiagnosticCode =
  | 'INVALID_INPUT'
  | 'NON_MANIFOLD_INPUT'
  | 'SLIVER_RESULT'
  | 'COPLANAR_AMBIGUITY'
  | 'DISCONNECTED_RESULT'
  | 'DEGENERATE_RESULT'
  | 'BOOLEAN_FAILED';

export interface BooleanDiagnostic {
  code: BooleanDiagnosticCode;
  message: string;
  entityIds: string[];
}

export interface TopologyProvenance {
  resultId: string;
  sourceIds: readonly string[];
  kind: 'retained' | 'split' | 'intersection' | 'generated';
}

export type PlanarBooleanResult =
  | {
      ok: true;
      bodies: Body[];
      primaryBodyId: string | null;
      provenance: TopologyProvenance[];
      diagnostics: BooleanDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: BooleanDiagnostic[];
    };

type Vector3 = [number, number, number];

interface PolygonSource {
  bodyId: string;
  faceId: string;
}

class CsgVertex {
  constructor(readonly position: Vector3) {}

  clone(): CsgVertex {
    return new CsgVertex([...this.position]);
  }

  interpolate(other: CsgVertex, amount: number): CsgVertex {
    return new CsgVertex([
      this.position[0] + (other.position[0] - this.position[0]) * amount,
      this.position[1] + (other.position[1] - this.position[1]) * amount,
      this.position[2] + (other.position[2] - this.position[2]) * amount,
    ]);
  }
}

class CsgPlane {
  constructor(
    readonly normal: Vector3,
    readonly w: number,
    private readonly epsilon: number
  ) {}

  static fromPoints(a: Vector3, b: Vector3, c: Vector3, epsilon: number): CsgPlane | null {
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    if (!normal) return null;
    return new CsgPlane(normal, dot(normal, a), epsilon);
  }

  clone(): CsgPlane {
    return new CsgPlane([...this.normal], this.w, this.epsilon);
  }

  flipped(): CsgPlane {
    return new CsgPlane(scale(this.normal, -1), -this.w, this.epsilon);
  }

  splitPolygon(
    polygon: CsgPolygon,
    coplanarFront: CsgPolygon[],
    coplanarBack: CsgPolygon[],
    front: CsgPolygon[],
    back: CsgPolygon[]
  ): void {
    const coplanar = 0;
    const frontType = 1;
    const backType = 2;
    const spanning = 3;
    let polygonType = coplanar;
    const types = polygon.vertices.map((vertex) => {
      const distance = dot(this.normal, vertex.position) - this.w;
      const type = distance < -this.epsilon
        ? backType
        : distance > this.epsilon ? frontType : coplanar;
      polygonType |= type;
      return type;
    });

    if (polygonType === coplanar) {
      if (dot(this.normal, polygon.plane.normal) > 0) coplanarFront.push(polygon);
      else coplanarBack.push(polygon);
      return;
    }
    if (polygonType === frontType) {
      front.push(polygon);
      return;
    }
    if (polygonType === backType) {
      back.push(polygon);
      return;
    }
    if (polygonType !== spanning) return;

    const frontVertices: CsgVertex[] = [];
    const backVertices: CsgVertex[] = [];
    for (let index = 0; index < polygon.vertices.length; index++) {
      const nextIndex = (index + 1) % polygon.vertices.length;
      const currentType = types[index]!;
      const nextType = types[nextIndex]!;
      const current = polygon.vertices[index]!;
      const next = polygon.vertices[nextIndex]!;
      if (currentType !== backType) frontVertices.push(current);
      if (currentType !== frontType) backVertices.push(currentType === backType ? current : current.clone());
      if ((currentType | nextType) === spanning) {
        const direction = subtract(next.position, current.position);
        const denominator = dot(this.normal, direction);
        if (Math.abs(denominator) <= this.epsilon) continue;
        const amount = (this.w - dot(this.normal, current.position)) / denominator;
        const vertex = current.interpolate(next, amount);
        frontVertices.push(vertex);
        backVertices.push(vertex.clone());
      }
    }
    if (frontVertices.length >= 3) front.push(new CsgPolygon(frontVertices, polygon.sources, this.epsilon));
    if (backVertices.length >= 3) back.push(new CsgPolygon(backVertices, polygon.sources, this.epsilon));
  }
}

class CsgPolygon {
  readonly plane: CsgPlane;

  constructor(
    readonly vertices: CsgVertex[],
    readonly sources: readonly PolygonSource[],
    epsilon: number
  ) {
    const plane = CsgPlane.fromPoints(
      vertices[0]!.position,
      vertices[1]!.position,
      vertices[2]!.position,
      epsilon
    );
    if (!plane) throw new Error('Degenerate Boolean polygon');
    this.plane = plane;
  }

  clone(): CsgPolygon {
    return new CsgPolygon(
      this.vertices.map((vertex) => vertex.clone()),
      this.sources.map((source) => ({ ...source })),
      DEFAULT_TOLERANCE_POLICY.linear
    );
  }

  flipped(): CsgPolygon {
    return new CsgPolygon(
      [...this.vertices].reverse().map((vertex) => vertex.clone()),
      this.sources.map((source) => ({ ...source })),
      DEFAULT_TOLERANCE_POLICY.linear
    );
  }
}

class CsgNode {
  private plane: CsgPlane | null = null;
  private front: CsgNode | null = null;
  private back: CsgNode | null = null;
  private polygons: CsgPolygon[] = [];

  constructor(polygons: readonly CsgPolygon[] = []) {
    if (polygons.length > 0) this.build(polygons.map((polygon) => polygon.clone()));
  }

  clone(): CsgNode {
    const node = new CsgNode();
    node.plane = this.plane?.clone() ?? null;
    node.front = this.front?.clone() ?? null;
    node.back = this.back?.clone() ?? null;
    node.polygons = this.polygons.map((polygon) => polygon.clone());
    return node;
  }

  invert(): void {
    this.polygons = this.polygons.map((polygon) => polygon.flipped());
    this.plane = this.plane?.flipped() ?? null;
    this.front?.invert();
    this.back?.invert();
    [this.front, this.back] = [this.back, this.front];
  }

  clipPolygons(polygons: readonly CsgPolygon[]): CsgPolygon[] {
    if (!this.plane) return polygons.map((polygon) => polygon.clone());
    let front: CsgPolygon[] = [];
    let back: CsgPolygon[] = [];
    for (const polygon of polygons) {
      this.plane.splitPolygon(polygon, front, back, front, back);
    }
    if (this.front) front = this.front.clipPolygons(front);
    if (this.back) back = this.back.clipPolygons(back);
    else back = [];
    return [...front, ...back];
  }

  clipTo(other: CsgNode): void {
    this.polygons = other.clipPolygons(this.polygons);
    this.front?.clipTo(other);
    this.back?.clipTo(other);
  }

  allPolygons(): CsgPolygon[] {
    return [
      ...this.polygons,
      ...(this.front?.allPolygons() ?? []),
      ...(this.back?.allPolygons() ?? []),
    ];
  }

  build(polygons: readonly CsgPolygon[]): void {
    if (polygons.length === 0) return;
    this.plane ??= polygons[0]!.plane.clone();
    const front: CsgPolygon[] = [];
    const back: CsgPolygon[] = [];
    for (const polygon of polygons) {
      this.plane.splitPolygon(polygon, this.polygons, this.polygons, front, back);
    }
    if (front.length > 0) {
      this.front ??= new CsgNode();
      this.front.build(front);
    }
    if (back.length > 0) {
      this.back ??= new CsgNode();
      this.back.build(back);
    }
  }
}

export function executePlanarBoolean(request: PlanarBooleanRequest): PlanarBooleanResult {
  const tolerance = request.tolerance ?? DEFAULT_TOLERANCE_POLICY;
  if (!request.operationId.trim() || request.tools.length === 0) {
    return failure('INVALID_INPUT', 'Boolean operations require an operation ID and at least one tool body.', [
      request.target.id,
    ]);
  }
  const operands = [request.target, ...request.tools];
  for (const body of operands) {
    const validation = validateClosedManifoldBody(body);
    if (!validation.ok) {
      return failure(
        'NON_MANIFOLD_INPUT',
        `Body ${body.name} is not a closed planar manifold.`,
        [body.id, ...validation.errors.map((error) => error.entityId).filter(isString)]
      );
    }
  }

  try {
    const target = bodyToCsgPolygons(request.target, tolerance.linear);
    if (target.length === 0) {
      return failure('DEGENERATE_RESULT', 'The target body could not be converted to planar regions.', [
        request.target.id,
      ]);
    }
    const tools = [...request.tools]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((body) => bodyToCsgPolygons(body, tolerance.linear));
    if (tools.some((polygons) => polygons.length === 0)) {
      return failure('DEGENERATE_RESULT', 'A tool body could not be converted to planar regions.', [
        ...request.tools.map((body) => body.id),
      ]);
    }

    let resultPolygons: CsgPolygon[];
    if (request.operation === 'split') {
      if (tools.length !== 1) {
        return failure('INVALID_INPUT', 'Split requires exactly one tool body.', [
          request.target.id,
          ...request.tools.map((body) => body.id),
        ]);
      }
      const kept = rebuildBodies(
        subtractCsg(target, tools[0]!),
        `${request.operationId}:kept`,
        request.target.id,
        `${request.target.name} kept`,
        tolerance
      );
      if (!kept.ok) return kept;
      const removedBodyId = `${request.operationId}:body:removed`;
      const removed = rebuildBodies(
        intersectCsg(target, tools[0]!),
        `${request.operationId}:removed`,
        removedBodyId,
        `${request.target.name} removed`,
        tolerance
      );
      if (!removed.ok) return removed;
      return {
        ok: true,
        bodies: [...kept.bodies, ...removed.bodies],
        primaryBodyId: kept.primaryBodyId,
        provenance: [...kept.provenance, ...removed.provenance]
          .sort((left, right) => left.resultId.localeCompare(right.resultId)),
        diagnostics: [],
      };
    } else {
      resultPolygons = target;
      for (const tool of tools) {
        resultPolygons = request.operation === 'union'
          ? unionCsg(resultPolygons, tool)
          : request.operation === 'difference'
            ? subtractCsg(resultPolygons, tool)
            : intersectCsg(resultPolygons, tool);
      }
    }

    if (resultPolygons.length === 0) {
      return failure('DEGENERATE_RESULT', 'The Boolean operation removed all solid material.', [
        request.target.id,
        ...request.tools.map((body) => body.id),
      ]);
    }
    const rebuilt = rebuildBodies(
      resultPolygons,
      request.operationId,
      request.target.id,
      `${request.target.name} ${request.operation}`,
      tolerance
    );
    if (!rebuilt.ok) return rebuilt;
    if (request.operation === 'union' && rebuilt.bodies.length !== 1) {
      return failure(
        'DISCONNECTED_RESULT',
        'Union requires one connected result. Use Compound Bodies for separated solids.',
        [request.target.id, ...request.tools.map((body) => body.id)]
      );
    }
    return rebuilt;
  } catch (error) {
    return failure(
      'BOOLEAN_FAILED',
      error instanceof Error ? error.message : 'The planar Boolean operation failed.',
      [request.target.id, ...request.tools.map((body) => body.id)]
    );
  }
}

function unionCsg(leftPolygons: readonly CsgPolygon[], rightPolygons: readonly CsgPolygon[]): CsgPolygon[] {
  const left = new CsgNode(leftPolygons);
  const right = new CsgNode(rightPolygons);
  left.clipTo(right);
  right.clipTo(left);
  right.invert();
  right.clipTo(left);
  right.invert();
  left.build(right.allPolygons());
  return left.allPolygons();
}

function subtractCsg(
  leftPolygons: readonly CsgPolygon[],
  rightPolygons: readonly CsgPolygon[]
): CsgPolygon[] {
  const left = new CsgNode(leftPolygons);
  const right = new CsgNode(rightPolygons);
  left.invert();
  left.clipTo(right);
  right.clipTo(left);
  right.invert();
  right.clipTo(left);
  right.invert();
  left.build(right.allPolygons());
  left.invert();
  return left.allPolygons();
}

function intersectCsg(
  leftPolygons: readonly CsgPolygon[],
  rightPolygons: readonly CsgPolygon[]
): CsgPolygon[] {
  const left = new CsgNode(leftPolygons);
  const right = new CsgNode(rightPolygons);
  left.invert();
  right.clipTo(left);
  right.invert();
  left.clipTo(right);
  right.clipTo(left);
  left.build(right.allPolygons());
  left.invert();
  return left.allPolygons();
}

function bodyToCsgPolygons(body: Body, epsilon: number): CsgPolygon[] {
  const polygons: CsgPolygon[] = [];
  for (const [faceId, face] of [...body.faces].sort(([left], [right]) => left.localeCompare(right))) {
    const triangulation = triangulateFace(body, face, faceId);
    if (!triangulation) continue;
    for (let index = 0; index < triangulation.indices.length; index += 3) {
      const triangle = [
        triangulation.indices[index]!,
        triangulation.indices[index + 1]!,
        triangulation.indices[index + 2]!,
      ].map((vertexIndex): Vector3 => {
        const offset = vertexIndex * 3;
        return [
          triangulation.positions[offset]!,
          triangulation.positions[offset + 1]!,
          triangulation.positions[offset + 2]!,
        ];
      });
      if (magnitude(cross(subtract(triangle[1]!, triangle[0]!), subtract(triangle[2]!, triangle[0]!)))
        <= epsilon * epsilon) {
        continue;
      }
      polygons.push(new CsgPolygon(
        triangle.map((position) => new CsgVertex(position)),
        [{ bodyId: body.id, faceId }],
        epsilon
      ));
    }
  }
  return polygons;
}

interface RebuildSuccess {
  ok: true;
  bodies: Body[];
  primaryBodyId: string | null;
  provenance: TopologyProvenance[];
  diagnostics: BooleanDiagnostic[];
}

interface RebuiltFaceDefinition {
  planeId: string;
  plane: Plane;
  faceId: string;
  loops: Vector3[][];
  sourceIds: string[];
}

function rebuildBodies(
  polygons: readonly CsgPolygon[],
  operationId: string,
  targetBodyId: string,
  name: string,
  tolerance: TolerancePolicy
): RebuildSuccess | { ok: false; diagnostics: BooleanDiagnostic[] } {
  const faceGroups = groupCoplanarPolygons(polygons, tolerance);
  const body = createBody(targetBodyId, name);
  const provenance: TopologyProvenance[] = [];
  const vertexIds = new Map<string, string>();
  const edgeIds = new Map<string, string>();
  const faceDefinitions: RebuiltFaceDefinition[] = [];

  for (const [planeKey, group] of [...faceGroups].sort(([left], [right]) => left.localeCompare(right))) {
    const plane = createCanonicalPlane(group[0]!.plane);
    const maxPlaneDistance = Math.max(...group.flatMap((polygon) =>
      polygon.vertices.map((vertex) =>
        Math.abs(dot(group[0]!.plane.normal, vertex.position) - group[0]!.plane.w)
      )
    ));
    if (maxPlaneDistance > tolerance.planarity) {
      return failure(
        'BOOLEAN_FAILED',
        `Boolean face fragments drifted off their canonical plane by ${maxPlaneDistance}.`,
        group.flatMap((polygon) =>
          polygon.sources.map((source) => `${source.bodyId}/${source.faceId}`)
        )
      );
    }
    const projected: PlanarPoint[][][] = [];
    for (const polygon of group) {
      const snapped = snapFragmentRing(
        polygon.vertices.map((vertex) => projectToPlane(plane, vertex.position)),
        tolerance
      );
      const normalizedFragment = normalizePlanarRegion({ outer: snapped }, tolerance);
      if (!normalizedFragment.ok) {
        return failure(
          'SLIVER_RESULT',
          'A Boolean face fragment collapsed within the document tolerance.',
          polygon.sources.map((source) => `${source.bodyId}/${source.faceId}`)
        );
      }
      projected.push([normalizedFragment.region.outer]);
    }
    if (projected.length === 0) continue;
    const merged = polygonClipping.union(projected[0]!, ...projected.slice(1));
    const sourceIds = [...new Set(group.flatMap((polygon) =>
      polygon.sources.map((source) => `${source.bodyId}/${source.faceId}`)
    ))].sort();
    for (const polygon of canonicalMultiPolygon(merged, tolerance)) {
      const normalized = normalizePlanarRegion({
        outer: polygon[0]!,
        holes: polygon.slice(1),
      }, tolerance);
      if (!normalized.ok) {
        return failure(
          'COPLANAR_AMBIGUITY',
          `Coplanar fragments could not be merged safely: ${normalized.diagnostics
            .map((diagnostic) => diagnostic.code)
            .join(', ')}.`,
          sourceIds
        );
      }
      const planeId = `${operationId}:plane:${hashText(planeKey)}`;
      const regionSignature = regionKey(normalized.region, tolerance);
      const faceId = `${operationId}:face:${hashText(`${planeKey}|${regionSignature}`)}`;
      faceDefinitions.push({
        planeId,
        plane,
        faceId,
        loops: [normalized.region.outer, ...normalized.region.holes]
          .map((loop) => loop.map((point) => planeToWorld(plane, point))),
        sourceIds,
      });
      provenance.push({
        resultId: faceId,
        sourceIds,
        kind: sourceIds.length === 1 ? 'split' : 'intersection',
      });
    }
  }

  const globalPoints = uniqueVectors(
    faceDefinitions.flatMap((definition) => definition.loops.flat()),
    tolerance.linear
  );
  for (const definition of faceDefinitions.sort((left, right) =>
    left.faceId.localeCompare(right.faceId)
  )) {
    if (!body.planes.has(definition.planeId)) {
      addPlane(body, definition.plane, definition.planeId);
    }
    const faceLoops = definition.loops.map((loop) =>
      subdivideLoopAtPoints(loop, globalPoints, tolerance.linear).map((world) => {
        const vertexKey = vectorKey(world, tolerance.linear);
        let vertexId = vertexIds.get(vertexKey);
        if (!vertexId) {
          vertexId = `${operationId}:vertex:${hashText(vertexKey)}`;
          vertexIds.set(vertexKey, vertexId);
          addVertex(body, createVertex(world, vertexId));
        }
        return vertexId;
      }).map((vertexId, index, ids) => {
        const nextId = ids[(index + 1) % ids.length]!;
        const edgeKey = vertexId < nextId ? `${vertexId}|${nextId}` : `${nextId}|${vertexId}`;
        let edgeId = edgeIds.get(edgeKey);
        if (!edgeId) {
          edgeId = `${operationId}:edge:${hashText(edgeKey)}`;
          edgeIds.set(edgeKey, edgeId);
          addEdge(body, createEdge(vertexId, nextId, edgeId));
        }
        return edgeId;
      })
    );
    const face = createFace(
      definition.planeId,
      faceLoops[0]!,
      definition.faceId,
      `Boolean ${definition.faceId.slice(-8)}`
    );
    if (faceLoops.length > 1) face.innerBoundaryEdgeIds = faceLoops.slice(1);
    addFace(body, face);
  }

  const components = partitionBody(body, operationId, targetBodyId, name);
  if (components.length === 0) {
    return failure('DEGENERATE_RESULT', 'Boolean reconstruction produced no closed body.', [targetBodyId]);
  }
  for (const component of components) {
    const validation = validateClosedManifoldBody(component);
    if (!validation.ok) {
      return failure(
        'BOOLEAN_FAILED',
        `Boolean reconstruction produced a non-manifold planar body: ${validation.errors
          .map((item) => `${item.code} (${item.entityId ?? 'unknown'})`)
          .join(', ')}.`,
        [component.id, ...validation.errors.map((error) => error.entityId).filter(isString)]
      );
    }
  }
  return {
    ok: true,
    bodies: components,
    primaryBodyId: components[0]?.id ?? null,
    provenance: provenance.sort((left, right) => left.resultId.localeCompare(right.resultId)),
    diagnostics: [],
  };
}

function uniqueVectors(points: readonly Vector3[], tolerance: number): Vector3[] {
  const byKey = new Map<string, Vector3>();
  for (const point of points) {
    const key = vectorKey(point, tolerance);
    if (!byKey.has(key)) byKey.set(key, [...point]);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, point]) => point);
}

function subdivideLoopAtPoints(
  loop: readonly Vector3[],
  candidatePoints: readonly Vector3[],
  tolerance: number
): Vector3[] {
  const result: Vector3[] = [];
  for (let index = 0; index < loop.length; index++) {
    const start = loop[index]!;
    const end = loop[(index + 1) % loop.length]!;
    const direction = subtract(end, start);
    const lengthSquared = dot(direction, direction);
    if (lengthSquared <= tolerance * tolerance) continue;
    const points = candidatePoints
      .map((point) => {
        const amount = dot(subtract(point, start), direction) / lengthSquared;
        const projection = add(start, scale(direction, amount));
        return { point, amount, distance: magnitude(subtract(point, projection)) };
      })
      .filter(({ amount, distance }) =>
        amount >= -tolerance
        && amount < 1 - tolerance
        && distance <= tolerance
      )
      .sort((left, right) =>
        left.amount - right.amount
        || vectorKey(left.point, tolerance).localeCompare(vectorKey(right.point, tolerance))
      );
    for (const { point } of points) {
      if (result.length === 0 || magnitude(subtract(point, result[result.length - 1]!)) > tolerance) {
        result.push([...point]);
      }
    }
  }
  return result;
}

function groupCoplanarPolygons(
  polygons: readonly CsgPolygon[],
  tolerance: TolerancePolicy
): Map<string, CsgPolygon[]> {
  const groups = new Map<string, CsgPolygon[]>();
  for (const polygon of polygons) {
    const key = csgPlaneKey(polygon.plane, tolerance);
    const group = groups.get(key) ?? [];
    group.push(polygon);
    groups.set(key, group);
  }
  return groups;
}

function createCanonicalPlane(source: CsgPlane): Plane {
  return createPlane(scale(source.normal, source.w), source.normal);
}

function csgPlaneKey(plane: CsgPlane, tolerance: TolerancePolicy): string {
  return [
    quantizeToTolerance(plane.normal[0], tolerance.angular),
    quantizeToTolerance(plane.normal[1], tolerance.angular),
    quantizeToTolerance(plane.normal[2], tolerance.angular),
    quantizeToTolerance(plane.w, tolerance.linear),
  ].join(',');
}

function canonicalMultiPolygon(value: MultiPolygon, tolerance: TolerancePolicy): PlanarPoint[][][] {
  return value
    .map((polygon) => polygon
      .map((ring) => canonicalRing(ring as PlanarPoint[], tolerance.linear))
      .filter((ring) => ring.length >= 3))
    .filter((polygon) => polygon.length > 0)
    .sort((left, right) => ringKey(left[0]!, tolerance.linear)
      .localeCompare(ringKey(right[0]!, tolerance.linear)));
}

function canonicalRing(points: readonly PlanarPoint[], tolerance: number): PlanarPoint[] {
  const withoutClose = points.length > 1 && distance2(points[0]!, points[points.length - 1]!) <= tolerance
    ? points.slice(0, -1)
    : [...points];
  const seen = new Set<string>();
  const deduplicated = withoutClose
    .map((point): PlanarPoint => [
      quantizeToTolerance(point[0], tolerance),
      quantizeToTolerance(point[1], tolerance),
    ])
    .filter((point, index, quantized) => {
      if (index > 0 && distance2(point, quantized[index - 1]!) <= tolerance) return false;
      const key = `${point[0]},${point[1]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  let changed = true;
  while (changed && deduplicated.length > 3) {
    changed = false;
    for (let index = 0; index < deduplicated.length; index++) {
      const previous = deduplicated[(index - 1 + deduplicated.length) % deduplicated.length]!;
      const current = deduplicated[index]!;
      const next = deduplicated[(index + 1) % deduplicated.length]!;
      if (Math.abs(cross2(subtract2(current, previous), subtract2(next, current))) <= tolerance) {
        deduplicated.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return deduplicated;
}

function snapFragmentRing(
  points: readonly PlanarPoint[],
  tolerance: TolerancePolicy
): PlanarPoint[] {
  const snapped = points.map((point): PlanarPoint => [
    quantizeToTolerance(point[0], tolerance.linear),
    quantizeToTolerance(point[1], tolerance.linear),
  ]);
  if (snapped.length > 1 && distance2(snapped[0]!, snapped[snapped.length - 1]!)
    <= tolerance.linear) {
    snapped.pop();
  }
  const deduplicated = snapped.filter((point, index) =>
    index === 0 || distance2(point, snapped[index - 1]!) > tolerance.linear
  );
  let changed = true;
  while (changed && deduplicated.length > 3) {
    changed = false;
    for (let index = 0; index < deduplicated.length; index++) {
      const previous = deduplicated[(index - 1 + deduplicated.length) % deduplicated.length]!;
      const current = deduplicated[index]!;
      const next = deduplicated[(index + 1) % deduplicated.length]!;
      if (Math.abs(cross2(subtract2(current, previous), subtract2(next, current)))
        <= tolerance.area) {
        deduplicated.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return deduplicated;
}

function partitionBody(body: Body, operationId: string, targetBodyId: string, name: string): Body[] {
  const remaining = new Set(body.faces.keys());
  const components: string[][] = [];
  while (remaining.size > 0) {
    const start = [...remaining].sort()[0]!;
    const queue = [start];
    const faces: string[] = [];
    remaining.delete(start);
    while (queue.length > 0) {
      const faceId = queue.shift()!;
      faces.push(faceId);
      const face = body.faces.get(faceId)!;
      const adjacent = [...face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds?.flat() ?? [])]
        .flatMap((edgeId) => body.edges.get(edgeId)?.faceIds ?? [])
        .filter((candidate) => remaining.has(candidate))
        .sort();
      for (const candidate of adjacent) {
        remaining.delete(candidate);
        queue.push(candidate);
      }
    }
    components.push(faces.sort());
  }
  const records = components.map((faceIds) => ({
    faceIds,
    bounds: getFaceComponentBounds(body, faceIds),
  }));
  const roots = records
    .filter((candidate) => !records.some((container) =>
      container !== candidate && componentContainsComponent(body, container, candidate)
    ))
    .map((root) => ({
      root,
      faceIds: [...root.faceIds],
    }));
  for (const nested of records.filter((candidate) => !roots.some(({ root }) => root === candidate))) {
    const container = roots
      .filter(({ root }) => componentContainsComponent(body, root, nested))
      .sort((left, right) =>
        boundsVolume(left.root.bounds) - boundsVolume(right.root.bounds)
        || left.root.faceIds.join('|').localeCompare(right.root.faceIds.join('|'))
      )[0];
    if (container) container.faceIds.push(...nested.faceIds);
    else roots.push({ root: nested, faceIds: [...nested.faceIds] });
  }
  roots.sort((left, right) =>
    boundsVolume(right.root.bounds) - boundsVolume(left.root.bounds)
    || left.faceIds.join('|').localeCompare(right.faceIds.join('|'))
  );
  return roots.map(({ faceIds }, index) =>
    extractBodyComponent(
      body,
      faceIds.sort(),
      index === 0 ? targetBodyId : `${operationId}:body:${hashText(faceIds.join('|'))}`,
      index === 0 ? name : `${name} ${index + 1}`
    )
  );
}

interface ComponentBounds {
  min: Vector3;
  max: Vector3;
}

function getFaceComponentBounds(body: Body, faceIds: readonly string[]): ComponentBounds {
  const min: Vector3 = [Infinity, Infinity, Infinity];
  const max: Vector3 = [-Infinity, -Infinity, -Infinity];
  const vertexIds = new Set(faceIds.flatMap((faceId) => {
    const face = body.faces.get(faceId);
    return face
      ? [...face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds?.flat() ?? [])]
        .flatMap((edgeId) => body.edges.get(edgeId)?.vertexIds ?? [])
      : [];
  }));
  for (const vertexId of vertexIds) {
    const position = body.vertices.get(vertexId)?.position;
    if (!position) continue;
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  }
  return { min, max };
}

function strictlyContainsBounds(container: ComponentBounds, nested: ComponentBounds): boolean {
  const tolerance = DEFAULT_TOLERANCE_POLICY.linear;
  return ([0, 1, 2] as const).every((axis) =>
    container.min[axis] < nested.min[axis] - tolerance
    && container.max[axis] > nested.max[axis] + tolerance
  );
}

function componentContainsComponent(
  body: Body,
  container: { faceIds: readonly string[]; bounds: ComponentBounds },
  nested: { faceIds: readonly string[]; bounds: ComponentBounds }
): boolean {
  if (!strictlyContainsBounds(container.bounds, nested.bounds)) return false;
  const nestedVertexId = nested.faceIds
    .flatMap((faceId) => {
      const face = body.faces.get(faceId);
      return face
        ? [...face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds?.flat() ?? [])]
          .flatMap((edgeId) => body.edges.get(edgeId)?.vertexIds ?? [])
        : [];
    })
    .sort()[0];
  const sample = nestedVertexId ? body.vertices.get(nestedVertexId)?.position : undefined;
  return sample ? pointInsideFaceComponent(body, container.faceIds, sample) : false;
}

/**
 * Deterministic ray parity against one closed face component. Triangles are a
 * query-only view here; authoritative topology remains the planar B-Rep.
 */
function pointInsideFaceComponent(
  body: Body,
  faceIds: readonly string[],
  point: Vector3
): boolean {
  const directions: readonly Vector3[] = [
    normalize([1, 0.3713906763541037, 0.6947465906068658])!,
    normalize([0.6180339887498948, 1, 0.4142135623730951])!,
    normalize([0.2679491924311227, 0.7320508075688772, 1])!,
  ];
  let insideVotes = 0;
  for (const direction of directions) {
    const intersections: number[] = [];
    for (const faceId of [...faceIds].sort()) {
      const face = body.faces.get(faceId);
      if (!face) continue;
      const triangulation = triangulateFace(body, face, faceId);
      if (!triangulation) continue;
      for (let index = 0; index < triangulation.indices.length; index += 3) {
        const triangle = [0, 1, 2].map((offset): Vector3 => {
          const vertexIndex = triangulation.indices[index + offset]!;
          const positionOffset = vertexIndex * 3;
          return [
            triangulation.positions[positionOffset]!,
            triangulation.positions[positionOffset + 1]!,
            triangulation.positions[positionOffset + 2]!,
          ];
        });
        const distance = rayTriangleDistance(
          point,
          direction,
          triangle[0]!,
          triangle[1]!,
          triangle[2]!
        );
        if (distance !== null) intersections.push(distance);
      }
    }
    intersections.sort((left, right) => left - right);
    const unique = intersections.filter(
      (distance, index) =>
        index === 0
        || Math.abs(distance - intersections[index - 1]!) > DEFAULT_TOLERANCE_POLICY.linear
    );
    if (unique.length % 2 === 1) insideVotes += 1;
  }
  return insideVotes >= 2;
}

function rayTriangleDistance(
  origin: Vector3,
  direction: Vector3,
  a: Vector3,
  b: Vector3,
  c: Vector3
): number | null {
  const epsilon = DEFAULT_TOLERANCE_POLICY.linear * 1e-3;
  const edgeAB = subtract(b, a);
  const edgeAC = subtract(c, a);
  const h = cross(direction, edgeAC);
  const determinant = dot(edgeAB, h);
  if (Math.abs(determinant) <= epsilon) return null;
  const inverse = 1 / determinant;
  const fromA = subtract(origin, a);
  const u = inverse * dot(fromA, h);
  if (u < -epsilon || u > 1 + epsilon) return null;
  const q = cross(fromA, edgeAB);
  const v = inverse * dot(direction, q);
  if (v < -epsilon || u + v > 1 + epsilon) return null;
  const distance = inverse * dot(edgeAC, q);
  return distance > epsilon ? distance : null;
}

function boundsVolume(bounds: ComponentBounds): number {
  return Math.max(0, bounds.max[0] - bounds.min[0])
    * Math.max(0, bounds.max[1] - bounds.min[1])
    * Math.max(0, bounds.max[2] - bounds.min[2]);
}

function extractBodyComponent(source: Body, faceIds: readonly string[], id: string, name: string): Body {
  const result = createBody(id, name);
  const edgeIds = new Set<string>();
  const vertexIds = new Set<string>();
  const planeIds = new Set<string>();
  for (const faceId of faceIds) {
    const face = source.faces.get(faceId)!;
    planeIds.add(face.planeId);
    for (const edgeId of [...face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds?.flat() ?? [])]) {
      edgeIds.add(edgeId);
      const edge = source.edges.get(edgeId)!;
      vertexIds.add(edge.vertexIds[0]);
      vertexIds.add(edge.vertexIds[1]);
    }
  }
  for (const vertexId of [...vertexIds].sort()) {
    const vertex = source.vertices.get(vertexId)!;
    addVertex(result, createVertex([...vertex.position], vertex.id));
  }
  for (const edgeId of [...edgeIds].sort()) {
    const edge = source.edges.get(edgeId)!;
    addEdge(result, createEdge(edge.vertexIds[0], edge.vertexIds[1], edge.id));
  }
  for (const planeId of [...planeIds].sort()) {
    const plane = source.planes.get(planeId)!;
    addPlane(result, {
      origin: [...plane.origin],
      normal: [...plane.normal],
      uAxis: [...plane.uAxis],
      vAxis: [...plane.vAxis],
    }, planeId);
  }
  for (const faceId of [...faceIds].sort()) {
    const sourceFace = source.faces.get(faceId)!;
    const face = createFace(
      sourceFace.planeId,
      [...sourceFace.boundaryEdgeIds],
      sourceFace.id,
      sourceFace.name
    );
    if (sourceFace.innerBoundaryEdgeIds) {
      face.innerBoundaryEdgeIds = sourceFace.innerBoundaryEdgeIds.map((loop) => [...loop]);
    }
    addFace(result, face);
  }
  return result;
}

function projectToPlane(plane: Plane, point: Vector3): PlanarPoint {
  const offset = subtract(point, plane.origin);
  return [dot(offset, plane.uAxis), dot(offset, plane.vAxis)];
}

function planeToWorld(plane: Plane, point: PlanarPoint): Vector3 {
  return add(plane.origin, add(scale(plane.uAxis, point[0]), scale(plane.vAxis, point[1])));
}

function regionKey(region: PlanarRegion, tolerance: TolerancePolicy): string {
  return [
    ringKey(region.outer, tolerance.linear),
    ...region.holes.map((hole) => ringKey(hole, tolerance.linear)).sort(),
  ].join('/');
}

function ringKey(ring: readonly PlanarPoint[], tolerance: number): string {
  return ring.map((point) => [
    quantizeToTolerance(point[0], tolerance),
    quantizeToTolerance(point[1], tolerance),
  ].join(',')).join(';');
}

function vectorKey(vector: Vector3, tolerance: number): string {
  return vector.map((component) => quantizeToTolerance(component, tolerance)).join(',');
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function failure(
  code: BooleanDiagnosticCode,
  message: string,
  entityIds: readonly string[]
): { ok: false; diagnostics: BooleanDiagnostic[] } {
  return {
    ok: false,
    diagnostics: [{
      code,
      message,
      entityIds: [...new Set(entityIds)].sort(),
    }],
  };
}

function add(left: Vector3, right: Vector3): Vector3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(vector: Vector3, amount: number): Vector3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function magnitude(vector: Vector3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vector3): Vector3 | null {
  const length = magnitude(vector);
  return length <= DEFAULT_TOLERANCE_POLICY.linear ? null : scale(vector, 1 / length);
}

function subtract2(left: PlanarPoint, right: PlanarPoint): PlanarPoint {
  return [left[0] - right[0], left[1] - right[1]];
}

function cross2(left: PlanarPoint, right: PlanarPoint): number {
  return left[0] * right[1] - left[1] * right[0];
}

function distance2(left: PlanarPoint, right: PlanarPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}
