import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  NAMED_VIEW_ORDER,
  NAMED_VIEWS,
  applyNamedView,
  calculateNamedViewPose,
  type CameraProjection,
} from '../../src/rendering/NamedViews';

describe('NamedViews', () => {
  it('provides all canonical views in stable order', () => {
    expect(NAMED_VIEW_ORDER).toEqual([
      'top', 'front', 'right', 'back', 'left', 'bottom', 'isometric',
    ]);
    expect(Object.keys(NAMED_VIEWS)).toHaveLength(7);
  });

  it('calculates deterministic orthogonal camera poses', () => {
    expect(calculateNamedViewPose('top', [10, 20, 30], 50)).toEqual({
      position: [10, 20, 80],
      target: [10, 20, 30],
      up: [0, 1, 0],
      projection: 'orthographic',
    });
    expect(calculateNamedViewPose('right', [10, 20, 30], 50).position).toEqual([
      60, 20, 30,
    ]);
  });

  it('normalizes the isometric direction', () => {
    const pose = calculateNamedViewPose('isometric', [0, 0, 0], Math.sqrt(3));
    expect(pose.position[0]).toBeCloseTo(1);
    expect(pose.position[1]).toBeCloseTo(-1);
    expect(pose.position[2]).toBeCloseTo(1);
    expect(pose.projection).toBe('perspective');
  });

  it('rejects invalid distances', () => {
    expect(() => calculateNamedViewPose('front', [0, 0, 0], 0)).toThrow(
      'positive finite'
    );
    expect(() => calculateNamedViewPose('front', [0, 0, 0], Number.NaN)).toThrow();
  });

  it('applies a view through the camera controller without WebGL', () => {
    let projection: CameraProjection = 'perspective';
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 10, 10);
    const target = new THREE.Vector3(2, 3, 4);
    const update = vi.fn();
    const setProjection = vi.fn((next: CameraProjection) => { projection = next; });
    const controller = {
      camera,
      orbitControls: { target, update },
      getProjection: () => projection,
      setProjection,
    };

    const pose = applyNamedView(controller, 'front', { distance: 25 });

    expect(setProjection).toHaveBeenCalledWith('orthographic');
    expect(camera.position.toArray()).toEqual([2, -22, 4]);
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
    expect(pose.target).toEqual([2, 3, 4]);
    expect(update).toHaveBeenCalledOnce();
  });

  it('can preserve the current projection and accept an explicit target', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, 5, 5);
    const setProjection = vi.fn();
    const controller = {
      camera,
      orbitControls: { target: new THREE.Vector3(), update: vi.fn() },
      getProjection: () => 'perspective' as const,
      setProjection,
    };

    const pose = applyNamedView(controller, 'left', {
      target: [4, 5, 6],
      distance: 10,
      preserveProjection: true,
    });

    expect(pose.projection).toBe('perspective');
    expect(camera.position.toArray()).toEqual([-6, 5, 6]);
    expect(setProjection).not.toHaveBeenCalled();
  });
});
