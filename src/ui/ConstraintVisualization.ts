/**
 * Constraint Visualization - Milestone 06: Assembly-lite
 *
 * Viewport visualization of constraints:
 * - Arrow glyphs showing constraint direction
 * - Dimension lines for offsets
 * - Color: green=satisfied, red=error
 */

import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import type { MateConstraint, ComponentInstance } from '../assembly/AssemblyTypes';
import type { Body } from '../geometry';

const log = createModuleLogger('ConstraintVisualization');

/**
 * Options for ConstraintVisualization.
 */
export interface ConstraintVisualizationOptions {
  arrowLength?: number;
  arrowHeadLength?: number;
  arrowHeadWidth?: number;
}

/**
 * Visualizer for assembly constraints.
 */
export class ConstraintVisualization {
  private scene: THREE.Scene | null = null;
  private group: THREE.Group;
  private constraintGroups: Map<string, THREE.Group> = new Map();

  private arrowLength: number;
  private arrowHeadLength: number;
  private arrowHeadWidth: number;

  // Materials
  private satisfiedMaterial: THREE.LineBasicMaterial;
  private errorMaterial: THREE.LineBasicMaterial;
  private pendingMaterial: THREE.LineBasicMaterial;

  constructor(options: ConstraintVisualizationOptions = {}) {
    this.arrowLength = options.arrowLength ?? 0.5;
    this.arrowHeadLength = options.arrowHeadLength ?? 0.1;
    this.arrowHeadWidth = options.arrowHeadWidth ?? 0.05;

    this.group = new THREE.Group();
    this.group.name = 'constraint-visualization';

    // Create materials
    this.satisfiedMaterial = new THREE.LineBasicMaterial({ color: 0x4caf50 }); // Green
    this.errorMaterial = new THREE.LineBasicMaterial({ color: 0xf44336 }); // Red
    this.pendingMaterial = new THREE.LineBasicMaterial({ color: 0xffc107 }); // Amber

    log.debug('ConstraintVisualization created');
  }

  /**
   * Attach to a scene.
   */
  attachToScene(scene: THREE.Scene): void {
    this.scene = scene;
    scene.add(this.group);
    log.debug('Attached to scene');
  }

  /**
   * Update visualization for a constraint.
   */
  updateConstraint(
    constraint: MateConstraint,
    instanceBodies: Map<string, Body[]>,
    _instances: ComponentInstance[]
  ): void {
    // Remove existing visualization for this constraint
    this.removeConstraint(constraint.id);

    // Get bodies for both references
    const bodiesA = instanceBodies.get(constraint.refA.instanceId);
    const bodiesB = instanceBodies.get(constraint.refB.instanceId);

    if (!bodiesA || !bodiesA.length || !bodiesB || !bodiesB.length) {
      log.debug('Cannot visualize constraint - missing bodies', { constraintId: constraint.id });
      return;
    }

    // Get face positions
    const posA = this.getFacePosition(bodiesA, constraint.refA.faceId);
    const posB = this.getFacePosition(bodiesB, constraint.refB.faceId);

    if (!posA || !posB) {
      log.debug('Cannot visualize constraint - face not found', { constraintId: constraint.id });
      return;
    }

    // Create visualization group
    const vizGroup = new THREE.Group();
    vizGroup.name = `constraint-${constraint.id}`;

    // Choose material based on status
    let material: THREE.LineBasicMaterial;
    if (constraint.suppressed) {
      material = this.pendingMaterial;
    } else if (constraint.satisfied) {
      material = this.satisfiedMaterial;
    } else if (constraint.errorMessage) {
      material = this.errorMaterial;
    } else {
      material = this.pendingMaterial;
    }

    // Create line between faces
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...posA),
      new THREE.Vector3(...posB),
    ]);
    const line = new THREE.Line(lineGeometry, material);
    vizGroup.add(line);

    // Create arrows at each end
    const arrowA = this.createArrow(posA, posB, material);
    const arrowB = this.createArrow(posB, posA, material);
    vizGroup.add(arrowA);
    vizGroup.add(arrowB);

    // For offset constraints, add dimension label
    if (constraint.type === 'offset' && constraint.offset > 0) {
      const label = this.createDimensionLabel(posA, posB, constraint.offset);
      vizGroup.add(label);
    }

    // Add to group
    this.group.add(vizGroup);
    this.constraintGroups.set(constraint.id, vizGroup);

    log.debug('Constraint visualization updated', { constraintId: constraint.id });
  }

  /**
   * Get the center position of a face.
   */
  private getFacePosition(bodies: Body[], faceId: string): [number, number, number] | null {
    for (const body of bodies) {
      const face = body.faces.get(faceId);
      if (face) {
        // Calculate face center from vertices
        const positions: THREE.Vector3[] = [];

        for (const edgeId of face.boundaryEdgeIds) {
          const edge = body.edges.get(edgeId);
          if (!edge) continue;

          for (const vertexId of edge.vertexIds) {
            const vertex = body.vertices.get(vertexId);
            if (vertex) {
              positions.push(new THREE.Vector3(...vertex.position));
            }
          }
        }

        if (positions.length > 0) {
          const center = new THREE.Vector3();
          for (const pos of positions) {
            center.add(pos);
          }
          center.divideScalar(positions.length);
          return [center.x, center.y, center.z];
        }
      }
    }
    return null;
  }

  /**
   * Create an arrow pointing from start to end.
   */
  private createArrow(
    start: [number, number, number],
    end: [number, number, number],
    material: THREE.LineBasicMaterial
  ): THREE.Object3D {
    const dir = new THREE.Vector3(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2]
    ).normalize();

    const arrowHelper = new THREE.ArrowHelper(
      dir,
      new THREE.Vector3(...start),
      this.arrowLength,
      material.color.getHex(),
      this.arrowHeadLength,
      this.arrowHeadWidth
    );

    return arrowHelper;
  }

  /**
   * Create a dimension label for offset constraints.
   */
  private createDimensionLabel(
    posA: [number, number, number],
    posB: [number, number, number],
    offset: number
  ): THREE.Object3D {
    const midPoint = new THREE.Vector3(
      (posA[0] + posB[0]) / 2,
      (posA[1] + posB[1]) / 2,
      (posA[2] + posB[2]) / 2
    );

    // Create a sprite with text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return new THREE.Object3D();

    canvas.width = 128;
    canvas.height = 64;

    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.font = '24px monospace';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(offset.toFixed(2), canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(midPoint);
    sprite.scale.set(0.5, 0.25, 1);

    return sprite;
  }

  /**
   * Remove visualization for a constraint.
   */
  removeConstraint(constraintId: string): void {
    const group = this.constraintGroups.get(constraintId);
    if (group) {
      this.group.remove(group);
      this.constraintGroups.delete(constraintId);
    }
  }

  /**
   * Update all constraints.
   */
  updateAll(
    constraints: MateConstraint[],
    instanceBodies: Map<string, Body[]>,
    instances: ComponentInstance[]
  ): void {
    for (const constraint of constraints) {
      this.updateConstraint(constraint, instanceBodies, instances);
    }
  }

  /**
   * Clear all visualizations.
   */
  clear(): void {
    for (const [id] of this.constraintGroups) {
      this.removeConstraint(id);
    }
    log.debug('All constraint visualizations cleared');
  }

  /**
   * Set visibility.
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Dispose the visualizer.
   */
  dispose(): void {
    this.clear();

    this.satisfiedMaterial.dispose();
    this.errorMaterial.dispose();
    this.pendingMaterial.dispose();

    if (this.scene) {
      this.scene.remove(this.group);
    }

    log.debug('ConstraintVisualization disposed');
  }
}
