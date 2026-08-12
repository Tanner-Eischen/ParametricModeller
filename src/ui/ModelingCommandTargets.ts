import { createSketchFeature, type FeatureRecord } from '../features';
import type { Body as BRepBody } from '../geometry';
import { SKETCH_FEATURE_TYPE } from '../features/sketch/SketchFeature';
import { createFacePlaneRef, type PlaneRef } from '../sketch';

export interface ExplicitBodyTarget {
  body: BRepBody;
  feature: FeatureRecord;
}

export interface ExplicitBodyTargetOptions {
  activeBodyId: string | null;
  selectedBodyIds: ReadonlySet<string>;
  bodies: readonly BRepBody[];
  getFeatureByBodyId: (bodyId: string) => FeatureRecord | null;
}

export interface FaceSketchTarget {
  faceId: string;
  bodyId: string;
  featureId: string;
  origin?: [number, number, number];
}

/** Create a face-backed sketch without inventing profile geometry. */
export function createEmptyFaceSketchFeature(
  target: FaceSketchTarget,
  name: string
): FeatureRecord {
  return createSketchFeature({
    planeRef: createFacePlaneRef(target.faceId, target.bodyId, target.featureId, target.origin),
    entities: [],
    dimensions: [],
  }, name);
}

/** Face normals point out of a solid, so a face-attached Cut starts inward. */
export function getDefaultCutFlipForSketch(sketchFeature: FeatureRecord): boolean {
  if (sketchFeature.type !== SKETCH_FEATURE_TYPE) return false;
  const planeRef = (sketchFeature.parameters as Partial<{ planeRef: PlaneRef }>).planeRef;
  return planeRef?.type === 'face';
}

/** Resolve only a sketch that the user explicitly selected in the model tree. */
export function resolveExplicitSketchTarget(
  selectedFeature: FeatureRecord | null
): FeatureRecord | null {
  return selectedFeature?.type === SKETCH_FEATURE_TYPE ? selectedFeature : null;
}

/**
 * Resolve only the active viewport body when it is still part of the explicit
 * body selection. Never falls back to document or rebuild order.
 */
export function resolveExplicitBodyTarget(
  options: ExplicitBodyTargetOptions
): ExplicitBodyTarget | null {
  if (options.selectedBodyIds.size !== 1) {
    return null;
  }
  const bodyId = options.activeBodyId;
  if (!bodyId || !options.selectedBodyIds.has(bodyId)) {
    return null;
  }

  const body = options.bodies.find((candidate) => candidate.id === bodyId);
  const feature = options.getFeatureByBodyId(bodyId);
  return body && feature ? { body, feature } : null;
}
