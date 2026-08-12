import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../src/persistence/serializer';
import { CURRENT_SCHEMA_VERSION } from '../src/persistence/Migrations';
import { createDefaultDocument } from '../src/types';
import type { Document } from '../src/types';

describe('serializer', () => {
  describe('serialize', () => {
    it('should serialize a document to JSON', () => {
      const doc = createDefaultDocument('Test Document');
      const result = serialize(doc);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.json);
        expect(parsed.version).toBe(CURRENT_SCHEMA_VERSION);
        expect(parsed.metadata.name).toBe('Test Document');
      }
    });

    it('should produce pretty-printed JSON', () => {
      const doc = createDefaultDocument();
      const result = serialize(doc);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.json).toContain('\n');
        expect(result.json).toContain('  ');
      }
    });

    it('should preserve bodies and features', () => {
      const doc: Document = {
        ...createDefaultDocument(),
        bodies: [
          {
            id: 'test-id',
            name: 'Test Body',
            type: 'solid',
            transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            visible: true,
            locked: false,
          },
        ],
        features: [],
        components: [],
        componentInstances: [],
        constraints: [],
        activeComponentId: null,
      };

      const result = serialize(doc);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const parsed = JSON.parse(result.json);
        expect(parsed.bodies).toHaveLength(1);
        expect(parsed.bodies[0].name).toBe('Test Body');
      }
    });
  });

  describe('deserialize', () => {
    it('should deserialize valid JSON', () => {
      const doc = createDefaultDocument('Original');
      const serialized = serialize(doc);

      expect(serialized.ok).toBe(true);
      if (!serialized.ok) return;

      const result = deserialize(serialized.json);
      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.document.metadata.name).toBe('Original');
      }
    });

    it('should reject invalid JSON', () => {
      const result = deserialize('not json');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unexpected');
      }
    });

    it('should reject non-document objects', () => {
      const result = deserialize('{"foo": "bar"}');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Invalid document structure');
      }
    });

    it('should reject incompatible versions', () => {
      const json = JSON.stringify({
        version: '1.0.0',
        metadata: { name: 'Test', created: '2024-01-01', modified: '2024-01-01' },
        bodies: [],
      });

      const result = deserialize(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Incompatible schema version');
      }
    });

    it('should accept 0.1.x versions', () => {
      const json = JSON.stringify({
        version: '0.1.5',
        metadata: { name: 'Test', created: '2024-01-01', modified: '2024-01-01' },
        bodies: [],
        features: [],
      });

      const result = deserialize(json);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.document.version).toBe(CURRENT_SCHEMA_VERSION);
        expect(result.migrationDiagnostics).toMatchObject([
          { fromVersion: '0.1.5', toVersion: '0.2.0' },
          { fromVersion: '0.2.0', toVersion: CURRENT_SCHEMA_VERSION },
        ]);
      }
    });

    it('rejects a future patch version without attempting to normalize it', () => {
      const result = deserialize(JSON.stringify({
        version: '0.3.1',
        metadata: { name: 'Future', created: '2024-01-01', modified: '2024-01-01' },
        bodies: [],
      }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('newer than supported version');
      }
    });

    it('should fill in missing optional fields', () => {
      const json = JSON.stringify({
        version: '0.1.0',
        metadata: { name: 'Test', created: '2024-01-01', modified: '2024-01-01' },
        bodies: [],
      });

      const result = deserialize(json);
      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.document.config).toBeDefined();
        expect(result.document.config.units).toBe('inch');
        expect(result.document.features).toEqual([]);
      }
    });

    it('migrates legacy face sketches to the latest earlier body owner', () => {
      const doc = createDefaultDocument('Legacy Face Sketch');
      doc.features = [
        {
          id: 'box-feature',
          type: 'box',
          name: 'Box',
          parameters: {},
          refsIn: [],
          refsOut: ['box-body'],
          suppressed: false,
        },
        {
          id: 'face-sketch',
          type: 'sketch',
          name: 'Face Sketch',
          parameters: {
            planeRef: {
              id: 'plane-ref',
              type: 'face',
              faceId: 'box-body_face_pos_z',
              bodyId: 'box-body',
            },
            entities: [],
            dimensions: [],
          },
          refsIn: ['box-body'],
          refsOut: ['face-sketch'],
          suppressed: false,
        },
      ];

      const result = deserialize(JSON.stringify(doc));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const sketch = result.document.features[1]!;
      expect(sketch.refsIn).toEqual(['box-feature']);
      expect(sketch.parameters.planeRef).toMatchObject({
        bodyId: 'box-body',
        featureId: 'box-feature',
      });

      const roundTrip = serialize(result.document);
      expect(roundTrip.ok).toBe(true);
      if (!roundTrip.ok) return;
      const second = deserialize(roundTrip.json);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.document.features[1]?.refsIn).toEqual(['box-feature']);
        expect(second.document.features[1]?.parameters.planeRef).toMatchObject({
          featureId: 'box-feature',
        });
      }
    });

    it('losslessly migrates and round-trips legacy sketch geometry', () => {
      const doc = createDefaultDocument('Legacy Sketch Geometry');
      const legacyEntities = [{
        id: 'rectangle',
        type: 'rectangle',
        origin: [1, 2],
        width: 6,
        height: 3,
        rotation: 0,
      }];
      const legacyDimensions = [{
        id: 'width',
        type: 'width',
        entityId: 'rectangle',
        value: 6,
        name: 'Board width',
      }];
      doc.features = [{
        id: 'sketch',
        type: 'sketch',
        name: 'Sketch',
        parameters: {
          planeRef: { id: 'xy', type: 'world', worldPlane: 'xy', offset: 0 },
          entities: legacyEntities,
          dimensions: legacyDimensions,
        },
        refsIn: [],
        refsOut: ['sketch'],
        suppressed: false,
      }];

      const result = deserialize(JSON.stringify(doc));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const migrated = result.document.features[0]!.parameters;
      expect(migrated.entities).toEqual(legacyEntities);
      expect(migrated.dimensions).toEqual(legacyDimensions);
      expect((migrated.geometry as { points: unknown[] }).points).toHaveLength(4);
      expect(migrated.relations).toBeDefined();
      expect(migrated.drivingDimensions).toBeDefined();

      const serialized = serialize(result.document);
      expect(serialized.ok).toBe(true);
      if (!serialized.ok) return;
      const second = deserialize(serialized.json);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.document.features[0]!.parameters).toEqual(migrated);
    });

    it('normalizes legacy sketches during save without mutating the source document', () => {
      const doc = createDefaultDocument('Save Migration');
      doc.features = [{
        id: 'line-sketch',
        type: 'sketch',
        name: 'Line Sketch',
        parameters: {
          planeRef: { id: 'xy', type: 'world', worldPlane: 'xy' },
          entities: [{ id: 'line', type: 'line', start: [0, 0], end: [1, 0] }],
          dimensions: [],
        },
        refsIn: [],
        refsOut: ['line-sketch'],
        suppressed: false,
      }];

      const result = serialize(doc);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(doc.features[0]!.parameters.geometry).toBeUndefined();
      const parsed = JSON.parse(result.json) as Document;
      expect(parsed.features[0]!.parameters.geometry).toBeDefined();
      expect(parsed.features[0]!.parameters.entities).toEqual(doc.features[0]!.parameters.entities);
    });
  });

  describe('round-trip', () => {
    it('should preserve document through serialize/deserialize cycle', () => {
      const original: Document = {
        version: '0.1.0',
        metadata: {
          name: 'Round Trip Test',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-02T00:00:00.000Z',
        },
        config: {
          units: 'mm',
          gridSpacing: { major: 25, minor: 5 },
          snapEnabled: false,
        },
        bodies: [
          {
            id: 'body-1',
            name: 'Box 1',
            type: 'solid',
            transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1],
            visible: true,
            locked: false,
          },
        ],
        features: [],
        components: [],
        componentInstances: [],
        constraints: [],
        activeComponentId: null,
      };

      const serialized = serialize(original);
      expect(serialized.ok).toBe(true);
      if (!serialized.ok) return;

      const deserialized = deserialize(serialized.json);
      expect(deserialized.ok).toBe(true);
      if (!deserialized.ok) return;

      expect(deserialized.document.metadata.name).toBe(original.metadata.name);
      expect(deserialized.document.config.units).toBe(original.config.units);
      expect(deserialized.document.config.gridSpacing.major).toBe(25);
      expect(deserialized.document.bodies).toHaveLength(1);
      expect(deserialized.document.bodies[0]?.transform).toEqual(original.bodies[0]?.transform);
    });
  });
});
