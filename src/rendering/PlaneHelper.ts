import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import type { ConstructionPlane } from '../geometry';

const log = createModuleLogger('PlaneHelper');

export interface PlaneHelperOptions {
  /** Size of the plane quad (width x height) */
  size?: number;
  /** Color of the translucent plane surface */
  planeColor?: number;
  /** Opacity of the plane surface (0-1) */
  opacity?: number;
  /** Length of the normal arrow */
  arrowLength?: number;
  /** Color of the normal arrow */
  arrowColor?: number;
  /** Color of the border lines */
  borderColor?: number;
}

const DEFAULT_OPTIONS: Required<PlaneHelperOptions> = {
  size: 5,
  planeColor: 0x4a9eff,
  opacity: 0.3,
  arrowLength: 1,
  arrowColor: 0x0066ff,
  borderColor: 0x66aaff,
};

/**
 * Visual helper for sketch planes.
 * Renders a translucent quad with normal arrow and wireframe border.
 */
export class PlaneHelper {
  group: THREE.Group;
  private planeMesh: THREE.Mesh;
  private normalArrow: THREE.ArrowHelper;
  private borderLines: THREE.LineSegments;
  private options: Required<PlaneHelperOptions>;
  private planeMaterial: THREE.MeshStandardMaterial;
  private lineMaterial: THREE.LineBasicMaterial;

  constructor(options: PlaneHelperOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.group = new THREE.Group();
    this.group.visible = false; // Hidden by default

    // Create plane geometry (1x1 centered quad)
    const planeGeometry = new THREE.PlaneGeometry(this.options.size, this.options.size);

    // Create translucent material
    this.planeMaterial = new THREE.MeshStandardMaterial({
      color: this.options.planeColor,
      opacity: this.options.opacity,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.planeMesh = new THREE.Mesh(planeGeometry, this.planeMaterial);
    this.planeMesh.userData.isPlaneHelper = true;

    // Create border lines
    const borderGeometry = new THREE.EdgesGeometry(planeGeometry);
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: this.options.borderColor,
      linewidth: 2,
    });
    this.borderLines = new THREE.LineSegments(borderGeometry, this.lineMaterial);

    // Create normal arrow
    const normalDir = new THREE.Vector3(0, 0, 1);
    const origin = new THREE.Vector3(0, 0, 0);
    this.normalArrow = new THREE.ArrowHelper(
      normalDir,
      origin,
      this.options.arrowLength,
      this.options.arrowColor,
      this.options.arrowLength * 0.3,
      this.options.arrowLength * 0.15
    );

    // Add all to group
    this.group.add(this.planeMesh);
    this.group.add(this.borderLines);
    this.group.add(this.normalArrow);

    log.debug('PlaneHelper created', this.options);
  }

  /**
   * Update the plane position and orientation from a ConstructionPlane.
   */
  update(plane: ConstructionPlane): void {
    // Set position
    this.group.position.set(...plane.origin);

    // Build rotation matrix from basis vectors
    const uAxis = new THREE.Vector3(...plane.uAxis);
    const vAxis = new THREE.Vector3(...plane.vAxis);
    const normal = new THREE.Vector3(...plane.normal);

    // Create rotation matrix (columns are basis vectors)
    const rotationMatrix = new THREE.Matrix4();
    rotationMatrix.makeBasis(uAxis, vAxis, normal);

    // Extract quaternion from matrix
    const quaternion = new THREE.Quaternion();
    quaternion.setFromRotationMatrix(rotationMatrix);
    this.group.quaternion.copy(quaternion);

    log.debug('PlaneHelper updated', {
      origin: plane.origin,
      normal: plane.normal,
    });
  }

  /**
   * Show or hide the plane helper.
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
    log.debug('PlaneHelper visibility', { visible });
  }

  /**
   * Check if the plane helper is visible.
   */
  isVisible(): boolean {
    return this.group.visible;
  }

  /**
   * Set the plane color.
   */
  setColor(color: number): void {
    this.planeMaterial.color.setHex(color);
    this.lineMaterial.color.setHex(color);
  }

  /**
   * Set the plane opacity.
   */
  setOpacity(opacity: number): void {
    this.planeMaterial.opacity = opacity;
  }

  /**
   * Set the plane size (recreates geometry).
   */
  setSize(size: number): void {
    this.options.size = size;

    // Recreate plane geometry
    const planeGeometry = new THREE.PlaneGeometry(size, size);
    this.planeMesh.geometry.dispose();
    this.planeMesh.geometry = planeGeometry;

    // Recreate border geometry
    const borderGeometry = new THREE.EdgesGeometry(planeGeometry);
    this.borderLines.geometry.dispose();
    this.borderLines.geometry = borderGeometry;

    log.debug('PlaneHelper size updated', { size });
  }

  /**
   * Get the current options.
   */
  getOptions(): Required<PlaneHelperOptions> {
    return { ...this.options };
  }

  /**
   * Dispose of all geometries and materials.
   */
  dispose(): void {
    this.planeMesh.geometry.dispose();
    this.planeMaterial.dispose();
    this.borderLines.geometry.dispose();
    this.lineMaterial.dispose();

    // ArrowHelper doesn't have a dispose method, so we clean up manually
    if (this.normalArrow.line) {
      this.normalArrow.line.geometry.dispose();
      if (this.normalArrow.line.material instanceof THREE.Material) {
        this.normalArrow.line.material.dispose();
      }
    }
    if (this.normalArrow.cone) {
      this.normalArrow.cone.geometry.dispose();
      if (this.normalArrow.cone.material instanceof THREE.Material) {
        this.normalArrow.cone.material.dispose();
      }
    }

    log.debug('PlaneHelper disposed');
  }
}
