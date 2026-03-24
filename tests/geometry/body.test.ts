import { describe, it, expect } from 'vitest';
import {
  createBody,
  addVertex,
  addEdge,
  addFace,
  addPlane,
  getVertex,
  getEdge,
  getFace,
  getPlane,
  getBodyBoundingBox,
  cloneBody,
} from '../../src/geometry';
import { createVertex } from '../../src/geometry/Vertex';
import { createEdge } from '../../src/geometry/Edge';
import { createFace } from '../../src/geometry/Face';
import { createPlane } from '../../src/geometry/Plane';

describe('Body', () => {
  describe('createBody', () => {
    it('should create an empty body', () => {
      const body = createBody();

      expect(body.id).toBeDefined();
      expect(body.name).toBe('Body');
      expect(body.vertices.size).toBe(0);
      expect(body.edges.size).toBe(0);
      expect(body.faces.size).toBe(0);
      expect(body.planes.size).toBe(0);
    });

    it('should create a body with custom ID and name', () => {
      const body = createBody('my-id', 'My Body');

      expect(body.id).toBe('my-id');
      expect(body.name).toBe('My Body');
    });
  });

  describe('addVertex', () => {
    it('should add a vertex to the body', () => {
      const body = createBody();
      const vertex = createVertex([1, 2, 3]);
      const vertexId = addVertex(body, vertex);

      expect(vertexId).toBe(vertex.id);
      expect(body.vertices.has(vertex.id)).toBe(true);
    });
  });

  describe('addEdge', () => {
    it('should add an edge and update vertex references', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);

      addVertex(body, v1);
      addVertex(body, v2);

      const edge = createEdge(v1.id, v2.id);
      const edgeId = addEdge(body, edge);

      expect(edgeId).toBe(edge.id);
      expect(body.edges.has(edge.id)).toBe(true);

      // Check vertex edge references were updated
      const updatedV1 = body.vertices.get(v1.id);
      const updatedV2 = body.vertices.get(v2.id);

      expect(updatedV1?.edgeIds).toContain(edge.id);
      expect(updatedV2?.edgeIds).toContain(edge.id);
    });
  });

  describe('addFace', () => {
    it('should add a face and update edge references', () => {
      const body = createBody();
      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      const v3 = createVertex([1, 1, 0]);

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);
      addPlane(body, plane, 'plane-1');

      const e1 = createEdge(v1.id, v2.id);
      const e2 = createEdge(v2.id, v3.id);
      const e3 = createEdge(v3.id, v1.id);

      addEdge(body, e1);
      addEdge(body, e2);
      addEdge(body, e3);

      const face = createFace('plane-1', [e1.id, e2.id, e3.id]);
      const faceId = addFace(body, face);

      expect(faceId).toBe(face.id);
      expect(body.faces.has(face.id)).toBe(true);

      // Check edge face references were updated
      const updatedE1 = body.edges.get(e1.id);
      expect(updatedE1?.faceIds).toContain(face.id);
    });
  });

  describe('getters', () => {
    it('should get vertex by ID', () => {
      const body = createBody();
      const vertex = createVertex([1, 2, 3]);
      addVertex(body, vertex);

      expect(getVertex(body, vertex.id)).toBe(vertex);
      expect(getVertex(body, 'nonexistent')).toBeUndefined();
    });

    it('should get edge by ID', () => {
      const body = createBody();
      const v1 = createVertex([0, 0, 0]);
      const v2 = createVertex([1, 0, 0]);
      addVertex(body, v1);
      addVertex(body, v2);

      const edge = createEdge(v1.id, v2.id);
      addEdge(body, edge);

      expect(getEdge(body, edge.id)).toBe(edge);
    });

    it('should get face by ID', () => {
      const body = createBody();
      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      addPlane(body, plane, 'plane-1');

      const face = createFace('plane-1', []);
      addFace(body, face);

      expect(getFace(body, face.id)).toBe(face);
    });

    it('should get plane by ID', () => {
      const body = createBody();
      const plane = createPlane([0, 0, 0], [0, 0, 1]);
      addPlane(body, plane, 'plane-1');

      expect(getPlane(body, 'plane-1')).toBe(plane);
    });
  });

  describe('getBodyBoundingBox', () => {
    it('should compute the bounding box', () => {
      const body = createBody();
      addVertex(body, createVertex([0, 0, 0]));
      addVertex(body, createVertex([1, 2, 3]));
      addVertex(body, createVertex([-1, -2, -3]));

      const bbox = getBodyBoundingBox(body);

      expect(bbox.min).toEqual([-1, -2, -3]);
      expect(bbox.max).toEqual([1, 2, 3]);
    });
  });

  describe('cloneBody', () => {
    it('should create a clone with a new ID', () => {
      const body = createBody('original-id', 'Original');
      addVertex(body, createVertex([0, 0, 0]));

      const clone = cloneBody(body, 'clone-id');

      expect(clone.id).toBe('clone-id');
      expect(clone.name).toBe('Original');
      expect(clone.vertices.size).toBe(1);
      // Verify it's a copy, not the same reference
      expect(clone.vertices).not.toBe(body.vertices);
    });
  });
});
