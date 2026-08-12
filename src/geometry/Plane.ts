import * as THREE from 'three';
import { DEFAULT_TOLERANCE_POLICY } from './TolerancePolicy';

/**
 * Orthonormal basis for a plane in 3D space.
 * Used for defining face orientations.
 */
export interface Plane {
  /** Origin point of the plane */
  origin: [number, number, number];
  /** Normal vector (unit length, points outward for faces) */
  normal: [number, number, number];
  /** First tangent vector (unit length, perpendicular to normal) */
  uAxis: [number, number, number];
  /** Second tangent vector (unit length, perpendicular to normal and uAxis) */
  vAxis: [number, number, number];
}

/**
 * Create a plane from an origin point and normal vector.
 * Automatically computes orthonormal uAxis and vAxis.
 */
export function createPlane(
  origin: [number, number, number],
  normal: [number, number, number]
): Plane {
  const n = new THREE.Vector3(...normal).normalize();

  // Find a vector not parallel to normal for computing uAxis
  let temp = new THREE.Vector3(1, 0, 0);
  if (Math.abs(n.dot(temp)) > 0.9) {
    temp = new THREE.Vector3(0, 1, 0);
  }

  const u = new THREE.Vector3().crossVectors(n, temp).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();

  return {
    origin,
    normal: [n.x, n.y, n.z],
    uAxis: [u.x, u.y, u.z],
    vAxis: [v.x, v.y, v.z],
  };
}

/**
 * Create a plane aligned with the XY plane (Z-up).
 */
export function createXYPlane(z = 0): Plane {
  return {
    origin: [0, 0, z],
    normal: [0, 0, 1],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
  };
}

/**
 * Create a plane aligned with the XZ plane (Y-up).
 */
export function createXZPlane(y = 0): Plane {
  return {
    origin: [0, y, 0],
    normal: [0, 1, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
  };
}

/**
 * Create a plane aligned with the YZ plane (X-up).
 */
export function createYZPlane(x = 0): Plane {
  return {
    origin: [x, 0, 0],
    normal: [1, 0, 0],
    uAxis: [0, 1, 0],
    vAxis: [0, 0, 1],
  };
}

/**
 * Get the signed distance from a point to the plane.
 * Positive if the point is on the side the normal points to.
 */
export function distanceToPoint(plane: Plane, point: [number, number, number]): number {
  const o = new THREE.Vector3(...plane.origin);
  const n = new THREE.Vector3(...plane.normal);
  const p = new THREE.Vector3(...point);
  return p.sub(o).dot(n);
}

/**
 * Project a point onto the plane.
 */
export function projectPoint(plane: Plane, point: [number, number, number]): [number, number, number] {
  const dist = distanceToPoint(plane, point);
  return [
    point[0] - dist * plane.normal[0],
    point[1] - dist * plane.normal[1],
    point[2] - dist * plane.normal[2],
  ];
}

/**
 * Check if a point lies on the plane within tolerance.
 */
export function pointOnPlane(
  plane: Plane,
  point: [number, number, number],
  tolerance = DEFAULT_TOLERANCE_POLICY.linear
): boolean {
  return Math.abs(distanceToPoint(plane, point)) < tolerance;
}
