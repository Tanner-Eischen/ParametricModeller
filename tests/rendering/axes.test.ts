import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Axes } from '../../src/rendering/Axes';

function positionsOf(axes: Axes): number[] {
  const lines = axes.group.getObjectByName('infinite-reference-axes') as THREE.LineSegments;
  return Array.from(lines.geometry.getAttribute('position').array as Float32Array);
}

const NDC_FRUSTUM_CORNERS = [
  [-1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [-1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1],
] as const;

function worldFrustumCorners(camera: THREE.Camera): THREE.Vector3[] {
  camera.updateMatrixWorld(true);
  return NDC_FRUSTUM_CORNERS.map(([x, y, z]) =>
    new THREE.Vector3(x, y, z).unproject(camera)
  );
}

function expectExtentToContainFrustum(axes: Axes, camera: THREE.Camera): void {
  const extent = axes.getCurrentExtent();
  for (const corner of worldFrustumCorners(camera)) {
    expect(Math.abs(corner.x)).toBeLessThan(extent);
    expect(Math.abs(corner.y)).toBeLessThan(extent);
    expect(Math.abs(corner.z)).toBeLessThan(extent);
  }
}

describe('camera-relative reference axes', () => {
  it('renders each world axis bidirectionally beyond a perspective frustum', () => {
    const axes = new Axes();
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 100);
    camera.position.set(3, 4, 12);
    axes.update(camera);

    const extent = axes.getCurrentExtent();
    expect(extent).toBeGreaterThan(camera.far);
    const expected = [
      -extent, 0, 0, extent, 0, 0,
      0, -extent, 0, 0, extent, 0,
      0, 0, -extent, 0, 0, extent,
    ];
    positionsOf(axes).forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index]!);
    });
    const lines = axes.group.getObjectByName('infinite-reference-axes') as THREE.LineSegments;
    expect(lines.frustumCulled).toBe(false);
    axes.dispose();
  });

  it('expands with orthographic zoom-out and camera pan', () => {
    const axes = new Axes();
    const camera = new THREE.OrthographicCamera(-20, 20, 10, -10, 0.01, 50);
    camera.position.set(250, -100, 80);
    camera.zoom = 0.05;
    axes.update(camera);

    const firstExtent = axes.getCurrentExtent();
    expect(firstExtent).toBeGreaterThan(400);
    camera.position.set(2000, -1000, 800);
    axes.update(camera);
    expect(axes.getCurrentExtent()).toBeGreaterThan(firstExtent);
    expect(positionsOf(axes).every(Number.isFinite)).toBe(true);
    axes.dispose();
  });

  it('contains every frustum corner for a rotated perspective camera', () => {
    const axes = new Axes();
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    const farCornerDirection = new THREE.Vector3(1, 1, -1).normalize();
    camera.quaternion.setFromUnitVectors(farCornerDirection, new THREE.Vector3(1, 0, 0));

    axes.update(camera);

    expect(axes.getCurrentExtent()).toBeGreaterThan(170);
    expectExtentToContainFrustum(axes, camera);
    axes.dispose();
  });

  it('accounts for extreme perspective zoom-out', () => {
    const axes = new Axes();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.zoom = 0.01;

    axes.update(camera);

    expect(axes.getCurrentExtent()).toBeGreaterThan(4000);
    expectExtentToContainFrustum(axes, camera);
    expect(positionsOf(axes).every(Number.isFinite)).toBe(true);
    axes.dispose();
  });

  it('changes marker size without shortening the reference lines', () => {
    const axes = new Axes();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    axes.update(camera);
    const extent = axes.getCurrentExtent();

    axes.setSize(8);

    expect(axes.getCurrentExtent()).toBe(extent);
    expect(Math.max(...positionsOf(axes))).toBeCloseTo(extent);
    axes.dispose();
  });
});
