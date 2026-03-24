import { generateId } from '../core/id';
import type { Sketch, RectangleEntity, Profile2D, Point2D } from './SketchTypes';
import { getRectangleCorners } from './SketchTypes';

/**
 * Extract all closed profiles from a sketch.
 * For v1 (Milestone 02), we only handle rectangles as simple closed loops.
 */
export function extractProfiles(sketch: Sketch): Profile2D[] {
  const profiles: Profile2D[] = [];

  // For v1, each rectangle is its own profile
  for (const entity of sketch.entities) {
    if (entity.type === 'rectangle') {
      const profile = extractRectangleProfile(entity, sketch.id);
      if (profile) {
        profiles.push(profile);
      }
    }
  }

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
    id: generateId(),
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
  const entity = sketch.entities.find((e) => e.id === entityId);
  if (!entity) return undefined;

  if (entity.type === 'rectangle') {
    return extractRectangleProfile(entity, sketch.id) ?? undefined;
  }

  return undefined;
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

  if (Math.abs(area) < 1e-10) {
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
