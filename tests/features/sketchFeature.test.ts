/**
 * Tests for SketchFeature.
 */
import { describe, it, expect } from 'vitest';
import {
  SKETCH_FEATURE_TYPE,
  validateSketchParams,
  createSketchFeature,
  rebuildSketch,
  addEntityToSketchFeature,
  createDefaultRectSketch,
  defaultSketchParams,
  registerBodies,
  type SketchParams,
} from '../../src/features';
import {
  createFacePlaneRef,
  createWorldPlaneRef,
  createRectangleEntity,
  projectModelEdgeToSketch,
} from '../../src/sketch';
import {
  addEdge,
  addVertex,
  createBody,
  createEdge,
  createVertex,
  createWorldConstructionPlane,
} from '../../src/geometry';
import { createRebuildContext } from '../../src/features';
import type { FeatureRecord } from '../../src/features';
import {
  migrateSketchParams,
  type NormalizedSketchParams,
} from '../../src/features/sketch/SketchFeature';

describe('SketchFeature', () => {
  describe('SKETCH_FEATURE_TYPE', () => {
    it('should be "sketch"', () => {
      expect(SKETCH_FEATURE_TYPE).toBe('sketch');
    });
  });

  describe('defaultSketchParams', () => {
    it('should have default values', () => {
      expect(defaultSketchParams.planeRef.type).toBe('world');
      expect(defaultSketchParams.entities).toEqual([]);
      expect(defaultSketchParams.dimensions).toEqual([]);
    });
  });

  describe('validateSketchParams', () => {
    it('should return empty array for valid params', () => {
      const params: SketchParams = {
        planeRef: createWorldPlaneRef('xy'),
        entities: [createRectangleEntity([0, 0], 1, 1)],
        dimensions: [],
      };
      const diagnostics = validateSketchParams(params);
      expect(diagnostics).toHaveLength(0);
    });

    it('should error on missing plane ref', () => {
      const diagnostics = validateSketchParams({});
      expect(diagnostics.some(d => d.code === 'MISSING_PLANE_REF')).toBe(true);
    });

    it('should error on invalid world plane type', () => {
      const diagnostics = validateSketchParams({
        planeRef: { id: '1', type: 'world' },
      });
      expect(diagnostics.some(d => d.code === 'INVALID_PLANE_REF')).toBe(true);
    });

    it('should error on face plane without faceId', () => {
      const diagnostics = validateSketchParams({
        planeRef: { id: '1', type: 'face', bodyId: 'body-1' },
      });
      expect(diagnostics.some(d => d.code === 'INVALID_PLANE_REF')).toBe(true);
    });

    it('should error on face plane without bodyId', () => {
      const diagnostics = validateSketchParams({
        planeRef: { id: '1', type: 'face', faceId: 'face-1' },
      });
      expect(diagnostics.some(d => d.code === 'INVALID_PLANE_REF')).toBe(true);
    });

    it('should error on invalid rectangle entity', () => {
      const params: SketchParams = {
        planeRef: createWorldPlaneRef('xy'),
        entities: [{ ...createRectangleEntity([0, 0], 0, 1), width: 0 }],
        dimensions: [],
      };
      const diagnostics = validateSketchParams(params);
      expect(diagnostics.some(d => d.code === 'INVALID_ENTITY')).toBe(true);
    });
  });

  describe('createSketchFeature', () => {
    it('should create a sketch feature', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });

      expect(feature.type).toBe('sketch');
      expect(feature.id).toBeDefined();
      expect(feature.suppressed).toBe(false);
      expect(feature.refsIn).toEqual([]);
      expect(feature.refsOut).toContain(feature.id);
    });

    it('should use provided name', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] }, 'My Sketch');
      expect(feature.name).toBe('My Sketch');
    });

    it('should add dependency for face-based sketch', () => {
      const planeRef = createFacePlaneRef('face-1', 'body-1', 'box-feature');

      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });
      expect(feature.refsIn).toEqual(['box-feature']);
    });

    it('retains legacy body dependencies when no owner is available', () => {
      const planeRef = createFacePlaneRef('face-1', 'body-1');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });

      expect(feature.refsIn).toEqual(['body-1']);
    });

    it('retains plane and projected model feature dependencies in refsIn', () => {
      const planeRef = createFacePlaneRef('face-1', 'body-1', 'plane-feature');
      const feature = createSketchFeature({
        planeRef,
        entities: [],
        dimensions: [],
        geometry: {
          schemaVersion: 1,
          points: [
            { id: 'projected-a', position: [0, 0] },
            { id: 'projected-b', position: [1, 0] },
          ],
          segments: [{
            id: 'projected-segment',
            type: 'line',
            startPointId: 'projected-a',
            endPointId: 'projected-b',
            construction: true,
            sourceRef: {
              kind: 'model-edge',
              featureId: 'source-feature',
              bodyId: 'source-body',
              edgeId: 'source-edge',
              vertexIds: ['source-a', 'source-b'],
            },
          }],
        },
      });

      expect(feature.refsIn).toEqual(['plane-feature', 'source-feature']);
    });

    it('should store entities in parameters', () => {
      const planeRef = createWorldPlaneRef('xy');
      const rect = createRectangleEntity([0, 0], 1, 1);
      const feature = createSketchFeature({ planeRef, entities: [rect], dimensions: [] });

      const params = feature.parameters as unknown as SketchParams;
      expect(params.entities).toHaveLength(1);
      expect(params.entities[0]?.id).toBe(rect.id);
    });
  });

  describe('rebuildSketch', () => {
    it('should return empty bodies array for valid sketch', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });
      const context = createRebuildContext();

      const result = rebuildSketch(feature, context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.bodies).toEqual([]);
      }
    });

    it('should return error for invalid params', () => {
      const feature: FeatureRecord = {
        id: '1',
        type: 'sketch',
        name: 'Test',
        parameters: {
          // planeRef with invalid world plane type
          planeRef: { id: '1', type: 'world' }, // missing worldPlane
          entities: [],
          dimensions: [],
        },
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };
      const context = createRebuildContext();

      const result = rebuildSketch(feature, context);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it('solves legacy driving dimensions and emits a materialized live sketch', () => {
      const rectangle = createRectangleEntity([0, 0], 4, 3, 0, 'rectangle');
      const feature = createSketchFeature({
        planeRef: createWorldPlaneRef('xy'),
        entities: [rectangle],
        dimensions: [
          { id: 'width', type: 'width', entityId: rectangle.id, value: 6 },
          { id: 'height', type: 'height', entityId: rectangle.id, value: 2 },
        ],
      });

      const result = rebuildSketch(feature, createRebuildContext());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.outputs?.[0];
      expect(output?.kind).toBe('sketch');
      if (output?.kind !== 'sketch') return;
      expect(output.sketch.entities).toHaveLength(4);
      const points = output.sketch.entities.flatMap((entity) =>
        entity.type === 'line' ? [entity.start, entity.end] : []
      );
      expect(Math.max(...points.map((point) => point[0]))).toBeCloseTo(6, 5);
      expect(Math.max(...points.map((point) => point[1]))).toBeCloseTo(2, 5);
    });

    it('fails closed with actionable diagnostics for inconsistent persisted relations', () => {
      const feature = createSketchFeature({
        planeRef: createWorldPlaneRef('xy'),
        entities: [],
        dimensions: [],
        geometry: {
          schemaVersion: 1,
          points: [
            { id: 'a', position: [0, 0] },
            { id: 'b', position: [1, 0] },
          ],
          segments: [
            { id: 'line', type: 'line', startPointId: 'a', endPointId: 'b', construction: false },
          ],
        },
        relations: [
          { id: 'fix-a', type: 'fixed', pointId: 'a', position: [0, 0] },
          { id: 'fix-b', type: 'fixed', pointId: 'b', position: [1, 0] },
        ],
        drivingDimensions: [
          { id: 'length', type: 'distance', pointAId: 'a', pointBId: 'b', value: 2 },
        ],
      });

      const result = rebuildSketch(feature, createRebuildContext());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: 'INCONSISTENT_CONSTRAINTS',
        featureId: feature.id,
      }));
    });

    it('emits identical solved sketch output across ten rebuilds', () => {
      const rectangle = createRectangleEntity([0, 0], 2, 3, 0, 'stable-rectangle');
      const feature = createSketchFeature({
        planeRef: { id: 'xy', type: 'world', worldPlane: 'xy', offset: 0 },
        entities: [rectangle],
        dimensions: [
          { id: 'width', type: 'width', entityId: rectangle.id, value: 5 },
          { id: 'height', type: 'height', entityId: rectangle.id, value: 4 },
        ],
      });
      feature.id = 'stable-sketch';
      const outputs = Array.from({ length: 10 }, () => {
        const result = rebuildSketch(feature, createRebuildContext());
        if (!result.ok) throw new Error(result.error);
        return JSON.stringify(result.outputs);
      });

      expect(new Set(outputs).size).toBe(1);
    });

    it('refreshes projected edge coordinates from the live source body during rebuild', () => {
      const sourceBody = createBody('source-body', 'Source');
      addVertex(sourceBody, createVertex([1, 2, 0], 'source-a'));
      addVertex(sourceBody, createVertex([4, 2, 0], 'source-b'));
      addEdge(sourceBody, createEdge('source-a', 'source-b', 'source-edge'));
      const plane = createWorldConstructionPlane('xy', 0, 'xy');
      const projected = projectModelEdgeToSketch(
        { schemaVersion: 1, points: [], segments: [] },
        {
          featureId: 'source-feature',
          bodyId: sourceBody.id,
          edgeId: 'source-edge',
        },
        sourceBody,
        plane
      );
      if (!projected.ok) throw new Error(projected.error.message);
      const sketchFeature = createSketchFeature({
        planeRef: createWorldPlaneRef('xy', 0),
        entities: [],
        dimensions: [],
        geometry: projected.geometry,
      });
      expect(sketchFeature.refsIn).toContain('source-feature');

      sourceBody.vertices.set('source-a', createVertex([2, 3, 0], 'source-a'));
      sourceBody.vertices.set('source-b', createVertex([8, 3, 0], 'source-b'));
      const context = registerBodies(
        createRebuildContext(),
        'source-feature',
        [sourceBody]
      );
      const result = rebuildSketch(sketchFeature, context);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.outputs?.[0];
      expect(output?.kind).toBe('sketch');
      if (output?.kind !== 'sketch') return;
      expect(output.sketch.entities).toEqual([
        expect.objectContaining({ start: [2, 3], end: [8, 3] }),
      ]);
    });

    it('fails closed with the projected segment ID when source topology is unavailable', () => {
      const sourceBody = createBody('source-body', 'Source');
      addVertex(sourceBody, createVertex([1, 2, 0], 'source-a'));
      addVertex(sourceBody, createVertex([4, 2, 0], 'source-b'));
      addEdge(sourceBody, createEdge('source-a', 'source-b', 'source-edge'));
      const projected = projectModelEdgeToSketch(
        { schemaVersion: 1, points: [], segments: [] },
        { featureId: 'missing-feature', bodyId: sourceBody.id, edgeId: 'source-edge' },
        sourceBody,
        createWorldConstructionPlane('xy', 0, 'xy')
      );
      if (!projected.ok) throw new Error(projected.error.message);
      const sketchFeature = createSketchFeature({
        planeRef: createWorldPlaneRef('xy', 0),
        entities: [],
        dimensions: [],
        geometry: projected.geometry,
      });

      const result = rebuildSketch(sketchFeature, createRebuildContext());

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: 'PROJECTED_EDGE_SOURCE_BODY_NOT_FOUND',
        featureId: sketchFeature.id,
        entityId: projected.createdSegmentId,
      }));
    });
  });

  describe('legacy normalized migration', () => {
    it('preserves legacy entities and dimensions while creating shared points', () => {
      const rectangle = createRectangleEntity([1, 2], 3, 4, 0, 'rect');
      const legacy: SketchParams = {
        planeRef: createWorldPlaneRef('xy'),
        entities: [rectangle],
        dimensions: [{ id: 'width', type: 'width', entityId: 'rect', value: 3 }],
      };
      const migrated = migrateSketchParams(legacy);

      expect(migrated.entities).toEqual(legacy.entities);
      expect(migrated.dimensions).toEqual(legacy.dimensions);
      expect(migrated.geometry.points).toHaveLength(4);
      expect(migrated.geometry.segments).toHaveLength(4);
      expect(migrated.relations).toHaveLength(5);
      expect(migrated.drivingDimensions).toEqual([
        expect.objectContaining({ id: 'width', type: 'distance', value: 3 }),
      ]);
      expect((migrated as NormalizedSketchParams).legacySourceSignature).toBeTruthy();
    });

    it('keeps explicitly supplied normalized geometry authoritative over a legacy cache', () => {
      const feature = createSketchFeature({
        planeRef: createWorldPlaneRef('xy'),
        entities: [createRectangleEntity([0, 0], 1, 1, 0, 'legacy-cache')],
        dimensions: [],
        geometry: {
          schemaVersion: 1,
          points: [
            { id: 'a', position: [10, 10] },
            { id: 'b', position: [12, 10] },
          ],
          segments: [
            { id: 'authoritative', type: 'line', startPointId: 'a', endPointId: 'b', construction: false },
          ],
        },
      });
      const params = feature.parameters as unknown as NormalizedSketchParams;

      expect(params.geometry.segments.map((segment) => segment.id)).toEqual(['authoritative']);
      expect(params.entities[0]?.id).toBe('legacy-cache');
    });
  });

  describe('addEntityToSketchFeature', () => {
    it('should add entity to sketch feature', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createSketchFeature({ planeRef, entities: [], dimensions: [] });
      const rect = createRectangleEntity([0, 0], 1, 1);

      const updated = addEntityToSketchFeature(feature, rect);
      const params = updated.parameters as unknown as SketchParams;
      expect(params.entities).toHaveLength(1);
    });

    it('should not modify non-sketch feature', () => {
      const feature: FeatureRecord = {
        id: '1',
        type: 'box',
        name: 'Test',
        parameters: {},
        refsIn: [],
        refsOut: [],
        suppressed: false,
      };
      const rect = createRectangleEntity([0, 0], 1, 1);

      const updated = addEntityToSketchFeature(feature, rect);
      expect(updated).toBe(feature);
    });
  });

  describe('createDefaultRectSketch', () => {
    it('should create sketch with default rectangle', () => {
      const planeRef = createWorldPlaneRef('xy');
      const feature = createDefaultRectSketch(planeRef, 2, 3);

      expect(feature.type).toBe('sketch');
      const params = feature.parameters as unknown as SketchParams;
      expect(params.entities).toHaveLength(1);

      const rect = params.entities[0];
      expect(rect?.type).toBe('rectangle');
      if (rect?.type === 'rectangle') {
        expect(rect.width).toBe(2);
        expect(rect.height).toBe(3);
      }
    });
  });
});
