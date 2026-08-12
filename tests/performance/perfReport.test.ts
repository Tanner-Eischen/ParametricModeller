import { describe, expect, it } from 'vitest';
import { createRebuildEngine } from '../../src/features/RebuildEngine';
import { BOX_FEATURE_TYPE, rebuildBox } from '../../src/features/primitives/BoxFeature';
import {
  PerfRecorder,
  instrumentRebuildEngine,
} from '../../src/performance/PerfReport';
import { evaluatePerformanceBudget } from '../../src/performance/PerformanceBudget';
import { createReferenceBoxFeatures } from '../../src/performance/ReferenceBenchmark';

function sequenceClock(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

describe('PerfRecorder', () => {
  it('produces stable, sorted, JSON-serializable timing and interaction stats', () => {
    const recorder = new PerfRecorder(
      'deterministic-test-environment',
      sequenceClock([0, 1, 4, 5, 9, 12, 14])
    );

    recorder.beginRebuild(2);
    recorder.measureFeature({ id: 'feature-z', type: 'box' }, () => undefined);
    recorder.measureFeature({ id: 'feature-a', type: 'sketch' }, () => undefined);
    recorder.finishRebuild();
    recorder.recordCacheLookup(false);
    recorder.recordCacheLookup(true);
    const pick = recorder.measurePicking(200, () => 'hit', (result) => result === 'hit');

    expect(pick).toBe('hit');
    expect(recorder.snapshot()).toEqual({
      schemaVersion: 1,
      referenceEnvironment: 'deterministic-test-environment',
      featureCount: 2,
      totalRebuildMs: 12,
      featureTimings: [
        {
          featureId: 'feature-a',
          featureType: 'sketch',
          invocations: 1,
          totalMs: 4,
          maxMs: 4,
        },
        {
          featureId: 'feature-z',
          featureType: 'box',
          invocations: 1,
          totalMs: 3,
          maxMs: 3,
        },
      ],
      cache: { lookups: 2, hits: 1, misses: 1, hitRate: 0.5 },
      picking: {
        queries: 1,
        candidates: 200,
        hits: 1,
        totalMs: 0,
        averageMs: 0,
        maxMs: 0,
      },
    });
    expect(() => JSON.stringify(recorder.snapshot())).not.toThrow();
  });

  it('instruments an existing rebuild engine without changing its result', () => {
    const recorder = new PerfRecorder('test');
    const engine = instrumentRebuildEngine(createRebuildEngine(), recorder);
    engine.registerHandler(BOX_FEATURE_TYPE, rebuildBox);

    const features = createReferenceBoxFeatures().slice(0, 2);
    const result = engine.rebuild(features);
    const report = recorder.snapshot();

    expect(result.ok).toBe(true);
    expect(result.ok && result.bodies).toHaveLength(2);
    expect(report.featureCount).toBe(2);
    expect(report.featureTimings.map((timing) => timing.featureId)).toEqual([
      'perf_box_000',
      'perf_box_001',
    ]);
  });

  it('reports every exceeded budget with exact metric names', () => {
    const report = {
      schemaVersion: 1 as const,
      referenceEnvironment: 'test',
      featureCount: 200,
      totalRebuildMs: 301,
      featureTimings: [],
      cache: { lookups: 0, hits: 0, misses: 0, hitRate: 0 },
      picking: {
        queries: 1,
        candidates: 200,
        hits: 0,
        totalMs: 51,
        averageMs: 51,
        maxMs: 51,
      },
    };

    expect(evaluatePerformanceBudget(report, {
      maxRebuildMs: 300,
      maxAveragePickingMs: 50,
      maxSinglePickingMs: 50,
    })).toEqual([
      { metric: 'totalRebuildMs', actualMs: 301, budgetMs: 300 },
      { metric: 'averagePickingMs', actualMs: 51, budgetMs: 50 },
      { metric: 'maxPickingMs', actualMs: 51, budgetMs: 50 },
    ]);
  });
});
