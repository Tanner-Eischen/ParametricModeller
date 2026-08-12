import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GrainDirectionOverlay } from '../../src/rendering/GrainDirectionOverlay';

describe('GrainDirectionOverlay', () => {
  it('renders valid entries in stable body order', () => {
    const overlay = new GrainDirectionOverlay();
    overlay.update([
      { bodyId: 'b', center: [2, 3, 4], direction: [0, 1, 0], length: 8 },
      { bodyId: 'a', center: [0, 0, 0], direction: [1, 0, 0], length: 4 },
    ]);

    expect(overlay.group.children.map((child) => child.userData.bodyId)).toEqual(['a', 'b']);
    expect(overlay.group.children[1]?.position.toArray()).toEqual([2, 3, 4]);
  });

  it('ignores hidden, zero-axis, and invalid-length entries', () => {
    const overlay = new GrainDirectionOverlay();
    overlay.update([
      { bodyId: 'hidden', center: [0, 0, 0], direction: [1, 0, 0], length: 3, visible: false },
      { bodyId: 'zero', center: [0, 0, 0], direction: [0, 0, 0], length: 3 },
      { bodyId: 'invalid', center: [0, 0, 0], direction: [1, 0, 0], length: 0 },
    ]);
    expect(overlay.group.children).toHaveLength(0);
  });

  it('attaches and disposes cleanly', () => {
    const scene = new THREE.Scene();
    const overlay = new GrainDirectionOverlay();
    overlay.attachTo(scene);
    expect(overlay.group.parent).toBe(scene);
    overlay.dispose();
    expect(overlay.group.parent).toBeNull();
  });
});
