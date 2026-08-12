import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRebuildEngine,
  createFeatureRecord,
  type FeatureRebuildHandler,
} from '../../src/features';
import { addVertex, createBody } from '../../src/geometry';
import { createVertex } from '../../src/geometry/Vertex';

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

    it('captures deep per-feature snapshots before a later same-ID edit', () => {
      engine.registerHandler('source', () => {
        const body = createBody('stable-body', 'Source');
        addVertex(body, createVertex([2, 0, 0], 'vertex'));
        return { ok: true, bodies: [body], diagnostics: [] };
      });
      engine.registerHandler('edit', (_feature, context) => {
        const body = context.bodiesByFeature.get('source')![0]!;
        body.vertices.get('vertex')!.position[0] = 1;
        return {
          ok: true,
          bodies: [body],
          diagnostics: [],
          replacedBodyIds: [body.id],
        };
      });

      const result = engine.rebuild([
        createFeatureRecord('source', 'Source', {}, { id: 'source' }),
        createFeatureRecord('edit', 'Edit', {}, {
          id: 'edit',
          refsIn: ['source'],
        }),
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.bodies[0]?.vertices.get('vertex')?.position).toEqual([1, 0, 0]);
      expect(result.bodiesByFeature.get('source')?.[0]?.vertices.get('vertex')?.position)
        .toEqual([2, 0, 0]);
      expect(result.bodiesByFeature.get('edit')?.[0]?.vertices.get('vertex')?.position)
        .toEqual([1, 0, 0]);
      expect(result.featureByBodyId.get('stable-body')).toBe('edit');
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

    it('fails before executing handlers when a dependency is missing', () => {
      const order: string[] = [];
      engine.registerHandler('test', (feature) => {
        order.push(feature.id);
        return { ok: true, bodies: [], diagnostics: [] };
      });
      const feature = createFeatureRecord('test', 'Broken', {}, {
        id: 'broken',
        refsIn: ['deleted-feature'],
      });

      const result = engine.rebuild([feature]);

      expect(result.ok).toBe(false);
      expect(order).toEqual([]);
      expect(result.diagnostics.some((item) => item.code === 'MISSING_DEPENDENCY')).toBe(true);
    });

    it('fails before executing handlers when dependencies form a cycle', () => {
      engine.registerHandler('test', () => ({ ok: true, bodies: [], diagnostics: [] }));
      const first = createFeatureRecord('test', 'First', {}, { id: 'first', refsIn: ['second'] });
      const second = createFeatureRecord('test', 'Second', {}, { id: 'second', refsIn: ['first'] });

      const result = engine.rebuild([first, second]);

      expect(result.ok).toBe(false);
      expect(result.diagnostics.some((item) => item.code === 'DEPENDENCY_CYCLE')).toBe(true);
    });
  });
});
