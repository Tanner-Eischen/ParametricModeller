import { generateId } from '../core/id';
import type { Body } from './Body';
import { addVertex, addEdge, addFace, addPlane, getBodyBoundingBox } from './Body';
import type { Plane } from './Plane';
import { createPlane } from './Plane';
import type { ConstructionPlane } from './ConstructionPlane';
import { sketchToWorld } from './ConstructionPlane';
import type { Profile2D } from '../sketch';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('CutBuilder');

/**
 * Result of validating a cut operation.
 */
export interface CutValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that a cut operation can be performed.
 * For v1, we check:
 * - Profile is within face bounds (simplified check)
 * - Depth is valid
 */
export function validateCutOperation(
  body: Body,
  plane: ConstructionPlane,
  profile: Profile2D,
  distance: number,
  _flip: boolean
): CutValidationResult {
  // Check body has faces
  if (body.faces.size === 0) {
    return { valid: false, error: 'Body has no faces to cut' };
  }

  // Check distance is positive
  if (distance <= 0) {
    return { valid: false, error: 'Cut distance must be greater than 0' };
  }

  // Check profile has enough points
  if (profile.loop.length < 3) {
    return { valid: false, error: 'Profile must have at least 3 points' };
  }

  // v1: Check profile is rectangular (simplification)
  if (profile.loop.length !== 4) {
    return { valid: false, error: 'Only rectangular profiles are supported in v1' };
  }

  // Get body bounding box for bounds check
  const bbox = getBodyBoundingBox(body);

  // Transform profile to world coordinates
  const worldPoints = profile.loop.map(p => sketchToWorld(plane, p));

  // Check all profile points are within body bounds (simplified)
  for (const point of worldPoints) {
    const tolerance = 0.001;
    if (
      point[0] < bbox.min[0] - tolerance ||
      point[0] > bbox.max[0] + tolerance ||
      point[1] < bbox.min[1] - tolerance ||
      point[1] > bbox.max[1] + tolerance ||
      point[2] < bbox.min[2] - tolerance ||
      point[2] > bbox.max[2] + tolerance
    ) {
      return { valid: false, error: 'Profile extends beyond body bounds' };
    }
  }

  return { valid: true };
}

/**
 * Compute the depth needed for a through cut.
 * Finds the exit face by raycasting through the body.
 */
export function computeThroughCutDepth(
  body: Body,
  plane: ConstructionPlane,
  flip: boolean
): number | null {
  // Get body bounding box
  const bbox = getBodyBoundingBox(body);

  // Direction for the cut
  const cutDir: [number, number, number] = flip
    ? [-plane.normal[0], -plane.normal[1], -plane.normal[2]]
    : [...plane.normal];

  // Raycast from plane origin through body
  // Simplified: use bounding box intersection
  const origin = plane.origin;
  const minBbox = bbox.min;
  const maxBbox = bbox.max;

  // Find entry and exit distances along the ray
  let tMin = -Infinity;
  let tMax = Infinity;

  for (let i = 0; i < 3; i++) {
    const cutDirI = cutDir[i];
    const minI = minBbox[i];
    const maxI = maxBbox[i];
    const originI = origin[i];

    if (cutDirI === undefined || minI === undefined || maxI === undefined || originI === undefined) {
      continue;
    }

    if (Math.abs(cutDirI) < 1e-6) {
      // Ray parallel to slab
      if (originI < minI || originI > maxI) {
        return null;
      }
    } else {
      const t1 = (minI - originI) / cutDirI;
      const t2 = (maxI - originI) / cutDirI;

      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    }
  }

  if (tMax < tMin) {
    return null;
  }

  // Through cut depth is from entry to exit
  const throughDepth = tMax - tMin + 0.01; // Add small buffer

  if (throughDepth <= 0) {
    return null;
  }

  return throughDepth;
}

/**
 * Perform a cut operation on the body.
 * For v1, this creates a pocket by:
 * 1. Adding vertices for the cut profile at the bottom depth
 * 2. Adding edges for the cut profile
 * 3. Adding faces for the pocket sides and bottom
 *
 * This is a simplified approach that modifies the body topology directly.
 */
export function performCut(
  body: Body,
  plane: ConstructionPlane,
  profile: Profile2D,
  distance: number,
  flip: boolean
): Body | null {
  try {
    // Determine cut direction
    const cutDir: [number, number, number] = flip
      ? [-plane.normal[0], -plane.normal[1], -plane.normal[2]]
      : [...plane.normal];

    // Get profile points in world coordinates (top of cut)
    const topPoints3D = profile.loop.map(p => sketchToWorld(plane, p));

    // Compute bottom points (at cut depth)
    const bottomPoints3D = topPoints3D.map(p => [
      p[0] + distance * cutDir[0],
      p[1] + distance * cutDir[1],
      p[2] + distance * cutDir[2],
    ] as [number, number, number]);

    const numPoints = topPoints3D.length;

    // Generate IDs for new topology
    const cutId = generateId();
    const topVertexIds: string[] = [];
    const bottomVertexIds: string[] = [];
    const topEdgeIds: string[] = [];
    const bottomEdgeIds: string[] = [];
    const verticalEdgeIds: string[] = [];
    const sidePlaneIds: string[] = [];

    // Create top vertices (on sketch plane)
    for (let i = 0; i < numPoints; i++) {
      const id = `cut_${cutId}_top_v${i}`;
      addVertex(body, {
        id,
        position: topPoints3D[i]!,
        edgeIds: [],
      });
      topVertexIds.push(id);
    }

    // Create bottom vertices (at cut depth)
    for (let i = 0; i < numPoints; i++) {
      const id = `cut_${cutId}_bottom_v${i}`;
      addVertex(body, {
        id,
        position: bottomPoints3D[i]!,
        edgeIds: [],
      });
      bottomVertexIds.push(id);
    }

    // Create bottom plane (parallel to sketch plane, at cut depth)
    const bottomOrigin: [number, number, number] = [
      plane.origin[0] + distance * cutDir[0],
      plane.origin[1] + distance * cutDir[1],
      plane.origin[2] + distance * cutDir[2],
    ];
    // Bottom plane normal points opposite to cut direction (so it faces into the pocket)
    const bottomNormal: [number, number, number] = [
      -cutDir[0],
      -cutDir[1],
      -cutDir[2],
    ];
    const bottomPlane: Plane = {
      origin: bottomOrigin,
      normal: bottomNormal,
      uAxis: plane.uAxis,
      vAxis: plane.vAxis,
    };
    const bottomPlaneId = `cut_${cutId}_bottom`;
    addPlane(body, bottomPlane, bottomPlaneId);

    // Create side planes
    for (let i = 0; i < numPoints; i++) {
      const next = (i + 1) % numPoints;

      const sidePlaneId = `cut_${cutId}_side_plane_${i}`;
      const p1Top = topPoints3D[i]!;
      const p2Top = topPoints3D[next]!;

      // Side plane normal points inward (toward center of pocket)
      // Compute from top edge direction and cut direction
      const edgeDir: [number, number, number] = [
        p2Top[0] - p1Top[0],
        p2Top[1] - p1Top[1],
        p2Top[2] - p1Top[2],
      ];
      // Cross product gives outward normal, so negate for inward
      const sideNormal = crossProduct(cutDir, edgeDir);
      const sidePlane = createPlane(p1Top, sideNormal);
      addPlane(body, sidePlane, sidePlaneId);
      sidePlaneIds.push(sidePlaneId);
    }

    // Create top edges (cut profile boundary)
    for (let i = 0; i < numPoints; i++) {
      const next = (i + 1) % numPoints;
      const id = `cut_${cutId}_top_e${i}`;
      addEdge(body, {
        id,
        vertexIds: [topVertexIds[i]!, topVertexIds[next]!],
        faceIds: [],
      });
      topEdgeIds.push(id);
    }

    // Create bottom edges
    for (let i = 0; i < numPoints; i++) {
      const next = (i + 1) % numPoints;
      const id = `cut_${cutId}_bottom_e${i}`;
      addEdge(body, {
        id,
        vertexIds: [bottomVertexIds[i]!, bottomVertexIds[next]!],
        faceIds: [],
      });
      bottomEdgeIds.push(id);
    }

    // Create vertical edges
    for (let i = 0; i < numPoints; i++) {
      const id = `cut_${cutId}_vertical_e${i}`;
      addEdge(body, {
        id,
        vertexIds: [topVertexIds[i]!, bottomVertexIds[i]!],
        faceIds: [],
      });
      verticalEdgeIds.push(id);
    }

    // Create bottom face of pocket
    addFace(body, {
      id: `cut_${cutId}_bottom`,
      planeId: bottomPlaneId,
      boundaryEdgeIds: bottomEdgeIds,
      name: 'Cut Bottom',
    });

    // Create side faces of pocket
    for (let i = 0; i < numPoints; i++) {
      const next = (i + 1) % numPoints;
      const faceId = `cut_${cutId}_side_${i}`;

      // Side face edges: vertical, bottom, vertical, top
      const sideEdges = [
        verticalEdgeIds[i]!,
        bottomEdgeIds[i]!,
        verticalEdgeIds[next]!,
        topEdgeIds[i]!,
      ];

      addFace(body, {
        id: faceId,
        planeId: sidePlaneIds[i]!,
        boundaryEdgeIds: sideEdges,
        name: `Cut Side ${i + 1}`,
      });
    }

    log.info('Cut performed', {
      cutId,
      numPoints,
      distance,
    });

    return body;
  } catch (e) {
    log.error('Cut operation failed', { error: e });
    return null;
  }
}

/**
 * Compute cross product of two vectors.
 */
function crossProduct(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
