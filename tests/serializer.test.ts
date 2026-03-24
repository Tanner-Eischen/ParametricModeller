import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../src/persistence/serializer';
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
        expect(parsed.version).toBe('0.1.0');
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
