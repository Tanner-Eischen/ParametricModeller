import type { Body } from './Body';
import type { Edge } from './Edge';
import type { Vertex } from './Vertex';

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

    for (const edgeId of face.boundaryEdgeIds) {
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
  tolerance = 1e-6
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
