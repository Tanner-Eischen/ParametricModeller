import type * as THREE from 'three';

/** A camera itself or an owner whose `camera` getter always returns the active camera. */
export type ActiveCameraSource = THREE.Camera | { readonly camera: THREE.Camera };

export function resolveActiveCamera(source: ActiveCameraSource): THREE.Camera {
  return 'camera' in source ? source.camera : source;
}
