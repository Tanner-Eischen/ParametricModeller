/**
 * PlanarityGuard - Validation for vertex movements (Milestone 07).
 * Ensures vertex movements preserve planarity of adjacent faces.
 */

import { PLANARITY_TOLERANCE, computePlaneEquation } from './SubObjectTypes';
import type { Body } from './Body';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('PlanarityGuard');

/**
 * Check if a polygon is planar within tolerance.
 * @param points Array of 3D points forming the polygon
 * @param tolerance Maximum allowed deviation from the plane
 * @returns true if all points lie on the same plane within tolerance
 */
export function isPolygonPlanar(
  points: [number, number, number][],
  tolerance: number = PLANARITY_TOLERANCE
): boolean {
  if (points.length < 3) return true;
  if (points.length === 3) return true; // Triangle is always planar

  // Compute plane from first 3 points
  const { normal, d } = computePlaneEquation(points[0]!, points[1]!, points[2]!);

  // Check if all other points lie on this plane
  for (let i = 3; i < points.length; i++) {
    const point = points[i]!;
    const distance = Math.abs(
      normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + d
    );
    if (distance >= tolerance) {
      log.debug('Planarity check failed', {
        pointIndex: i,
        point,
        distance,
        tolerance,
      });
      return false;
    }
  }

  return true;
}

/**
 * Get the distance of a point from a plane.
 */
export function distanceFromPlane(
  point: [number, number, number],
  normal: [number, number, number],
  d: number
): number {
  return Math.abs(normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + d);
}

/**
 * Re-export tolerance constant for convenience.
 */
export { PLANARITY_TOLERANCE } from './SubObjectTypes';
