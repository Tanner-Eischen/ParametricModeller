/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createComponentInstance,
  createIdentityTransform,
} from '../../src/assembly/AssemblyTypes';
import { InstanceTransformGizmo } from '../../src/ui/InstanceTransformGizmo';
import { eventBus } from '../../src/core';

const controlMocks = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock('three/addons/controls/TransformControls.js', async () => {
  const THREE = await vi.importActual<typeof import('three')>('three');

  class MockTransformControls {
    object: THREE.Object3D | null = null;
    camera: THREE.Camera;
    mode: 'translate' | 'rotate' = 'translate';
    showX = true;
    showY = true;
    showZ = true;
    readonly helper = new THREE.Object3D();
    readonly listeners = new Map<string, Array<(event: { value?: boolean }) => void>>();
    setSize = vi.fn();
    setSpace = vi.fn();
    setTranslationSnap = vi.fn();
    setRotationSnap = vi.fn();
    dispose = vi.fn();

    constructor(camera: THREE.Camera) {
      this.camera = camera;
      controlMocks.instances.push(this);
    }

    getHelper(): THREE.Object3D {
      return this.helper;
    }

    addEventListener(type: string, listener: (event: { value?: boolean }) => void): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type: string, event: { value?: boolean } = {}): void {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    attach(object: THREE.Object3D): void {
      this.object = object;
    }

    detach(): void {
      this.object = null;
    }

    setMode(mode: 'translate' | 'rotate'): void {
      this.mode = mode;
    }
  }

  return { TransformControls: MockTransformControls };
});

interface ControlsHarness {
  object: THREE.Object3D | null;
  camera: THREE.Camera;
  dispatch(type: string, event?: { value?: boolean }): void;
}

describe('InstanceTransformGizmo preview contract', () => {
  afterEach(() => {
    controlMocks.instances.length = 0;
    document.body.innerHTML = '';
  });

  function setup() {
    const domElement = document.createElement('div');
    domElement.tabIndex = 0;
    document.body.appendChild(domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const mesh = new THREE.Object3D();
    mesh.position.set(1, 2, 3);
    scene.add(mesh);
    const instance = createComponentInstance('component-1', 'Instance 1', createIdentityTransform());
    const gizmo = new InstanceTransformGizmo({ snapEnabled: false });
    gizmo.attach(scene, camera, domElement);
    const controls = controlMocks.instances[0] as ControlsHarness;
    return { domElement, scene, mesh, instance, gizmo, controls };
  }

  it('never commits from pointer or drag end; commit remains explicit', () => {
    const { domElement, mesh, instance, gizmo, controls } = setup();
    const onSessionStart = vi.fn();
    const onPreview = vi.fn((_instanceId: string, _transform: number[]) => true);
    const onCommit = vi.fn((_instanceId: string, _transform: number[]) => true);
    gizmo.showEditor({ instance, mesh, onSessionStart, onPreview, onCommit });

    controls.dispatch('dragging-changed', { value: true });
    mesh.position.set(4, 5, 6);
    mesh.updateMatrixWorld(true);
    controls.dispatch('change');
    domElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    controls.dispatch('dragging-changed', { value: false });

    expect(onSessionStart).toHaveBeenCalledWith(instance.id, instance.transform);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(gizmo.isActive()).toBe(true);

    expect(gizmo.commitTransform()).toBe(true);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[1].slice(12, 15)).toEqual([4, 5, 6]);
    gizmo.dispose();
  });

  it('restores the visual and serialized baselines on cancellation', () => {
    const { domElement, mesh, instance, gizmo, controls } = setup();
    const baselineBytes = JSON.stringify(instance);
    const onCommit = vi.fn();
    gizmo.show(instance, mesh, onCommit);

    controls.dispatch('dragging-changed', { value: true });
    mesh.position.set(8, 9, 10);
    mesh.updateMatrixWorld(true);
    controls.dispatch('change');
    controls.dispatch('dragging-changed', { value: false });

    domElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(gizmo.isActive()).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
    expect(gizmo.resetPreview()).toBe(true);
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(JSON.stringify(instance)).toBe(baselineBytes);
    expect(gizmo.readBaselineTransform()).toEqual(instance.transform);

    gizmo.hide();
    expect(gizmo.isActive()).toBe(false);
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    gizmo.dispose();
  });

  it('reports drag ownership and always releases it when hidden', () => {
    const { mesh, instance, gizmo, controls } = setup();
    const onDraggingChange = vi.fn();
    gizmo.showEditor({ instance, mesh, onDraggingChange });

    controls.dispatch('dragging-changed', { value: true });
    controls.dispatch('dragging-changed', { value: false });
    controls.dispatch('dragging-changed', { value: true });
    gizmo.hide();

    expect(onDraggingChange.mock.calls.map(([dragging]) => dragging)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    gizmo.dispose();
  });

  it('previews and restores every mesh in a multi-body instance as one transform', () => {
    const { scene, mesh, instance, gizmo, controls } = setup();
    const second = new THREE.Object3D();
    second.position.set(-2, 4, 1);
    scene.add(second);
    const firstBaseline = mesh.position.toArray();
    const secondBaseline = second.position.toArray();
    const onPreview = vi.fn(() => true);
    const onCommit = vi.fn((_instanceId: string, _transform: number[]) => true);
    const onDraggingChange = vi.fn();

    gizmo.showEditor({
      instance,
      mesh,
      meshes: [mesh, second],
      onPreview,
      onCommit,
      onDraggingChange,
    });
    const previewRoot = controls.object!;
    expect(previewRoot).not.toBe(mesh);

    controls.dispatch('dragging-changed', { value: true });
    previewRoot.position.set(5, -1, 2);
    previewRoot.updateMatrixWorld(true);
    controls.dispatch('change');
    controls.dispatch('dragging-changed', { value: false });

    expect(new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).toArray()).toEqual([6, 1, 5]);
    expect(new THREE.Vector3().setFromMatrixPosition(second.matrixWorld).toArray()).toEqual([3, 3, 3]);
    expect(onPreview).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onDraggingChange.mock.calls.map(([dragging]) => dragging)).toEqual([true, false]);

    expect(gizmo.resetPreview()).toBe(true);
    expect(new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).toArray()).toEqual(firstBaseline);
    expect(new THREE.Vector3().setFromMatrixPosition(second.matrixWorld).toArray()).toEqual(secondBaseline);
    gizmo.hide();
    expect(mesh.parent).toBe(scene);
    expect(second.parent).toBe(scene);
    expect(mesh.position.toArray()).toEqual(firstBaseline);
    expect(second.position.toArray()).toEqual(secondBaseline);
    gizmo.dispose();
  });

  it('commits a multi-body preview only when explicitly requested', () => {
    const { scene, mesh, instance, gizmo, controls } = setup();
    const second = new THREE.Object3D();
    second.position.set(-2, 4, 1);
    scene.add(second);
    const onCommit = vi.fn((_instanceId: string, _transform: number[]) => true);
    gizmo.showEditor({ instance, mesh, meshes: [mesh, second], onCommit });
    const previewRoot = controls.object!;

    controls.dispatch('dragging-changed', { value: true });
    previewRoot.position.set(2, 0, 0);
    previewRoot.updateMatrixWorld(true);
    controls.dispatch('change');
    controls.dispatch('dragging-changed', { value: false });
    expect(onCommit).not.toHaveBeenCalled();

    expect(gizmo.commitTransform()).toBe(true);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[1].slice(12, 15)).toEqual([2, 0, 0]);
    gizmo.hide();

    expect(mesh.parent).toBe(scene);
    expect(second.parent).toBe(scene);
    expect(mesh.position.toArray()).toEqual([3, 2, 3]);
    expect(second.position.toArray()).toEqual([0, 4, 1]);
    gizmo.dispose();
  });

  it('uses the current active camera after projection replacement', () => {
    const domElement = document.createElement('div');
    const scene = new THREE.Scene();
    const perspective = new THREE.PerspectiveCamera();
    const orthographic = new THREE.OrthographicCamera();
    const source: { camera: THREE.Camera } = { camera: perspective };
    const gizmo = new InstanceTransformGizmo();
    gizmo.attach(scene, source, domElement);
    const controls = controlMocks.instances[0] as ControlsHarness;

    expect(controls.camera).toBe(perspective);
    source.camera = orthographic;
    eventBus.emit('camera:projection', { type: 'orthographic' });
    expect(controls.camera).toBe(orthographic);

    gizmo.dispose();
  });
});
