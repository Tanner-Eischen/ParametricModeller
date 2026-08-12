import { createModuleLogger } from '../core/logger';
import type { Body } from '../geometry';
import type { Diagnostic } from './Diagnostics';
import { error } from './Diagnostics';
import type { FeatureRecord } from './FeatureRecord';
import { createDependencyGraph } from './DependencyGraph';
import {
  createBodyOutput,
  getFeatureOutputId,
  type FeatureOutput,
} from './FeatureReferences';
import {
  createRebuildContext,
  setCurrentFeature,
  registerBodies,
  registerFeatureOutputs,
  getAllBodies,
  type RebuildContext,
} from './RebuildContext';

const log = createModuleLogger('RebuildEngine');

/**
 * Function signature for feature rebuild handlers.
 */
export type FeatureRebuildHandler = (
  feature: FeatureRecord,
  context: RebuildContext
) => RebuildHandlerResult;

/**
 * Result from a feature rebuild handler.
 */
export type RebuildHandlerResult =
  | {
      ok: true;
      bodies: Body[];
      diagnostics: Diagnostic[];
      outputs?: FeatureOutput[];
      replacedBodyIds?: string[];
    }
  | { ok: false; error: string; diagnostics: Diagnostic[] };

/**
 * The rebuild engine executes feature rebuilds in order.
 */
export interface RebuildEngine {
  /** Register a handler for a feature type */
  registerHandler(type: string, handler: FeatureRebuildHandler): void;
  /** Rebuild all features and return the resulting bodies */
  rebuild(features: FeatureRecord[]): RebuildResult;
}

/**
 * Result of a full rebuild operation.
 */
export type RebuildResult =
  | {
      ok: true;
      bodies: Body[];
      diagnostics: Diagnostic[];
      outputsByFeature: Map<string, string[]>;
      /** Isolated geometry snapshots captured when each feature rebuilt. */
      bodiesByFeature: Map<string, Body[]>;
      /** Latest feature that emitted each stable body ID. */
      featureByBodyId: Map<string, string>;
    }
  | {
      ok: false;
      error: string;
      featureId: string;
      diagnostics: Diagnostic[];
      outputsByFeature: Map<string, string[]>;
      /** Isolated snapshots from successful features preceding the failure. */
      bodiesByFeature: Map<string, Body[]>;
      /** Latest successful feature that emitted each stable body ID. */
      featureByBodyId: Map<string, string>;
    };

/**
 * Create a new rebuild engine.
 */
export function createRebuildEngine(): RebuildEngine {
  const handlers = new Map<string, FeatureRebuildHandler>();

  return {
    registerHandler(type: string, handler: FeatureRebuildHandler): void {
      handlers.set(type, handler);
      log.debug('Registered feature handler', { type });
    },

    rebuild(features: FeatureRecord[]): RebuildResult {
      log.info('Starting rebuild', { featureCount: features.length });

      const bodiesByFeature = new Map<string, Body[]>();
      const featureByBodyId = new Map<string, string>();
      const dependencyGraph = createDependencyGraph(features);
      if (dependencyGraph.diagnostics.length > 0) {
        const firstDiagnostic = dependencyGraph.diagnostics[0]!;
        log.error('Dependency graph validation failed', {
          code: firstDiagnostic.code,
          featureId: firstDiagnostic.featureId,
        });
        return {
          ok: false,
          error: firstDiagnostic.message,
          featureId: firstDiagnostic.featureId ?? '',
          diagnostics: dependencyGraph.diagnostics,
          outputsByFeature: new Map(),
          bodiesByFeature,
          featureByBodyId,
        };
      }

      let context = createRebuildContext(features);
      const allDiagnostics: Diagnostic[] = [];

      for (const feature of features) {
        // Skip suppressed features
        if (feature.suppressed) {
          log.debug('Skipping suppressed feature', { id: feature.id, type: feature.type });
          continue;
        }

        context = setCurrentFeature(context, feature.id);

        const handler = handlers.get(feature.type);
        if (!handler) {
          const errorMsg = `No handler registered for feature type: ${feature.type}`;
          log.error(errorMsg, { featureId: feature.id });
          return {
            ok: false,
            error: errorMsg,
            featureId: feature.id,
            diagnostics: [
              ...allDiagnostics,
              error('UNKNOWN_FEATURE_TYPE', errorMsg, feature.id),
            ],
            outputsByFeature: collectOutputIds(context.outputsByFeature),
            bodiesByFeature,
            featureByBodyId,
          };
        }

        try {
          const result = handler(feature, context);

          allDiagnostics.push(...result.diagnostics);

          if (!result.ok) {
            log.error('Feature rebuild failed', {
              featureId: feature.id,
              error: result.error,
            });
            return {
              ok: false,
              error: result.error,
              featureId: feature.id,
              diagnostics: allDiagnostics,
              outputsByFeature: collectOutputIds(context.outputsByFeature),
              bodiesByFeature,
              featureByBodyId,
            };
          }

          const bodySnapshots = result.bodies.map(cloneBodySnapshot);
          bodiesByFeature.set(feature.id, bodySnapshots);
          for (const body of bodySnapshots) {
            featureByBodyId.set(body.id, feature.id);
          }
          context = registerBodies(context, feature.id, result.bodies, result.replacedBodyIds ?? []);
          context = registerFeatureOutputs(context, feature.id, [
            ...result.bodies.map((body) => createBodyOutput(feature.id, body)),
            ...(result.outputs ?? []),
          ]);
          log.debug('Feature rebuilt successfully', {
            featureId: feature.id,
            bodyCount: result.bodies.length,
          });
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          log.error('Feature rebuild threw exception', {
            featureId: feature.id,
            error: errorMsg,
          });
          return {
            ok: false,
            error: errorMsg,
            featureId: feature.id,
            diagnostics: allDiagnostics,
            outputsByFeature: collectOutputIds(context.outputsByFeature),
            bodiesByFeature,
            featureByBodyId,
          };
        }
      }

      const bodies = getAllBodies(context);
      log.info('Rebuild complete', { bodyCount: bodies.length });

      return {
        ok: true,
        bodies,
        diagnostics: allDiagnostics,
        outputsByFeature: collectOutputIds(context.outputsByFeature),
        bodiesByFeature,
        featureByBodyId,
      };
    },
  };
}

/**
 * Capture feature output geometry without retaining mutable arrays or map
 * entries that a downstream direct-edit feature could share.
 */
function cloneBodySnapshot(body: Body): Body {
  return {
    id: body.id,
    name: body.name,
    vertices: new Map(
      Array.from(body.vertices, ([id, vertex]) => [
        id,
        {
          ...vertex,
          position: [...vertex.position] as [number, number, number],
          edgeIds: [...vertex.edgeIds],
        },
      ])
    ),
    edges: new Map(
      Array.from(body.edges, ([id, edge]) => [
        id,
        {
          ...edge,
          vertexIds: [...edge.vertexIds] as [string, string],
          faceIds: [...edge.faceIds],
        },
      ])
    ),
    faces: new Map(
      Array.from(body.faces, ([id, face]) => [
        id,
        {
          ...face,
          boundaryEdgeIds: [...face.boundaryEdgeIds],
          ...(face.innerBoundaryEdgeIds
            ? {
                innerBoundaryEdgeIds: face.innerBoundaryEdgeIds.map(
                  (loop) => [...loop]
                ),
              }
            : {}),
        },
      ])
    ),
    planes: new Map(
      Array.from(body.planes, ([id, plane]) => [
        id,
        {
          ...plane,
          origin: [...plane.origin] as [number, number, number],
          normal: [...plane.normal] as [number, number, number],
          uAxis: [...plane.uAxis] as [number, number, number],
          vAxis: [...plane.vAxis] as [number, number, number],
        },
      ])
    ),
  };
}

function collectOutputIds(
  outputsByFeature: Map<string, FeatureOutput[]>
): Map<string, string[]> {
  return new Map(
    Array.from(outputsByFeature.entries()).map(([featureId, outputs]) => [
      featureId,
      outputs.map(getFeatureOutputId),
    ])
  );
}
