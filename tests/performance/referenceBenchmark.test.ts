import { describe, expect, it } from 'vitest';
import { evaluatePerformanceBudget } from '../../src/performance/PerformanceBudget';
import {
  PERFORMANCE_REFERENCE_ENVIRONMENT,
  REFERENCE_FEATURE_COUNT,
  REFERENCE_PERFORMANCE_BUDGET,
  runReferenceBenchmark,
} from '../../src/performance/ReferenceBenchmark';

describe('200-feature reference performance budget', () => {
  it('rebuilds and picks within the CI-stable upper bounds', () => {
    const report = runReferenceBenchmark();

    expect(report.referenceEnvironment).toBe(PERFORMANCE_REFERENCE_ENVIRONMENT);
    expect(report.featureCount).toBe(REFERENCE_FEATURE_COUNT);
    expect(report.featureTimings).toHaveLength(REFERENCE_FEATURE_COUNT);
    expect(report.cache).toEqual({
      lookups: REFERENCE_FEATURE_COUNT * 2,
      hits: REFERENCE_FEATURE_COUNT,
      misses: REFERENCE_FEATURE_COUNT,
      hitRate: 0.5,
    });
    expect(report.picking.queries).toBe(20);
    expect(report.picking.candidates).toBe(REFERENCE_FEATURE_COUNT * 20);
    expect(evaluatePerformanceBudget(report, REFERENCE_PERFORMANCE_BUDGET)).toEqual([]);
  }, 15_000);
});
