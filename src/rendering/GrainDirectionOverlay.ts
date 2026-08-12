import * as THREE from 'three';

export interface GrainDirectionEntry {
  bodyId: string;
  center: readonly [number, number, number];
  direction: readonly [number, number, number];
  length: number;
  visible?: boolean;
}

export interface GrainDirectionOverlayOptions {
  color?: number;
}

export class GrainDirectionOverlay {
  readonly group = new THREE.Group();
  private readonly color: number;

  constructor(options: GrainDirectionOverlayOptions = {}) {
    this.color = options.color ?? 0xf4c95d;
    this.group.name = 'woodworking-grain-directions';
    this.group.renderOrder = 30;
  }

  attachTo(scene: THREE.Object3D): void {
    if (this.group.parent !== scene) scene.add(this.group);
  }

  update(entries: readonly GrainDirectionEntry[]): void {
    this.clear();
    for (const entry of [...entries].sort((left, right) => left.bodyId.localeCompare(right.bodyId))) {
      if (entry.visible === false || !Number.isFinite(entry.length) || entry.length <= 0) continue;
      const direction = new THREE.Vector3(...entry.direction);
      if (direction.lengthSq() <= Number.EPSILON) continue;
      direction.normalize();
      const length = Math.max(entry.length, 0.001);
      const arrow = new THREE.ArrowHelper(
        direction,
        new THREE.Vector3(...entry.center),
        length,
        this.color,
        Math.min(length * 0.25, 2),
        Math.min(length * 0.12, 1)
      );
      arrow.name = `grain:${entry.bodyId}`;
      arrow.userData.bodyId = entry.bodyId;
      arrow.traverse((child) => {
        child.renderOrder = 30;
      });
      this.group.add(arrow);
    }
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      child.traverse((descendant) => {
        if (descendant instanceof THREE.Line || descendant instanceof THREE.Mesh) {
          descendant.geometry.dispose();
          const materials = Array.isArray(descendant.material)
            ? descendant.material
            : [descendant.material];
          for (const material of materials) material.dispose();
        }
      });
      child.removeFromParent();
    }
  }
}
