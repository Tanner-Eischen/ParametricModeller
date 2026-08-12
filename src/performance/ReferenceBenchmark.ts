import * as THREE from 'three';
import type { FeatureRecord } from '../features/FeatureRecord';
import { createRebuildEngine } from '../features/RebuildEngine';
import { BOX_FEATURE_TYPE, rebuildBox } from '../features/primitives/BoxFeature';
import { Picking } from '../rendering/Picking';
import { RenderMeshCache } from '../rendering/RenderMeshCache';
import type { Body } from '../geometry';
import { PerfRecorder, instrumentRebuildEngine, type PerfReport } from './PerfReport';
import type { PerformanceBudget } from './PerformanceBudget';

export const REFERENCE_FEATURE_COUNT = 200;

export const BROWSER_REFERENCE_WORKLOAD =
  'Phase 6 / 200 boxes / Playwright Chromium Desktop Chrome (1280x720)';

export interface BrowserPerformanceBudget {
  maxRebuildAndLoadMs: number;
  maxAveragePickingMs: number;
  maxSinglePickingMs: number;
  maxAverageFrameMs: number;
  maxSingleFrameMs: number;
  minCacheHitRate: number;
}

/** End-to-end application budgets; intentionally allow shared-CI scheduling headroom. */
export const BROWSER_REFERENCE_BUDGET: BrowserPerformanceBudget = {
  maxRebuildAndLoadMs: 5_000,
  maxAveragePickingMs: 25,
  maxSinglePickingMs: 100,
  maxAverageFrameMs: 40,
  maxSingleFrameMs: 250,
  minCacheHitRate: 0.5,
};

/** The checked-in CI environment against which these deliberately generous limits are defined. */
export const PERFORMANCE_REFERENCE_ENVIRONMENT =
  'GitHub Actions ubuntu-latest, Node.js 22, Vitest worker (July 2026 baseline)';

/**
 * Upper bounds only: no minimum/high-resolution timing assumption. The headroom is intentional
 * so shared CI load does not turn the benchmark into a flaky micro-benchmark.
 */
export const REFERENCE_PERFORMANCE_BUDGET: PerformanceBudget = {
  maxRebuildMs: 3000,
  maxAveragePickingMs: 100,
  maxSinglePickingMs: 250,
};

export function createReferenceBoxFeatures(): FeatureRecord[] {
  return Array.from({ length: REFERENCE_FEATURE_COUNT }, (_, index) => ({
    id: `perf_box_${String(index).padStart(3, '0')}`,
    type: BOX_FEATURE_TYPE,
    name: `Performance Box ${index + 1}`,
    parameters: {
      width: 18,
      depth: 38,
      height: 12,
      anchorMode: 'corner',
      origin: [(index % 20) * 24, Math.floor(index / 20) * 44, 0],
    },
    refsIn: [],
    refsOut: [],
    suppressed: false,
  }));
}

/** Run the reproducible 200-feature rebuild and vertex-picking workload used by CI. */
export function runReferenceBenchmark(): PerfReport {
  const recorder = new PerfRecorder(PERFORMANCE_REFERENCE_ENVIRONMENT);
  const engine = instrumentRebuildEngine(createRebuildEngine(), recorder);
  engine.registerHandler(BOX_FEATURE_TYPE, rebuildBox);

  const result = engine.rebuild(createReferenceBoxFeatures());
  if (!result.ok) {
    throw new Error(`Reference rebuild failed at ${result.featureId}: ${result.error}`);
  }

  const bodyEntries = new Map<string, { body: Body; featureId: string }>();
  for (const body of result.bodies) {
    bodyEntries.set(body.id, {
      body,
      featureId: body.id.replace(/_body$/, ''),
    });
  }

  const meshCache = new RenderMeshCache();
  for (const body of result.bodies) {
    meshCache.getOrCreateMesh(body);
  }
  for (const body of result.bodies) {
    meshCache.getOrCreateMesh(body);
  }
  const cacheStats = meshCache.getStats();
  for (let index = 0; index < cacheStats.misses; index += 1) {
    recorder.recordCacheLookup(false);
  }
  for (let index = 0; index < cacheStats.hits; index += 1) {
    recorder.recordCacheLookup(true);
  }

  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 5000);
  camera.position.set(240, 220, 850);
  camera.lookAt(240, 220, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const picking = new Picking();
  const queries: ReadonlyArray<readonly [number, number]> = [
    [400, 300],
    [300, 225],
    [500, 225],
    [300, 375],
    [500, 375],
  ];
  for (let pass = 0; pass < 4; pass += 1) {
    for (const [x, y] of queries) {
      recorder.measurePicking(
        bodyEntries.size,
        () => picking.pickVertex(x, y, 800, 600, camera, bodyEntries, 12),
        (pick) => pick !== null
      );
    }
  }
  picking.dispose();
  meshCache.dispose();

  return recorder.snapshot();
}
