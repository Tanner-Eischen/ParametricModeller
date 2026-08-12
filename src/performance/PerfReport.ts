import type { FeatureRecord } from '../features/FeatureRecord';
import type {
  FeatureRebuildHandler,
  RebuildEngine,
  RebuildResult,
} from '../features/RebuildEngine';

/** A monotonic clock in milliseconds. Injectable so instrumentation is deterministic in tests. */
export type PerfClock = () => number;

export interface FeatureTiming {
  featureId: string;
  featureType: string;
  invocations: number;
  totalMs: number;
  maxMs: number;
}

export interface CachePerfStats {
  lookups: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface PickingPerfStats {
  queries: number;
  candidates: number;
  hits: number;
  totalMs: number;
  averageMs: number;
  maxMs: number;
}

/** Stable, JSON-serializable output from one rebuild/performance run. */
export interface PerfReport {
  schemaVersion: 1;
  referenceEnvironment: string;
  featureCount: number;
  totalRebuildMs: number;
  featureTimings: FeatureTiming[];
  cache: CachePerfStats;
  picking: PickingPerfStats;
}

interface MutableFeatureTiming {
  featureType: string;
  invocations: number;
  totalMs: number;
  maxMs: number;
}

const defaultClock: PerfClock = () => performance.now();

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function elapsed(start: number, end: number): number {
  return Math.max(0, end - start);
}

/**
 * Collects rebuild, per-feature, cache, and picking measurements.
 * `beginRebuild` starts a fresh report; use an injected clock for repeatable tests.
 */
export class PerfRecorder {
  private readonly clock: PerfClock;
  private readonly referenceEnvironment: string;
  private rebuildStartedAt = 0;
  private totalRebuildMs = 0;
  private featureCount = 0;
  private readonly features = new Map<string, MutableFeatureTiming>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private pickingQueries = 0;
  private pickingCandidates = 0;
  private pickingHits = 0;
  private pickingTotalMs = 0;
  private pickingMaxMs = 0;

  constructor(referenceEnvironment: string, clock: PerfClock = defaultClock) {
    this.referenceEnvironment = referenceEnvironment;
    this.clock = clock;
  }

  beginRebuild(featureCount: number): void {
    this.reset();
    this.featureCount = featureCount;
    this.rebuildStartedAt = this.clock();
  }

  finishRebuild(): void {
    this.totalRebuildMs = elapsed(this.rebuildStartedAt, this.clock());
  }

  measureFeature<T>(feature: Pick<FeatureRecord, 'id' | 'type'>, operation: () => T): T {
    const startedAt = this.clock();
    try {
      return operation();
    } finally {
      const durationMs = elapsed(startedAt, this.clock());
      const previous = this.features.get(feature.id);
      this.features.set(feature.id, {
        featureType: feature.type,
        invocations: (previous?.invocations ?? 0) + 1,
        totalMs: (previous?.totalMs ?? 0) + durationMs,
        maxMs: Math.max(previous?.maxMs ?? 0, durationMs),
      });
    }
  }

  recordCacheLookup(hit: boolean): void {
    if (hit) {
      this.cacheHits += 1;
    } else {
      this.cacheMisses += 1;
    }
  }

  measurePicking<T>(candidateCount: number, operation: () => T, isHit: (result: T) => boolean): T {
    const startedAt = this.clock();
    try {
      const result = operation();
      this.pickingHits += isHit(result) ? 1 : 0;
      return result;
    } finally {
      const durationMs = elapsed(startedAt, this.clock());
      this.pickingQueries += 1;
      this.pickingCandidates += Math.max(0, candidateCount);
      this.pickingTotalMs += durationMs;
      this.pickingMaxMs = Math.max(this.pickingMaxMs, durationMs);
    }
  }

  snapshot(): PerfReport {
    const lookups = this.cacheHits + this.cacheMisses;
    const featureTimings = [...this.features.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([featureId, timing]) => ({
        featureId,
        featureType: timing.featureType,
        invocations: timing.invocations,
        totalMs: rounded(timing.totalMs),
        maxMs: rounded(timing.maxMs),
      }));

    return {
      schemaVersion: 1,
      referenceEnvironment: this.referenceEnvironment,
      featureCount: this.featureCount,
      totalRebuildMs: rounded(this.totalRebuildMs),
      featureTimings,
      cache: {
        lookups,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: lookups === 0 ? 0 : rounded(this.cacheHits / lookups),
      },
      picking: {
        queries: this.pickingQueries,
        candidates: this.pickingCandidates,
        hits: this.pickingHits,
        totalMs: rounded(this.pickingTotalMs),
        averageMs: this.pickingQueries === 0 ? 0 : rounded(this.pickingTotalMs / this.pickingQueries),
        maxMs: rounded(this.pickingMaxMs),
      },
    };
  }

  private reset(): void {
    this.totalRebuildMs = 0;
    this.featureCount = 0;
    this.features.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.pickingQueries = 0;
    this.pickingCandidates = 0;
    this.pickingHits = 0;
    this.pickingTotalMs = 0;
    this.pickingMaxMs = 0;
  }
}

/** Decorate an existing rebuild engine without changing its rebuild semantics. */
export function instrumentRebuildEngine(engine: RebuildEngine, recorder: PerfRecorder): RebuildEngine {
  return {
    registerHandler(type: string, handler: FeatureRebuildHandler): void {
      engine.registerHandler(type, (feature, context) =>
        recorder.measureFeature(feature, () => handler(feature, context))
      );
    },

    rebuild(features: FeatureRecord[]): RebuildResult {
      recorder.beginRebuild(features.length);
      try {
        return engine.rebuild(features);
      } finally {
        recorder.finishRebuild();
      }
    },
  };
}
