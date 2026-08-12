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

export interface FlushMateCheck {
  satisfied: boolean;
  /** Signed separation of face B from face A along face A's normal. */
  distance: number;
  /** Absolute difference between signed separation and the requested offset. */
  offsetError: number;
  /** Angular error in radians from anti-parallel face normals. */
  angularError: number;
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
  if (normalA.lengthSq() < 1e-18 || normalB.lengthSq() < 1e-18) {
    return { ok: false, error: 'Mate faces must have non-zero plane normals' };
  }
  normalA.normalize();
  normalB.normalize();

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
  const dot = THREE.MathUtils.clamp(normalB.dot(targetNormalB), -1, 1);
  if (Math.abs(dot - 1) < 1e-6) {
    // Already aligned, no rotation needed
    rotation.identity();
  } else if (Math.abs(dot + 1) < 1e-6) {
    // Anti-parallel, rotate 180 degrees around any perpendicular axis
    const basis = Math.abs(normalB.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const perp = new THREE.Vector3().crossVectors(normalB, basis).normalize();
    rotation.setFromAxisAngle(perp, Math.PI);
  } else {
    // General case: rotate around the cross product axis
    const axis = new THREE.Vector3().crossVectors(normalB, targetNormalB).normalize();
    const angle = Math.acos(dot);
    rotation.setFromAxisAngle(axis, angle);
  }

  // Rotate around face B's plane origin. A flush mate leaves both tangential
  // translation degrees of freedom untouched; it only corrects separation
  // along face A's normal.
  const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotation);
  const rotateAroundCenterB = new THREE.Matrix4()
    .makeTranslation(centerB.x, centerB.y, centerB.z)
    .multiply(rotationMatrix)
    .multiply(new THREE.Matrix4().makeTranslation(
      -centerB.x,
      -centerB.y,
      -centerB.z
    ));
  const currentSeparation = centerB.clone().sub(centerA).dot(normalA);
  const translation = normalA.clone().multiplyScalar(offset - currentSeparation);
  const matrix = new THREE.Matrix4()
    .makeTranslation(translation.x, translation.y, translation.z)
    .multiply(rotateAroundCenterB);

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
  tolerance: number = 0.001,
  offset: number = 0
): FlushMateCheck {
  const planeA = getFacePlane(bodyA, faceRefA.faceId);
  const planeB = getFacePlane(bodyB, faceRefB.faceId);

  if (!planeA || !planeB) {
    return {
      satisfied: false,
      distance: Infinity,
      offsetError: Infinity,
      angularError: Infinity,
    };
  }

  // Check if normals are anti-parallel
  const normalA = new THREE.Vector3(...planeA.normal).normalize();
  const normalB = new THREE.Vector3(...planeB.normal).normalize();

  const dot = THREE.MathUtils.clamp(normalA.dot(normalB), -1, 1);
  const angularError = Math.acos(THREE.MathUtils.clamp(-dot, -1, 1));

  const originA = new THREE.Vector3(...planeA.origin);
  const originB = new THREE.Vector3(...planeB.origin);

  const distance = originB.clone().sub(originA).dot(normalA);
  const offsetError = Math.abs(distance - offset);

  return {
    satisfied: angularError < tolerance && offsetError < tolerance,
    distance,
    offsetError,
    angularError,
  };
}
