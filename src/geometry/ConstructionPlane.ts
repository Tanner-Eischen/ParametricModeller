import * as THREE from 'three';
import { generateId } from '../core/id';
import type { Plane } from './Plane';
import { createXYPlane, createXZPlane, createYZPlane } from './Plane';
import type { Body } from './Body';
import type { Face } from './Face';
import type { PlaneRef, Point2D } from '../sketch';

/**
 * A construction plane extends a geometric plane with reference information.
 * Used for sketch planes and feature references.
 */
export interface ConstructionPlane extends Plane {
  /** Unique identifier */
  id: string;
  /** Reference information (world plane or face) */
  ref: PlaneRef;
}

/**
 * Create a construction plane from a world plane type.
 */
export function createWorldConstructionPlane(
  type: 'xy' | 'xz' | 'yz',
  offset = 0,
  id?: string
): ConstructionPlane {
  let plane: Plane;

  switch (type) {
    case 'xy':
      plane = createXYPlane(offset);
      break;
    case 'xz':
      plane = createXZPlane(offset);
      break;
    case 'yz':
      plane = createYZPlane(offset);
      break;
  }

  return {
    ...plane,
    id: id ?? generateId(),
    ref: {
      id: generateId(),
      type: 'world',
      worldPlane: type,
      offset,
    },
  };
}

/**
 * Create a construction plane from a face of a body.
 */
export function createFaceConstructionPlane(
  face: Face,
  body: Body,
  faceId: string,
  id?: string
): ConstructionPlane | null {
  // Get the plane for this face
  const plane = body.planes.get(face.planeId);
  if (!plane) return null;

  return {
    ...plane,
    id: id ?? generateId(),
    ref: {
      id: generateId(),
      type: 'face',
      faceId,
      bodyId: body.id,
    },
  };
}

/**
 * Get a construction plane from a PlaneRef.
 */
export function getConstructionPlaneFromRef(
  ref: PlaneRef,
  bodies: Body[]
): ConstructionPlane | null {
  if (ref.type === 'world') {
    return createWorldConstructionPlane(
      ref.worldPlane ?? 'xy',
      ref.offset ?? 0,
      ref.id
    );
  }

  if (ref.type === 'face') {
    // Find the body
    const body = bodies.find((b) => b.id === ref.bodyId);
    if (!body) return null;

    // Find the face
    const face = body.faces.get(ref.faceId ?? '');
    if (!face) return null;

    return createFaceConstructionPlane(face, body, ref.faceId ?? '', ref.id);
  }

  return null;
}

/**
 * Convert a 2D point in sketch coordinates to 3D world coordinates.
 */
export function sketchToWorld(
  plane: ConstructionPlane,
  point2D: Point2D
): [number, number, number] {
  // Convert 2D point to 3D using the plane's basis vectors
  const x = plane.origin[0] + point2D[0] * plane.uAxis[0] + point2D[1] * plane.vAxis[0];
  const y = plane.origin[1] + point2D[0] * plane.uAxis[1] + point2D[1] * plane.vAxis[1];
  const z = plane.origin[2] + point2D[0] * plane.uAxis[2] + point2D[1] * plane.vAxis[2];

  return [x, y, z];
}

/**
 * Convert a 3D world coordinate to 2D sketch coordinates.
 */
export function worldToSketch(
  plane: ConstructionPlane,
  point3D: [number, number, number]
): Point2D {
  // Project point onto plane and get 2D coordinates
  const origin = new THREE.Vector3(...plane.origin);
  const uAxis = new THREE.Vector3(...plane.uAxis);
  const vAxis = new THREE.Vector3(...plane.vAxis);
  const point = new THREE.Vector3(...point3D);

  // Vector from origin to point
  const relative = point.clone().sub(origin);

  // Project onto u and v axes
  const u = relative.dot(uAxis);
  const v = relative.dot(vAxis);

  return [u, v];
}

/**
 * Convert multiple 2D points to 3D.
 */
export function sketchPointsToWorld(
  plane: ConstructionPlane,
  points2D: Point2D[]
): [number, number, number][] {
  return points2D.map((p) => sketchToWorld(plane, p));
}

/**
 * Convert multiple 3D points to 2D.
 */
export function worldPointsToSketch(
  plane: ConstructionPlane,
  points3D: [number, number, number][]
): Point2D[] {
  return points3D.map((p) => worldToSketch(plane, p));
}

/**
 * Get the transform matrix to go from sketch space to world space.
 */
export function getSketchToWorldMatrix(plane: ConstructionPlane): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();

  // Build rotation from basis vectors
  const uAxis = new THREE.Vector3(...plane.uAxis);
  const vAxis = new THREE.Vector3(...plane.vAxis);
  const normal = new THREE.Vector3(...plane.normal);

  // Rotation matrix (columns are basis vectors)
  const rotation = new THREE.Matrix4();
  rotation.makeBasis(uAxis, vAxis, normal);

  // Translation matrix
  const translation = new THREE.Matrix4();
  translation.setPosition(new THREE.Vector3(...plane.origin));

  // Combined transform
  matrix.multiplyMatrices(translation, rotation);

  return matrix;
}

/**
 * Check if two construction planes are equivalent.
 */
export function planesAreEquivalent(
  a: ConstructionPlane,
  b: ConstructionPlane,
  tolerance = 1e-6
): boolean {
  const aOrigin = new THREE.Vector3(...a.origin);
  const bOrigin = new THREE.Vector3(...b.origin);
  const aNormal = new THREE.Vector3(...a.normal);
  const bNormal = new THREE.Vector3(...b.normal);

  // Check normal direction (may be opposite for same plane)
  const normalDot = Math.abs(aNormal.dot(bNormal));
  if (normalDot < 1 - tolerance) return false;

  // Check if origins are on the same plane
  const distance = aOrigin.clone().sub(bOrigin).dot(aNormal);
  if (Math.abs(distance) > tolerance) return false;

  return true;
}

/**
 * Get the default sketch plane (XY plane at z=0).
 */
export function getDefaultSketchPlane(): ConstructionPlane {
  return createWorldConstructionPlane('xy', 0, 'default_xy');
}

/**
 * Get the three standard world planes.
 */
export function getStandardWorldPlanes(): ConstructionPlane[] {
  return [
    createWorldConstructionPlane('xy', 0, 'world_xy'),
    createWorldConstructionPlane('xz', 0, 'world_xz'),
    createWorldConstructionPlane('yz', 0, 'world_yz'),
  ];
}

/**
 * Offset a construction plane along its normal.
 */
export function offsetConstructionPlane(
  plane: ConstructionPlane,
  distance: number
): ConstructionPlane {
  const newOrigin: [number, number, number] = [
    plane.origin[0] + distance * plane.normal[0],
    plane.origin[1] + distance * plane.normal[1],
    plane.origin[2] + distance * plane.normal[2],
  ];

  return {
    ...plane,
    origin: newOrigin,
  };
}

/**
 * Flip a construction plane (reverse normal direction).
 */
export function flipConstructionPlane(plane: ConstructionPlane): ConstructionPlane {
  return {
    ...plane,
    normal: [-plane.normal[0], -plane.normal[1], -plane.normal[2]] as [number, number, number],
    uAxis: plane.vAxis,
    vAxis: plane.uAxis,
  };
}
