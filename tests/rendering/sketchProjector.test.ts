import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWorldConstructionPlane } from '../../src/geometry';
import { ConstructionPlaneProjector } from '../../src/rendering/SketchProjector';

function createCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-10, 10, 7.5, -7.5, 0.01, 1000);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

describe('ConstructionPlaneProjector', () => {
  it.each(['xy', 'xz', 'yz'] as const)('round-trips points on the %s plane', (planeName) => {
    const plane = createWorldConstructionPlane(planeName, 3);
    const camera = createCamera();
    camera.position.set(...plane.origin).add(new THREE.Vector3(...plane.normal).multiplyScalar(50));
    camera.up.set(...plane.vAxis);
    camera.lookAt(...plane.origin);
    const projector = new ConstructionPlaneProjector(plane, camera);

    const screen = projector.sketchToScreen([2.25, -1.75], 800, 600);
    expect(screen).not.toBeNull();
    const restored = projector.screenToSketch(screen!.x, screen!.y, 800, 600);

    expect(restored?.[0]).toBeCloseTo(2.25, 9);
    expect(restored?.[1]).toBeCloseTo(-1.75, 9);
  });

  it('tracks zoom while keeping inverse projection exact', () => {
    const plane = createWorldConstructionPlane('xy');
    const camera = createCamera();
    const projector = new ConstructionPlaneProjector(plane, camera);
    const center = projector.sketchToScreen([0, 0], 800, 600)!;
    const normalZoom = projector.sketchToScreen([2, 0], 800, 600)!;

    camera.zoom = 2;
    camera.updateProjectionMatrix();
    const zoomed = projector.sketchToScreen([2, 0], 800, 600)!;
    const restored = projector.screenToSketch(zoomed.x, zoomed.y, 800, 600);

    expect(Math.abs(zoomed.x - center.x)).toBeCloseTo(2 * Math.abs(normalZoom.x - center.x), 9);
    expect(restored?.[0]).toBeCloseTo(2, 9);
    expect(restored?.[1]).toBeCloseTo(0, 9);
  });
});
