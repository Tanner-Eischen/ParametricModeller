import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRebuildEngine,
  createFeatureRecord,
  type FeatureRebuildHandler,
} from '../../src/features';
import { createBody } from '../../src/geometry';

describe('RebuildEngine', () => {
  let engine: ReturnType<typeof createRebuildEngine>;

  beforeEach(() => {
    engine = createRebuildEngine();
  });

  describe('registerHandler', () => {
    it('should register a handler for a feature type', () => {
      const handler: FeatureRebuildHandler = (_feature, _context) => ({
        ok: true,
        bodies: [],
        diagnostics: [],
      });

      engine.registerHandler('test-type', handler);

      // If it doesn't throw, registration succeeded
      expect(true).toBe(true);
    });
  });

  describe('rebuild', () => {
    it('should return error for unknown feature type', () => {
      const feature = createFeatureRecord('unknown-type', 'Unknown', {});
      const result = engine.rebuild([feature]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('No handler registered');
        expect(result.featureId).toBe(feature.id);
      }
    });

    it('should rebuild features in order', () => {
      const order: string[] = [];

      engine.registerHandler('type-a', (feature, _context) => {
        order.push(feature.id);
        return { ok: true, bodies: [], diagnostics: [] };
      });

      engine.registerHandler('type-b', (feature, _context) => {
        order.push(feature.id);
        return { ok: true, bodies: [], diagnostics: [] };
      });

      const f1 = createFeatureRecord('type-a', 'A', {}, { id: 'f1' });
      const f2 = createFeatureRecord('type-b', 'B', {}, { id: 'f2' });

      engine.rebuild([f1, f2]);

      expect(order).toEqual(['f1', 'f2']);
    });

    it('should skip suppressed features', () => {
      const order: string[] = [];

      engine.registerHandler('test', (feature, _context) => {
        order.push(feature.id);
        return { ok: true, bodies: [], diagnostics: [] };
      });

      const f1 = createFeatureRecord('test', 'A', {}, { id: 'f1' });
      const f2 = createFeatureRecord('test', 'B', {}, { id: 'f2', suppressed: true });
      const f3 = createFeatureRecord('test', 'C', {}, { id: 'f3' });

      engine.rebuild([f1, f2, f3]);

      expect(order).toEqual(['f1', 'f3']);
    });

    it('should stop on feature failure', () => {
      const order: string[] = [];

      engine.registerHandler('test', (feature, _context) => {
        order.push(feature.id);
        if (feature.id === 'f2') {
          return { ok: false, error: 'Failed', diagnostics: [] };
        }
        return { ok: true, bodies: [], diagnostics: [] };
      });

      const f1 = createFeatureRecord('test', 'A', {}, { id: 'f1' });
      const f2 = createFeatureRecord('test', 'B', {}, { id: 'f2' });
      const f3 = createFeatureRecord('test', 'C', {}, { id: 'f3' });

      const result = engine.rebuild([f1, f2, f3]);

      expect(order).toEqual(['f1', 'f2']);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.featureId).toBe('f2');
      }
    });

    it('should accumulate bodies across features', () => {
      engine.registerHandler('test', (feature, _context) => ({
        ok: true,
        bodies: [createBody(undefined, `Body from ${feature.id}`)],
        diagnostics: [],
      }));

      const f1 = createFeatureRecord('test', 'A', {}, { id: 'f1' });
      const f2 = createFeatureRecord('test', 'B', {}, { id: 'f2' });

      const result = engine.rebuild([f1, f2]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.bodies).toHaveLength(2);
      }
    });

    it('should handle exceptions in handlers', () => {
      engine.registerHandler('test', () => {
        throw new Error('Handler crashed');
      });

      const feature = createFeatureRecord('test', 'A', {});
      const result = engine.rebuild([feature]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Handler crashed');
      }
    });
  });
});
