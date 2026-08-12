import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import type { Body } from '../geometry';
import { triangulateBody, createBufferGeometry, createWireframeGeometry } from '../geometry';

const log = createModuleLogger('RenderMeshCache');

/**
 * Cached render data for a body.
 */
interface CachedMesh {
  bodyId: string;
  group: THREE.Group;
  mesh: THREE.Mesh;
  wireframe: THREE.LineSegments;
  bodyVersion: string;
  /** Map from numeric face ID hash to actual face ID string */
  faceIdMap: Map<number, string>;
}

export interface RenderMeshCacheStats {
  lookups: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export type BodyInteractionState = 'default' | 'hovered' | 'selected';

/**
 * Cache for converting B-Rep bodies to Three.js renderable meshes.
 * Handles triangulation and material management.
 */
export class RenderMeshCache {
  private cache: Map<string, CachedMesh> = new Map();
  private defaultMaterial: THREE.Material;
  private hoveredMaterial: THREE.Material;
  private selectedMaterial: THREE.Material;
  private lookups = 0;
  private hits = 0;
  private misses = 0;

  constructor() {
    this.defaultMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a9eff,
      metalness: 0.1,
      roughness: 0.8,
      side: THREE.FrontSide,
    });

    this.hoveredMaterial = new THREE.MeshStandardMaterial({
      color: 0x67c7ff,
      emissive: 0x12384f,
      metalness: 0.15,
      roughness: 0.72,
      side: THREE.FrontSide,
    });

    this.selectedMaterial = new THREE.MeshStandardMaterial({
      color: 0xffa928,
      emissive: 0x5c2b00,
      metalness: 0.3,
      roughness: 0.7,
      side: THREE.FrontSide,
    });

    log.debug('RenderMeshCache initialized');
  }

  /**
   * Get or create a Three.js Group for a body.
   * The group contains both the solid mesh and wireframe.
   */
  getOrCreateMesh(body: Body): THREE.Group {
    this.lookups += 1;
    const existing = this.cache.get(body.id);
    const bodyVersion = this.getBodyVersion(body);

    if (existing?.bodyVersion === bodyVersion) {
      this.hits += 1;
      return existing.group;
    }

    this.misses += 1;
    if (existing) {
      this.removeBody(body.id);
    }

    return this.createMeshForBody(body, bodyVersion);
  }

  /**
   * Create a new mesh group for a body.
   */
  private createMeshForBody(body: Body, bodyVersion: string): THREE.Group {
    const group = new THREE.Group();
    // Picking's generic body-selection contract resolves userData.id by
    // walking up from the intersected mesh. Keep bodyId for sub-object tools.
    group.userData.id = body.id;
    group.userData.bodyId = body.id;
    group.userData.name = body.name;
    group.userData.interactionState = 'default';

    // Triangulate the body
    const triangulation = triangulateBody(body);

    if (triangulation.positions.length === 0) {
      log.warn('Body has no geometry', { bodyId: body.id });
      return group;
    }

    // Build face ID lookup map
    const faceIdMap = new Map<number, string>();
    for (const faceId of body.faces.keys()) {
      const hash = this.hashFaceId(faceId);
      faceIdMap.set(hash, faceId);
    }

    // Create solid mesh
    const geometry = createBufferGeometry(triangulation);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.defaultMaterial);
    mesh.userData.bodyId = body.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Create wireframe overlay
    const wireframeGeometry = createWireframeGeometry(body);
    const wireframe = new THREE.LineSegments(
      wireframeGeometry,
      new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 })
    );
    wireframe.userData.bodyId = body.id;

    group.add(mesh);
    group.add(wireframe);

    // Cache the result
    const cached: CachedMesh = {
      bodyId: body.id,
      group,
      mesh,
      wireframe,
      bodyVersion,
      faceIdMap,
    };
    this.cache.set(body.id, cached);

    log.debug('Created mesh for body', { bodyId: body.id, faceCount: faceIdMap.size });
    return group;
  }

  /**
   * Hash a face ID string to a numeric value (must match Triangulator.ts).
   */
  private hashFaceId(faceId: string): number {
    let hash = 0;
    for (let i = 0; i < faceId.length; i++) {
      const char = faceId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /** Fingerprint every B-Rep input consumed by triangulation and wireframe creation. */
  private getBodyVersion(body: Body): string {
    return JSON.stringify({
      vertices: [...body.vertices],
      edges: [...body.edges],
      faces: [...body.faces],
      planes: [...body.planes],
    });
  }

  /**
   * Get the face ID string from a numeric hash.
   */
  getFaceIdFromBody(bodyId: string, faceIdHash: number): string | null {
    const cached = this.cache.get(bodyId);
    if (!cached) return null;
    return cached.faceIdMap.get(faceIdHash) ?? null;
  }

  /**
   * Update selection state for a body's mesh.
   */
  setSelectionState(bodyId: string, selected: boolean): void {
    this.setInteractionState(bodyId, selected ? 'selected' : 'default');
  }

  /** Apply distinct transient hover and persistent selection feedback. */
  setInteractionState(bodyId: string, state: BodyInteractionState): void {
    const cached = this.cache.get(bodyId);
    if (cached) {
      cached.mesh.material = state === 'selected'
        ? this.selectedMaterial
        : state === 'hovered'
          ? this.hoveredMaterial
          : this.defaultMaterial;
      const wireframe = cached.wireframe.material as THREE.LineBasicMaterial;
      wireframe.color.setHex(
        state === 'selected' ? 0xfff0c2 : state === 'hovered' ? 0xbce9ff : 0x000000
      );
      wireframe.opacity = state === 'default' ? 0.72 : 1;
      wireframe.transparent = true;
      wireframe.depthTest = state === 'default';
      cached.wireframe.renderOrder = state === 'default' ? 0 : 900;
      cached.group.userData.interactionState = state;
    }
  }

  /**
   * Remove a body from the cache.
   */
  removeBody(bodyId: string): void {
    const cached = this.cache.get(bodyId);
    if (cached) {
      cached.mesh.geometry.dispose();
      cached.wireframe.geometry.dispose();
      (cached.wireframe.material as THREE.Material).dispose();
      this.cache.delete(bodyId);
      log.debug('Removed body from cache', { bodyId });
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    for (const cached of this.cache.values()) {
      cached.mesh.geometry.dispose();
      cached.wireframe.geometry.dispose();
      (cached.wireframe.material as THREE.Material).dispose();
    }
    this.cache.clear();
    log.debug('RenderMeshCache cleared');
  }

  /**
   * Get the number of cached bodies.
   */
  get size(): number {
    return this.cache.size;
  }

  /** Return counters from real mesh requests without mutating cache state. */
  getStats(): RenderMeshCacheStats {
    return {
      lookups: this.lookups,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.lookups === 0 ? 0 : this.hits / this.lookups,
    };
  }

  /** Start a new measurement window while retaining cached geometry. */
  resetStats(): void {
    this.lookups = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.clear();
    this.defaultMaterial.dispose();
    this.hoveredMaterial.dispose();
    this.selectedMaterial.dispose();
    log.debug('RenderMeshCache disposed');
  }
}
