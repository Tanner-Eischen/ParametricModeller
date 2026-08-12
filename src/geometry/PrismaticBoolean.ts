import type { Body } from './Body';
import { addEdge, addFace, addPlane, addVertex, createBody } from './Body';
import { createEdge } from './Edge';
import { createFace } from './Face';
import { createPlane, type Plane } from './Plane';
import { createVertex } from './Vertex';
import { createTopologyIdAllocator, type TopologyIdAllocator } from './TopologyIdAllocator';
import { DEFAULT_TOLERANCE_POLICY, type TolerancePolicy } from './TolerancePolicy';
import {
  isPointStrictlyInsideRegion,
  loopsContact,
  normalizePlanarRegion,
  signedPlanarArea,
  type PlanarLoop,
  type PlanarPoint,
  type PlanarRegion,
} from './PlanarRegion';
import { getOrderedLoopVertices } from './Triangulator';
import { validateClosedManifoldBody } from './Validation';

export interface PrismaticFrame {
  origin: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
  normal: [number, number, number];
}

export interface PrismaticBodyDefinition {
  id: string;
  name?: string;
  operationId: string;
  frame: PrismaticFrame;
  region: PlanarRegion;
  minDepth: number;
  maxDepth: number;
}

export type PrismaticBooleanDiagnosticCode =
  | 'INVALID_INPUT'
  | 'NON_MANIFOLD_INPUT'
  | 'UNSUPPORTED_ORIENTATION'
  | 'UNSUPPORTED_TOPOLOGY'
  | 'PROFILE_OUTSIDE_TARGET'
  | 'AMBIGUOUS_CONTACT'
  | 'DEGENERATE_RESULT'
  | 'DISCONNECTED_RESULT';

export interface PrismaticBooleanDiagnostic {
  code: PrismaticBooleanDiagnosticCode;
  message: string;
  entityIds: string[];
}

export type PrismaticBooleanResult =
  | { ok: true; body: Body }
  | { ok: false; diagnostics: PrismaticBooleanDiagnostic[] };

export interface PrismaticDifferenceRequest {
  target: Body;
  frame: PrismaticFrame;
  profile: Readonly<{ outer: readonly PlanarPoint[]; holes?: readonly (readonly PlanarPoint[])[] }>;
  operationId: string;
  depth?: number;
  throughAll?: boolean;
  from?: 'min' | 'max';
  tolerance?: Pick<TolerancePolicy, 'linear' | 'area' | 'angular'>;
}

export interface PrismaticUnionRequest {
  left: Body;
  right: Body;
  frame: PrismaticFrame;
  operationId: string;
  tolerance?: Pick<TolerancePolicy, 'linear' | 'area' | 'angular'>;
}

interface ExtractedPrism {
  region: PlanarRegion;
  minDepth: number;
  maxDepth: number;
}

interface RingTopology {
  lowerVertices: string[];
  upperVertices: string[];
  lowerEdges: string[];
  upperEdges: string[];
  verticalEdges: string[];
}

/** Build a deterministic closed prism from one outer loop and optional holes. */
export function createPrismaticBody(definition: PrismaticBodyDefinition): PrismaticBooleanResult {
  const normalized = normalizePlanarRegion(definition.region);
  if (!normalized.ok || !validFrame(definition.frame)
    || !Number.isFinite(definition.minDepth) || !Number.isFinite(definition.maxDepth)
    || definition.maxDepth - definition.minDepth <= DEFAULT_TOLERANCE_POLICY.linear) {
    return failure('INVALID_INPUT', 'A prism requires a valid frame, region, and positive depth.', [definition.id]);
  }
  const body = buildThroughPrism(
    normalized.region,
    definition.frame,
    definition.minDepth,
    definition.maxDepth,
    definition.id,
    definition.name ?? 'Prismatic body',
    definition.operationId
  );
  return validateResultBody(body);
}

/**
 * Restricted deterministic difference: target must be a pure same-frame prism;
 * cutter must be a single simple loop strictly inside its outer boundary.
 */
export function differencePrismatic(request: PrismaticDifferenceRequest): PrismaticBooleanResult {
  const tolerance = request.tolerance ?? DEFAULT_TOLERANCE_POLICY;
  const target = extractPrism(request.target, request.frame, tolerance);
  if (!target.ok) return target;
  if (target.prism.region.holes.length > 0) {
    return failure('UNSUPPORTED_TOPOLOGY', 'Cutting an already-holed or layered prism is not supported.', [request.target.id]);
  }
  const cutterResult = normalizePlanarRegion(request.profile, tolerance);
  if (!cutterResult.ok || cutterResult.region.holes.length > 0) {
    return failure('INVALID_INPUT', 'The cutter must be one valid simple planar loop.', [request.target.id]);
  }
  const cutter = cutterResult.region.outer;
  const cavityLoop = [...cutter].reverse();
  const contact = loopsContact(target.prism.region.outer, cutter, tolerance.linear);
  if (contact) {
    return failure('AMBIGUOUS_CONTACT', 'Tangential or boundary-touching cuts are rejected.', [request.target.id]);
  }
  if (cutter.some((point) => !isPointStrictlyInsideRegion(point, target.prism.region, tolerance.linear))) {
    return failure('PROFILE_OUTSIDE_TARGET', 'The cutter must lie strictly inside the target boundary.', [request.target.id]);
  }

  const span = target.prism.maxDepth - target.prism.minDepth;
  const through = request.throughAll === true;
  const depth = through ? span : request.depth;
  if (!depth || !Number.isFinite(depth) || depth <= tolerance.linear) {
    return failure('INVALID_INPUT', 'Pocket depth must be finite and positive.', [request.target.id]);
  }
  if (!through && depth >= span - tolerance.linear) {
    return failure('DEGENERATE_RESULT', 'Use through-all when the cut reaches the opposite cap.', [request.target.id]);
  }

  const body = through
    ? buildThroughPrism(
      { outer: target.prism.region.outer, holes: [cavityLoop] },
      request.frame,
      target.prism.minDepth,
      target.prism.maxDepth,
      `${request.target.id}:difference`,
      `${request.target.name} cut`,
      request.operationId
    )
    : buildPocketPrism(
      target.prism.region.outer,
      cavityLoop,
      request.frame,
      target.prism.minDepth,
      target.prism.maxDepth,
      depth,
      request.from ?? 'max',
      `${request.target.id}:difference`,
      `${request.target.name} pocket`,
      request.operationId
    );
  return validateResultBody(body);
}

/** Restricted union for same-depth axis-aligned rectangular prisms whose union is one rectangle. */
export function unionPrismatic(request: PrismaticUnionRequest): PrismaticBooleanResult {
  const tolerance = request.tolerance ?? DEFAULT_TOLERANCE_POLICY;
  const left = extractPrism(request.left, request.frame, tolerance);
  if (!left.ok) return left;
  const right = extractPrism(request.right, request.frame, tolerance);
  if (!right.ok) return right;
  if (!approximately(left.prism.minDepth, right.prism.minDepth, tolerance.linear)
    || !approximately(left.prism.maxDepth, right.prism.maxDepth, tolerance.linear)) {
    return failure('UNSUPPORTED_TOPOLOGY', 'Union operands must have identical extrusion depths.', [request.left.id, request.right.id]);
  }
  const leftBounds = rectangleBounds(left.prism.region, tolerance.linear);
  const rightBounds = rectangleBounds(right.prism.region, tolerance.linear);
  if (!leftBounds || !rightBounds) {
    return failure('UNSUPPORTED_TOPOLOGY', 'Restricted union supports rectangular prisms only.', [request.left.id, request.right.id]);
  }
  const bounds = {
    minX: Math.min(leftBounds.minX, rightBounds.minX),
    minY: Math.min(leftBounds.minY, rightBounds.minY),
    maxX: Math.max(leftBounds.maxX, rightBounds.maxX),
    maxY: Math.max(leftBounds.maxY, rightBounds.maxY),
  };
  const intersectionArea = Math.max(0, Math.min(leftBounds.maxX, rightBounds.maxX)
    - Math.max(leftBounds.minX, rightBounds.minX))
    * Math.max(0, Math.min(leftBounds.maxY, rightBounds.maxY)
    - Math.max(leftBounds.minY, rightBounds.minY));
  const unionArea = rectangleArea(leftBounds) + rectangleArea(rightBounds) - intersectionArea;
  if (!approximately(unionArea, rectangleArea(bounds), tolerance.area)) {
    return failure('DISCONNECTED_RESULT', 'The rectangular union would be disconnected or L-shaped.', [request.left.id, request.right.id]);
  }
  return createPrismaticBody({
    id: `${request.left.id}:union:${request.right.id}`,
    name: `${request.left.name} + ${request.right.name}`,
    operationId: request.operationId,
    frame: request.frame,
    region: { outer: rectangleLoop(bounds), holes: [] },
    minDepth: left.prism.minDepth,
    maxDepth: left.prism.maxDepth,
  });
}

function extractPrism(
  body: Body,
  frame: PrismaticFrame,
  tolerance: Pick<TolerancePolicy, 'linear' | 'area' | 'angular'>
): { ok: true; prism: ExtractedPrism } | { ok: false; diagnostics: PrismaticBooleanDiagnostic[] } {
  if (!validFrame(frame)) return failure('UNSUPPORTED_ORIENTATION', 'The requested extrusion frame is invalid.', [body.id]);
  const shell = validateClosedManifoldBody(body);
  if (!shell.ok) return failure('NON_MANIFOLD_INPUT', shell.errors[0]?.message ?? 'Input shell is invalid.', [body.id]);
  const depths = [...body.vertices.values()].map((vertex) => projectDepth(frame, vertex.position));
  const minDepth = Math.min(...depths);
  const maxDepth = Math.max(...depths);
  if (!Number.isFinite(minDepth) || maxDepth - minDepth <= tolerance.linear) {
    return failure('DEGENERATE_RESULT', 'Input prism has no usable extrusion depth.', [body.id]);
  }
  if (depths.some((depth) => !approximately(depth, minDepth, tolerance.linear)
    && !approximately(depth, maxDepth, tolerance.linear))) {
    return failure('UNSUPPORTED_TOPOLOGY', 'Layered or tapered source bodies are outside the restricted kernel.', [body.id]);
  }
  for (const face of body.faces.values()) {
    const plane = body.planes.get(face.planeId)!;
    const alignment = Math.abs(dot3(plane.normal, frame.normal));
    if (alignment > tolerance.angular && Math.abs(alignment - 1) > tolerance.angular) {
      return failure('UNSUPPORTED_ORIENTATION', 'Every source face must be a cap or extrusion wall.', [body.id, face.id]);
    }
  }
  const cap = [...body.faces.values()].find((face) => {
    const plane = body.planes.get(face.planeId);
    if (!plane || dot3(plane.normal, frame.normal) < 1 - tolerance.angular) return false;
    const vertices = getOrderedLoopVertices(body, face.boundaryEdgeIds);
    return vertices.length >= 3
      && vertices.every((vertex) => approximately(projectDepth(frame, vertex.position), maxDepth, tolerance.linear));
  });
  if (!cap) return failure('UNSUPPORTED_ORIENTATION', 'A matching positive extrusion cap was not found.', [body.id]);
  const outer = getOrderedLoopVertices(body, cap.boundaryEdgeIds)
    .map((vertex) => projectPoint2(frame, vertex.position));
  const holes = (cap.innerBoundaryEdgeIds ?? []).map((loop) =>
    getOrderedLoopVertices(body, loop).map((vertex) => projectPoint2(frame, vertex.position))
  );
  const region = normalizePlanarRegion({ outer, holes }, tolerance);
  if (!region.ok) return failure('INVALID_INPUT', 'The source cap contains invalid boundary loops.', [body.id, cap.id]);
  return { ok: true, prism: { region: region.region, minDepth, maxDepth } };
}

function buildThroughPrism(
  region: PlanarRegion,
  frame: PrismaticFrame,
  minDepth: number,
  maxDepth: number,
  id: string,
  name: string,
  operationId: string
): Body {
  const body = createBody(id, name);
  const allocator = createTopologyIdAllocator(`boolean:${operationId}`);
  const rings = [region.outer, ...region.holes];
  const topology = rings.map((loop, index) =>
    addRing(body, allocator, loop, minDepth, maxDepth, frame, `ring:${index}`)
  );
  const lowerPlaneId = addCapPlane(body, allocator, frame, minDepth, -1, 'cap:min');
  const upperPlaneId = addCapPlane(body, allocator, frame, maxDepth, 1, 'cap:max');
  addFace(body, {
    ...createFace(lowerPlaneId, topology[0]!.lowerEdges, allocator.face('cap:min'), 'Bottom'),
    innerBoundaryEdgeIds: topology.slice(1).map((ring) => ring.lowerEdges),
  });
  addFace(body, {
    ...createFace(upperPlaneId, topology[0]!.upperEdges, allocator.face('cap:max'), 'Top'),
    innerBoundaryEdgeIds: topology.slice(1).map((ring) => ring.upperEdges),
  });
  topology.forEach((ring, ringIndex) =>
    addRingSideFaces(body, allocator, rings[ringIndex]!, ring, frame, `ring:${ringIndex}`)
  );
  return body;
}

function buildPocketPrism(
  outer: PlanarLoop,
  cutter: PlanarLoop,
  frame: PrismaticFrame,
  minDepth: number,
  maxDepth: number,
  depth: number,
  from: 'min' | 'max',
  id: string,
  name: string,
  operationId: string
): Body {
  const body = createBody(id, name);
  const allocator = createTopologyIdAllocator(`boolean:${operationId}`);
  const outerRing = addRing(body, allocator, outer, minDepth, maxDepth, frame, 'outer');
  const floorDepth = from === 'max' ? maxDepth - depth : minDepth + depth;
  const cavityMin = from === 'max' ? floorDepth : minDepth;
  const cavityMax = from === 'max' ? maxDepth : floorDepth;
  const cavityRing = addRing(body, allocator, cutter, cavityMin, cavityMax, frame, 'cavity');
  const lowerPlaneId = addCapPlane(body, allocator, frame, minDepth, -1, 'cap:min');
  const upperPlaneId = addCapPlane(body, allocator, frame, maxDepth, 1, 'cap:max');
  addFace(body, {
    ...createFace(lowerPlaneId, outerRing.lowerEdges, allocator.face('cap:min'), 'Bottom'),
    ...(from === 'min' ? { innerBoundaryEdgeIds: [cavityRing.lowerEdges] } : {}),
  });
  addFace(body, {
    ...createFace(upperPlaneId, outerRing.upperEdges, allocator.face('cap:max'), 'Top'),
    ...(from === 'max' ? { innerBoundaryEdgeIds: [cavityRing.upperEdges] } : {}),
  });
  addRingSideFaces(body, allocator, outer, outerRing, frame, 'outer');
  addRingSideFaces(body, allocator, cutter, cavityRing, frame, 'cavity');
  const floorNormal = from === 'max' ? 1 : -1;
  const floorPlaneId = addCapPlane(body, allocator, frame, floorDepth, floorNormal, 'pocket:floor');
  const floorEdges = from === 'max' ? cavityRing.lowerEdges : cavityRing.upperEdges;
  addFace(body, createFace(floorPlaneId, floorEdges, allocator.face('pocket:floor'), 'Pocket Floor'));
  return body;
}

function addRing(
  body: Body,
  allocator: TopologyIdAllocator,
  loop: PlanarLoop,
  minDepth: number,
  maxDepth: number,
  frame: PrismaticFrame,
  key: string
): RingTopology {
  const lowerVertices = loop.map((point, index) => {
    const id = allocator.vertex(`${key}:min:${index}`);
    addVertex(body, createVertex(toWorld(frame, point, minDepth), id));
    return id;
  });
  const upperVertices = loop.map((point, index) => {
    const id = allocator.vertex(`${key}:max:${index}`);
    addVertex(body, createVertex(toWorld(frame, point, maxDepth), id));
    return id;
  });
  const lowerEdges = loop.map((_, index) => addBodyEdge(
    body, allocator, `${key}:min:${index}`, lowerVertices[index]!, lowerVertices[(index + 1) % loop.length]!
  ));
  const upperEdges = loop.map((_, index) => addBodyEdge(
    body, allocator, `${key}:max:${index}`, upperVertices[index]!, upperVertices[(index + 1) % loop.length]!
  ));
  const verticalEdges = loop.map((_, index) => addBodyEdge(
    body, allocator, `${key}:vertical:${index}`, lowerVertices[index]!, upperVertices[index]!
  ));
  return { lowerVertices, upperVertices, lowerEdges, upperEdges, verticalEdges };
}

function addRingSideFaces(
  body: Body,
  allocator: TopologyIdAllocator,
  loop: PlanarLoop,
  ring: RingTopology,
  frame: PrismaticFrame,
  key: string
): void {
  loop.forEach((point, index) => {
    const nextIndex = (index + 1) % loop.length;
    const next = loop[nextIndex]!;
    const edge: PlanarPoint = [next[0] - point[0], next[1] - point[1]];
    const normal = normalize3(add3(scale3(frame.uAxis, edge[1]), scale3(frame.vAxis, -edge[0])));
    const planeId = allocator.plane(`${key}:side:${index}`);
    addPlane(body, createPlane(toWorld(frame, point, 0), normal), planeId);
    addFace(body, createFace(planeId, [
      ring.lowerEdges[index]!,
      ring.verticalEdges[nextIndex]!,
      ring.upperEdges[index]!,
      ring.verticalEdges[index]!,
    ], allocator.face(`${key}:side:${index}`), `${key} side ${index}`));
  });
}

function addCapPlane(
  body: Body,
  allocator: TopologyIdAllocator,
  frame: PrismaticFrame,
  depth: number,
  normalSign: 1 | -1,
  key: string
): string {
  const planeId = allocator.plane(key);
  const plane: Plane = {
    origin: toWorld(frame, [0, 0], depth),
    normal: scale3(frame.normal, normalSign),
    uAxis: [...frame.uAxis],
    vAxis: [...frame.vAxis],
  };
  addPlane(body, plane, planeId);
  return planeId;
}

function addBodyEdge(
  body: Body, allocator: TopologyIdAllocator, key: string, start: string, end: string
): string {
  const edge = createEdge(start, end, allocator.edge(key));
  addEdge(body, edge);
  return edge.id;
}

function validateResultBody(body: Body): PrismaticBooleanResult {
  const validation = validateClosedManifoldBody(body);
  return validation.ok
    ? { ok: true, body }
    : failure('NON_MANIFOLD_INPUT', validation.errors[0]?.message ?? 'Generated shell is invalid.', [body.id]);
}

function rectangleBounds(region: PlanarRegion, tolerance: number): RectBounds | null {
  if (region.holes.length > 0 || region.outer.length !== 4) return null;
  const xs = region.outer.map((point) => point[0]);
  const ys = region.outer.map((point) => point[1]);
  const bounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  const corners = rectangleLoop(bounds);
  return region.outer.every((point) => corners.some((corner) =>
    approximately(point[0], corner[0], tolerance) && approximately(point[1], corner[1], tolerance)
  )) ? bounds : null;
}

interface RectBounds { minX: number; minY: number; maxX: number; maxY: number }
function rectangleLoop(bounds: RectBounds): PlanarLoop {
  return [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY],
  ];
}
function rectangleArea(bounds: RectBounds): number {
  return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
}

function validFrame(frame: PrismaticFrame): boolean {
  const vectors = [frame.uAxis, frame.vAxis, frame.normal];
  return [...frame.origin, ...vectors.flat()].every(Number.isFinite)
    && vectors.every((vector) => Math.abs(Math.hypot(...vector) - 1) <= DEFAULT_TOLERANCE_POLICY.angular)
    && Math.abs(dot3(frame.uAxis, frame.vAxis)) <= DEFAULT_TOLERANCE_POLICY.angular
    && Math.abs(dot3(frame.uAxis, frame.normal)) <= DEFAULT_TOLERANCE_POLICY.angular
    && Math.abs(dot3(frame.vAxis, frame.normal)) <= DEFAULT_TOLERANCE_POLICY.angular
    && dot3(cross3(frame.uAxis, frame.vAxis), frame.normal) > 1 - DEFAULT_TOLERANCE_POLICY.angular;
}

function projectPoint2(frame: PrismaticFrame, point: [number, number, number]): PlanarPoint {
  const relative = subtract3(point, frame.origin);
  return [dot3(relative, frame.uAxis), dot3(relative, frame.vAxis)];
}
function projectDepth(frame: PrismaticFrame, point: [number, number, number]): number {
  return dot3(subtract3(point, frame.origin), frame.normal);
}
function toWorld(frame: PrismaticFrame, point: PlanarPoint, depth: number): [number, number, number] {
  return add3(frame.origin, add3(
    add3(scale3(frame.uAxis, point[0]), scale3(frame.vAxis, point[1])),
    scale3(frame.normal, depth)
  ));
}

function failure(
  code: PrismaticBooleanDiagnosticCode, message: string, entityIds: string[]
): { ok: false; diagnostics: PrismaticBooleanDiagnostic[] } {
  return { ok: false, diagnostics: [{ code, message, entityIds: [...entityIds].sort() }] };
}
function approximately(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}
function subtract3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale3(a: [number, number, number], scalar: number): [number, number, number] {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}
function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize3(a: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
}

// Retained as a useful invariant for callers and tests.
export function planarRegionArea(region: PlanarRegion): number {
  return Math.abs(signedPlanarArea(region.outer))
    - region.holes.reduce((sum, hole) => sum + Math.abs(signedPlanarArea(hole)), 0);
}
