import { createModuleLogger } from '../core/logger';
import type { Body } from '../geometry';
import type { Diagnostic } from './Diagnostics';
import type { FeatureRecord } from './FeatureRecord';
import {
  createRebuildContext,
  setCurrentFeature,
  registerBodies,
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
  | { ok: true; bodies: Body[]; diagnostics: Diagnostic[] }
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
  | { ok: true; bodies: Body[]; diagnostics: Diagnostic[] }
  | { ok: false; error: string; featureId: string; diagnostics: Diagnostic[] };

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

      let context = createRebuildContext();
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
            diagnostics: allDiagnostics,
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
            };
          }

          context = registerBodies(context, feature.id, result.bodies);
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
          };
        }
      }

      const bodies = getAllBodies(context);
      log.info('Rebuild complete', { bodyCount: bodies.length });

      return {
        ok: true,
        bodies,
        diagnostics: allDiagnostics,
      };
    },
  };
}
