import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Grid');

export interface GridOptions {
  majorSpacing?: number;
  minorSpacing?: number;
  majorColor?: number;
  minorColor?: number;
  size?: number;
}

const DEFAULT_OPTIONS: Required<GridOptions> = {
  majorSpacing: 12,    // 12 inches = 1 foot major lines
  minorSpacing: 1,     // 1 inch minor lines
  majorColor: 0x444444,
  minorColor: 0x333333,
  size: 200,           // 200 inches = ~16 feet, good for furniture/cabinets
};

export class Grid {
  group: THREE.Group;
  private gridHelper: THREE.GridHelper;
  private options: Required<GridOptions>;

  constructor(options: GridOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.group = new THREE.Group();

    // Create main grid using Three.js GridHelper
    const divisions = Math.floor(this.options.size / this.options.minorSpacing);
    this.gridHelper = new THREE.GridHelper(
      this.options.size,
      divisions,
      this.options.majorColor,
      this.options.minorColor
    );

    // Adjust for major/minor line distinction
    this.gridHelper.material.opacity = 0.5;
    this.gridHelper.material.transparent = true;

    this.group.add(this.gridHelper);

    // Position grid at Y=0 (XZ plane)
    this.gridHelper.position.y = 0;

    log.debug('Grid created', this.options);
  }

  setSpacing(major: number, minor: number): void {
    this.options.majorSpacing = major;
    this.options.minorSpacing = minor;

    // Recreate grid with new spacing
    this.group.remove(this.gridHelper);
    this.gridHelper.dispose();

    const divisions = Math.floor(this.options.size / minor);
    this.gridHelper = new THREE.GridHelper(
      this.options.size,
      divisions,
      this.options.majorColor,
      this.options.minorColor
    );
    this.gridHelper.material.opacity = 0.5;
    this.gridHelper.material.transparent = true;
    this.gridHelper.position.y = 0;

    this.group.add(this.gridHelper);
    log.debug('Grid spacing updated', { major, minor });
  }

  setSize(size: number): void {
    this.options.size = size;

    // Recreate grid with new size
    this.group.remove(this.gridHelper);
    this.gridHelper.dispose();

    const divisions = Math.floor(size / this.options.minorSpacing);
    this.gridHelper = new THREE.GridHelper(
      size,
      divisions,
      this.options.majorColor,
      this.options.minorColor
    );
    this.gridHelper.material.opacity = 0.5;
    this.gridHelper.material.transparent = true;
    this.gridHelper.position.y = 0;

    this.group.add(this.gridHelper);
    log.debug('Grid size updated', { size });
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    log.debug('Grid visibility', { visible });
  }

  getSpacing(): { major: number; minor: number } {
    return {
      major: this.options.majorSpacing,
      minor: this.options.minorSpacing,
    };
  }

  dispose(): void {
    this.gridHelper.dispose();
    log.debug('Grid disposed');
  }
}
