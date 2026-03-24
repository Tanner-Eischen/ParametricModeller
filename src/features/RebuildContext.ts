import type { Body } from '../geometry';

/**
 * Context provided to features during rebuild.
 * Tracks created bodies and provides reference resolution.
 */
export interface RebuildContext {
  /** All bodies created so far in this rebuild, keyed by feature ID */
  bodiesByFeature: Map<string, Body[]>;
  /** All bodies created in the current rebuild */
  allBodies: Body[];
  /** Current feature being rebuilt */
  currentFeatureId: string;
}

/**
 * Create a fresh rebuild context.
 */
export function createRebuildContext(): RebuildContext {
  return {
    bodiesByFeature: new Map(),
    allBodies: [],
    currentFeatureId: '',
  };
}

/**
 * Set the current feature being rebuilt.
 */
export function setCurrentFeature(
  context: RebuildContext,
  featureId: string
): RebuildContext {
  return {
    ...context,
    currentFeatureId: featureId,
  };
}

/**
 * Register bodies created by a feature.
 */
export function registerBodies(
  context: RebuildContext,
  featureId: string,
  bodies: Body[]
): RebuildContext {
  const newBodiesByFeature = new Map(context.bodiesByFeature);
  newBodiesByFeature.set(featureId, bodies);

  return {
    ...context,
    bodiesByFeature: newBodiesByFeature,
    allBodies: [...context.allBodies, ...bodies],
  };
}

/**
 * Get bodies created by a specific feature.
 */
export function getBodiesByFeature(
  context: RebuildContext,
  featureId: string
): Body[] | undefined {
  return context.bodiesByFeature.get(featureId);
}

/**
 * Get a single body by feature ID (for single-body features).
 */
export function getBodyByFeature(
  context: RebuildContext,
  featureId: string
): Body | undefined {
  const bodies = context.bodiesByFeature.get(featureId);
  return bodies?.[0];
}

/**
 * Get all bodies created so far.
 */
export function getAllBodies(context: RebuildContext): Body[] {
  return [...context.allBodies];
}
