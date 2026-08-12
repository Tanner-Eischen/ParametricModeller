import * as THREE from 'three';
import { DEFAULT_TOLERANCE_POLICY } from './TolerancePolicy';

export type Vector3Tuple = [number, number, number];
export type Matrix4Tuple = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/**
 * A rigid, right-handed coordinate frame.
 *
 * Axes are unit length and satisfy xAxis × yAxis = zAxis.
 */
export interface CoordinateFrame3D {
  origin: Vector3Tuple;
  xAxis: Vector3Tuple;
  yAxis: Vector3Tuple;
  zAxis: Vector3Tuple;
}

const FRAME_TOLERANCE = DEFAULT_TOLERANCE_POLICY.linear;

function tuple(vector: THREE.Vector3): Vector3Tuple {
  return [vector.x, vector.y, vector.z];
}

function finiteTuple(value: Vector3Tuple): boolean {
  return value.length === 3 && value.every(Number.isFinite);
}

function normalized(value: Vector3Tuple, label: string): THREE.Vector3 {
  if (!finiteTuple(value)) {
    throw new Error(`${label} must contain three finite values`);
  }
  const vector = new THREE.Vector3(...value);
  if (vector.lengthSq() <= FRAME_TOLERANCE * FRAME_TOLERANCE) {
    throw new Error(`${label} must be non-zero`);
  }
  return vector.normalize();
}

/**
 * Build a frame from X and Y directions. Y is orthogonalized against X and
 * Z is derived by the right-hand rule.
 */
export function createCoordinateFrame3D(
  origin: Vector3Tuple,
  xAxis: Vector3Tuple,
  yAxis: Vector3Tuple
): CoordinateFrame3D {
  if (!finiteTuple(origin)) {
    throw new Error('Frame origin must contain three finite values');
  }

  const x = normalized(xAxis, 'Frame X axis');
  const yCandidate = normalized(yAxis, 'Frame Y axis');
  const y = yCandidate.addScaledVector(x, -yCandidate.dot(x));
  if (y.lengthSq() <= FRAME_TOLERANCE * FRAME_TOLERANCE) {
    throw new Error('Frame X and Y axes must not be parallel');
  }
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();

  return {
    origin: [...origin],
    xAxis: tuple(x),
    yAxis: tuple(y),
    zAxis: tuple(z),
  };
}

/**
 * Build a right-handed frame with a prescribed Z axis and a preferred X axis.
 */
export function createCoordinateFrameFromZAxis(
  origin: Vector3Tuple,
  zAxis: Vector3Tuple,
  xHint: Vector3Tuple = [1, 0, 0]
): CoordinateFrame3D {
  if (!finiteTuple(origin)) {
    throw new Error('Frame origin must contain three finite values');
  }

  const z = normalized(zAxis, 'Frame Z axis');
  let x = normalized(xHint, 'Frame X hint');
  x.addScaledVector(z, -x.dot(z));

  if (x.lengthSq() <= FRAME_TOLERANCE * FRAME_TOLERANCE) {
    const fallback = Math.abs(z.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    x = fallback.addScaledVector(z, -fallback.dot(z));
  }

  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return createCoordinateFrame3D([...origin], tuple(x), tuple(y));
}

/**
 * Build a right-handed frame with a prescribed X axis and a preferred Z axis.
 */
export function createCoordinateFrameFromXAxis(
  origin: Vector3Tuple,
  xAxis: Vector3Tuple,
  zHint: Vector3Tuple = [0, 0, 1]
): CoordinateFrame3D {
  if (!finiteTuple(origin)) {
    throw new Error('Frame origin must contain three finite values');
  }

  const x = normalized(xAxis, 'Frame X axis');
  let z = normalized(zHint, 'Frame Z hint');
  z.addScaledVector(x, -z.dot(x));

  if (z.lengthSq() <= FRAME_TOLERANCE * FRAME_TOLERANCE) {
    const fallback = Math.abs(x.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
    z = fallback.addScaledVector(x, -fallback.dot(x));
  }

  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return createCoordinateFrame3D([...origin], tuple(x), tuple(y));
}

export function isRightHandedCoordinateFrame(
  frame: CoordinateFrame3D,
  tolerance = 1e-8
): boolean {
  if (
    !finiteTuple(frame.origin)
    || !finiteTuple(frame.xAxis)
    || !finiteTuple(frame.yAxis)
    || !finiteTuple(frame.zAxis)
  ) {
    return false;
  }

  const x = new THREE.Vector3(...frame.xAxis);
  const y = new THREE.Vector3(...frame.yAxis);
  const z = new THREE.Vector3(...frame.zAxis);
  return Math.abs(x.length() - 1) <= tolerance
    && Math.abs(y.length() - 1) <= tolerance
    && Math.abs(z.length() - 1) <= tolerance
    && Math.abs(x.dot(y)) <= tolerance
    && Math.abs(x.dot(z)) <= tolerance
    && Math.abs(y.dot(z)) <= tolerance
    && new THREE.Vector3().crossVectors(x, y).distanceTo(z) <= tolerance;
}

/**
 * Return the standard column-vector affine matrix for this frame.
 */
export function coordinateFrameToMatrix(frame: CoordinateFrame3D): THREE.Matrix4 {
  if (!isRightHandedCoordinateFrame(frame)) {
    throw new Error('Coordinate frame must be orthonormal and right-handed');
  }

  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...frame.xAxis),
    new THREE.Vector3(...frame.yAxis),
    new THREE.Vector3(...frame.zAxis)
  ).setPosition(new THREE.Vector3(...frame.origin));
}

export function coordinateFrameToMatrixTuple(frame: CoordinateFrame3D): Matrix4Tuple {
  return coordinateFrameToMatrix(frame).toArray() as Matrix4Tuple;
}

/**
 * Extract a rigid frame from a matrix. Scale and shear are rejected.
 */
export function coordinateFrameFromMatrix(
  matrix: THREE.Matrix4,
  tolerance = 1e-8
): CoordinateFrame3D {
  const elements = matrix.elements;
  if (
    Math.abs(elements[3] ?? Infinity) > tolerance
    || Math.abs(elements[7] ?? Infinity) > tolerance
    || Math.abs(elements[11] ?? Infinity) > tolerance
    || Math.abs((elements[15] ?? Infinity) - 1) > tolerance
  ) {
    throw new Error('Matrix must be affine');
  }

  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  matrix.extractBasis(x, y, z);
  const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
  const frame: CoordinateFrame3D = {
    origin: tuple(origin),
    xAxis: tuple(x),
    yAxis: tuple(y),
    zAxis: tuple(z),
  };
  if (!isRightHandedCoordinateFrame(frame, tolerance)) {
    throw new Error('Matrix must contain a rigid right-handed transform');
  }
  return frame;
}

export function transformCoordinateFrame(
  frame: CoordinateFrame3D,
  matrix: THREE.Matrix4
): CoordinateFrame3D {
  const transformed = coordinateFrameToMatrix(frame).premultiply(matrix);
  return coordinateFrameFromMatrix(transformed);
}
