import { describe, it, expect } from 'vitest';
import {
  validateBody,
  validateUniqueVertices,
} from '../../src/geometry';
import { createBody, addVertex, addEdge, addFace, addPlane } from '../../src/geometry';
import { createVertex } from '../../src/geometry/Vertex';
import { createEdge } from '../../src/geometry/Edge';
import { createFace } from '../../src/geometry/Face';
import { createPlane } from '../../src/geometry/Plane';

describe('Validation', () => {
  describe('validateBody', () => {
    it('should return error for empty body', () => {
      const body = createBody();
      const result = validateBody(body);

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === 'EMPTY_BODY')).toBe(true);
    });

    it('should return error for edge referencing non-existent vertex', () => {
      const body = createBody();
      addVertex(body, createVertex([0, 0, 0]));
      // Add edge referencing a vertex that doesn't exist
      body.edges.set('bad-edge', {
        id: 'bad-edge',
        vertexIds: ['v1', 'nonexistent'],
        faceIds: [],
      });

      const result = validateBody(body);

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_EDGE_VERTEX')).toBe(true);
    });

    it('should return error for face referencing non-existent plane', () => {
      const body = createBody();
      addVertex(body, createVertex([0, 0, 0]));
      // Add face referencing a plane that doesn't exist
      body.faces.set('bad-face', {
        id: 'bad-face',
        planeId: 'nonexistent-plane',
        boundaryEdgeIds: [],
      });

      const result = validateBody(body);

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_FACE_PLANE')).toBe(true);
    });

    it('should return error for non-manifold edges (>2 faces)', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      addVertex(body, v1);
      addVertex(body, v2);

      const edge = createEdge(v1.id, v2.id);
      addEdge(body, edge);

      // Manually add too many face references
      const overConnectedEdge = body.edges.get(edge.id);
      if (overConnectedEdge) {
        overConnectedEdge.faceIds = ['f1', 'f2', 'f3'];
      }

      const result = validateBody(body);

      expect(result.errors.some((e) => e.code === 'NON_MANIFOLD_EDGE')).toBe(true);
    });

    it('should pass for a valid simple body', () => {
      const body = createBody();

      // Create a simple triangle face
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      const v3 = createVertex([0, 1, 0]);

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);

      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      addPlane(body, plane, 'p1');

      const e1 = createEdge(v1.id, v2.id);
      const e2 = createEdge(v2.id, v3.id);
      const e3 = createEdge(v3.id, v1.id);

      addEdge(body, e1);
      addEdge(body, e2);
      addEdge(body, e3);

      const face = createFace('p1', [e1.id, e2.id, e3.id]);
      addFace(body, face);

      const result = validateBody(body);

      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateUniqueVertices', () => {
    it('should return true for unique vertices', () => {
      const vertices = [
        createVertex([0, 0, 0]),
        createVertex([1, 0, 0]),
        createVertex([0, 1, 0]),
      ];

      expect(validateUniqueVertices(vertices)).toBe(true);
    });

    it('should return false for duplicate vertices', () => {
      const vertices = [
        createVertex([0, 0, 0]),
        createVertex([1, 0, 0]),
        createVertex([0, 0, 0]), // Duplicate
      ];

      expect(validateUniqueVertices(vertices)).toBe(false);
    });

    it('should respect tolerance', () => {
      const vertices = [
        createVertex([0, 0, 0]),
        createVertex([0.0001, 0, 0]), // 0.0001 units apart
      ];

      // dist (0.0001) < tolerance (0.001) is TRUE → returns false (not unique)
      expect(validateUniqueVertices(vertices, 1e-3)).toBe(false);
      // dist (0.0001) < tolerance (0.00001) is FALSE → returns true (unique)
      expect(validateUniqueVertices(vertices, 1e-5)).toBe(true);
    });
  });
});
