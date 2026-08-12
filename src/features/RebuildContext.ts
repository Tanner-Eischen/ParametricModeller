import type { Body } from '../geometry';
import type { Sketch } from '../sketch';
import type { FeatureOutput } from './FeatureReferences';
import type { FeatureRecord } from './FeatureRecord';

/**
 * Context provided to features during rebuild.
 * Tracks created bodies and provides reference resolution.
 */
export interface RebuildContext {
  /** Features participating in this rebuild, keyed by stable feature ID. */
  featuresById: Map<string, FeatureRecord>;
  /** Typed outputs produced so far, keyed by feature ID. */
  outputsByFeature: Map<string, FeatureOutput[]>;
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
export function createRebuildContext(features: FeatureRecord[] = []): RebuildContext {
  return {
    featuresById: new Map(features.map((feature) => [feature.id, feature])),
    outputsByFeature: new Map(),
    bodiesByFeature: new Map(),
    allBodies: [],
    currentFeatureId: '',
  };
}

/** Register typed outputs created by a feature. */
export function registerFeatureOutputs(
  context: RebuildContext,
  featureId: string,
  outputs: FeatureOutput[]
): RebuildContext {
  const outputsByFeature = new Map(context.outputsByFeature);
  outputsByFeature.set(featureId, outputs);
  return { ...context, outputsByFeature };
}

export function getFeatureById(
  context: RebuildContext,
  featureId: string
): FeatureRecord | undefined {
  return context.featuresById.get(featureId);
}

export function getFeatureOutputs(
  context: RebuildContext,
  featureId: string
): FeatureOutput[] {
  return [...(context.outputsByFeature.get(featureId) ?? [])];
}

/** Resolve the live sketch emitted by a sketch feature earlier in this rebuild. */
export function resolveSketch(
  context: RebuildContext,
  featureId: string
): Sketch | undefined {
  const output = context.outputsByFeature
    .get(featureId)
    ?.find((candidate) => candidate.kind === 'sketch');
  return output?.kind === 'sketch' ? output.sketch : undefined;
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
  bodies: Body[],
  replacedBodyIds: string[] = []
): RebuildContext {
  const newBodiesByFeature = new Map(context.bodiesByFeature);
  newBodiesByFeature.set(featureId, bodies);
  const replaced = new Set(replacedBodyIds);
  const retainedBodies = replaced.size === 0
    ? context.allBodies
    : context.allBodies.filter((body) => !replaced.has(body.id));

  return {
    ...context,
    bodiesByFeature: newBodiesByFeature,
    allBodies: [...retainedBodies, ...bodies],
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
