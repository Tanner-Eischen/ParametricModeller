/**
 * Flush Mate Solver - Milestone 06: Assembly-lite
 *
 * Calculates the transform needed to satisfy a flush mate constraint.
 * A flush mate makes two faces coplanar with their normals anti-parallel.
 */

import * as THREE from 'three';
import { createModuleLogger } from '../../core/logger';
import type { Body } from '../../geometry';
import type { Plane } from '../../geometry/Plane';
import type { InstanceFaceRef } from '../AssemblyTypes';

const log = createModuleLogger('FlushMateSolver');

/**
 * Result of solving a flush mate.
 */
export interface FlushMateResult {
  ok: boolean;
  transform?: number[];  // 4x4 matrix to apply to instance B
  error?: string;
}

/**
 * Get the plane of a face from a body.
 */
function getFacePlane(body: Body, faceId: string): Plane | null {
  const face = body.faces.get(faceId);
  if (!face) {
    return null;
  }

  const plane = body.planes.get(face.planeId);
  return plane ?? null;
}

/**
 * Calculate the transform to make two faces coplanar with anti-parallel normals.
 *
 * Algorithm:
 * 1. Get plane A and plane B
 * 2. Compute rotation to make normal B anti-parallel to normal A
 * 3. Apply rotation to body B
 * 4. Compute translation to make origins coincident
 *
 * @param bodyA - Body containing face A
 * @param faceRefA - Reference to face A
 * @param bodyB - Body containing face B
 * @param faceRefB - Reference to face B
 * @param offset - Distance offset (0 for flush)
 * @returns Transform matrix to apply to instance B, or error
 */
export function solveFlushMate(
  bodyA: Body,
  faceRefA: InstanceFaceRef,
  bodyB: Body,
  faceRefB: InstanceFaceRef,
  offset: number = 0
): FlushMateResult {
  // Get planes
  const planeA = getFacePlane(bodyA, faceRefA.faceId);
  const planeB = getFacePlane(bodyB, faceRefB.faceId);

  if (!planeA) {
    return { ok: false, error: `Face ${faceRefA.faceId} not found in body ${faceRefA.bodyId}` };
  }

  if (!planeB) {
    return { ok: false, error: `Face ${faceRefB.faceId} not found in body ${faceRefB.bodyId}` };
  }

  // Face centers (use plane origins for simplicity)
  const centerA = new THREE.Vector3(...planeA.origin);
  const centerB = new THREE.Vector3(...planeB.origin);

  // Face normals
  const normalA = new THREE.Vector3(...planeA.normal);
  const normalB = new THREE.Vector3(...planeB.normal);

  log.debug('Solving flush mate', {
    centerA: centerA.toArray(),
    centerB: centerB.toArray(),
    normalA: normalA.toArray(),
    normalB: normalB.toArray(),
    offset,
  });

  // For flush mate, we want normalB to be anti-parallel to normalA
  // i.e., normalB' = -normalA
  const targetNormalB = normalA.clone().negate();

  // Calculate rotation to align normalB with targetNormalB
  const rotation = new THREE.Quaternion();

  // Check if normals are already (anti-)parallel
  const dot = normalB.dot(targetNormalB);
  if (Math.abs(dot - 1) < 1e-6) {
    // Already aligned, no rotation needed
    rotation.identity();
  } else if (Math.abs(dot + 1) < 1e-6) {
    // Anti-parallel, rotate 180 degrees around any perpendicular axis
    const perp = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normalB.dot(perp)) > 0.9) {
      perp.set(0, 1, 0);
    }
    rotation.setFromAxisAngle(perp, Math.PI);
  } else {
    // General case: rotate around the cross product axis
    const axis = new THREE.Vector3().crossVectors(normalB, targetNormalB).normalize();
    const angle = Math.acos(dot);
    rotation.setFromAxisAngle(axis, angle);
  }

  // Apply rotation to center B
  const rotatedCenterB = centerB.clone().applyQuaternion(rotation);

  // Calculate translation to align centers with offset along normalA
  // Target: rotatedCenterB + translation = centerA + offset * normalA
  const translation = new THREE.Vector3()
    .copy(centerA)
    .add(normalA.clone().multiplyScalar(offset))
    .sub(rotatedCenterB);

  // Compose final transform matrix
  const matrix = new THREE.Matrix4();
  matrix.makeRotationFromQuaternion(rotation);
  matrix.setPosition(translation);

  log.debug('Flush mate solved', {
    translation: translation.toArray(),
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });

  return {
    ok: true,
    transform: Array.from(matrix.elements),
  };
}

/**
 * Check if two faces satisfy a flush mate constraint.
 */
export function checkFlushMate(
  bodyA: Body,
  faceRefA: InstanceFaceRef,
  bodyB: Body,
  faceRefB: InstanceFaceRef,
  tolerance: number = 0.001
): { satisfied: boolean; distance: number } {
  const planeA = getFacePlane(bodyA, faceRefA.faceId);
  const planeB = getFacePlane(bodyB, faceRefB.faceId);

  if (!planeA || !planeB) {
    return { satisfied: false, distance: Infinity };
  }

  // Check if normals are anti-parallel
  const normalA = new THREE.Vector3(...planeA.normal);
  const normalB = new THREE.Vector3(...planeB.normal);

  const dot = normalA.dot(normalB);
  if (dot > -1 + tolerance) {
    // Normals are not anti-parallel
    return { satisfied: false, distance: Math.abs(dot + 1) };
  }

  // Check if origins are coplanar
  const originA = new THREE.Vector3(...planeA.origin);
  const originB = new THREE.Vector3(...planeB.origin);

  // Distance from originB to planeA
  const distance = originB.clone().sub(originA).dot(normalA);

  return {
    satisfied: Math.abs(distance) < tolerance,
    distance,
  };
}
