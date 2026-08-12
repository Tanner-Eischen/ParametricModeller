import type { Body } from './Body';
import type { Edge } from './Edge';
import type { Vertex } from './Vertex';
import { DEFAULT_TOLERANCE_POLICY } from './TolerancePolicy';

/**
 * Result of body validation.
 */
export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  entityId?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  entityId?: string;
}

/**
 * Validate that a body represents a valid manifold solid.
 */
export function validateBody(body: Body): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check for empty body
  if (body.vertices.size === 0) {
    errors.push({
      code: 'EMPTY_BODY',
      message: 'Body has no vertices',
    });
    return { ok: false, errors, warnings };
  }

  // Check all edges reference valid vertices
  for (const edge of body.edges.values()) {
    for (const vertexId of edge.vertexIds) {
      if (!body.vertices.has(vertexId)) {
        errors.push({
          code: 'INVALID_EDGE_VERTEX',
          message: `Edge ${edge.id} references non-existent vertex ${vertexId}`,
          entityId: edge.id,
        });
      }
    }
  }

  // Check all faces reference valid edges and planes
  for (const face of body.faces.values()) {
    if (!body.planes.has(face.planeId)) {
      errors.push({
        code: 'INVALID_FACE_PLANE',
        message: `Face ${face.id} references non-existent plane ${face.planeId}`,
        entityId: face.id,
      });
    }

    for (const edgeId of [
      ...face.boundaryEdgeIds,
      ...(face.innerBoundaryEdgeIds?.flat() ?? []),
    ]) {
      if (!body.edges.has(edgeId)) {
        errors.push({
          code: 'INVALID_FACE_EDGE',
          message: `Face ${face.id} references non-existent edge ${edgeId}`,
          entityId: face.id,
        });
      }
    }
  }

  // Check manifold condition: all edges have 1-2 adjacent faces
  for (const edge of body.edges.values()) {
    if (edge.faceIds.length === 0) {
      warnings.push({
        code: 'ORPHAN_EDGE',
        message: `Edge ${edge.id} has no adjacent faces`,
        entityId: edge.id,
      });
    } else if (edge.faceIds.length > 2) {
      errors.push({
        code: 'NON_MANIFOLD_EDGE',
        message: `Edge ${edge.id} has ${edge.faceIds.length} adjacent faces (max 2 for manifold)`,
        entityId: edge.id,
      });
    }
  }

  // Check vertex edge references are bidirectional
  for (const vertex of body.vertices.values()) {
    for (const edgeId of vertex.edgeIds) {
      const edge = body.edges.get(edgeId);
      if (!edge) {
        errors.push({
          code: 'INVALID_VERTEX_EDGE',
          message: `Vertex ${vertex.id} references non-existent edge ${edgeId}`,
          entityId: vertex.id,
        });
      } else if (!edge.vertexIds.includes(vertex.id)) {
        errors.push({
          code: 'UNIDIRECTIONAL_EDGE_REF',
          message: `Vertex ${vertex.id} references edge ${edgeId} but edge does not reference vertex`,
          entityId: vertex.id,
        });
      }
    }
  }

  // Check for duplicate vertices at same position
  const positionMap = new Map<string, string>();
  for (const vertex of body.vertices.values()) {
    const key = vertex.position.map((p) => p.toFixed(6)).join(',');
    const existingId = positionMap.get(key);
    if (existingId !== undefined) {
      warnings.push({
        code: 'DUPLICATE_VERTEX_POSITION',
        message: `Vertices ${existingId} and ${vertex.id} share the same position`,
        entityId: vertex.id,
      });
    } else {
      positionMap.set(key, vertex.id);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/** Strict validation for a closed planar B-Rep shell used by boolean operations. */
export function validateClosedManifoldBody(body: Body): ValidationResult {
  const base = validateBody(body);
  const errors = [...base.errors];
  const warnings = [...base.warnings];

  for (const edge of body.edges.values()) {
    if (edge.faceIds.length !== 2) {
      errors.push({
        code: 'OPEN_SHELL_EDGE',
        message: `Closed solids require exactly two adjacent faces on edge ${edge.id}`,
        entityId: edge.id,
      });
    }
    for (const faceId of edge.faceIds) {
      const face = body.faces.get(faceId);
      const faceEdges = face
        ? [...face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds?.flat() ?? [])]
        : [];
      if (!face || !faceEdges.includes(edge.id)) {
        errors.push({
          code: 'INVALID_EDGE_FACE',
          message: `Edge ${edge.id} references a face that does not reference the edge`,
          entityId: edge.id,
        });
      }
    }
  }

  for (const face of body.faces.values()) {
    const plane = body.planes.get(face.planeId);
    for (const loop of [face.boundaryEdgeIds, ...(face.innerBoundaryEdgeIds ?? [])]) {
      if (!isClosedEdgeLoop(body, loop)) {
        errors.push({
          code: 'OPEN_FACE_LOOP',
          message: `Face ${face.id} contains an open or branching boundary loop`,
          entityId: face.id,
        });
      }
      if (plane) {
        const vertexIds = new Set(loop.flatMap((edgeId) => body.edges.get(edgeId)?.vertexIds ?? []));
        for (const vertexId of vertexIds) {
          const vertex = body.vertices.get(vertexId);
          if (vertex && Math.abs(
            plane.normal[0] * (vertex.position[0] - plane.origin[0])
            + plane.normal[1] * (vertex.position[1] - plane.origin[1])
            + plane.normal[2] * (vertex.position[2] - plane.origin[2])
          ) > DEFAULT_TOLERANCE_POLICY.planarity) {
            errors.push({
              code: 'NON_PLANAR_FACE_VERTEX',
              message: `Face ${face.id} has a vertex outside its supporting plane`,
              entityId: face.id,
            });
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isClosedEdgeLoop(body: Body, edgeIds: readonly string[]): boolean {
  if (edgeIds.length < 3 || new Set(edgeIds).size !== edgeIds.length) return false;
  const degree = new Map<string, number>();
  for (const edgeId of edgeIds) {
    const edge = body.edges.get(edgeId);
    if (!edge) return false;
    for (const vertexId of edge.vertexIds) {
      degree.set(vertexId, (degree.get(vertexId) ?? 0) + 1);
    }
  }
  return degree.size >= 3 && [...degree.values()].every((value) => value === 2);
}

/**
 * Check if an edge is manifold (1-2 adjacent faces).
 */
export function isManifoldEdge(edge: Edge): boolean {
  return edge.faceIds.length >= 1 && edge.faceIds.length <= 2;
}

/**
 * Validate that all vertices in a list are unique within tolerance.
 */
export function validateUniqueVertices(
  vertices: Vertex[],
  tolerance = DEFAULT_TOLERANCE_POLICY.linear
): boolean {
  for (let i = 0; i < vertices.length; i++) {
    const vertexA = vertices[i];
    if (!vertexA) continue;

    for (let j = i + 1; j < vertices.length; j++) {
      const vertexB = vertices[j];
      if (!vertexB) continue;

      const a = vertexA.position;
      const b = vertexB.position;
      const dist = Math.sqrt(
        (a[0] - b[0]) ** 2 +
        (a[1] - b[1]) ** 2 +
        (a[2] - b[2]) ** 2
      );
      if (dist < tolerance) {
        return false;
      }
    }
  }
  return true;
}
