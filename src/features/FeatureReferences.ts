import type { Body } from '../geometry';
import type { Sketch } from '../sketch';

/**
 * Runtime reference types used while rebuilding a feature tree.
 *
 * FeatureRecord continues to persist refsIn/refsOut as strings for backwards
 * compatibility. Rebuild code normalizes those strings to this discriminated
 * representation before resolving them.
 */
export type FeatureReference =
  | { kind: 'feature'; featureId: string }
  | { kind: 'sketch'; featureId: string; sketchId: string }
  | { kind: 'body'; featureId: string; bodyId: string }
  | { kind: 'face'; featureId: string; bodyId: string; faceId: string }
  | { kind: 'edge'; featureId: string; bodyId: string; edgeId: string }
  | { kind: 'vertex'; featureId: string; bodyId: string; vertexId: string };

/** Typed values produced by feature rebuild handlers. */
export type FeatureOutput =
  | { kind: 'sketch'; featureId: string; sketch: Sketch }
  | { kind: 'body'; featureId: string; body: Body };

export function normalizeFeatureReference(
  reference: string | FeatureReference
): FeatureReference {
  return typeof reference === 'string'
    ? { kind: 'feature', featureId: reference }
    : reference;
}

export function getReferencedFeatureId(reference: FeatureReference): string {
  return reference.featureId;
}

export function createSketchOutput(featureId: string, sketch: Sketch): FeatureOutput {
  return { kind: 'sketch', featureId, sketch };
}

export function createBodyOutput(featureId: string, body: Body): FeatureOutput {
  return { kind: 'body', featureId, body };
}

export function getFeatureOutputId(output: FeatureOutput): string {
  return output.kind === 'body' ? output.body.id : output.sketch.id;
}
