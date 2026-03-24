import { generateId } from '../../core/id';
import {
  createBody,
  addVertex,
  addEdge,
  addFace,
  addPlane,
  createPlane,
  type Body,
} from '../../geometry';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';

/**
 * Parameters for the Box primitive feature.
 */
export interface BoxParams {
  /** X dimension (width) */
  width: number;
  /** Y dimension (depth) */
  depth: number;
  /** Z dimension (height) */
  height: number;
  /** Anchor mode: corner means origin is at -X/-Y/-Z corner */
  anchorMode: 'corner' | 'center';
  /** Origin point */
  origin: [number, number, number];
}

/**
 * Default box parameters.
 */
export const defaultBoxParams: BoxParams = {
  width: 1,
  depth: 1,
  height: 1,
  anchorMode: 'corner',
  origin: [0, 0, 0],
};

/**
 * Feature type identifier for box.
 */
export const BOX_FEATURE_TYPE = 'box';

/**
 * Deterministic topology IDs for box faces.
 * Named by normal direction in box-local frame.
 */
const FACE_IDS = {
  posX: '+X',
  negX: '-X',
  posY: '+Y',
  negY: '-Y',
  posZ: '+Z',
  negZ: '-Z',
} as const;

/**
 * Deterministic topology IDs for box edges.
 * Named by adjacent faces.
 */
const EDGE_IDS = {
  posXPosY: '+X+Y',
  posXNegY: '+X-Y',
  posXPosZ: '+X+Z',
  posXNegZ: '+X-Z',
  negXPosY: '-X+Y',
  negXNegY: '-X-Y',
  negXPosZ: '-X+Z',
  negXNegZ: '-X-Z',
  posYPosZ: '+Y+Z',
  posYNegZ: '+Y-Z',
  negYPosZ: '-Y+Z',
  negYNegZ: '-Y-Z',
} as const;

/**
 * Deterministic topology IDs for box vertices.
 * Named by three faces meeting at the vertex.
 */
const VERTEX_IDS = {
  posXPosYPosZ: '+X+Y+Z',
  posXPosYNegZ: '+X+Y-Z',
  posXNegYPosZ: '+X-Y+Z',
  posXNegYNegZ: '+X-Y-Z',
  negXPosYPosZ: '-X+Y+Z',
  negXPosYNegZ: '-X+Y-Z',
  negXNegYPosZ: '-X-Y+Z',
  negXNegYNegZ: '-X-Y-Z',
} as const;

/**
 * Validate box parameters.
 */
export function validateBoxParams(params: Partial<BoxParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (params.width !== undefined && params.width <= 0) {
    diagnostics.push(error('INVALID_DIMENSION', 'Width must be greater than 0'));
  }

  if (params.depth !== undefined && params.depth <= 0) {
    diagnostics.push(error('INVALID_DIMENSION', 'Depth must be greater than 0'));
  }

  if (params.height !== undefined && params.height <= 0) {
    diagnostics.push(error('INVALID_DIMENSION', 'Height must be greater than 0'));
  }

  return diagnostics;
}

/**
 * Create a box body with the given parameters.
 * Uses deterministic topology IDs for stable references.
 */
export function createBoxBody(params: BoxParams, bodyId?: string): Body {
  const { width, depth, height, anchorMode, origin } = params;

  // Calculate box bounds based on anchor mode
  let minX: number, maxX: number;
  let minY: number, maxY: number;
  let minZ: number, maxZ: number;

  if (anchorMode === 'corner') {
    minX = origin[0];
    minY = origin[1];
    minZ = origin[2];
    maxX = origin[0] + width;
    maxY = origin[1] + depth;
    maxZ = origin[2] + height;
  } else {
    // center mode
    minX = origin[0] - width / 2;
    maxX = origin[0] + width / 2;
    minY = origin[1] - depth / 2;
    maxY = origin[1] + depth / 2;
    minZ = origin[2] - height / 2;
    maxZ = origin[2] + height / 2;
  }

  const body = createBody(bodyId, 'Box');

  // Create 8 vertices with deterministic IDs
  const vertices = [
    { id: VERTEX_IDS.posXPosYPosZ, pos: [maxX, maxY, maxZ] as [number, number, number] },
    { id: VERTEX_IDS.posXPosYNegZ, pos: [maxX, maxY, minZ] as [number, number, number] },
    { id: VERTEX_IDS.posXNegYPosZ, pos: [maxX, minY, maxZ] as [number, number, number] },
    { id: VERTEX_IDS.posXNegYNegZ, pos: [maxX, minY, minZ] as [number, number, number] },
    { id: VERTEX_IDS.negXPosYPosZ, pos: [minX, maxY, maxZ] as [number, number, number] },
    { id: VERTEX_IDS.negXPosYNegZ, pos: [minX, maxY, minZ] as [number, number, number] },
    { id: VERTEX_IDS.negXNegYPosZ, pos: [minX, minY, maxZ] as [number, number, number] },
    { id: VERTEX_IDS.negXNegYNegZ, pos: [minX, minY, minZ] as [number, number, number] },
  ];

  for (const v of vertices) {
    addVertex(body, { id: v.id, position: v.pos, edgeIds: [] });
  }

  // Create 6 planes for the faces
  const planes = [
    { id: FACE_IDS.posX, plane: createPlane([maxX, 0, 0], [1, 0, 0]) },
    { id: FACE_IDS.negX, plane: createPlane([minX, 0, 0], [-1, 0, 0]) },
    { id: FACE_IDS.posY, plane: createPlane([0, maxY, 0], [0, 1, 0]) },
    { id: FACE_IDS.negY, plane: createPlane([0, minY, 0], [0, -1, 0]) },
    { id: FACE_IDS.posZ, plane: createPlane([0, 0, maxZ], [0, 0, 1]) },
    { id: FACE_IDS.negZ, plane: createPlane([0, 0, minZ], [0, 0, -1]) },
  ];

  for (const p of planes) {
    addPlane(body, p.plane, p.id);
  }

  // Create 12 edges with deterministic IDs
  // Each edge connects two vertices, edges are shared by two faces
  const edgeDefs: Array<{ id: string; v1: string; v2: string }> = [
    // Edges along X axis
    { id: EDGE_IDS.posYPosZ, v1: VERTEX_IDS.negXPosYPosZ, v2: VERTEX_IDS.posXPosYPosZ },
    { id: EDGE_IDS.posYNegZ, v1: VERTEX_IDS.negXPosYNegZ, v2: VERTEX_IDS.posXPosYNegZ },
    { id: EDGE_IDS.negYPosZ, v1: VERTEX_IDS.negXNegYPosZ, v2: VERTEX_IDS.posXNegYPosZ },
    { id: EDGE_IDS.negYNegZ, v1: VERTEX_IDS.negXNegYNegZ, v2: VERTEX_IDS.posXNegYNegZ },
    // Edges along Y axis
    { id: EDGE_IDS.posXPosZ, v1: VERTEX_IDS.posXNegYPosZ, v2: VERTEX_IDS.posXPosYPosZ },
    { id: EDGE_IDS.posXNegZ, v1: VERTEX_IDS.posXNegYNegZ, v2: VERTEX_IDS.posXPosYNegZ },
    { id: EDGE_IDS.negXPosZ, v1: VERTEX_IDS.negXNegYPosZ, v2: VERTEX_IDS.negXPosYPosZ },
    { id: EDGE_IDS.negXNegZ, v1: VERTEX_IDS.negXNegYNegZ, v2: VERTEX_IDS.negXPosYNegZ },
    // Edges along Z axis
    { id: EDGE_IDS.posXPosY, v1: VERTEX_IDS.posXPosYNegZ, v2: VERTEX_IDS.posXPosYPosZ },
    { id: EDGE_IDS.posXNegY, v1: VERTEX_IDS.posXNegYNegZ, v2: VERTEX_IDS.posXNegYPosZ },
    { id: EDGE_IDS.negXPosY, v1: VERTEX_IDS.negXPosYNegZ, v2: VERTEX_IDS.negXPosYPosZ },
    { id: EDGE_IDS.negXNegY, v1: VERTEX_IDS.negXNegYNegZ, v2: VERTEX_IDS.negXNegYPosZ },
  ];

  for (const e of edgeDefs) {
    // Create edge with deterministic ID
    const edge = {
      id: e.id,
      vertexIds: [e.v1, e.v2] as [string, string],
      faceIds: [],
    };
    addEdge(body, edge);
  }

  // Create 6 faces with deterministic IDs
  // Face boundary edges are ordered CCW when viewed from outside
  const faceDefs: Array<{ id: string; planeId: string; edges: string[] }> = [
    { id: FACE_IDS.posX, planeId: FACE_IDS.posX, edges: [EDGE_IDS.posXPosY, EDGE_IDS.posXPosZ, EDGE_IDS.posXNegY, EDGE_IDS.posXNegZ] },
    { id: FACE_IDS.negX, planeId: FACE_IDS.negX, edges: [EDGE_IDS.negXNegY, EDGE_IDS.negXPosZ, EDGE_IDS.negXPosY, EDGE_IDS.negXNegZ] },
    { id: FACE_IDS.posY, planeId: FACE_IDS.posY, edges: [EDGE_IDS.negXPosY, EDGE_IDS.posYPosZ, EDGE_IDS.posXPosY, EDGE_IDS.posYNegZ] },
    { id: FACE_IDS.negY, planeId: FACE_IDS.negY, edges: [EDGE_IDS.posXNegY, EDGE_IDS.negYPosZ, EDGE_IDS.negXNegY, EDGE_IDS.negYNegZ] },
    { id: FACE_IDS.posZ, planeId: FACE_IDS.posZ, edges: [EDGE_IDS.negXPosZ, EDGE_IDS.posYPosZ, EDGE_IDS.posXPosZ, EDGE_IDS.negYPosZ] },
    { id: FACE_IDS.negZ, planeId: FACE_IDS.negZ, edges: [EDGE_IDS.posXNegZ, EDGE_IDS.posYNegZ, EDGE_IDS.negXNegZ, EDGE_IDS.negYNegZ] },
  ];

  for (const f of faceDefs) {
    const face = {
      id: f.id,
      planeId: f.planeId,
      boundaryEdgeIds: f.edges,
      name: f.id,
    };
    addFace(body, face);
  }

  return body;
}

/**
 * Rebuild handler for the box feature.
 */
export function rebuildBox(
  feature: FeatureRecord,
  _context: RebuildContext
): RebuildHandlerResult {
  const params: BoxParams = {
    ...defaultBoxParams,
    ...(feature.parameters as Partial<BoxParams>),
  };

  // Validate parameters
  const diagnostics = validateBoxParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid box parameters',
      diagnostics,
    };
  }

  // Create box body
  const body = createBoxBody(params, `${feature.id}_body`);

  return {
    ok: true,
    bodies: [body],
    diagnostics: [],
  };
}

/**
 * Create a box feature record.
 */
export function createBoxFeature(
  params: Partial<BoxParams> = {},
  name = 'Box'
): FeatureRecord {
  const fullParams: BoxParams = {
    ...defaultBoxParams,
    ...params,
  };

  return {
    id: generateId(),
    type: BOX_FEATURE_TYPE,
    name,
    parameters: fullParams as unknown as Record<string, unknown>,
    refsIn: [],
    refsOut: [],
    suppressed: false,
  };
}
