/**
 * Face highlight and selection visualization.
 * Milestone 03: Push/Pull as a Feature
 */

import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { Face, Plane, Body } from '../geometry';

const log = createModuleLogger('FaceHighlight');

/**
 * Options for FaceHighlight.
 */
export interface FaceHighlightOptions {
  /** Highlight color */
  highlightColor?: number;
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
  normalColor: 0x00ff00, // Green
  normalLength: 1,
};

/**
 * Manages face selection highlighting in the viewport.
 */
export class FaceHighlight {
  private scene: THREE.Scene | null = null;
  private highlightMesh: THREE.LineSegments | null = null;
  private normalArrow: THREE.ArrowHelper | null = null;
  private options: Required<FaceHighlightOptions>;

  /** Currently highlighted face info */
  private currentHighlight: {
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

  /**
   * Set the highlighted face.
   */
  setHighlightedFace(body: Body, faceId: string): void {
    if (!this.scene) {
      log.warn('Cannot highlight face - no scene attached');
      return;
    }

    // Clear existing highlight
    this.clearHighlight();

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

    // Create highlight outline
    this.createHighlightOutline(body, face);

    // Create normal indicator
    this.createNormalIndicator(face, plane);

    // Store current highlight
    this.currentHighlight = {
      bodyId: body.id,
      faceId,
    };

    // Emit selection event
    eventBus.emit('face:selected', {
      bodyId: body.id,
      faceId,
    });

    log.debug('Highlighted face', { bodyId: body.id, faceId });
  }

  /**
   * Clear the current highlight.
   */
  clearHighlight(): void {
    if (this.highlightMesh && this.scene) {
      this.scene.remove(this.highlightMesh);
      this.highlightMesh.geometry.dispose();
      (this.highlightMesh.material as THREE.Material).dispose();
      this.highlightMesh = null;
    }

    if (this.normalArrow && this.scene) {
      this.scene.remove(this.normalArrow);
      this.normalArrow = null;
    }

    if (this.currentHighlight) {
      eventBus.emit('face:deselected', {
        bodyId: this.currentHighlight.bodyId,
        faceId: this.currentHighlight.faceId,
      });
    }

    this.currentHighlight = null;
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
    return this.currentHighlight;
  }

  /**
   * Check if a face is currently highlighted.
   */
  isFaceHighlighted(bodyId: string, faceId: string): boolean {
    return (
      this.currentHighlight?.bodyId === bodyId &&
      this.currentHighlight?.faceId === faceId
    );
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
  private createHighlightOutline(body: Body, face: Face): void {
    if (!this.scene) return;

    // Get vertex positions for the face boundary
    const positions: THREE.Vector3[] = [];

    for (const edgeId of face.boundaryEdgeIds) {
      const edge = body.edges.get(edgeId);
      if (!edge) continue;

      const v0 = body.vertices.get(edge.vertexIds[0]);
      if (v0) {
        positions.push(new THREE.Vector3(...v0.position));
      }
    }

    if (positions.length === 0) return;

    // Create closed loop
    positions.push(positions[0]!.clone());

    // Create line geometry
    const geometry = new THREE.BufferGeometry().setFromPoints(positions);
    const material = new THREE.LineBasicMaterial({
      color: this.options.highlightColor,
      linewidth: 2,
    });

    this.highlightMesh = new THREE.LineSegments(geometry, material);
    this.scene.add(this.highlightMesh);
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
}

/**
 * Create a FaceHighlight instance.
 */
export function createFaceHighlight(options?: FaceHighlightOptions): FaceHighlight {
  return new FaceHighlight(options);
}
