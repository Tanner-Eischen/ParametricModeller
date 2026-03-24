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
  mesh: THREE.Mesh;
  wireframe: THREE.LineSegments;
  bodyVersion: number; // For future cache invalidation
  /** Map from numeric face ID hash to actual face ID string */
  faceIdMap: Map<number, string>;
}

/**
 * Cache for converting B-Rep bodies to Three.js renderable meshes.
 * Handles triangulation and material management.
 */
export class RenderMeshCache {
  private cache: Map<string, CachedMesh> = new Map();
  private defaultMaterial: THREE.Material;
  private selectedMaterial: THREE.Material;

  constructor() {
    this.defaultMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a9eff,
      metalness: 0.1,
      roughness: 0.8,
      side: THREE.FrontSide,
    });

    this.selectedMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0x443300,
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
    const existing = this.cache.get(body.id);

    if (existing) {
      // For now, always re-triangulate (future: check body version)
      this.removeBody(body.id);
    }

    return this.createMeshForBody(body);
  }

  /**
   * Create a new mesh group for a body.
   */
  private createMeshForBody(body: Body): THREE.Group {
    const group = new THREE.Group();
    group.userData.bodyId = body.id;
    group.userData.name = body.name;

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
      mesh,
      wireframe,
      bodyVersion: 0,
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
    const cached = this.cache.get(bodyId);
    if (cached) {
      cached.mesh.material = selected ? this.selectedMaterial : this.defaultMaterial;
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

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.clear();
    this.defaultMaterial.dispose();
    this.selectedMaterial.dispose();
    log.debug('RenderMeshCache disposed');
  }
}
