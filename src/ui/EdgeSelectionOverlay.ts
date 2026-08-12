import * as THREE from 'three';
import type { Body } from '../geometry';

export interface EdgeSelectionOverlayOptions {
  hoverColor?: number;
  selectedColor?: number;
}

interface EdgeKey {
  bodyId: string;
  edgeId: string;
}

/** View-only hover and selection feedback for planar B-Rep edges. */
export class EdgeSelectionOverlay {
  private scene: THREE.Scene | null = null;
  private hoverLine: THREE.Line | null = null;
  private selectedLine: THREE.Line | null = null;
  private hovered: EdgeKey | null = null;
  private selected: EdgeKey | null = null;
  private readonly hoverColor: number;
  private readonly selectedColor: number;

  constructor(options: EdgeSelectionOverlayOptions = {}) {
    this.hoverColor = options.hoverColor ?? 0xffc857;
    this.selectedColor = options.selectedColor ?? 0x39b9ff;
  }

  attachToScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  setHoveredEdge(body: Body, edgeId: string): void {
    if (this.matches(this.hovered, body.id, edgeId)) return;
    this.clearHover();
    this.hovered = { bodyId: body.id, edgeId };
    if (this.matches(this.selected, body.id, edgeId)) return;
    this.hoverLine = this.createLine(body, edgeId, this.hoverColor, 'hover');
    if (!this.hoverLine || !this.scene) {
      this.hovered = null;
      return;
    }
    this.scene.add(this.hoverLine);
  }

  setSelectedEdge(body: Body, edgeId: string): void {
    if (this.matches(this.selected, body.id, edgeId)) return;
    this.clearSelection();
    if (this.matches(this.hovered, body.id, edgeId)) {
      this.removeLine(this.hoverLine);
      this.hoverLine = null;
    }
    this.selectedLine = this.createLine(body, edgeId, this.selectedColor, 'selection');
    if (!this.selectedLine || !this.scene) return;
    this.selected = { bodyId: body.id, edgeId };
    this.scene.add(this.selectedLine);
  }

  clearHover(): void {
    this.removeLine(this.hoverLine);
    this.hoverLine = null;
    this.hovered = null;
  }

  clearSelection(): void {
    this.removeLine(this.selectedLine);
    this.selectedLine = null;
    this.selected = null;
  }

  clear(): void {
    this.clearHover();
    this.clearSelection();
  }

  getHoveredEdge(): EdgeKey | null {
    return this.hovered ? { ...this.hovered } : null;
  }

  getSelectedEdge(): EdgeKey | null {
    return this.selected ? { ...this.selected } : null;
  }

  dispose(): void {
    this.clear();
    this.scene = null;
  }

  private createLine(
    body: Body,
    edgeId: string,
    color: number,
    role: 'hover' | 'selection',
  ): THREE.Line | null {
    const edge = body.edges.get(edgeId);
    if (!edge) return null;
    const start = body.vertices.get(edge.vertexIds[0]);
    const end = body.vertices.get(edge.vertexIds[1]);
    if (!start || !end) return null;

    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...start.position),
      new THREE.Vector3(...end.position),
    ]);
    const material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 1000;
    line.userData.selectionOverlay = 'edge';
    line.userData.edgeOverlayRole = role;
    line.userData.bodyId = body.id;
    line.userData.edgeId = edgeId;
    return line;
  }

  private removeLine(line: THREE.Line | null): void {
    if (!line) return;
    this.scene?.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  }

  private matches(key: EdgeKey | null, bodyId: string, edgeId: string): boolean {
    return key?.bodyId === bodyId && key.edgeId === edgeId;
  }
}
