import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  VertexSelectionOverlay,
  type VertexSelectionTarget,
} from '../../src/ui/VertexSelectionOverlay';

const targets: VertexSelectionTarget[] = [
  {
    targetId: 'body-a:corner',
    bodyId: 'body-a',
    featureId: 'box-a',
    vertexId: 'corner',
    position: [0, 0, 0],
  },
  {
    targetId: 'body-b:corner',
    bodyId: 'body-b',
    featureId: 'box-b',
    vertexId: 'corner',
    position: [2, 0, 0],
  },
  {
    targetId: 'body-b:top',
    bodyId: 'body-b',
    featureId: 'box-b',
    vertexId: 'top',
    position: [2, 0, 1],
  },
];

describe('VertexSelectionOverlay', () => {
  it('shows every body-qualified target with distinct hover and selected states', () => {
    const scene = new THREE.Scene();
    const overlay = new VertexSelectionOverlay();
    overlay.attachTo(scene);
    overlay.setTargets(targets, 'body-b:corner', 'body-b:top');

    const group = scene.getObjectByName('vertex-selection-overlay')!;
    expect(group.visible).toBe(true);
    expect(group.children).toHaveLength(3);
    const stateFor = (targetId: string): string | undefined =>
      group.children.find((child) => child.userData.targetId === targetId)?.userData.selectionState;
    expect(stateFor('body-a:corner')).toBe('available');
    expect(stateFor('body-b:corner')).toBe('selected');
    expect(stateFor('body-b:top')).toBe('hovered');
    expect(group.children[1]?.scale.x).toBeCloseTo(1.35);
    expect(group.children[2]?.scale.x).toBeCloseTo(1.55);

    overlay.dispose();
  });

  it('removes all markers when cleared or disposed', () => {
    const scene = new THREE.Scene();
    const overlay = new VertexSelectionOverlay();
    overlay.attachTo(scene);
    overlay.setTargets(targets, null, null);
    const group = scene.getObjectByName('vertex-selection-overlay')!;

    overlay.clear();
    expect(group.visible).toBe(false);
    expect(group.children).toHaveLength(0);
    overlay.dispose();
    expect(scene.getObjectByName('vertex-selection-overlay')).toBeUndefined();
  });
});
