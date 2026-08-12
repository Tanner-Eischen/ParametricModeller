import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import { EdgeSelectionOverlay } from '../../src/ui/EdgeSelectionOverlay';

describe('EdgeSelectionOverlay', () => {
  it('keeps hover and selected edge feedback independent', () => {
    const body = createBoxBody({
      width: 2,
      depth: 3,
      height: 4,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'box');
    const edgeIds = [...body.edges.keys()];
    const scene = new THREE.Scene();
    const overlay = new EdgeSelectionOverlay();
    overlay.attachToScene(scene);

    overlay.setHoveredEdge(body, edgeIds[0]!);
    expect(overlay.getHoveredEdge()).toEqual({ bodyId: body.id, edgeId: edgeIds[0] });
    expect(scene.children.filter((child) => child.userData.selectionOverlay === 'edge')).toHaveLength(1);

    overlay.setSelectedEdge(body, edgeIds[1]!);
    expect(overlay.getSelectedEdge()).toEqual({ bodyId: body.id, edgeId: edgeIds[1] });
    expect(scene.children.filter((child) => child.userData.selectionOverlay === 'edge')).toHaveLength(2);

    overlay.clearHover();
    expect(overlay.getHoveredEdge()).toBeNull();
    expect(overlay.getSelectedEdge()).not.toBeNull();
    expect(scene.children.filter((child) => child.userData.selectionOverlay === 'edge')).toHaveLength(1);

    overlay.dispose();
    expect(scene.children.filter((child) => child.userData.selectionOverlay === 'edge')).toHaveLength(0);
  });

  it('ignores an edge that does not exist', () => {
    const body = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'box');
    const scene = new THREE.Scene();
    const overlay = new EdgeSelectionOverlay();
    overlay.attachToScene(scene);

    overlay.setHoveredEdge(body, 'missing');
    overlay.setSelectedEdge(body, 'missing');

    expect(overlay.getHoveredEdge()).toBeNull();
    expect(overlay.getSelectedEdge()).toBeNull();
    expect(scene.children).toHaveLength(0);
    overlay.dispose();
  });
});
