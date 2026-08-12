import { describe, it, expect } from 'vitest';
import {
  createBody,
  addVertex,
  addEdge,
  addFace,
  addPlane,
} from '../../src/geometry';
import { createVertex } from '../../src/geometry/Vertex';
import { createEdge } from '../../src/geometry/Edge';
import { createFace } from '../../src/geometry/Face';
import { createPlane } from '../../src/geometry/Plane';
import {
  getAdjacentFaceIds,
  getFaceVertexIds,
  checkPlanarityPreservation,
  computePlaneEquation,
  PLANARITY_TOLERANCE,
} from '../../src/geometry/SubObjectTypes';

describe('SubObject Utilities', () => {
  describe('computePlaneEquation', () => {
    it('should compute XY plane from origin points', () => {
      const { normal, d } = computePlaneEquation(
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0]
      );

      // Normal should point in +Z direction (or -Z, both valid)
      expect(Math.abs(normal[2])).toBeCloseTo(1, 5);
      expect(d).toBeCloseTo(0, 5);
    });

    it('should compute XZ plane', () => {
      const { normal, d } = computePlaneEquation(
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 1]
      );

      // Normal should point in Y direction
      expect(Math.abs(normal[1])).toBeCloseTo(1, 5);
      expect(d).toBeCloseTo(0, 5);
    });

    it('should compute YZ plane', () => {
      const { normal, d } = computePlaneEquation(
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      );

      // Normal should point in X direction
      expect(Math.abs(normal[0])).toBeCloseTo(1, 5);
      expect(d).toBeCloseTo(0, 5);
    });

    it('should compute offset plane', () => {
      const { normal, d } = computePlaneEquation(
        [0, 0, 1],
        [1, 0, 1],
        [0, 1, 1]
      );

      // Normal should point in Z direction
      expect(Math.abs(normal[2])).toBeCloseTo(1, 5);
      // d should be -1 for plane z = 1
      expect(Math.abs(d + normal[2])).toBeCloseTo(0, 5);
    });
  });

  describe('getFaceVertexIds', () => {
    it('should return empty array for non-existent face', () => {
      const body = createBody();
      const vertexIds = getFaceVertexIds(body, 'non-existent');
      expect(vertexIds).toEqual([]);
    });

    it('should return all vertex IDs for a triangular face', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      const v3 = createVertex([0, 1, 0]);

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);

      const e1 = createEdge(v1.id, v2.id);
      const e2 = createEdge(v2.id, v3.id);
      const e3 = createEdge(v3.id, v1.id);

      addEdge(body, e1);
      addEdge(body, e2);
      addEdge(body, e3);

      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      addPlane(body, plane, 'plane-1');

      const face = createFace('plane-1', [e1.id, e2.id, e3.id]);
      addFace(body, face);

      const vertexIds = getFaceVertexIds(body, face.id);

      expect(vertexIds.length).toBe(3);
      expect(vertexIds).toContain(v1.id);
      expect(vertexIds).toContain(v2.id);
      expect(vertexIds).toContain(v3.id);
    });

    it('should return all vertex IDs for a quadrilateral face', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      const v3 = createVertex([1, 1, 0]);
      const v4 = createVertex([0, 1, 0]);

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);
      addVertex(body, v4);

      const e1 = createEdge(v1.id, v2.id);
      const e2 = createEdge(v2.id, v3.id);
      const e3 = createEdge(v3.id, v4.id);
      const e4 = createEdge(v4.id, v1.id);

      addEdge(body, e1);
      addEdge(body, e2);
      addEdge(body, e3);
      addEdge(body, e4);

      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      addPlane(body, plane, 'plane-1');

      const face = createFace('plane-1', [e1.id, e2.id, e3.id, e4.id]);
      addFace(body, face);

      const vertexIds = getFaceVertexIds(body, face.id);

      expect(vertexIds.length).toBe(4);
      expect(vertexIds).toContain(v1.id);
      expect(vertexIds).toContain(v2.id);
      expect(vertexIds).toContain(v3.id);
      expect(vertexIds).toContain(v4.id);
    });
  });

  describe('getAdjacentFaceIds', () => {
    it('should return empty array for non-existent vertex', () => {
      const body = createBody();
      const faceIds = getAdjacentFaceIds(body, 'non-existent');
      expect(faceIds).toEqual([]);
    });

    it('should return all adjacent faces for a vertex', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      const v3 = createVertex([0, 1, 0]);
      const v4 = createVertex([0, 0, 1]);

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);
      addVertex(body, v4);

      // Edges from v1 to other vertices
      const e1 = createEdge(v1.id, v2.id);
      const e2 = createEdge(v1.id, v3.id);
      const e3 = createEdge(v1.id, v4.id);
      const e4 = createEdge(v2.id, v3.id);
      const e5 = createEdge(v3.id, v4.id);
      const e6 = createEdge(v4.id, v2.id);

      addEdge(body, e1);
      addEdge(body, e2);
      addEdge(body, e3);
      addEdge(body, e4);
      addEdge(body, e5);
      addEdge(body, e6);

      // Create three faces sharing v1
      const plane1 = createPlane([0, 0, 0], [0, 0, 1]);
      const plane2 = createPlane([0, 0, 0], [0, 1, 0]);
      const plane3 = createPlane([0, 0, 0], [1, 0, 0]);

      addPlane(body, plane1, 'plane-1');
      addPlane(body, plane2, 'plane-2');
      addPlane(body, plane3, 'plane-3');

      const face1 = createFace('plane-1', [e1.id, e4.id, e2.id]);
      const face2 = createFace('plane-2', [e2.id, e5.id, e3.id]);
      const face3 = createFace('plane-3', [e3.id, e6.id, e1.id]);

      addFace(body, face1);
      addFace(body, face2);
      addFace(body, face3);

      const adjacentFaces = getAdjacentFaceIds(body, v1.id);

      expect(adjacentFaces.length).toBe(3);
      expect(adjacentFaces).toContain(face1.id);
      expect(adjacentFaces).toContain(face2.id);
      expect(adjacentFaces).toContain(face3.id);
    });
  });

  describe('checkPlanarityPreservation', () => {
    it('should return ok: true for valid vertex move on planar face', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      const v3 = createVertex([1, 1, 0]);
      const v4 = createVertex([0, 1, 0]);

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);
      addVertex(body, v4);

      const e1 = createEdge(v1.id, v2.id);
      const e2 = createEdge(v2.id, v3.id);
      const e3 = createEdge(v3.id, v4.id);
      const e4 = createEdge(v4.id, v1.id);

      addEdge(body, e1);
      addEdge(body, e2);
      addEdge(body, e3);
      addEdge(body, e4);

      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      addPlane(body, plane, 'plane-1');

      const face = createFace('plane-1', [e1.id, e2.id, e3.id, e4.id]);
      addFace(body, face);

      // Move vertex within the plane (valid)
      const result = checkPlanarityPreservation(body, v1.id, [0.5, 0.5, 0]);

      expect(result.ok).toBe(true);
    });

    it('should return ok: false for move that would break planarity', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      const v3 = createVertex([1, 1, 0]);
      const v4 = createVertex([0, 1, 0]);

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);
      addVertex(body, v4);

      const e1 = createEdge(v1.id, v2.id);
      const e2 = createEdge(v2.id, v3.id);
      const e3 = createEdge(v3.id, v4.id);
      const e4 = createEdge(v4.id, v1.id);

      addEdge(body, e1);
      addEdge(body, e2);
      addEdge(body, e3);
      addEdge(body, e4);

      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      addPlane(body, plane, 'plane-1');

      const face = createFace('plane-1', [e1.id, e2.id, e3.id, e4.id]);
      addFace(body, face);

      // Move vertex out of the plane (invalid)
      const result = checkPlanarityPreservation(body, v1.id, [0, 0, 0.1]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violatingFaces.length).toBeGreaterThan(0);
        expect(result.violatingFaces).toContain(face.id);
      }
    });

    it('should return ok: true for very small planar displacement within tolerance', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      const v3 = createVertex([1, 1, 0]);
      const v4 = createVertex([0, 1, 0]);

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);
      addVertex(body, v4);

      const e1 = createEdge(v1.id, v2.id);
      const e2 = createEdge(v2.id, v3.id);
      const e3 = createEdge(v3.id, v4.id);
      const e4 = createEdge(v4.id, v1.id);

      addEdge(body, e1);
      addEdge(body, e2);
      addEdge(body, e3);
      addEdge(body, e4);

      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      addPlane(body, plane, 'plane-1');

      const face = createFace('plane-1', [e1.id, e2.id, e3.id, e4.id]);
      addFace(body, face);

      // Move vertex by tiny amount within tolerance
      const result = checkPlanarityPreservation(body, v1.id, [0, 0, PLANARITY_TOLERANCE / 10]);

      expect(result.ok).toBe(true);
    });
  });
});
