// @vitest-environment jsdom

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ToolSessionManager } from '../../src/interaction/ToolSessionManager';
import {
  LinearPatternPreviewManipulator,
  MirrorPreviewManipulator,
  MoveCopyToolSession,
  TranslationTriadGizmo,
  createCopyToolSession,
} from '../../src/ui';
import { RenderMeshCache } from '../../src/rendering';

const sourceBodyRef = { featureId: 'source-feature', bodyId: 'source-body' };

describe('TranslationTriadGizmo and MoveCopyToolSession', () => {
  it('previews exact metric displacement on the active triad axis', () => {
    const scene = new THREE.Scene();
    const first = new THREE.Object3D();
    const second = new THREE.Object3D();
    first.position.set(2, 3, 4);
    second.position.set(-1, 1, 0);
    const onPreview = vi.fn();
    const gizmo = new TranslationTriadGizmo();
    gizmo.attach(scene);
    gizmo.showEditor({ sourceBodyRef, mode: 'move', objects: [first, second], onPreview });
    gizmo.setAxis('x');

    expect(gizmo.submitNumeric('25.4 mm')).toMatchObject({
      ok: true,
      translation: [1, 0, 0],
    });
    expect(first.position.toArray()).toEqual([3, 3, 4]);
    expect(second.position.toArray()).toEqual([0, 1, 0]);
    expect(onPreview).toHaveBeenLastCalledWith([1, 0, 0]);
    gizmo.hide();
    expect(first.position.toArray()).toEqual([2, 3, 4]);
    expect(second.position.toArray()).toEqual([-1, 1, 0]);
  });

  it('claims and drags a visible axis handle without orbit-style ambiguity', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const dom = document.createElement('div');
    Object.defineProperty(dom, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const mesh = new THREE.Object3D();
    scene.add(mesh);
    const onPreview = vi.fn(() => true);
    const gizmo = new TranslationTriadGizmo();
    gizmo.attach(scene, camera, dom);
    gizmo.showEditor({ sourceBodyRef, mode: 'copy', objects: [mesh], onPreview });
    scene.updateMatrixWorld(true);

    const handle = new THREE.Vector3(1, 0, 0).project(camera);
    const x = (handle.x + 1) * 400;
    const y = (-handle.y + 1) * 300;
    dom.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
    dom.dispatchEvent(new MouseEvent('pointermove', { clientX: x + 80, clientY: y, bubbles: true }));
    dom.dispatchEvent(new MouseEvent('pointerup', { clientX: x + 80, clientY: y, bubbles: true }));

    expect(gizmo.getAxis()).toBe('x');
    expect(gizmo.readTranslation()[0]).toBeGreaterThan(0.5);
    expect(onPreview).toHaveBeenCalled();
    gizmo.dispose();
  });

  it('commits only through Enter and restores the visual/document baseline through Escape', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Object3D();
    mesh.position.set(4, 0, 0);
    const gizmo = new TranslationTriadGizmo();
    gizmo.attach(scene);
    const onPreview = vi.fn(() => true);
    const onCommit = vi.fn(() => true);
    const onCancel = vi.fn();
    const manager = new ToolSessionManager();
    const cancelled = new MoveCopyToolSession({
      id: 'move-session', sourceBodyRef, mode: 'move', objects: [mesh], gizmo,
      onPreview, onCommit, onCancel,
    });
    manager.start(cancelled);
    cancelled.previewTranslation([2, 0, 0]);

    expect(mesh.position.x).toBe(6);
    expect(onCommit).not.toHaveBeenCalled();
    expect(manager.routeKey('Escape')).toMatchObject({ ended: true, reason: 'cancelled' });
    expect(mesh.position.x).toBe(4);
    expect(onCancel).toHaveBeenCalledOnce();

    const copy = createCopyToolSession({
      id: 'copy-session', sourceBodyRef, objects: [mesh], gizmo, onPreview, onCommit,
    });
    manager.start(copy);
    copy.setAxis('y');
    copy.submitNumeric('3/4 in');
    expect(onCommit).not.toHaveBeenCalled();
    expect(manager.routeKey('Enter')).toMatchObject({ ended: true, reason: 'committed' });
    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'copy',
      sourceBodyRef,
      translation: [0, 0.75, 0],
    }));
  });

  it('previews 200 rendered bodies without invoking rebuild or remesh work', () => {
    const scene = new THREE.Scene();
    const objects = Array.from({ length: 200 }, (_, index) => {
      const object = new THREE.Object3D();
      object.position.set(index, 0, 0);
      scene.add(object);
      return object;
    });
    const originalIdentities = [...objects];
    const rebuild = vi.fn();
    const meshCache = new RenderMeshCache();
    const remesh = vi.spyOn(meshCache, 'getOrCreateMesh');
    const gizmo = new TranslationTriadGizmo();
    gizmo.attach(scene);
    gizmo.showEditor({
      sourceBodyRef,
      mode: 'move',
      objects,
      onPreview: () => true,
    });

    const startedAt = performance.now();
    for (let step = 1; step <= 100; step++) {
      expect(gizmo.previewTranslation([step / 10, 0, 0])).toBe(true);
    }
    const elapsed = performance.now() - startedAt;

    expect(rebuild).not.toHaveBeenCalled();
    expect(remesh).not.toHaveBeenCalled();
    expect(objects).toEqual(originalIdentities);
    expect(objects[199]!.position.x).toBe(209);
    expect(elapsed).toBeLessThan(500);
    gizmo.hide();
    expect(objects[199]!.position.x).toBe(199);
    meshCache.dispose();
  });
});

describe('pattern and mirror preview manipulators', () => {
  it('previews numeric pattern controls, commits on Enter, and retains explicit source refs', () => {
    const onPreview = vi.fn(() => true);
    const onCommit = vi.fn(() => true);
    const session = new LinearPatternPreviewManipulator({
      id: 'pattern-session', sourceBodyRef, onPreview, onCommit,
    });
    const manager = new ToolSessionManager();
    manager.start(session);

    expect(session.submitSpacing('50.8 mm')).toEqual({ ok: true, spacing: 2 });
    expect(session.previewCount(5)).toBe(true);
    expect(session.previewDirection([0, 3, 0])).toBe(true);
    expect(session.previewSymmetric(true)).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
    manager.routeKey('Enter');
    expect(onCommit).toHaveBeenCalledWith({
      sourceFeatureId: sourceBodyRef.featureId,
      sourceBodyRef,
      count: 5,
      spacing: 2,
      direction: [0, 1, 0],
      symmetric: true,
    });
  });

  it('restores mirror preview parameters through Escape without committing', () => {
    const baselinePlane = { id: 'yz', type: 'world' as const, worldPlane: 'yz' as const, offset: 0 };
    const previews: unknown[] = [];
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const session = new MirrorPreviewManipulator({
      id: 'mirror-session', sourceBodyRef, planeRef: baselinePlane,
      onPreview: (params) => { previews.push(params); }, onCommit, onCancel,
    });
    const manager = new ToolSessionManager();
    manager.start(session);

    expect(session.submitWorldPlaneOffset('25.4 mm')).toEqual({ ok: true, offset: 1 });
    expect(session.readParams().planeRef).toMatchObject({ offset: 1 });
    manager.routeKey('Escape');

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(previews.at(-1)).toMatchObject({ planeRef: baselinePlane, sourceBodyRef });
  });
});
