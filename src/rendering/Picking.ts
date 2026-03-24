import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import type { Body } from '../geometry';
import { PICKING_TOLERANCE_PX } from '../geometry/SubObjectTypes';

const log = createModuleLogger('Picking');

export interface PickResult {
  objectId: string | null;
  point: THREE.Vector3 | null;
  distance: number;
  /** Face ID if a specific face was hit (only set in face-picking mode) */
  faceId?: string;
  /** Body ID containing the face */
  bodyId?: string;
}

/**
 * Result of sub-object picking (vertex, edge, face).
 * Extends PickResult with sub-object type and ID information.
 */
export interface SubObjectPickResult extends PickResult {
  /** Type of sub-object that was picked */
  entityType: 'body' | 'face' | 'edge' | 'vertex';
  /** Vertex ID if a vertex was picked */
  vertexId?: string;
  /** Edge ID if an edge was picked */
  edgeId?: string;
  /** Feature ID that created the body */
  featureId?: string;
}

/**
 * Result of picking a face (includes face and body IDs)
 */
export interface FacePickResult {
  objectId: string | null;
  point: THREE.Vector3 | null;
  distance: number;
  faceId: string;
  bodyId: string;
}

export class Picking {
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  constructor() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    log.debug('Picking initialized');
  }

  /**
   * Pick an object from the scene at the given screen coordinates
   */
  pick(
    screenX: number,
    screenY: number,
    containerWidth: number,
    containerHeight: number,
    camera: THREE.Camera,
    objects: THREE.Object3D[]
  ): PickResult {
    // Convert screen coordinates to normalized device coordinates (-1 to +1)
    this.mouse.x = (screenX / containerWidth) * 2 - 1;
    this.mouse.y = -(screenY / containerHeight) * 2 + 1;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, camera);

    // Intersect with objects
    const intersects = this.raycaster.intersectObjects(objects, true);

    if (intersects.length > 0) {
      const hit = intersects[0]!;
      const objectId = this.getObjectId(hit.object);

      return {
        objectId,
        point: hit.point,
        distance: hit.distance,
      };
    }

    return {
      objectId: null,
      point: null,
      distance: Infinity,
    };
  }

  /**
   * Get the object ID from a Three.js object (traverses up to find userData.id)
   */
  private getObjectId(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData.id) {
        return current.userData.id;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * Get the body ID from a Three.js object (traverses up to find userData.bodyId)
   */
  private getBodyId(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData.bodyId) {
        return current.userData.bodyId;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * Pick a face from the scene at the given screen coordinates.
   * Returns face ID in addition to object and point.
   */
  pickFace(
    screenX: number,
    screenY: number,
    containerWidth: number,
    containerHeight: number,
    camera: THREE.Camera,
    objects: THREE.Object3D[]
  ): PickResult {
    // Convert screen coordinates to normalized device coordinates (-1 to +1)
    this.mouse.x = (screenX / containerWidth) * 2 - 1;
    this.mouse.y = -(screenY / containerHeight) * 2 + 1;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, camera);

    // Intersect with objects
    const intersects = this.raycaster.intersectObjects(objects, true);

    if (intersects.length > 0) {
      const hit = intersects[0]!;
      const objectId = this.getObjectId(hit.object);
      const bodyId = this.getBodyId(hit.object);

      // Try to get face ID from geometry attribute
      let faceId: string | undefined;
      if (hit.face && hit.object instanceof THREE.Mesh) {
        const geometry = hit.object.geometry;
        const faceIdAttr = geometry.getAttribute('faceId');
        if (faceIdAttr) {
          // The face index corresponds to the triangle, which has 3 vertices
          // But faceId is per-vertex, so get the first vertex of the triangle
          const vertexIndex = hit.face.a;
          const faceIdHash = faceIdAttr.getX(vertexIndex);
          faceId = String(faceIdHash);
        }
      }

      // Build result object, only including defined face/body IDs
      const result: PickResult = {
        objectId,
        point: hit.point,
        distance: hit.distance,
      };

      if (faceId !== undefined) {
        result.faceId = faceId;
      }
      if (bodyId !== null) {
        result.bodyId = bodyId;
      }

      return result;
    }

    return {
      objectId: null,
      point: null,
      distance: Infinity,
    };
  }

  /**
   * Create a ray from screen coordinates
   */
  createRay(
    screenX: number,
    screenY: number,
    containerWidth: number,
    containerHeight: number,
    camera: THREE.Camera
  ): THREE.Ray {
    // Convert screen coordinates to NDC
    this.mouse.x = (screenX / containerWidth) * 2 - 1;
    this.mouse.y = -(screenY / containerHeight) * 2 + 1;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, camera);

    return this.raycaster.ray;
  }

  /**
   * Pick a vertex from the scene using screen-space tolerance.
   * Finds the closest vertex within the tolerance radius.
   */
  pickVertex(
    screenX: number,
    screenY: number,
    containerWidth: number,
    containerHeight: number,
    camera: THREE.Camera,
    bodies: Map<string, { body: Body; featureId: string }>,
    tolerance: number = PICKING_TOLERANCE_PX
  ): SubObjectPickResult | null {
    let closestResult: SubObjectPickResult | null = null;
    let closestDistance = tolerance;

    // Project all vertices to screen space and find closest within tolerance
    for (const [bodyId, { body, featureId }] of bodies) {
      for (const [vertexId, vertex] of body.vertices) {
        // Project vertex position to screen space
        const worldPos = new THREE.Vector3(...vertex.position);
        const screenPos = worldPos.clone().project(camera);

        // Convert to screen coordinates
        const vertexScreenX = (screenPos.x * 0.5 + 0.5) * containerWidth;
        const vertexScreenY = (-screenPos.y * 0.5 + 0.5) * containerHeight;

        // Calculate distance in screen space
        const dx = vertexScreenX - screenX;
        const dy = vertexScreenY - screenY;
        const screenDistance = Math.sqrt(dx * dx + dy * dy);

        // Check if within tolerance and closer than previous best
        if (screenDistance < closestDistance) {
          closestDistance = screenDistance;

          // Calculate world distance for depth sorting
          const depth = camera.position.distanceTo(worldPos);

          closestResult = {
            objectId: bodyId,
            point: worldPos,
            distance: depth,
            entityType: 'vertex',
            vertexId,
            bodyId,
            featureId,
          };
        }
      }
    }

    return closestResult;
  }

  /**
   * Pick an edge from the scene using screen-space tolerance.
   * Finds the closest edge within the tolerance radius.
   */
  pickEdge(
    screenX: number,
    screenY: number,
    containerWidth: number,
    containerHeight: number,
    camera: THREE.Camera,
    bodies: Map<string, { body: Body; featureId: string }>,
    tolerance: number = PICKING_TOLERANCE_PX
  ): SubObjectPickResult | null {
    let closestResult: SubObjectPickResult | null = null;
    let closestDistance = tolerance;

    // Project all edges to screen space and find closest within tolerance
    for (const [bodyId, { body, featureId }] of bodies) {
      for (const [edgeId, edge] of body.edges) {
        const v1 = body.vertices.get(edge.vertexIds[0]);
        const v2 = body.vertices.get(edge.vertexIds[1]);

        if (!v1 || !v2) continue;

        // Project edge endpoints to screen space
        const worldPos1 = new THREE.Vector3(...v1.position);
        const worldPos2 = new THREE.Vector3(...v2.position);
        const screenPos1 = worldPos1.clone().project(camera);
        const screenPos2 = worldPos2.clone().project(camera);

        // Convert to screen coordinates
        const s1x = (screenPos1.x * 0.5 + 0.5) * containerWidth;
        const s1y = (-screenPos1.y * 0.5 + 0.5) * containerHeight;
        const s2x = (screenPos2.x * 0.5 + 0.5) * containerWidth;
        const s2y = (-screenPos2.y * 0.5 + 0.5) * containerHeight;

        // Calculate distance from point to line segment in screen space
        const screenDistance = this.pointToLineDistance2D(
          screenX, screenY,
          s1x, s1y,
          s2x, s2y
        );

        // Check if within tolerance and closer than previous best
        if (screenDistance < closestDistance) {
          closestDistance = screenDistance;

          // Calculate midpoint for the pick point
          const midPoint = new THREE.Vector3().addVectors(worldPos1, worldPos2).multiplyScalar(0.5);
          const depth = camera.position.distanceTo(midPoint);

          closestResult = {
            objectId: bodyId,
            point: midPoint,
            distance: depth,
            entityType: 'edge',
            edgeId,
            bodyId,
            featureId,
          };
        }
      }
    }

    return closestResult;
  }

  /**
   * Calculate the distance from a point to a line segment in 2D.
   */
  private pointToLineDistance2D(
    px: number, py: number,
    x1: number, y1: number,
    x2: number, y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      // Line segment is a point
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    // Project point onto line and clamp to segment
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    // Calculate closest point on segment
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;

    // Return distance to closest point
    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
  }

  /**
   * Test ray-AABB intersection
   */
  rayAABBIntersection(ray: THREE.Ray, box: THREE.Box3): number {
    return ray.intersectBox(box, new THREE.Vector3()) ? 1 : 0;
  }

  /**
   * Find all objects within a box selection
   */
  boxSelect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    containerWidth: number,
    containerHeight: number,
    camera: THREE.Camera,
    objects: THREE.Object3D[]
  ): string[] {
    const selectedIds: string[] = [];

    // Convert to NDC
    const ndcMinX = (minX / containerWidth) * 2 - 1;
    const ndcMinY = -(minY / containerHeight) * 2 + 1;
    const ndcMaxX = (maxX / containerWidth) * 2 - 1;
    const ndcMaxY = -(maxY / containerHeight) * 2 + 1;

    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();

    // Create a selection matrix
    const selectionMatrix = new THREE.Matrix4();
    selectionMatrix.set(
      2 / (ndcMaxX - ndcMinX), 0, 0, -(ndcMaxX + ndcMinX) / (ndcMaxX - ndcMinX),
      0, 2 / (ndcMaxY - ndcMinY), 0, -(ndcMaxY + ndcMinY) / (ndcMaxY - ndcMinY),
      0, 0, 1, 0,
      0, 0, 0, 1
    );

    projScreenMatrix.multiplyMatrices(
      selectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);

    for (const object of objects) {
      if (!object.userData.id) continue;

      // Get object bounding box
      const box = new THREE.Box3().setFromObject(object);

      if (frustum.intersectsBox(box)) {
        selectedIds.push(object.userData.id);
      }
    }

    return selectedIds;
  }

  dispose(): void {
    log.debug('Picking disposed');
  }
}
