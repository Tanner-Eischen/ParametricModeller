import type { Point2D, Sketch } from './SketchTypes';
import { getRectangleCorners } from './SketchTypes';
import { DEFAULT_TOLERANCE_POLICY } from '../geometry/TolerancePolicy';

export interface ProfileSegment {
  id: string;
  start: Point2D;
  end: Point2D;
}

export interface ProfileAnalysisOptions {
  pointTolerance?: number;
  intersectionTolerance?: number;
  minimumArea?: number;
}

export type ProfileIssueCode =
  | 'OPEN_ENDPOINT'
  | 'BRANCHING_VERTEX'
  | 'SELF_INTERSECTION'
  | 'OVERLAPPING_EDGE'
  | 'DEGENERATE_EDGE'
  | 'DUPLICATE_EDGE'
  | 'ZERO_AREA';

export interface ProfileIssue {
  code: ProfileIssueCode;
  message: string;
  entityIds: string[];
  point?: Point2D;
}

export interface AnalyzedProfile {
  /** Stable for the same set of boundary entities, regardless of input order. */
  id: string;
  /** Counter-clockwise loop with a deterministic starting point. */
  loop: Point2D[];
  /** Boundary entity IDs in the same order as loop edges. */
  entityIds: string[];
  area: number;
}

export interface ProfileAnalysis {
  profiles: AnalyzedProfile[];
  issues: ProfileIssue[];
}

interface Endpoint {
  key: string;
  point: Point2D;
}

interface Node {
  id: string;
  point: Point2D;
  endpointKeys: string[];
}

interface GraphEdge {
  id: string;
  startNodeId: string;
  endNodeId: string;
}

/**
 * Analyze line-like sketch geometry without mutating it.
 *
 * Invalid connected components fail closed: they produce actionable issues but
 * are not returned as profiles. Results are stable under input reordering.
 */
export function analyzeProfiles(
  segments: readonly ProfileSegment[],
  options: ProfileAnalysisOptions = {}
): ProfileAnalysis {
  const pointTolerance = positiveOrDefault(
    options.pointTolerance,
    DEFAULT_TOLERANCE_POLICY.profile
  );
  const intersectionTolerance = positiveOrDefault(
    options.intersectionTolerance,
    pointTolerance
  );
  const minimumArea = positiveOrDefault(
    options.minimumArea,
    DEFAULT_TOLERANCE_POLICY.area
  );

  const sortedSegments = [...segments].sort((a, b) => a.id.localeCompare(b.id));
  const { nodes, endpointToNode } = clusterEndpoints(sortedSegments, pointTolerance);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const issues: ProfileIssue[] = [];
  const candidateEdges: GraphEdge[] = [];
  const invalidEntityIds = new Set<string>();

  for (const segment of sortedSegments) {
    const startNodeId = endpointToNode.get(endpointKey(segment.id, 'start'));
    const endNodeId = endpointToNode.get(endpointKey(segment.id, 'end'));
    if (!startNodeId || !endNodeId) {
      continue;
    }

    if (startNodeId === endNodeId) {
      invalidEntityIds.add(segment.id);
      issues.push({
        code: 'DEGENERATE_EDGE',
        message: 'This edge has no usable length; delete it or move one endpoint.',
        entityIds: [segment.id],
        point: copyPointRequired(nodeById.get(startNodeId)!.point),
      });
      continue;
    }

    candidateEdges.push({ id: segment.id, startNodeId, endNodeId });
  }

  const uniqueEdges: GraphEdge[] = [];
  const edgesByNodePair = new Map<string, GraphEdge[]>();
  for (const edge of candidateEdges) {
    const pairKey = canonicalPair(edge.startNodeId, edge.endNodeId);
    const pair = edgesByNodePair.get(pairKey) ?? [];
    pair.push(edge);
    edgesByNodePair.set(pairKey, pair);
  }

  for (const pair of [...edgesByNodePair.values()].sort(compareEdgeGroups)) {
    pair.sort((a, b) => a.id.localeCompare(b.id));
    const first = pair[0];
    if (!first) {
      continue;
    }
    uniqueEdges.push(first);

    if (pair.length > 1) {
      const entityIds = pair.map((edge) => edge.id);
      for (const entityId of entityIds) {
        invalidEntityIds.add(entityId);
      }
      issues.push({
        code: 'DUPLICATE_EDGE',
        message: 'Multiple edges overlap exactly; remove the duplicate edge before creating a profile.',
        entityIds,
      });
    }
  }

  const incident = buildIncidentMap(uniqueEdges);
  const components = collectComponents(uniqueEdges, incident);
  const profiles: AnalyzedProfile[] = [];

  for (const component of components) {
    const componentEntityIds = component.map((edge) => edge.id).sort();
    const componentNodeIds = [...new Set(
      component.flatMap((edge) => [edge.startNodeId, edge.endNodeId])
    )].sort((a, b) => compareNodes(nodeById.get(a), nodeById.get(b)));
    let componentIsValid = !componentEntityIds.some((id) => invalidEntityIds.has(id));

    for (const nodeId of componentNodeIds) {
      const componentEdges = (incident.get(nodeId) ?? []).filter((edge) =>
        componentEntityIds.includes(edge.id)
      );
      const node = nodeById.get(nodeId);
      if (componentEdges.length === 1) {
        componentIsValid = false;
        issues.push({
          code: 'OPEN_ENDPOINT',
          message: 'This endpoint is open; connect it to another endpoint or trim the open chain.',
          entityIds: componentEdges.map((edge) => edge.id).sort(),
          point: copyPointRequired(node!.point),
        });
      } else if (componentEdges.length > 2) {
        componentIsValid = false;
        issues.push({
          code: 'BRANCHING_VERTEX',
          message: 'More than two edges meet here; trim the branch or split it into separate profiles.',
          entityIds: componentEdges.map((edge) => edge.id).sort(),
          point: copyPointRequired(node!.point),
        });
      }
    }

    if (!componentIsValid || component.length < 3) {
      continue;
    }

    const ordered = orderClosedComponent(component, incident, nodeById);
    if (!ordered) {
      continue;
    }

    const intersections = findSelfIntersections(
      ordered.loop,
      ordered.entityIds,
      intersectionTolerance
    );
    if (intersections.length > 0) {
      for (const intersection of intersections) {
        issues.push({
          code: intersection.kind === 'overlap' ? 'OVERLAPPING_EDGE' : 'SELF_INTERSECTION',
          message: intersection.kind === 'overlap'
            ? 'Profile edges overlap or backtrack; trim the highlighted edges so each boundary section is used once.'
            : 'Profile edges cross; trim or move the highlighted edges so the boundary does not intersect itself.',
          entityIds: intersection.entityIds,
          point: intersection.point,
        });
      }
    }

    const signedArea = calculateSignedArea(ordered.loop);
    if (Math.abs(signedArea) <= minimumArea) {
      issues.push({
        code: 'ZERO_AREA',
        message: 'This closed boundary has no usable area; move its points apart before creating a feature.',
        entityIds: [...ordered.entityIds].sort(),
      });
    }
    if (intersections.length > 0 || Math.abs(signedArea) <= minimumArea) {
      continue;
    }

    const normalized = signedArea < 0
      ? reverseKeepingStart(ordered.loop, ordered.entityIds)
      : ordered;
    profiles.push({
      id: `profile:${[...normalized.entityIds].sort().join('|')}`,
      loop: normalized.loop.map(copyPointRequired),
      entityIds: [...normalized.entityIds],
      area: Math.abs(signedArea),
    });
  }

  profiles.sort((a, b) => a.id.localeCompare(b.id));
  issues.sort(compareIssues);
  return { profiles, issues };
}

/** Adapt persisted sketch entities to the diagnostic segment model. */
export function analyzeSketchProfiles(
  sketch: Sketch,
  options: ProfileAnalysisOptions = {}
): ProfileAnalysis {
  const segments: ProfileSegment[] = [];
  for (const entity of [...sketch.entities].sort((a, b) => a.id.localeCompare(b.id))) {
    if (entity.type === 'line') {
      segments.push({ id: entity.id, start: entity.start, end: entity.end });
      continue;
    }

    const corners = getRectangleCorners(entity);
    for (let index = 0; index < corners.length; index++) {
      segments.push({
        id: `${entity.id}:edge:${index}`,
        start: corners[index]!,
        end: corners[(index + 1) % corners.length]!,
      });
    }
  }
  return analyzeProfiles(segments, options);
}

function clusterEndpoints(
  segments: readonly ProfileSegment[],
  tolerance: number
): { nodes: Node[]; endpointToNode: Map<string, string> } {
  const endpoints: Endpoint[] = segments.flatMap((segment) => [
    { key: endpointKey(segment.id, 'start'), point: segment.start },
    { key: endpointKey(segment.id, 'end'), point: segment.end },
  ]).sort((a, b) => comparePoints(a.point, b.point) || a.key.localeCompare(b.key));
  const parents = endpoints.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) {
      root = parents[root]!;
    }
    while (parents[index] !== index) {
      const next = parents[index]!;
      parents[index] = root;
      index = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parents[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
    }
  };

  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const a = endpoints[i]!;
      const b = endpoints[j]!;
      if (b.point[0] - a.point[0] > tolerance) {
        break;
      }
      if (distance(a.point, b.point) <= tolerance) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, Endpoint[]>();
  endpoints.forEach((endpoint, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(endpoint);
    groups.set(root, group);
  });

  const nodes = [...groups.values()].map((group): Node => {
    group.sort((a, b) => comparePoints(a.point, b.point) || a.key.localeCompare(b.key));
    const point = group[0]!.point;
    const endpointKeys = group.map((endpoint) => endpoint.key).sort();
    return {
      id: `node:${endpointKeys[0]}`,
      point: copyPointRequired(point),
      endpointKeys,
    };
  }).sort(compareNodes);

  const endpointToNode = new Map<string, string>();
  for (const node of nodes) {
    for (const key of node.endpointKeys) {
      endpointToNode.set(key, node.id);
    }
  }

  return { nodes, endpointToNode };
}

function buildIncidentMap(edges: readonly GraphEdge[]): Map<string, GraphEdge[]> {
  const incident = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    for (const nodeId of [edge.startNodeId, edge.endNodeId]) {
      const nodeEdges = incident.get(nodeId) ?? [];
      nodeEdges.push(edge);
      nodeEdges.sort((a, b) => a.id.localeCompare(b.id));
      incident.set(nodeId, nodeEdges);
    }
  }
  return incident;
}

function collectComponents(
  edges: readonly GraphEdge[],
  incident: Map<string, GraphEdge[]>
): GraphEdge[][] {
  const remaining = new Map(edges.map((edge) => [edge.id, edge]));
  const components: GraphEdge[][] = [];

  while (remaining.size > 0) {
    const seed = [...remaining.values()].sort((a, b) => a.id.localeCompare(b.id))[0]!;
    const stack = [seed];
    const component: GraphEdge[] = [];
    while (stack.length > 0) {
      const edge = stack.pop();
      if (!edge || !remaining.delete(edge.id)) {
        continue;
      }
      component.push(edge);
      for (const nodeId of [edge.startNodeId, edge.endNodeId]) {
        for (const neighbor of incident.get(nodeId) ?? []) {
          if (remaining.has(neighbor.id)) {
            stack.push(neighbor);
          }
        }
      }
    }
    component.sort((a, b) => a.id.localeCompare(b.id));
    components.push(component);
  }

  return components.sort((a, b) => a[0]!.id.localeCompare(b[0]!.id));
}

function orderClosedComponent(
  component: readonly GraphEdge[],
  incident: Map<string, GraphEdge[]>,
  nodeById: Map<string, Node>
): { loop: Point2D[]; entityIds: string[] } | null {
  const componentIds = new Set(component.map((edge) => edge.id));
  const startNodeId = [...new Set(component.flatMap((edge) => [edge.startNodeId, edge.endNodeId]))]
    .sort((a, b) => compareNodes(nodeById.get(a), nodeById.get(b)))[0];
  if (!startNodeId) {
    return null;
  }

  const startEdges = (incident.get(startNodeId) ?? [])
    .filter((edge) => componentIds.has(edge.id))
    .sort((a, b) => {
      const aOther = otherNode(a, startNodeId);
      const bOther = otherNode(b, startNodeId);
      return compareNodes(nodeById.get(aOther), nodeById.get(bOther)) || a.id.localeCompare(b.id);
    });
  let currentEdge = startEdges[0];
  if (!currentEdge) {
    return null;
  }

  const loopNodeIds = [startNodeId];
  const entityIds: string[] = [];
  const used = new Set<string>();
  let currentNodeId = startNodeId;

  while (used.size < component.length) {
    used.add(currentEdge.id);
    entityIds.push(currentEdge.id);
    currentNodeId = otherNode(currentEdge, currentNodeId);
    if (currentNodeId !== startNodeId) {
      loopNodeIds.push(currentNodeId);
    }
    const next = (incident.get(currentNodeId) ?? [])
      .filter((edge) => componentIds.has(edge.id) && !used.has(edge.id))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!next) {
      break;
    }
    currentEdge = next;
  }

  if (currentNodeId !== startNodeId || used.size !== component.length) {
    return null;
  }

  const loop = loopNodeIds.map((nodeId) => copyPointRequired(nodeById.get(nodeId)!.point));
  return { loop, entityIds };
}

function findSelfIntersections(
  loop: readonly Point2D[],
  entityIds: readonly string[],
  tolerance: number
): Array<{ kind: SegmentContactKind; entityIds: string[]; point: Point2D }> {
  const intersections: Array<{
    kind: SegmentContactKind;
    entityIds: string[];
    point: Point2D;
  }> = [];
  for (let i = 0; i < loop.length; i++) {
    for (let j = i + 1; j < loop.length; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === loop.length - 1);
      const contact = segmentContact(
        loop[i]!,
        loop[(i + 1) % loop.length]!,
        loop[j]!,
        loop[(j + 1) % loop.length]!,
        tolerance
      );
      // Neighboring edges must share one endpoint, but they must never retrace
      // a positive-length portion of one another.
      if (contact && (!adjacent || contact.kind === 'overlap')) {
        intersections.push({
          kind: contact.kind,
          entityIds: [entityIds[i]!, entityIds[j]!].sort(),
          point: contact.point,
        });
      }
    }
  }
  return intersections.sort((a, b) =>
    a.entityIds.join('|').localeCompare(b.entityIds.join('|')) || comparePoints(a.point, b.point)
  );
}

type SegmentContactKind = 'crossing' | 'overlap';

function segmentContact(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
  tolerance: number
): { kind: SegmentContactKind; point: Point2D } | null {
  const r: Point2D = [b[0] - a[0], b[1] - a[1]];
  const s: Point2D = [d[0] - c[0], d[1] - c[1]];
  const denominator = cross(r, s);
  const rLength = Math.hypot(r[0], r[1]);
  const sLength = Math.hypot(s[0], s[1]);
  if (rLength <= tolerance || sLength <= tolerance) return null;

  if (Math.abs(denominator) <= tolerance * rLength * sLength) {
    const cMinusA: Point2D = [c[0] - a[0], c[1] - a[1]];
    if (Math.abs(cross(cMinusA, r)) / rLength > tolerance) return null;

    const rLengthSquared = dot(r, r);
    const cParameter = dot(cMinusA, r) / rLengthSquared;
    const dMinusA: Point2D = [d[0] - a[0], d[1] - a[1]];
    const dParameter = dot(dMinusA, r) / rLengthSquared;
    const overlapStart = Math.max(0, Math.min(cParameter, dParameter));
    const overlapEnd = Math.min(1, Math.max(cParameter, dParameter));
    if ((overlapEnd - overlapStart) * rLength <= tolerance) return null;

    const midpoint = (overlapStart + overlapEnd) / 2;
    return {
      kind: 'overlap',
      point: [a[0] + midpoint * r[0], a[1] + midpoint * r[1]],
    };
  }
  const cMinusA: Point2D = [c[0] - a[0], c[1] - a[1]];
  const t = cross(cMinusA, s) / denominator;
  const u = cross(cMinusA, r) / denominator;
  if (t <= tolerance || t >= 1 - tolerance || u <= tolerance || u >= 1 - tolerance) {
    return null;
  }
  return { kind: 'crossing', point: [a[0] + t * r[0], a[1] + t * r[1]] };
}

function reverseKeepingStart(
  loop: readonly Point2D[],
  entityIds: readonly string[]
): { loop: Point2D[]; entityIds: string[] } {
  const first = loop[0];
  const lastEntity = entityIds[entityIds.length - 1];
  if (!first || !lastEntity) {
    return { loop: [...loop], entityIds: [...entityIds] };
  }
  return {
    loop: [copyPointRequired(first), ...loop.slice(1).reverse().map(copyPointRequired)],
    entityIds: [lastEntity, ...entityIds.slice(0, -1).reverse()],
  };
}

function calculateSignedArea(loop: readonly Point2D[]): number {
  let twiceArea = 0;
  for (let i = 0; i < loop.length; i++) {
    const current = loop[i]!;
    const next = loop[(i + 1) % loop.length]!;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
}

function endpointKey(entityId: string, endpoint: 'start' | 'end'): string {
  return `${entityId}:${endpoint}`;
}

function canonicalPair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function otherNode(edge: GraphEdge, nodeId: string): string {
  return edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId;
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function comparePoints(a: Point2D, b: Point2D): number {
  return a[0] - b[0] || a[1] - b[1];
}

function compareNodes(a: Node | undefined, b: Node | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return comparePoints(a.point, b.point) || a.id.localeCompare(b.id);
}

function compareEdgeGroups(a: GraphEdge[], b: GraphEdge[]): number {
  const firstA = [...a].sort((left, right) => left.id.localeCompare(right.id))[0];
  const firstB = [...b].sort((left, right) => left.id.localeCompare(right.id))[0];
  return (firstA?.id ?? '').localeCompare(firstB?.id ?? '');
}

function compareIssues(a: ProfileIssue, b: ProfileIssue): number {
  return a.code.localeCompare(b.code)
    || a.entityIds.join('|').localeCompare(b.entityIds.join('|'))
    || comparePoints(a.point ?? [0, 0], b.point ?? [0, 0]);
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function cross(a: Point2D, b: Point2D): number {
  return a[0] * b[1] - a[1] * b[0];
}

function dot(a: Point2D, b: Point2D): number {
  return a[0] * b[0] + a[1] * b[1];
}

function copyPointRequired(point: Point2D): Point2D {
  return [point[0], point[1]];
}
