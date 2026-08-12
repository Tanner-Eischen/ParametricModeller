import * as THREE from 'three';
import type { ConstructionPlane } from '../geometry';
import type { Point2D } from '../sketch';

export const SKETCH_CAMERA_CHANGE_EVENT = 'cad:sketch-camera-change';

type CameraProvider = () => THREE.Camera;
const cameraProviders = new WeakMap<HTMLElement, CameraProvider>();

export function registerSketchCamera(container: HTMLElement, provider: CameraProvider): () => void {
  cameraProviders.set(container, provider);
  return () => cameraProviders.delete(container);
}

export function getRegisteredSketchCamera(container: HTMLElement): THREE.Camera | null {
  return cameraProviders.get(container)?.() ?? null;
}

export function notifySketchCameraChanged(container: HTMLElement): void {
  container.dispatchEvent(new CustomEvent(SKETCH_CAMERA_CHANGE_EVENT));
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Project between construction-plane coordinates and CSS viewport pixels. */
export class ConstructionPlaneProjector {
  private readonly raycaster = new THREE.Raycaster();
  private readonly worldPlane = new THREE.Plane();

  constructor(
    private readonly plane: ConstructionPlane,
    private readonly camera: THREE.Camera
  ) {
    const normal = new THREE.Vector3(...plane.normal).normalize();
    this.worldPlane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...plane.origin));
  }

  sketchToScreen(point: Point2D, width: number, height: number): ScreenPoint | null {
    if (!isUsableViewport(width, height)) return null;
    this.updateCamera();
    const world = new THREE.Vector3(...this.plane.origin)
      .addScaledVector(new THREE.Vector3(...this.plane.uAxis), point[0])
      .addScaledVector(new THREE.Vector3(...this.plane.vAxis), point[1]);
    const ndc = world.project(this.camera);
    if (![ndc.x, ndc.y, ndc.z].every(Number.isFinite)) return null;
    return {
      x: (ndc.x + 1) * width / 2,
      y: (1 - ndc.y) * height / 2,
    };
  }

  screenToSketch(x: number, y: number, width: number, height: number): Point2D | null {
    if (!isUsableViewport(width, height) || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    this.updateCamera();
    const ndc = new THREE.Vector2((x / width) * 2 - 1, 1 - (y / height) * 2);
    this.raycaster.setFromCamera(ndc, this.camera);
    const world = this.raycaster.ray.intersectPlane(this.worldPlane, new THREE.Vector3());
    if (!world) return null;
    const relative = world.sub(new THREE.Vector3(...this.plane.origin));
    return [
      cleanCoordinate(relative.dot(new THREE.Vector3(...this.plane.uAxis))),
      cleanCoordinate(relative.dot(new THREE.Vector3(...this.plane.vAxis))),
    ];
  }

  private updateCamera(): void {
    this.camera.updateMatrixWorld(true);
    if ('updateProjectionMatrix' in this.camera) {
      (this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix();
    }
  }
}

/** Standalone/test fallback; the application uses its registered live camera. */
export function createFallbackSketchCamera(width: number, height: number): THREE.OrthographicCamera {
  const halfWidth = Math.max(width, 1) / 100;
  const halfHeight = Math.max(height, 1) / 100;
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.01, 1000);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function isUsableViewport(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function cleanCoordinate(value: number): number {
  const nearestInteger = Math.round(value);
  if (Math.abs(value - nearestInteger) <= 1e-12) return nearestInteger;
  return Math.abs(value) <= 1e-12 ? 0 : value;
}
