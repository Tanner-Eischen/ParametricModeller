import { describe, it, expect } from 'vitest';
import {
  createEdge,
  addFaceToEdge,
  removeFaceFromEdge,
  isBoundaryEdge,
  isManifoldEdge,
  edgeHasVertex,
  getOtherVertex,
  getEdgeKey,
} from '../../src/geometry';

describe('Edge', () => {
  describe('createEdge', () => {
    it('should create an edge between two vertices', () => {
      const edge = createEdge('v1', 'v2');

      expect(edge.vertexIds).toHaveLength(2);
      expect(edge.vertexIds).toContain('v1');
      expect(edge.vertexIds).toContain('v2');
      expect(edge.faceIds).toEqual([]);
    });

    it('should order vertex IDs consistently', () => {
      const edge1 = createEdge('a', 'b');
      const edge2 = createEdge('b', 'a');

      expect(edge1.vertexIds).toEqual(edge2.vertexIds);
    });

    it('should create an edge with custom ID', () => {
      const edge = createEdge('v1', 'v2', 'custom-edge-id');

      expect(edge.id).toBe('custom-edge-id');
    });
  });

  describe('addFaceToEdge', () => {
    it('should add a face reference', () => {
      const edge = createEdge('v1', 'v2');
      const updated = addFaceToEdge(edge, 'face-1');

      expect(updated.faceIds).toContain('face-1');
    });

    it('should not duplicate face references', () => {
      const edge = createEdge('v1', 'v2');
      const withFace = addFaceToEdge(edge, 'face-1');
      const duplicate = addFaceToEdge(withFace, 'face-1');

      expect(duplicate.faceIds).toHaveLength(1);
    });
  });

  describe('removeFaceFromEdge', () => {
    it('should remove a face reference', () => {
      const edge = createEdge('v1', 'v2');
      const withFace = addFaceToEdge(edge, 'face-1');
      const withoutFace = removeFaceFromEdge(withFace, 'face-1');

      expect(withoutFace.faceIds).not.toContain('face-1');
    });
  });

  describe('isBoundaryEdge', () => {
    it('should return true for edges with one adjacent face', () => {
      const edge = createEdge('v1', 'v2');
      const boundaryEdge = addFaceToEdge(edge, 'face-1');

      expect(isBoundaryEdge(boundaryEdge)).toBe(true);
    });

    it('should return false for edges with two adjacent faces', () => {
      const edge = createEdge('v1', 'v2');
      const interiorEdge = addFaceToEdge(addFaceToEdge(edge, 'face-1'), 'face-2');

      expect(isBoundaryEdge(interiorEdge)).toBe(false);
    });
  });

  describe('isManifoldEdge', () => {
    it('should return true for edges with 1-2 adjacent faces', () => {
      const edge1 = addFaceToEdge(createEdge('v1', 'v2'), 'face-1');
      const edge2 = addFaceToEdge(addFaceToEdge(createEdge('v3', 'v4'), 'face-1'), 'face-2');

      expect(isManifoldEdge(edge1)).toBe(true);
      expect(isManifoldEdge(edge2)).toBe(true);
    });

    it('should return false for edges with no faces', () => {
      const edge = createEdge('v1', 'v2');

      expect(isManifoldEdge(edge)).toBe(false);
    });
  });

  describe('edgeHasVertex', () => {
    it('should return true if edge contains the vertex', () => {
      const edge = createEdge('v1', 'v2');

      expect(edgeHasVertex(edge, 'v1')).toBe(true);
      expect(edgeHasVertex(edge, 'v2')).toBe(true);
      expect(edgeHasVertex(edge, 'v3')).toBe(false);
    });
  });

  describe('getOtherVertex', () => {
    it('should return the other vertex ID', () => {
      const edge = createEdge('v1', 'v2');

      expect(getOtherVertex(edge, 'v1')).toBe('v2');
      expect(getOtherVertex(edge, 'v2')).toBe('v1');
    });

    it('should return null if vertex not in edge', () => {
      const edge = createEdge('v1', 'v2');

      expect(getOtherVertex(edge, 'v3')).toBeNull();
    });
  });

  describe('getEdgeKey', () => {
    it('should return consistent key regardless of order', () => {
      const key1 = getEdgeKey('a', 'b');
      const key2 = getEdgeKey('b', 'a');

      expect(key1).toBe(key2);
    });
  });
});
