/**
 * @vitest-environment jsdom
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../src/core';
import { PushPullGizmo, type PushPullGizmoOptions } from '../../src/ui/PushPullGizmo';

const faceRef = {
  featureId: 'box-feature',
  bodyId: 'box-body',
  faceId: 'box-face',
};

function createGizmo(options?: PushPullGizmoOptions): { gizmo: PushPullGizmo; element: HTMLDivElement } {
  const element = document.createElement('div');
  document.body.appendChild(element);
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  const gizmo = new PushPullGizmo(options);
  gizmo.attach(new THREE.Scene(), new THREE.PerspectiveCamera(), element);
  gizmo.show(faceRef, [0, 0, 0], [0, 0, 1]);
  return { gizmo, element };
}

describe('PushPullGizmo tool-session contract', () => {
  afterEach(() => {
    eventBus.clear();
    document.body.innerHTML = '';
  });

  it('keeps a pointer-release preview active until an explicit commit', () => {
    const onCommit = vi.fn();
    eventBus.on('pushpull:commit', onCommit);
    const { gizmo, element } = createGizmo();
    gizmo.updateDelta(2);
    gizmo.startDrag();

    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(gizmo.isActive()).toBe(true);
    expect(gizmo.getCurrentDelta()).toBe(2);

    expect(gizmo.commit()).toBe(true);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(gizmo.isActive()).toBe(false);
    expect(gizmo.commit()).toBe(false);
    expect(onCommit).toHaveBeenCalledOnce();
    gizmo.dispose();
  });

  it('rejects commit without a non-zero preview and remains cancelable', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    eventBus.on('pushpull:commit', onCommit);
    eventBus.on('pushpull:cancel', onCancel);
    const { gizmo } = createGizmo();

    expect(gizmo.commit()).toBe(false);
    expect(gizmo.isActive()).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();

    gizmo.cancel();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(gizmo.isActive()).toBe(false);
    gizmo.dispose();
  });

  it('commits a negative signed distance', () => {
    const apply = vi.fn(() => true);
    const { gizmo } = createGizmo();
    gizmo.updateDelta(-0.5);

    expect(gizmo.commit(apply)).toBe(true);
    expect(apply).toHaveBeenCalledWith(faceRef, -0.5);
    expect(gizmo.isActive()).toBe(false);
    gizmo.dispose();
  });

  it('ignores non-finite distance samples', () => {
    const { gizmo } = createGizmo();
    gizmo.updateDelta(0.5);
    gizmo.updateDelta(Number.POSITIVE_INFINITY);

    expect(gizmo.getCurrentDelta()).toBe(0.5);
    gizmo.dispose();
  });

  it('keeps typed distances exact while snapping pointer previews', () => {
    const { gizmo } = createGizmo();

    gizmo.updateDelta(0.1);
    expect(gizmo.getCurrentDelta()).toBe(0.125);
    gizmo.updateDelta(0.1, false);
    expect(gizmo.getCurrentDelta()).toBe(0.1);
    gizmo.dispose();
  });

  it('keeps the preview active when the atomic application callback rejects', () => {
    const onCommitEvent = vi.fn();
    const apply = vi.fn(() => false);
    eventBus.on('pushpull:commit', onCommitEvent);
    const { gizmo } = createGizmo();
    gizmo.updateDelta(3);

    expect(gizmo.commit(apply)).toBe(false);

    expect(apply).toHaveBeenCalledWith(faceRef, 3);
    expect(onCommitEvent).not.toHaveBeenCalled();
    expect(gizmo.isActive()).toBe(true);
    expect(gizmo.getCurrentDelta()).toBe(3);
    gizmo.dispose();
  });

  it('resolves the current active camera for every drag sample', () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    });
    const perspective = new THREE.PerspectiveCamera();
    const orthographic = new THREE.OrthographicCamera();
    const source: { camera: THREE.Camera } = { camera: perspective };
    const setFromCamera = vi.spyOn(THREE.Raycaster.prototype, 'setFromCamera')
      .mockImplementation(function (this: THREE.Raycaster) { return this; });
    const gizmo = new PushPullGizmo();
    gizmo.attach(new THREE.Scene(), source, element);
    gizmo.show(faceRef, [0, 0, 0], [0, 0, 1]);
    gizmo.startDrag();

    source.camera = orthographic;
    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 300 }));
    expect(setFromCamera).toHaveBeenLastCalledWith(expect.any(THREE.Vector2), orthographic);

    setFromCamera.mockRestore();
    gizmo.dispose();
  });

  it('derives positive and negative signed distances from actual pointer movement', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    Object.defineProperty(element, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const gizmo = new PushPullGizmo();
    gizmo.attach(new THREE.Scene(), camera, element);
    gizmo.show(faceRef, [0, 0, 0], [1, 0, 0]);
    gizmo.startDrag();

    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 480, clientY: 300 }));
    expect(gizmo.getCurrentDelta()).toBeGreaterThan(0);

    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 320, clientY: 300 }));
    expect(gizmo.getCurrentDelta()).toBeLessThan(0);
    gizmo.dispose();
  });

  it('acquires pointer ownership on the handle before viewport navigation observes the press', () => {
    let orbitEnabled = true;
    const onDraggingChange = vi.fn((dragging: boolean) => {
      orbitEnabled = !dragging;
    });
    const { gizmo, element } = createGizmo({ onDraggingChange });
    const intersectObject = vi.spyOn(THREE.Raycaster.prototype, 'intersectObject')
      .mockReturnValue([{ object: new THREE.Object3D() } as THREE.Intersection]);
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    element.setPointerCapture = setPointerCapture;
    element.releasePointerCapture = releasePointerCapture;
    const navigationObservedEnabled = vi.fn(() => orbitEnabled);
    element.addEventListener('pointerdown', navigationObservedEnabled);

    element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 7,
      clientX: 400,
      clientY: 300,
    }));

    expect(gizmo.ownsPointer(7)).toBe(true);
    expect(onDraggingChange).toHaveBeenCalledWith(true);
    expect(navigationObservedEnabled).toHaveReturnedWith(false);
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    element.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 7,
    }));

    expect(gizmo.ownsPointer(7)).toBe(false);
    expect(onDraggingChange).toHaveBeenLastCalledWith(false);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    intersectObject.mockRestore();
    gizmo.dispose();
  });

  it('leaves non-handle pointer sequences available for navigation and face selection', () => {
    const onDraggingChange = vi.fn();
    const { gizmo, element } = createGizmo({ onDraggingChange });
    const intersectObject = vi.spyOn(THREE.Raycaster.prototype, 'intersectObject')
      .mockReturnValue([]);
    const viewportPointerDown = vi.fn();
    const viewportPointerUp = vi.fn();
    element.addEventListener('pointerdown', viewportPointerDown);
    element.addEventListener('pointerup', viewportPointerUp);

    element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 11,
      clientX: 50,
      clientY: 50,
    }));
    element.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 11,
      clientX: 50,
      clientY: 50,
    }));

    expect(gizmo.ownsPointer(11)).toBe(false);
    expect(onDraggingChange).not.toHaveBeenCalled();
    expect(viewportPointerDown).toHaveBeenCalledOnce();
    expect(viewportPointerUp).toHaveBeenCalledOnce();
    intersectObject.mockRestore();
    gizmo.dispose();
  });

  it('releases camera and pointer ownership when Escape cancels an active drag', () => {
    const onDraggingChange = vi.fn();
    const { gizmo, element } = createGizmo({ onDraggingChange });
    const intersectObject = vi.spyOn(THREE.Raycaster.prototype, 'intersectObject')
      .mockReturnValue([{ object: new THREE.Object3D() } as THREE.Intersection]);
    const releasePointerCapture = vi.fn();
    element.setPointerCapture = vi.fn();
    element.releasePointerCapture = releasePointerCapture;

    element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 13,
      clientX: 400,
      clientY: 300,
    }));
    expect(gizmo.ownsPointer(13)).toBe(true);

    gizmo.cancel();

    expect(gizmo.isActive()).toBe(false);
    expect(gizmo.ownsPointer(13)).toBe(false);
    expect(onDraggingChange.mock.calls.map(([dragging]) => dragging)).toEqual([true, false]);
    expect(releasePointerCapture).toHaveBeenCalledWith(13);
    intersectObject.mockRestore();
    gizmo.dispose();
  });
});
