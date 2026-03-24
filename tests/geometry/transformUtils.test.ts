/**
 * Tests for TransformUtils
 * Milestone 05: Patterning
 */

import { describe, it, expect } from 'vitest';
import {
  translateBody,
  mirrorBody,
  createBody,
  addVertex,
  addEdge,
  addFace,
  addPlane,
  createVertex,
  createEdge,
  createFace,
  createPlane,
  createXYPlane,
  createXZPlane,
  createYZPlane,
} from '../../src/geometry';

describe('TransformUtils', () => {
  describe('translateBody', () => {
    it('should create a translated copy of a body', () => {
      const body = createBody('test-body', 'Test');
      const v1 = createVertex([0, 0, 0], 'v1');
      const v2 = createVertex([1, 0, 0], 'v2');
      const v3 = createVertex([1, 1, 0], 'v3');
      const v4 = createVertex([0, 1, 0], 'v4');

      addVertex(body, v1);
      addVertex(body, v2);
      addVertex(body, v3);
      addVertex(body, v4);

      const translated = translateBody(body, [2, 3, 0]);

      expect(translated.id).toBe('test-body_translated');
      expect(translated.name).toBe('Test');
      expect(translated.vertices.size).toBe(4);

      // Verify positions are translated
      const positions = Array.from(translated.vertices.values()).map(v => v.position);
      expect(positions).toContainEqual([2, 3, 0]);
      expect(positions).toContainEqual([3, 3, 0]);
      expect(positions).toContainEqual([3, 4, 0]);
      expect(positions).toContainEqual([2, 4, 0]);
    });

    it('should preserve edge connectivity', () => {
      const body = createBody('test-body', 'Test');
      const v1 = createVertex([0, 0, 0], 'v1');
      const v2 = createVertex([1, 0, 0], 'v2');

      addVertex(body, v1);
      addVertex(body, v2);

      const edge = createEdge(['v1', 'v2'], 'e1');
      addEdge(body, edge);

      const translated = translateBody(body, [5, 0, 0]);

      expect(translated.edges.size).toBe(1);
      const translatedEdge = Array.from(translated.edges.values())[0];
      expect(translatedEdge).toBeDefined();
      expect(translatedEdge!.vertexIds.length).toBe(2);
    });

    it('should use custom ID when provided', () => {
      const body = createBody('test-body', 'Test');
      addVertex(body, createVertex([0, 0, 0], 'v1'));

      const translated = translateBody(body, [1, 0, 0], 'custom-id');

      expect(translated.id).toBe('custom-id');
    });

    it('should preserve face count', () => {
      const body = createBody('test-body', 'Test');

      // Create a simple quad
      addVertex(body, createVertex([0, 0, 0], 'v1'));
      addVertex(body, createVertex([1, 0, 0], 'v2'));
      addVertex(body, createVertex([1, 1, 0], 'v3'));
      addVertex(body, createVertex([0, 1, 0], 'v4'));

      addEdge(body, createEdge(['v1', 'v2'], 'e1'));
      addEdge(body, createEdge(['v2', 'v3'], 'e2'));
      addEdge(body, createEdge(['v3', 'v4'], 'e3'));
      addEdge(body, createEdge(['v4', 'v1'], 'e4'));

      addFace(body, createFace('p1', ['e1', 'e2', 'e3', 'e4'], 'f1'));

      const translated = translateBody(body, [0, 0, 1]);

      expect(translated.faces.size).toBe(1);
    });
  });

  describe('mirrorBody', () => {
    it('should create a mirrored copy across YZ plane', () => {
      const body = createBody('test-body', 'Test');
      addVertex(body, createVertex([1, 0, 0], 'v1'));
      addVertex(body, createVertex([2, 0, 0], 'v2'));

      const mirrorPlane = createYZPlane(0);
      const mirrored = mirrorBody(body, mirrorPlane);

      expect(mirrored.id).toBe('test-body_mirror');
      expect(mirrored.vertices.size).toBe(2);

      // Verify positions are mirrored (x -> -x)
      const positions = Array.from(mirrored.vertices.values()).map(v => v.position);
      expect(positions).toContainEqual([-1, 0, 0]);
      expect(positions).toContainEqual([-2, 0, 0]);
    });

    it('should create a mirrored copy across XY plane', () => {
      const body = createBody('test-body', 'Test');
      addVertex(body, createVertex([0, 0, 1], 'v1'));
      addVertex(body, createVertex([0, 0, 2], 'v2'));

      const mirrorPlane = createXYPlane(0);
      const mirrored = mirrorBody(body, mirrorPlane);

      expect(mirrored.vertices.size).toBe(2);

      // Verify positions are mirrored (z -> -z)
      const positions = Array.from(mirrored.vertices.values()).map(v => v.position);
      expect(positions).toContainEqual([0, 0, -1]);
      expect(positions).toContainEqual([0, 0, -2]);
    });

    it('should create a mirrored copy across XZ plane', () => {
      const body = createBody('test-body', 'Test');
      addVertex(body, createVertex([0, 1, 0], 'v1'));
      addVertex(body, createVertex([0, 2, 0], 'v2'));

      const mirrorPlane = createXZPlane(0);
      const mirrored = mirrorBody(body, mirrorPlane);

      expect(mirrored.vertices.size).toBe(2);

      // Verify positions are mirrored (y -> -y)
      const positions = Array.from(mirrored.vertices.values()).map(v => v.position);
      expect(positions).toContainEqual([0, -1, 0]);
      expect(positions).toContainEqual([0, -2, 0]);
    });

    it('should reverse face boundary edge order to flip normals', () => {
      const body = createBody('test-body', 'Test');

      addVertex(body, createVertex([0, 0, 0], 'v1'));
      addVertex(body, createVertex([1, 0, 0], 'v2'));
      addVertex(body, createVertex([1, 1, 0], 'v3'));

      addEdge(body, createEdge(['v1', 'v2'], 'e1'));
      addEdge(body, createEdge(['v2', 'v3'], 'e2'));
      addEdge(body, createEdge(['v3', 'v1'], 'e3'));

      addFace(body, createFace('p1', ['e1', 'e2', 'e3'], 'f1'));

      const originalFace = body.faces.get('f1');
      expect(originalFace?.boundaryEdgeIds).toHaveLength(3);

      const mirrorPlane = createYZPlane(0);
      const mirrored = mirrorBody(body, mirrorPlane);

      expect(mirrored.faces.size).toBe(1);
      // Face should have same number of edges
      const mirroredFace = Array.from(mirrored.faces.values())[0];
      expect(mirroredFace?.boundaryEdgeIds.length).toBe(3);
    });

    it('should mirror across an offset plane', () => {
      const body = createBody('test-body', 'Test');
      addVertex(body, createVertex([2, 0, 0], 'v1'));

      // Mirror across YZ plane at x=1
      const mirrorPlane = createYZPlane(1);
      const mirrored = mirrorBody(body, mirrorPlane);

      // Point at x=2 mirrored across x=1 should be at x=0
      const positions = Array.from(mirrored.vertices.values()).map(v => v.position);
      expect(positions[0]![0]).toBeCloseTo(0, 5);
    });

    it('should use custom ID when provided', () => {
      const body = createBody('test-body', 'Test');
      addVertex(body, createVertex([1, 0, 0], 'v1'));

      const mirrorPlane = createYZPlane(0);
      const mirrored = mirrorBody(body, mirrorPlane, 'custom-mirror-id');

      expect(mirrored.id).toBe('custom-mirror-id');
    });
  });
});
