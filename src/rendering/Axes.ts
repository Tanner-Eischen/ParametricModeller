import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Axes');

export interface AxesOptions {
  size?: number;
  lineWidth?: number;
  xColor?: number;
  yColor?: number;
  zColor?: number;
}

const DEFAULT_OPTIONS: Required<AxesOptions> = {
  size: 2,
  lineWidth: 2,
  xColor: 0xff0000, // Red for X
  yColor: 0x00ff00, // Green for Y
  zColor: 0x0000ff, // Blue for Z
};

export class Axes {
  group: THREE.Group;
  private axesHelper: THREE.AxesHelper;
  private customAxes: THREE.Group;
  private options: Required<AxesOptions>;

  constructor(options: AxesOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.group = new THREE.Group();

    // Use Three.js AxesHelper for basic implementation
    this.axesHelper = new THREE.AxesHelper(this.options.size);
    this.group.add(this.axesHelper);

    // Create custom axes with labels (more visible)
    this.customAxes = this.createCustomAxes();
    this.group.add(this.customAxes);

    log.debug('Axes created', this.options);
  }

  private createCustomAxes(): THREE.Group {
    const group = new THREE.Group();
    const { size, xColor, yColor, zColor } = this.options;

    // X axis (red)
    const xGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(size, 0, 0),
    ]);
    const xMaterial = new THREE.LineBasicMaterial({ color: xColor, linewidth: 2 });
    const xLine = new THREE.Line(xGeometry, xMaterial);
    group.add(xLine);

    // Y axis (green)
    const yGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, size, 0),
    ]);
    const yMaterial = new THREE.LineBasicMaterial({ color: yColor, linewidth: 2 });
    const yLine = new THREE.Line(yGeometry, yMaterial);
    group.add(yLine);

    // Z axis (blue)
    const zGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, size),
    ]);
    const zMaterial = new THREE.LineBasicMaterial({ color: zColor, linewidth: 2 });
    const zLine = new THREE.Line(zGeometry, zMaterial);
    group.add(zLine);

    // Add arrowheads
    const arrowSize = size * 0.1;
    const arrowRadius = size * 0.02;

    // X arrow
    const xArrowGeom = new THREE.ConeGeometry(arrowRadius, arrowSize, 8);
    const xArrowMat = new THREE.MeshBasicMaterial({ color: xColor });
    const xArrow = new THREE.Mesh(xArrowGeom, xArrowMat);
    xArrow.position.set(size, 0, 0);
    xArrow.rotation.z = -Math.PI / 2;
    group.add(xArrow);

    // Y arrow
    const yArrowGeom = new THREE.ConeGeometry(arrowRadius, arrowSize, 8);
    const yArrowMat = new THREE.MeshBasicMaterial({ color: yColor });
    const yArrow = new THREE.Mesh(yArrowGeom, yArrowMat);
    yArrow.position.set(0, size, 0);
    group.add(yArrow);

    // Z arrow
    const zArrowGeom = new THREE.ConeGeometry(arrowRadius, arrowSize, 8);
    const zArrowMat = new THREE.MeshBasicMaterial({ color: zColor });
    const zArrow = new THREE.Mesh(zArrowGeom, zArrowMat);
    zArrow.position.set(0, 0, size);
    zArrow.rotation.x = Math.PI / 2;
    group.add(zArrow);

    return group;
  }

  setSize(size: number): void {
    this.options.size = size;

    // Remove old axes
    this.group.remove(this.axesHelper);
    this.group.remove(this.customAxes);
    this.axesHelper.dispose();

    // Create new axes with updated size
    this.axesHelper = new THREE.AxesHelper(size);
    this.group.add(this.axesHelper);

    this.customAxes = this.createCustomAxes();
    this.group.add(this.customAxes);

    log.debug('Axes size updated', { size });
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    log.debug('Axes visibility', { visible });
  }

  dispose(): void {
    this.axesHelper.dispose();
    this.customAxes.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
    log.debug('Axes disposed');
  }
}
