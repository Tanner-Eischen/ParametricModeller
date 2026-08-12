import * as THREE from 'three';

export type NamedViewId =
  | 'top'
  | 'front'
  | 'right'
  | 'back'
  | 'left'
  | 'bottom'
  | 'isometric';

export type CameraProjection = 'perspective' | 'orthographic';
export type Vector3Tuple = readonly [number, number, number];

export interface NamedViewDefinition {
  id: NamedViewId;
  label: string;
  direction: Vector3Tuple;
  up: Vector3Tuple;
  projection: CameraProjection;
}

export interface NamedViewCameraController {
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly orbitControls: {
    readonly target: THREE.Vector3;
    update: () => void;
  };
  getProjection: () => CameraProjection;
  setProjection: (projection: CameraProjection) => void;
}

export interface ApplyNamedViewOptions {
  target?: THREE.Vector3 | Vector3Tuple;
  distance?: number;
  preserveProjection?: boolean;
}

export interface NamedViewPose {
  position: Vector3Tuple;
  target: Vector3Tuple;
  up: Vector3Tuple;
  projection: CameraProjection;
}

const DEFAULT_DISTANCE = 60;

export const NAMED_VIEW_ORDER: readonly NamedViewId[] = [
  'top',
  'front',
  'right',
  'back',
  'left',
  'bottom',
  'isometric',
];

export const NAMED_VIEWS: Readonly<Record<NamedViewId, NamedViewDefinition>> = {
  top: {
    id: 'top',
    label: 'Top',
    direction: [0, 0, 1],
    up: [0, 1, 0],
    projection: 'orthographic',
  },
  front: {
    id: 'front',
    label: 'Front',
    direction: [0, -1, 0],
    up: [0, 0, 1],
    projection: 'orthographic',
  },
  right: {
    id: 'right',
    label: 'Right',
    direction: [1, 0, 0],
    up: [0, 0, 1],
    projection: 'orthographic',
  },
  back: {
    id: 'back',
    label: 'Back',
    direction: [0, 1, 0],
    up: [0, 0, 1],
    projection: 'orthographic',
  },
  left: {
    id: 'left',
    label: 'Left',
    direction: [-1, 0, 0],
    up: [0, 0, 1],
    projection: 'orthographic',
  },
  bottom: {
    id: 'bottom',
    label: 'Bottom',
    direction: [0, 0, -1],
    up: [0, 1, 0],
    projection: 'orthographic',
  },
  isometric: {
    id: 'isometric',
    label: 'Isometric',
    direction: [1, -1, 1],
    up: [0, 0, 1],
    projection: 'perspective',
  },
};

export function getNamedView(id: NamedViewId): NamedViewDefinition {
  return NAMED_VIEWS[id];
}

export function calculateNamedViewPose(
  id: NamedViewId,
  target: THREE.Vector3 | Vector3Tuple = [0, 0, 0],
  distance = DEFAULT_DISTANCE,
  projection = NAMED_VIEWS[id].projection
): NamedViewPose {
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new Error('Named view distance must be a positive finite number');
  }

  const definition = NAMED_VIEWS[id];
  const targetVector = toVector3(target);
  const direction = new THREE.Vector3(...definition.direction).normalize();
  const position = targetVector.clone().addScaledVector(direction, distance);

  return {
    position: toTuple(position),
    target: toTuple(targetVector),
    up: definition.up,
    projection,
  };
}

/**
 * Applies a canonical view while retaining the current orbit target and zoom
 * distance by default. The same inputs always produce the same camera pose.
 */
export function applyNamedView(
  controller: NamedViewCameraController,
  id: NamedViewId,
  options: ApplyNamedViewOptions = {}
): NamedViewPose {
  const definition = NAMED_VIEWS[id];
  const target = options.target
    ? toVector3(options.target)
    : controller.orbitControls.target.clone();
  const currentDistance = controller.camera.position.distanceTo(
    controller.orbitControls.target
  );
  const distance = options.distance ?? (
    Number.isFinite(currentDistance) && currentDistance > 0
      ? currentDistance
      : DEFAULT_DISTANCE
  );
  const projection = options.preserveProjection
    ? controller.getProjection()
    : definition.projection;
  const pose = calculateNamedViewPose(id, target, distance, projection);

  if (!options.preserveProjection && controller.getProjection() !== projection) {
    controller.setProjection(projection);
  }

  controller.camera.position.set(...pose.position);
  controller.camera.up.set(...pose.up).normalize();
  controller.orbitControls.target.set(...pose.target);
  controller.camera.lookAt(controller.orbitControls.target);
  controller.orbitControls.update();

  return pose;
}

function toVector3(value: THREE.Vector3 | Vector3Tuple): THREE.Vector3 {
  return value instanceof THREE.Vector3
    ? value.clone()
    : new THREE.Vector3(...value);
}

function toTuple(value: THREE.Vector3): Vector3Tuple {
  return [value.x, value.y, value.z];
}
