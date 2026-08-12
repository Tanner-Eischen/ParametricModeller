/**
 * Face highlight and selection visualization.
 * Milestone 03: Push/Pull as a Feature
 */

import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import type { Face, Plane, Body } from '../geometry';
import { createBufferGeometry, getOrderedLoopVertices, triangulateFace } from '../geometry/Triangulator';

const log = createModuleLogger('FaceHighlight');

/**
 * Options for FaceHighlight.
 */
export interface FaceHighlightOptions {
  /** Persistent selection color */
  highlightColor?: number;
  /** Transient hover/preselection color */
  hoverColor?: number;
  /** Normal indicator color */
  normalColor?: number;
  /** Normal indicator length */
  normalLength?: number;
}

/**
 * Default options.
 */
const defaultOptions: Required<FaceHighlightOptions> = {
  highlightColor: 0xffd700, // Gold
  hoverColor: 0x67c7ff, // Light blue
  normalColor: 0x00ff00, // Green
  normalLength: 1,
};

/**
 * Manages face selection highlighting in the viewport.
 */
export class FaceHighlight {
  private scene: THREE.Scene | null = null;
  private hoverOverlay: THREE.Group | null = null;
  private selectionOverlay: THREE.Group | null = null;
  private normalArrow: THREE.ArrowHelper | null = null;
  private options: Required<FaceHighlightOptions>;

  private hoveredFace: {
    bodyId: string;
    faceId: string;
  } | null = null;

  private selectedFace: {
    bodyId: string;
    faceId: string;
  } | null = null;

  constructor(options?: FaceHighlightOptions) {
    this.options = { ...defaultOptions, ...options };
  }

  /**
   * Initialize with a Three.js scene.
   */
  attachToScene(scene: THREE.Scene): void {
    this.scene = scene;
    log.debug('Attached to scene');
  }

  /** Set the transient face preselection shown under the pointer. */
  setHoveredFace(body: Body, faceId: string): void {
    if (!this.scene) {
      log.warn('Cannot highlight face - no scene attached');
      return;
    }
    if (this.hoveredFace?.bodyId === body.id && this.hoveredFace.faceId === faceId) return;

    this.clearHover();

    const face = body.faces.get(faceId);
    if (!face) {
      log.warn('Face not found', { faceId });
      return;
    }

    this.hoveredFace = {
      bodyId: body.id,
      faceId,
    };
    if (!this.isFaceSelected(body.id, faceId)) {
      this.hoverOverlay = this.createFaceOverlay(body, face, faceId, this.options.hoverColor, 'hover');
    }
  }

  /** Set the persistent face selection. */
  setSelectedFace(body: Body, faceId: string): void {
    if (!this.scene) {
      log.warn('Cannot highlight face - no scene attached');
      return;
    }
    if (this.selectedFace?.bodyId === body.id && this.selectedFace.faceId === faceId) return;

    this.clearSelection();

    const face = body.faces.get(faceId);
    if (!face) {
      log.warn('Face not found', { faceId });
      return;
    }

    const plane = body.planes.get(face.planeId);
    if (!plane) {
      log.warn('Plane not found for face', { faceId, planeId: face.planeId });
      return;
    }

    // Avoid drawing two outlines when the clicked face is still under the pointer.
    if (this.hoveredFace?.bodyId === body.id && this.hoveredFace.faceId === faceId) {
      this.removeOverlay(this.hoverOverlay);
      this.hoverOverlay = null;
    }

    this.selectionOverlay = this.createFaceOverlay(
      body,
      face,
      faceId,
      this.options.highlightColor,
      'selection'
    );
    this.createNormalIndicator(face, plane);
    this.selectedFace = { bodyId: body.id, faceId };

    log.debug('Selected face highlight', { bodyId: body.id, faceId });
  }

  /** Backward-compatible alias used by push/pull. */
  setHighlightedFace(body: Body, faceId: string): void {
    this.setSelectedFace(body, faceId);
  }

  /** Clear only transient pointer hover, preserving the clicked selection. */
  clearHover(): void {
    this.removeOverlay(this.hoverOverlay);
    this.hoverOverlay = null;
    this.hoveredFace = null;
  }

  /** Clear only the persistent clicked selection. */
  clearSelection(): void {
    this.removeOverlay(this.selectionOverlay);
    this.selectionOverlay = null;

    if (this.normalArrow && this.scene) {
      this.scene.remove(this.normalArrow);
      this.normalArrow = null;
    }
    this.selectedFace = null;
  }

  /** Clear all face overlays when face mode ends. */
  clearHighlight(): void {
    this.clearHover();
    this.clearSelection();
  }

  /**
   * Show a normal direction indicator.
   */
  showNormalIndicator(face: Face, plane: Plane): void {
    if (!this.scene) return;

    // Remove existing arrow
    if (this.normalArrow) {
      this.scene.remove(this.normalArrow);
    }

    // Calculate face center
    const center = this.calculateFaceCenter(face, plane);

    // Create arrow helper
    const dir = new THREE.Vector3(...plane.normal).normalize();
    const origin = new THREE.Vector3(...center);
    const length = this.options.normalLength;
    const color = this.options.normalColor;

    this.normalArrow = new THREE.ArrowHelper(dir, origin, length, color);
    this.scene.add(this.normalArrow);
  }

  /**
   * Get the currently highlighted face info.
   */
  getHighlightedFace(): { bodyId: string; faceId: string } | null {
    return this.selectedFace;
  }

  getHoveredFace(): { bodyId: string; faceId: string } | null {
    return this.hoveredFace;
  }

  getSelectedFace(): { bodyId: string; faceId: string } | null {
    return this.selectedFace;
  }

  /**
   * Check if a face is currently highlighted.
   */
  isFaceHighlighted(bodyId: string, faceId: string): boolean {
    return this.isFaceSelected(bodyId, faceId);
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.clearHighlight();
    this.scene = null;
    log.debug('Disposed');
  }

  /**
   * Create a wireframe outline of the face.
   */
  private createFaceOverlay(
    body: Body,
    face: Face,
    faceId: string,
    color: number,
    role: 'hover' | 'selection'
  ): THREE.Group | null {
    if (!this.scene) return null;

    const triangulation = triangulateFace(body, face, faceId);
    const boundary = getOrderedLoopVertices(body, face.boundaryEdgeIds);
    if (!triangulation || boundary.length < 3) return null;

    const group = new THREE.Group();
    group.userData.faceOverlayRole = role;
    group.userData.bodyId = body.id;
    group.userData.faceId = faceId;
    group.renderOrder = 1000;

    const fill = new THREE.Mesh(
      createBufferGeometry(triangulation),
      new THREE.MeshBasicMaterial({
        color,
        opacity: role === 'selection' ? 0.34 : 0.2,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    fill.renderOrder = 1000;
    fill.userData.faceOverlayPart = 'fill';
    group.add(fill);

    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        boundary.map((vertex) => new THREE.Vector3(...vertex.position)),
      ),
      new THREE.LineBasicMaterial({
      color,
      linewidth: 2,
      depthTest: false,
      toneMapped: false,
      }),
    );
    outline.renderOrder = 1000;
    outline.userData.faceOverlayPart = 'outline';
    group.add(outline);

    this.scene.add(group);
    return group;
  }

  /**
   * Create a normal direction indicator.
   */
  private createNormalIndicator(face: Face, plane: Plane): void {
    if (!this.scene) return;

    // Calculate face center
    const center = this.calculateFaceCenter(face, plane);

    // Create arrow helper
    const dir = new THREE.Vector3(...plane.normal).normalize();
    const origin = new THREE.Vector3(...center);
    const length = this.options.normalLength;
    const color = this.options.normalColor;

    this.normalArrow = new THREE.ArrowHelper(dir, origin, length, color);
    this.scene.add(this.normalArrow);
  }

  /**
   * Calculate the center point of a face.
   */
  private calculateFaceCenter(_face: Face, plane: Plane): [number, number, number] {
    // For a planar face, we return the plane origin as an approximation
    // A more accurate implementation would calculate the centroid from body vertices
    return plane.origin;
  }

  private isFaceSelected(bodyId: string, faceId: string): boolean {
    return this.selectedFace?.bodyId === bodyId && this.selectedFace.faceId === faceId;
  }

  private removeOverlay(overlay: THREE.Group | null): void {
    if (!overlay) return;
    this.scene?.remove(overlay);
    overlay.traverse((child) => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.LineLoop)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    });
  }
}

/**
 * Create a FaceHighlight instance.
 */
export function createFaceHighlight(options?: FaceHighlightOptions): FaceHighlight {
  return new FaceHighlight(options);
}
