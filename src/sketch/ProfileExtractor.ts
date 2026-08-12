import type { Sketch, RectangleEntity, LineEntity, Profile2D, Point2D } from './SketchTypes';
import { getRectangleCorners } from './SketchTypes';
import { createTopologyId } from '../geometry/TopologyIdAllocator';
import { DEFAULT_TOLERANCE_POLICY } from '../geometry/TolerancePolicy';

const POINT_TOLERANCE = DEFAULT_TOLERANCE_POLICY.profile;

interface LineSegment {
  line: LineEntity;
  startKey: string;
  endKey: string;
}

/**
 * Extract all closed profiles from a sketch.
 * For v1 (Milestone 02), we only handle rectangles as simple closed loops.
 */
export function extractProfiles(sketch: Sketch): Profile2D[] {
  const profiles: Profile2D[] = [];

  // Each valid rectangle is its own profile.
  for (const entity of sketch.entities) {
    if (entity.type === 'rectangle') {
      const profile = extractRectangleProfile(entity, sketch.id);
      if (profile) {
        profiles.push(profile);
      }
    }
  }

  profiles.push(...extractLineProfiles(sketch));

  return profiles;
}

/**
 * Extract a profile from a rectangle entity.
 */
function extractRectangleProfile(
  rect: RectangleEntity,
  sketchId: string
): Profile2D | null {
  // Validate rectangle
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  // Get corners (already in CCW order)
  const corners = getRectangleCorners(rect);

  return {
    id: createTopologyId(sketchId, 'profile', rect.id),
    sketchId,
    loop: corners,
    entityIds: [rect.id],
    isValid: true,
  };
}

/**
 * Get profile for a specific entity.
 */
export function getProfileForEntity(
  sketch: Sketch,
  entityId: string
): Profile2D | undefined {
  return extractProfiles(sketch).find((profile) => profile.entityIds.includes(entityId));
}

/**
 * Get profile by index (for extrude feature).
 */
export function getProfileByIndex(sketch: Sketch, index: number): Profile2D | undefined {
  const profiles = extractProfiles(sketch);
  return profiles[index];
}

/**
 * Check if a profile is valid for extrusion.
 */
export function isProfileValidForExtrude(profile: Profile2D): boolean {
  if (!profile.isValid) return false;
  if (profile.loop.length < 3) return false;

  // Check that the loop is closed (first and last points are the same or very close)
  const first = profile.loop[0];
  const last = profile.loop[profile.loop.length - 1];

  if (!first || !last) return false;

  // For rectangles and polygons, we don't duplicate the first point at the end
  // So we need to check that the loop would form a closed shape
  return profile.loop.length >= 3;
}

/**
 * Calculate the area of a profile.
 * Uses the shoelace formula for polygon area.
 */
export function calculateProfileArea(profile: Profile2D): number {
  const { loop } = profile;
  if (loop.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const current = loop[i]!;
    const next = loop[(i + 1) % loop.length]!;
    area += current[0] * next[1];
    area -= next[0] * current[1];
  }

  return Math.abs(area) / 2;
}

/**
 * Get the centroid of a profile.
 */
export function getProfileCentroid(profile: Profile2D): Point2D {
  const { loop } = profile;
  if (loop.length === 0) return [0, 0];
  if (loop.length === 1) return loop[0]!;

  let cx = 0;
  let cy = 0;
  let area = 0;

  for (let i = 0; i < loop.length; i++) {
    const current = loop[i]!;
    const next = loop[(i + 1) % loop.length]!;

    const cross = current[0] * next[1] - next[0] * current[1];
    area += cross;
    cx += (current[0] + next[0]) * cross;
    cy += (current[1] + next[1]) * cross;
  }

  area /= 2;

  if (Math.abs(area) < DEFAULT_TOLERANCE_POLICY.area) {
    // Degenerate case: return average of points
    const sumX = loop.reduce((s, p) => s + p[0], 0);
    const sumY = loop.reduce((s, p) => s + p[1], 0);
    return [sumX / loop.length, sumY / loop.length];
  }

  const factor = 1 / (6 * area);
  return [cx * factor, cy * factor];
}

/**
 * Get the bounding box of a profile.
 */
export function getProfileBounds(profile: Profile2D): {
  min: Point2D;
  max: Point2D;
} {
  const { loop } = profile;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of loop) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }

  return {
    min: [minX, minY],
    max: [maxX, maxY],
  };
}

/**
 * Check if a point is inside a profile.
 * Uses the ray casting algorithm.
 */
export function isPointInProfile(profile: Profile2D, point: Point2D): boolean {
  const { loop } = profile;
  let inside = false;

  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i]![0];
    const yi = loop[i]![1];
    const xj = loop[j]![0];
    const yj = loop[j]![1];

    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function extractLineProfiles(sketch: Sketch): Profile2D[] {
  const lines = sketch.entities.filter((entity): entity is LineEntity => entity.type === 'line');
  if (lines.length < 3) {
    return [];
  }

  const segments = lines
    .map((line): LineSegment | null => {
      const startKey = pointToKey(line.start);
      const endKey = pointToKey(line.end);
      if (startKey === endKey) {
        return null;
      }

      return { line, startKey, endKey };
    })
    .filter((segment): segment is LineSegment => segment !== null);

  if (segments.length < 3) {
    return [];
  }

  const incidentByNode = new Map<string, LineSegment[]>();
  for (const segment of segments) {
    appendIncidentSegment(incidentByNode, segment.startKey, segment);
    appendIncidentSegment(incidentByNode, segment.endKey, segment);
  }

  const remaining = new Map(segments.map((segment) => [segment.line.id, segment]));
  const profiles: Profile2D[] = [];

  while (remaining.size > 0) {
    const seed = remaining.values().next().value as LineSegment | undefined;
    if (!seed) {
      break;
    }

    const component = collectConnectedSegments(seed, remaining, incidentByNode);
    if (component.length < 3) {
      continue;
    }

    const profile = buildClosedLineProfile(component, sketch.id, incidentByNode);
    if (profile) {
      profiles.push(profile);
    }
  }

  return profiles;
}

function appendIncidentSegment(
  incidentByNode: Map<string, LineSegment[]>,
  nodeKey: string,
  segment: LineSegment
): void {
  const existing = incidentByNode.get(nodeKey) ?? [];
  existing.push(segment);
  incidentByNode.set(nodeKey, existing);
}

function collectConnectedSegments(
  seed: LineSegment,
  remaining: Map<string, LineSegment>,
  incidentByNode: Map<string, LineSegment[]>
): LineSegment[] {
  const component: LineSegment[] = [];
  const stack: LineSegment[] = [seed];

  while (stack.length > 0) {
    const segment = stack.pop();
    if (!segment || !remaining.has(segment.line.id)) {
      continue;
    }

    remaining.delete(segment.line.id);
    component.push(segment);

    for (const nodeKey of [segment.startKey, segment.endKey]) {
      const neighbors = incidentByNode.get(nodeKey) ?? [];
      for (const neighbor of neighbors) {
        if (remaining.has(neighbor.line.id)) {
          stack.push(neighbor);
        }
      }
    }
  }

  return component;
}

function buildClosedLineProfile(
  component: LineSegment[],
  sketchId: string,
  incidentByNode: Map<string, LineSegment[]>
): Profile2D | null {
  const componentIds = new Set(component.map((segment) => segment.line.id));
  const nodeKeys = Array.from(
    new Set(component.flatMap((segment) => [segment.startKey, segment.endKey]))
  );

  for (const nodeKey of nodeKeys) {
    const degree = (incidentByNode.get(nodeKey) ?? []).filter((segment) => componentIds.has(segment.line.id)).length;
    if (degree !== 2) {
      return null;
    }
  }

  const startNode = [...nodeKeys].sort()[0];
  if (!startNode) {
    return null;
  }

  const startEdges = (incidentByNode.get(startNode) ?? [])
    .filter((segment) => componentIds.has(segment.line.id))
    .sort((a, b) => a.line.id.localeCompare(b.line.id));
  const firstEdge = startEdges[0];
  if (!firstEdge) {
    return null;
  }

  const loopKeys: string[] = [startNode];
  const entityIds: string[] = [];
  const used = new Set<string>();

  let previousNode = startNode;
  let currentNode = otherEndpoint(firstEdge, startNode);
  let currentEdge: LineSegment | null = firstEdge;

  entityIds.push(firstEdge.line.id);
  used.add(firstEdge.line.id);
  loopKeys.push(currentNode);

  while (currentNode !== startNode) {
    const candidates = (incidentByNode.get(currentNode) ?? [])
      .filter((segment) => componentIds.has(segment.line.id) && !used.has(segment.line.id))
      .sort((a, b) => a.line.id.localeCompare(b.line.id));

    const nextEdge = candidates[0];
    if (!nextEdge) {
      return null;
    }

    const nextNode = otherEndpoint(nextEdge, currentNode);
    if (nextNode === previousNode && candidates.length === 1 && used.size !== component.length - 1) {
      return null;
    }

    previousNode = currentNode;
    currentNode = nextNode;
    currentEdge = nextEdge;
    used.add(nextEdge.line.id);
    entityIds.push(nextEdge.line.id);
    loopKeys.push(currentNode);

    if (used.size > component.length + 1) {
      return null;
    }
  }

  if (used.size !== component.length || loopKeys.length < 4 || currentEdge === null) {
    return null;
  }

  const loop = loopKeys.slice(0, -1).map(keyToPoint);
  if (loop.length < 3) {
    return null;
  }

  if (calculateSignedArea(loop) < 0) {
    loop.reverse();
    entityIds.reverse();
  }

  const canonicalStartIndex = findCanonicalStartIndex(loop);
  if (canonicalStartIndex > 0) {
    rotateInPlace(loop, canonicalStartIndex);
    rotateInPlace(entityIds, canonicalStartIndex);
  }

  return {
    id: createTopologyId(sketchId, 'profile', entityIds.join('|')),
    sketchId,
    loop,
    entityIds,
    isValid: true,
  };
}

function otherEndpoint(segment: LineSegment, nodeKey: string): string {
  return segment.startKey === nodeKey ? segment.endKey : segment.startKey;
}

function pointToKey(point: Point2D): string {
  const x = Math.round(point[0] / POINT_TOLERANCE) * POINT_TOLERANCE;
  const y = Math.round(point[1] / POINT_TOLERANCE) * POINT_TOLERANCE;
  return `${x.toFixed(6)},${y.toFixed(6)}`;
}

function keyToPoint(key: string): Point2D {
  const [x, y] = key.split(',');
  return [Number(x), Number(y)];
}

function calculateSignedArea(loop: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const current = loop[i]!;
    const next = loop[(i + 1) % loop.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }

  return area / 2;
}

function findCanonicalStartIndex(loop: Point2D[]): number {
  let bestIndex = 0;
  for (let i = 1; i < loop.length; i++) {
    const [x, y] = loop[i]!;
    const [bestX, bestY] = loop[bestIndex]!;
    if (x < bestX || (x === bestX && y < bestY)) {
      bestIndex = i;
    }
  }

  return bestIndex;
}

function rotateInPlace<T>(values: T[], startIndex: number): void {
  if (startIndex <= 0 || startIndex >= values.length) {
    return;
  }

  const rotated = [...values.slice(startIndex), ...values.slice(0, startIndex)];
  values.splice(0, values.length, ...rotated);
}
