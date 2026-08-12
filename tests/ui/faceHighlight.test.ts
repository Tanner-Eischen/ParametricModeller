import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { eventBus } from '../../src/core';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import { FaceHighlight } from '../../src/ui/FaceHighlight';

const createBody = () => createBoxBody({
  width: 2,
  depth: 3,
  height: 4,
  anchorMode: 'corner',
  origin: [0, 0, 0],
}, 'body-1');

const faceOverlays = (scene: THREE.Scene) => scene.children.filter(
  (child) => child.userData.faceOverlayRole === 'hover' ||
    child.userData.faceOverlayRole === 'selection'
);

describe('FaceHighlight face-mode overlays', () => {
  const disposables: FaceHighlight[] = [];

  afterEach(() => {
    for (const highlight of disposables) highlight.dispose();
    disposables.length = 0;
  });

  function setup() {
    const scene = new THREE.Scene();
    const highlight = new FaceHighlight();
    highlight.attachToScene(scene);
    disposables.push(highlight);
    return { body: createBody(), highlight, scene };
  }

  it('shows the face under the pointer and clears it when the pointer moves away', () => {
    const { body, highlight, scene } = setup();

    highlight.setHoveredFace(body, '+X');
    expect(highlight.getHoveredFace()).toEqual({ bodyId: body.id, faceId: '+X' });
    expect(faceOverlays(scene).map((overlay) => overlay.userData.faceOverlayRole)).toEqual(['hover']);
    const hoverOverlay = faceOverlays(scene)[0] as THREE.Group;
    expect(hoverOverlay.children.some((child) => child.userData.faceOverlayPart === 'fill')).toBe(true);
    expect(hoverOverlay.children.some((child) => child.userData.faceOverlayPart === 'outline')).toBe(true);

    highlight.clearHover();
    expect(highlight.getHoveredFace()).toBeNull();
    expect(faceOverlays(scene)).toHaveLength(0);
  });

  it('keeps a clicked face selected after hover moves away', () => {
    const { body, highlight, scene } = setup();

    highlight.setHoveredFace(body, '+X');
    highlight.setSelectedFace(body, '+X');
    highlight.setHoveredFace(body, '+Y');
    expect(highlight.getSelectedFace()).toEqual({ bodyId: body.id, faceId: '+X' });
    expect(highlight.getHoveredFace()).toEqual({ bodyId: body.id, faceId: '+Y' });
    expect(faceOverlays(scene).map((overlay) => overlay.userData.faceOverlayRole).sort()).toEqual([
      'hover',
      'selection',
    ]);

    highlight.clearHover();
    expect(highlight.getSelectedFace()).toEqual({ bodyId: body.id, faceId: '+X' });
    expect(faceOverlays(scene).map((overlay) => overlay.userData.faceOverlayRole)).toEqual([
      'selection',
    ]);
  });

  it('clears hover and selection overlays together when face mode exits', () => {
    const { body, highlight, scene } = setup();

    highlight.setSelectedFace(body, '+X');
    highlight.setHoveredFace(body, '+Y');
    highlight.clearHighlight();

    expect(highlight.getHoveredFace()).toBeNull();
    expect(highlight.getSelectedFace()).toBeNull();
    expect(faceOverlays(scene)).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });

  it('does not emit semantic selection events from visual-only updates', () => {
    const { body, highlight } = setup();
    const selected = vi.fn();
    const deselected = vi.fn();
    eventBus.on('face:selected', selected);
    eventBus.on('face:deselected', deselected);

    try {
      highlight.setHoveredFace(body, '+X');
      highlight.setSelectedFace(body, '+X');
      highlight.clearHighlight();

      expect(selected).not.toHaveBeenCalled();
      expect(deselected).not.toHaveBeenCalled();
    } finally {
      eventBus.off('face:selected', selected);
      eventBus.off('face:deselected', deselected);
    }
  });
});
