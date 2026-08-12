import * as THREE from 'three';

export type VertexMarkerState = 'available' | 'hovered' | 'selected';

export interface VertexSelectionTarget {
  /** Body-qualified stable key; vertex topology IDs can repeat across bodies. */
  targetId: string;
  bodyId: string;
  featureId: string;
  vertexId: string;
  position: [number, number, number];
}

export interface VertexSelectionOverlayOptions {
  markerRadius?: number;
  availableColor?: number;
  hoveredColor?: number;
  selectedColor?: number;
}

const DEFAULT_OPTIONS: Required<VertexSelectionOverlayOptions> = {
  markerRadius: 0.08,
  availableColor: 0x8fa9c6,
  hoveredColor: 0xffd36d,
  selectedColor: 0x59c2ff,
};

/** View-only vertex markers used while the document is in vertex selection mode. */
export class VertexSelectionOverlay {
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.SphereGeometry;
  private readonly materials: Record<VertexMarkerState, THREE.MeshBasicMaterial>;
  private scene: THREE.Scene | null = null;

  constructor(options: VertexSelectionOverlayOptions = {}) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    this.group.name = 'vertex-selection-overlay';
    this.group.visible = false;
    this.group.renderOrder = 20;
    this.geometry = new THREE.SphereGeometry(resolved.markerRadius, 12, 12);
    this.materials = {
      available: this.createMaterial(resolved.availableColor, 0.74),
      hovered: this.createMaterial(resolved.hoveredColor, 1),
      selected: this.createMaterial(resolved.selectedColor, 1),
    };
  }

  attachTo(scene: THREE.Scene): void {
    if (this.scene === scene) return;
    this.detach();
    this.scene = scene;
    scene.add(this.group);
  }

  setTargets(
    targets: readonly VertexSelectionTarget[],
    selectedTargetId: string | null,
    hoveredTargetId: string | null,
  ): void {
    this.group.clear();
    if (!this.scene || targets.length === 0) {
      this.group.visible = false;
      return;
    }

    for (const target of targets) {
      const state: VertexMarkerState = target.targetId === selectedTargetId
        ? 'selected'
        : target.targetId === hoveredTargetId
          ? 'hovered'
          : 'available';
      const marker = new THREE.Mesh(this.geometry, this.materials[state]);
      marker.name = 'vertex-selection-marker';
      marker.position.fromArray(target.position);
      marker.scale.setScalar(state === 'hovered' ? 1.55 : state === 'selected' ? 1.35 : 1);
      marker.renderOrder = 20;
      marker.userData = {
        targetId: target.targetId,
        bodyId: target.bodyId,
        featureId: target.featureId,
        vertexId: target.vertexId,
        selectionState: state,
      };
      this.group.add(marker);
    }
    this.group.visible = true;
  }

  clear(): void {
    this.group.clear();
    this.group.visible = false;
  }

  dispose(): void {
    this.clear();
    this.detach();
    this.geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
  }

  private createMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
  }

  private detach(): void {
    this.group.removeFromParent();
    this.scene = null;
  }
}
