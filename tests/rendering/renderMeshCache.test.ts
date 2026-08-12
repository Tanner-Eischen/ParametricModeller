import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import { RenderMeshCache } from '../../src/rendering/RenderMeshCache';
import { Picking } from '../../src/rendering/Picking';

describe('RenderMeshCache performance instrumentation', () => {
  it('exposes the body identity required by viewport and marquee picking', () => {
    const cache = new RenderMeshCache();
    const picking = new Picking();
    const body = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'quick-start-body');
    const group = cache.getOrCreateMesh(body);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(3, 3, 3);
    camera.lookAt(0.5, 0.5, 0.5);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    group.updateMatrixWorld(true);

    expect(group.userData.id).toBe(body.id);
    expect(group.userData.bodyId).toBe(body.id);
    expect(picking.pick(50, 50, 100, 100, camera, [group]).objectId).toBe(body.id);

    picking.dispose();
    cache.dispose();
  });

  it('reports real reuse and invalidates a same-ID geometry change', () => {
    const cache = new RenderMeshCache();
    const firstBody = createBoxBody({
      width: 2,
      depth: 3,
      height: 4,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'panel');

    const firstMesh = cache.getOrCreateMesh(firstBody);
    expect(cache.getOrCreateMesh(firstBody)).toBe(firstMesh);

    const changedBody = createBoxBody({
      width: 4,
      depth: 3,
      height: 4,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'panel');
    expect(cache.getOrCreateMesh(changedBody)).not.toBe(firstMesh);
    expect(cache.getStats()).toEqual({
      lookups: 3,
      hits: 1,
      misses: 2,
      hitRate: 1 / 3,
    });

    cache.dispose();
  });

  it('keeps hover and persistent selection visually distinct', () => {
    const cache = new RenderMeshCache();
    const body = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'selectable-body');
    const group = cache.getOrCreateMesh(body);
    const mesh = group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh)!;
    const color = () => (mesh.material as THREE.MeshStandardMaterial).color.getHex();

    const defaultColor = color();
    cache.setInteractionState(body.id, 'hovered');
    const hoverColor = color();
    expect(group.userData.interactionState).toBe('hovered');

    cache.setInteractionState(body.id, 'selected');
    const selectedColor = color();
    expect(group.userData.interactionState).toBe('selected');
    expect(new Set([defaultColor, hoverColor, selectedColor]).size).toBe(3);

    cache.dispose();
  });
});
