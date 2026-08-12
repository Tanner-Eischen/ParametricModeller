// @vitest-environment jsdom

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../src/core';
import type { CameraControls } from '../../src/rendering/CameraControls';
import { BodyRotateGizmo } from '../../src/ui/BodyRotateGizmo';
import { MoveVertexGizmo } from '../../src/ui/MoveVertexGizmo';

const controlMocks = vi.hoisted(() => ({ instances: [] as MockTransformControls[] }));

interface MockTransformControls {
  camera: THREE.Camera;
  object: THREE.Object3D | null;
  dispatch(type: string, event?: { value?: boolean }): void;
}

vi.mock('three/addons/controls/TransformControls.js', async () => {
  const THREE = await vi.importActual<typeof import('three')>('three');
  class TransformControlsMock {
    camera: THREE.Camera;
    object: THREE.Object3D | null = null;
    showX = true;
    showY = true;
    showZ = true;
    private readonly helper = new THREE.Object3D();
    private readonly listeners = new Map<string, Array<(event: { value?: boolean }) => void>>();

    constructor(camera: THREE.Camera) {
      this.camera = camera;
      controlMocks.instances.push(this);
    }

    getHelper() { return this.helper; }
    setMode() {}
    setSpace() {}
    setSize() {}
    setRotationSnap() {}
    setTranslationSnap() {}
    dispose() {}
    attach(object: THREE.Object3D) { this.object = object; }
    detach() { this.object = null; }
    addEventListener(type: string, listener: (event: { value?: boolean }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    dispatch(type: string, event: { value?: boolean } = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }
  return { TransformControls: TransformControlsMock };
});

function cameraHarness() {
  const perspective = new THREE.PerspectiveCamera();
  const orthographic = new THREE.OrthographicCamera();
  const controls = {
    camera: perspective as THREE.Camera,
    orbitControls: { enabled: true },
  } as unknown as CameraControls;
  return { perspective, orthographic, controls };
}

describe('direct transform gizmo view-only previews', () => {
  afterEach(() => {
    controlMocks.instances.length = 0;
  });

  it('rotates a rendered object during drag and restores it on cancel', () => {
    const scene = new THREE.Scene();
    const { controls } = cameraHarness();
    const target = new THREE.Object3D();
    target.position.set(2, 0, 0);
    scene.add(target);
    const preview = vi.fn(() => true);
    const gizmo = new BodyRotateGizmo({ snapEnabled: false });
    gizmo.attach(scene, controls, document.createElement('div'));
    gizmo.showEditor({
      featureId: 'rotate-1', bodyId: 'body-1', pivot: [0, 0, 0],
      rotationDegrees: [0, 0, 0], objects: [target], onPreview: preview,
    });
    const transform = controlMocks.instances[0]!;
    transform.dispatch('dragging-changed', { value: true });
    transform.object!.rotation.z = Math.PI / 2;
    transform.dispatch('change');

    expect(preview).toHaveBeenCalledOnce();
    expect(target.position.x).toBeCloseTo(0, 6);
    expect(target.position.y).toBeCloseTo(2, 6);
    gizmo.hide();
    expect(target.position.toArray()).toEqual([2, 0, 0]);
    gizmo.dispose();
  });

  it('deforms only matching render vertices and restores the same buffers on cancel', () => {
    const scene = new THREE.Scene();
    const { controls } = cameraHarness();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 0, 0,
    ], 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);
    const gizmo = new MoveVertexGizmo({ snapEnabled: false });
    gizmo.attach(scene, controls, document.createElement('div'));
    gizmo.showEditor({
      featureId: 'move-1',
      vertexRef: { featureId: 'box-1', bodyId: 'body-1', vertexId: 'vertex-1' },
      basePosition: [0, 0, 0], translation: [0, 0, 0], object: group,
      onPreview: () => true,
    });
    const transform = controlMocks.instances[0]!;
    transform.dispatch('dragging-changed', { value: true });
    transform.object!.position.set(0, 0, 2);
    transform.dispatch('change');
    const positions = geometry.getAttribute('position');

    expect([positions.getZ(0), positions.getZ(1), positions.getZ(2)]).toEqual([2, 0, 2]);
    gizmo.hide();
    expect([positions.getZ(0), positions.getZ(1), positions.getZ(2)]).toEqual([0, 0, 0]);
    gizmo.dispose();
  });

  it('rebinds both TransformControls gizmos to the active projection camera', () => {
    const scene = new THREE.Scene();
    const { perspective, orthographic, controls } = cameraHarness();
    const rotate = new BodyRotateGizmo();
    const vertex = new MoveVertexGizmo();
    const dom = document.createElement('div');
    rotate.attach(scene, controls, dom);
    vertex.attach(scene, controls, dom);

    expect(controlMocks.instances.map((item) => item.camera)).toEqual([perspective, perspective]);
    (controls as unknown as { camera: THREE.Camera }).camera = orthographic;
    eventBus.emit('camera:projection', { type: 'orthographic' });
    expect(controlMocks.instances.map((item) => item.camera)).toEqual([orthographic, orthographic]);

    rotate.dispose();
    vertex.dispose();
  });
});
