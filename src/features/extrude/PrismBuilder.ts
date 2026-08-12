import { generateId } from '../../core/id';
import type { Body } from '../../geometry';
import { createBody, addVertex, addEdge, addFace, addPlane, createPlane } from '../../geometry';
import type { Plane } from '../../geometry';
import type { ConstructionPlane } from '../../geometry/ConstructionPlane';
import { sketchToWorld } from '../../geometry/ConstructionPlane';
import type { Profile2D, Point2D } from '../../sketch';

/**
 * Parameters for building a prism (extruded profile).
 */
export interface PrismParams {
  /** Construction plane for the sketch */
  plane: ConstructionPlane;
  /** Profile to extrude */
  profile: Profile2D;
  /** Extrusion distance */
  distance: number;
  /** Signed offset of the first cap along the resolved extrusion direction. */
  startOffset?: number;
  /** Whether to flip extrusion direction (opposite to plane normal) */
  flip: boolean;
}

/**
 * Deterministic topology IDs for prism faces.
 */
const PRISM_FACE_IDS = {
  bottom: 'bottom',
  top: 'top',
} as const;

/**
 * Build a prism body from a profile.
 */
export function buildPrism(params: PrismParams, bodyId?: string): Body {
  const { plane, profile, distance, flip, startOffset = 0 } = params;

  // Determine extrusion direction
  const extrudeDir: [number, number, number] = flip
    ? [-plane.normal[0], -plane.normal[1], -plane.normal[2]]
    : [...plane.normal];

  // Create body
  const body = createBody(bodyId, 'Prism');

  // Get profile points in world coordinates
  const bottomPoints2D = profile.loop;
  const topPoints2D = bottomPoints2D; // Same 2D points, different Z

  // Transform to 3D
  const bottomPoints3D = bottomPoints2D.map((p) => {
    const point = sketchToWorld(plane, p);
    return [
      point[0] + startOffset * extrudeDir[0],
      point[1] + startOffset * extrudeDir[1],
      point[2] + startOffset * extrudeDir[2],
    ] as [number, number, number];
  });
  const topPoints3D = topPoints2D.map((p) => {
    const bottom = sketchToWorld(plane, p);
    return [
      bottom[0] + (startOffset + distance) * extrudeDir[0],
      bottom[1] + (startOffset + distance) * extrudeDir[1],
      bottom[2] + (startOffset + distance) * extrudeDir[2],
    ] as [number, number, number];
  });

  const numPoints = bottomPoints3D.length;

  // Create bottom cap vertices
  for (let i = 0; i < numPoints; i++) {
    const id = `bottom_v${i}`;
    addVertex(body, {
      id,
      position: bottomPoints3D[i]!,
      edgeIds: [],
    });
  }

  // Create top cap vertices
  for (let i = 0; i < numPoints; i++) {
    const id = `top_v${i}`;
    addVertex(body, {
      id,
      position: topPoints3D[i]!,
      edgeIds: [],
    });
  }

  // Create bottom cap plane (opposite normal to sketch plane)
  const bottomPlane: Plane = {
    origin: [
      plane.origin[0] + startOffset * extrudeDir[0],
      plane.origin[1] + startOffset * extrudeDir[1],
      plane.origin[2] + startOffset * extrudeDir[2],
    ],
    normal: [-extrudeDir[0], -extrudeDir[1], -extrudeDir[2]],
    uAxis: plane.uAxis,
    vAxis: plane.vAxis,
  };
  addPlane(body, bottomPlane, PRISM_FACE_IDS.bottom);

  // Create top cap plane
  const topOrigin: [number, number, number] = [
    plane.origin[0] + (startOffset + distance) * extrudeDir[0],
    plane.origin[1] + (startOffset + distance) * extrudeDir[1],
    plane.origin[2] + (startOffset + distance) * extrudeDir[2],
  ];
  const topPlane: Plane = {
    origin: topOrigin,
    normal: extrudeDir,
    uAxis: plane.uAxis,
    vAxis: plane.vAxis,
  };
  addPlane(body, topPlane, PRISM_FACE_IDS.top);

  // Create side planes and edges
  for (let i = 0; i < numPoints; i++) {
    const next = (i + 1) % numPoints;

    // Create side plane
    const sidePlaneId = `side_${i}`;
    const p1Bottom = bottomPoints3D[i]!;
    const p2Bottom = bottomPoints3D[next]!;

    // Side plane normal points outward
    // Compute from bottom edge direction and extrusion direction
    const edgeDir: [number, number, number] = [
      p2Bottom[0] - p1Bottom[0],
      p2Bottom[1] - p1Bottom[1],
      p2Bottom[2] - p1Bottom[2],
    ];
    const sideNormal = crossProduct(edgeDir, extrudeDir);
    const sidePlane = createPlane(p1Bottom, sideNormal);
    addPlane(body, sidePlane, sidePlaneId);
  }

  // Create bottom cap edges (CCW when viewed from below)
  for (let i = 0; i < numPoints; i++) {
    const next = (i + 1) % numPoints;
    const id = `bottom_e${i}`;
    addEdge(body, {
      id,
      vertexIds: [`bottom_v${i}`, `bottom_v${next}`],
      faceIds: [],
    });
  }

  // Create top cap edges (CCW when viewed from above)
  for (let i = 0; i < numPoints; i++) {
    const next = (i + 1) % numPoints;
    const id = `top_e${i}`;
    addEdge(body, {
      id,
      vertexIds: [`top_v${i}`, `top_v${next}`],
      faceIds: [],
    });
  }

  // Create vertical edges
  for (let i = 0; i < numPoints; i++) {
    const id = `vertical_e${i}`;
    addEdge(body, {
      id,
      vertexIds: [`bottom_v${i}`, `top_v${i}`],
      faceIds: [],
    });
  }

  // Create bottom cap face
  const bottomEdgeIds: string[] = [];
  for (let i = 0; i < numPoints; i++) {
    bottomEdgeIds.push(`bottom_e${i}`);
  }
  addFace(body, {
    id: PRISM_FACE_IDS.bottom,
    planeId: PRISM_FACE_IDS.bottom,
    boundaryEdgeIds: bottomEdgeIds,
    name: 'Bottom',
  });

  // Create top cap face
  const topEdgeIds: string[] = [];
  for (let i = 0; i < numPoints; i++) {
    topEdgeIds.push(`top_e${i}`);
  }
  addFace(body, {
    id: PRISM_FACE_IDS.top,
    planeId: PRISM_FACE_IDS.top,
    boundaryEdgeIds: topEdgeIds,
    name: 'Top',
  });

  // Create side faces
  for (let i = 0; i < numPoints; i++) {
    const next = (i + 1) % numPoints;
    const faceId = `side_${i}`;

    // Side face edges: vertical, top, vertical, bottom (in CCW when viewed from outside)
    const sideEdgeIds = [
      `vertical_e${i}`,
      `top_e${i}`,
      `vertical_e${next}`,
      `bottom_e${i}`,
    ];

    addFace(body, {
      id: faceId,
      planeId: faceId,
      boundaryEdgeIds: sideEdgeIds,
      name: `Side ${i + 1}`,
    });
  }

  return body;
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

/**
 * Validate prism parameters.
 */
export function validatePrismParams(params: Partial<PrismParams>): string[] {
  const errors: string[] = [];

  if (!params.plane) {
    errors.push('Construction plane is required');
  }

  if (!params.profile) {
    errors.push('Profile is required');
  } else {
    if (!params.profile.isValid) {
      errors.push('Profile is not valid');
    }
    if (params.profile.loop.length < 3) {
      errors.push('Profile must have at least 3 points');
    }
  }

  if (params.distance !== undefined && params.distance <= 0) {
    errors.push('Distance must be greater than 0');
  }

  return errors;
}

/**
 * Create a prism from a rectangle profile.
 * Convenience function for common case.
 */
export function buildRectangularPrism(
  plane: ConstructionPlane,
  origin: Point2D,
  width: number,
  height: number,
  distance: number,
  flip = false,
  bodyId?: string
): Body {
  // Create rectangle profile
  const profile: Profile2D = {
    id: generateId(),
    sketchId: '',
    loop: [
      origin,
      [origin[0] + width, origin[1]],
      [origin[0] + width, origin[1] + height],
      [origin[0], origin[1] + height],
    ],
    entityIds: [],
    isValid: true,
  };

  return buildPrism({ plane, profile, distance, flip }, bodyId);
}
