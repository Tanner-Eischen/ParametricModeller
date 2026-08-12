import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Axes');

export interface AxesOptions {
  /** Size of the positive-direction arrow markers. */
  size?: number;
  lineWidth?: number;
  xColor?: number;
  yColor?: number;
  zColor?: number;
}

const DEFAULT_OPTIONS: Required<AxesOptions> = {
  size: 2,
  lineWidth: 2,
  xColor: 0xff4444,
  yColor: 0x44ff44,
  zColor: 0x4488ff,
};

const NDC_FRUSTUM_CORNERS = [
  [-1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [-1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1],
] as const;

/**
 * Camera-relative world reference axes. The rendered segments are finite for
 * WebGL, but are extended beyond the active camera frustum every frame so they
 * behave as infinite bidirectional construction lines at any supported zoom.
 */
export class Axes {
  readonly group = new THREE.Group();

  private readonly options: Required<AxesOptions>;
  private readonly lineGeometry = new THREE.BufferGeometry();
  private readonly lineMaterial: THREE.LineBasicMaterial;
  private readonly lines: THREE.LineSegments;
  private readonly frustumCorner = new THREE.Vector3();
  private markerGroup: THREE.Group;
  private currentExtent = 1;

  constructor(options: AxesOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(18), 3)
    );
    this.lineGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.createAxisColors(), 3)
    );
    this.lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: this.options.lineWidth,
      transparent: true,
      opacity: 0.78,
      // The X (red) and Z (blue) axes lie in the y=0 plane — the same plane as
      // the grid — so by default they z-fight against the grid lines and vanish.
      // Draw the axes on top of everything (grid included) by disabling depth
      // testing and rendering them last.
      depthTest: false,
    });
    this.lines = new THREE.LineSegments(this.lineGeometry, this.lineMaterial);
    this.lines.name = 'infinite-reference-axes';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 999;
    this.group.add(this.lines);

    this.markerGroup = this.createDirectionMarkers();
    this.group.add(this.markerGroup);
    this.writeAxisPositions(this.currentExtent);

    log.debug('Camera-relative axes created', this.options);
  }

  update(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    const nextExtent = this.calculateRequiredExtent(camera);
    if (Math.abs(nextExtent - this.currentExtent) <= Math.max(1, nextExtent) * 1e-6) return;
    this.currentExtent = nextExtent;
    this.writeAxisPositions(nextExtent);
  }

  getCurrentExtent(): number {
    return this.currentExtent;
  }

  setSize(size: number): void {
    if (!Number.isFinite(size) || size <= 0) return;
    this.options.size = size;
    this.group.remove(this.markerGroup);
    this.disposeGroup(this.markerGroup);
    this.markerGroup = this.createDirectionMarkers();
    this.group.add(this.markerGroup);
    log.debug('Axes marker size updated', { size });
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    log.debug('Axes visibility', { visible });
  }

  dispose(): void {
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
    this.disposeGroup(this.markerGroup);
    log.debug('Axes disposed');
  }

  private calculateRequiredExtent(
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  ): number {
    camera.updateProjectionMatrix();
    camera.updateWorldMatrix(true, false);

    let maxWorldCoordinate = 0;
    for (const [x, y, z] of NDC_FRUSTUM_CORNERS) {
      this.frustumCorner.set(x, y, z).unproject(camera);
      maxWorldCoordinate = Math.max(
        maxWorldCoordinate,
        Math.abs(this.frustumCorner.x),
        Math.abs(this.frustumCorner.y),
        Math.abs(this.frustumCorner.z)
      );
    }

    return Math.max(1, camera.far, maxWorldCoordinate) * 1.1;
  }

  private writeAxisPositions(extent: number): void {
    const positions = this.lineGeometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, -extent, 0, 0);
    positions.setXYZ(1, extent, 0, 0);
    positions.setXYZ(2, 0, -extent, 0);
    positions.setXYZ(3, 0, extent, 0);
    positions.setXYZ(4, 0, 0, -extent);
    positions.setXYZ(5, 0, 0, extent);
    positions.needsUpdate = true;
  }

  private createAxisColors(): Float32Array {
    const colors = new Float32Array(18);
    const axisColors = [
      new THREE.Color(this.options.xColor),
      new THREE.Color(this.options.yColor),
      new THREE.Color(this.options.zColor),
    ];
    axisColors.forEach((color, axis) => {
      color.toArray(colors, axis * 6);
      color.toArray(colors, axis * 6 + 3);
    });
    return colors;
  }

  private createDirectionMarkers(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'reference-axis-direction-markers';
    const { size } = this.options;
    const markerLength = size * 0.1;
    const markerRadius = size * 0.025;
    const descriptors = [
      { color: this.options.xColor, position: [size, 0, 0] as const, rotation: [0, 0, -Math.PI / 2] as const },
      { color: this.options.yColor, position: [0, size, 0] as const, rotation: [0, 0, 0] as const },
      { color: this.options.zColor, position: [0, 0, size] as const, rotation: [Math.PI / 2, 0, 0] as const },
    ];

    for (const descriptor of descriptors) {
      const marker = new THREE.Mesh(
        new THREE.ConeGeometry(markerRadius, markerLength, 8),
        new THREE.MeshBasicMaterial({
          color: descriptor.color,
          // Draw the direction markers on top of the grid too.
          depthTest: false,
        })
      );
      marker.position.set(
        descriptor.position[0],
        descriptor.position[1],
        descriptor.position[2]
      );
      marker.rotation.set(
        descriptor.rotation[0],
        descriptor.rotation[1],
        descriptor.rotation[2]
      );
      marker.renderOrder = 999;
      marker.frustumCulled = false;
      group.add(marker);
    }
    return group;
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    });
  }
}
