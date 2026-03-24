import { describe, it, expect } from 'vitest';
import {
  createVertex,
  addEdgeToVertex,
  removeEdgeFromVertex,
  verticesEqual,
  getVertexPosition,
} from '../../src/geometry';

describe('Vertex', () => {
  describe('createVertex', () => {
    it('should create a vertex with position', () => {
      const vertex = createVertex([1, 2, 3]);

      expect(vertex.position).toEqual([1, 2, 3]);
      expect(vertex.edgeIds).toEqual([]);
      expect(vertex.id).toBeDefined();
      expect(vertex.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('should create a vertex with custom ID', () => {
      const vertex = createVertex([0, 0, 0], 'custom-id');

      expect(vertex.id).toBe('custom-id');
    });
  });

  describe('addEdgeToVertex', () => {
    it('should add an edge reference', () => {
      const vertex = createVertex([0, 0, 0]);
      const updated = addEdgeToVertex(vertex, 'edge-1');

      expect(updated.edgeIds).toContain('edge-1');
    });

    it('should not duplicate edge references', () => {
      const vertex = createVertex([0, 0, 0]);
      const withEdge = addEdgeToVertex(vertex, 'edge-1');
      const duplicate = addEdgeToVertex(withEdge, 'edge-1');

      expect(duplicate.edgeIds).toHaveLength(1);
    });
  });

  describe('removeEdgeFromVertex', () => {
    it('should remove an edge reference', () => {
      const vertex = createVertex([0, 0, 0]);
      const withEdge = addEdgeToVertex(vertex, 'edge-1');
      const withoutEdge = removeEdgeFromVertex(withEdge, 'edge-1');

      expect(withoutEdge.edgeIds).not.toContain('edge-1');
    });
  });

  describe('verticesEqual', () => {
    it('should return true for vertices at same position', () => {
      const a = createVertex([1, 2, 3]);
      const b = createVertex([1, 2, 3]);

      expect(verticesEqual(a, b)).toBe(true);
    });

    it('should return false for vertices at different positions', () => {
      const a = createVertex([1, 2, 3]);
      const b = createVertex([1, 2, 4]);

      expect(verticesEqual(a, b)).toBe(false);
    });

    it('should respect tolerance', () => {
      const a = createVertex([1, 2, 3]);
      const b = createVertex([1, 2, 3.000001]);

      expect(verticesEqual(a, b, 1e-5)).toBe(true);
      expect(verticesEqual(a, b, 1e-7)).toBe(false);
    });
  });

  describe('getVertexPosition', () => {
    it('should return a copy of the position', () => {
      const vertex = createVertex([1, 2, 3]);
      const pos = getVertexPosition(vertex);

      expect(pos).toEqual([1, 2, 3]);

      // Modifying returned array should not affect vertex
      pos[0] = 99;
      expect(vertex.position[0]).toBe(1);
    });
  });
});
