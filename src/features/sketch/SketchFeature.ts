import { generateId } from '../../core/id';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import {
  type Sketch,
  type SketchEntity,
  type SketchDimension,
  type PlaneRef,
  type RectangleEntity,
  createSketch,
  validateRectangle,
} from '../../sketch';

/**
 * Parameters for the Sketch feature.
 */
export interface SketchParams {
  /** Reference to the plane this sketch is on */
  planeRef: PlaneRef;
  /** All entities in the sketch */
  entities: SketchEntity[];
  /** Dimension constraints */
  dimensions: SketchDimension[];
}

/**
 * Default sketch parameters.
 */
export const defaultSketchParams: SketchParams = {
  planeRef: {
    id: 'default',
    type: 'world',
    worldPlane: 'xy',
    offset: 0,
  },
  entities: [],
  dimensions: [],
};

/**
 * Feature type identifier for sketch.
 */
export const SKETCH_FEATURE_TYPE = 'sketch';

/**
 * Validate sketch parameters.
 */
export function validateSketchParams(params: Partial<SketchParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Validate plane reference
  if (!params.planeRef) {
    diagnostics.push(error('MISSING_PLANE_REF', 'Plane reference is required'));
  } else {
    if (params.planeRef.type === 'world') {
      if (!params.planeRef.worldPlane) {
        diagnostics.push(error('INVALID_PLANE_REF', 'World plane type is required'));
      }
    } else if (params.planeRef.type === 'face') {
      if (!params.planeRef.faceId) {
        diagnostics.push(error('INVALID_PLANE_REF', 'Face ID is required for face plane'));
      }
      if (!params.planeRef.bodyId) {
        diagnostics.push(error('INVALID_PLANE_REF', 'Body ID is required for face plane'));
      }
    }
  }

  // Validate entities
  if (params.entities) {
    for (const entity of params.entities) {
      if (entity.type === 'rectangle') {
        const rectErrors = validateRectangle(entity as RectangleEntity);
        for (const msg of rectErrors) {
          diagnostics.push(error('INVALID_ENTITY', msg, entity.id));
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Create a sketch from parameters.
 */
export function createSketchFromParams(params: SketchParams, id?: string): Sketch {
  return createSketch(params.planeRef, 'Sketch', id);
}

/**
 * Rebuild handler for the sketch feature.
 * Sketches don't create bodies - they store 2D geometry for extrude features.
 */
export function rebuildSketch(
  feature: FeatureRecord,
  _context: RebuildContext
): RebuildHandlerResult {
  const params: SketchParams = {
    ...defaultSketchParams,
    ...(feature.parameters as Partial<SketchParams>),
  };

  // Validate parameters
  const diagnostics = validateSketchParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid sketch parameters',
      diagnostics,
    };
  }

  // Sketch features don't create bodies - they just store 2D data
  // The refsOut will contain the sketch ID for extrude to reference
  return {
    ok: true,
    bodies: [],
    diagnostics: [],
  };
}

/**
 * Create a sketch feature record.
 */
export function createSketchFeature(
  params: Partial<SketchParams> = {},
  name = 'Sketch'
): FeatureRecord {
  const fullParams: SketchParams = {
    ...defaultSketchParams,
    ...params,
  };

  const feature: FeatureRecord = {
    id: generateId(),
    type: SKETCH_FEATURE_TYPE,
    name,
    parameters: fullParams as unknown as Record<string, unknown>,
    refsIn: [],
    refsOut: [],
    suppressed: false,
  };

  // If this is a face-based sketch, add dependency on the body
  if (fullParams.planeRef.type === 'face' && fullParams.planeRef.bodyId) {
    feature.refsIn.push(fullParams.planeRef.bodyId);
  }

  // The sketch itself is an output reference
  feature.refsOut.push(feature.id);

  return feature;
}

/**
 * Get sketch data from a feature record.
 */
export function getSketchFromFeature(feature: FeatureRecord): Sketch | null {
  if (feature.type !== SKETCH_FEATURE_TYPE) return null;

  const params = feature.parameters as unknown as SketchParams;
  return createSketchFromParams(params, feature.id);
}

/**
 * Add an entity to a sketch feature.
 */
export function addEntityToSketchFeature(
  feature: FeatureRecord,
  entity: SketchEntity
): FeatureRecord {
  if (feature.type !== SKETCH_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as SketchParams;
  const newParams: SketchParams = {
    ...params,
    entities: [...params.entities, entity],
  };

  return {
    ...feature,
    parameters: newParams as unknown as Record<string, unknown>,
  };
}

/**
 * Update an entity in a sketch feature.
 */
export function updateEntityInSketchFeature(
  feature: FeatureRecord,
  entityId: string,
  updates: Partial<SketchEntity>
): FeatureRecord {
  if (feature.type !== SKETCH_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as SketchParams;
  const newParams: SketchParams = {
    ...params,
    entities: params.entities.map((e): SketchEntity => {
      if (e.id === entityId) {
        return { ...e, ...updates } as SketchEntity;
      }
      return e;
    }),
  };

  return {
    ...feature,
    parameters: newParams as unknown as Record<string, unknown>,
  };
}

/**
 * Add a dimension to a sketch feature.
 */
export function addDimensionToSketchFeature(
  feature: FeatureRecord,
  dimension: SketchDimension
): FeatureRecord {
  if (feature.type !== SKETCH_FEATURE_TYPE) return feature;

  const params = feature.parameters as unknown as SketchParams;
  const newParams: SketchParams = {
    ...params,
    dimensions: [...params.dimensions, dimension],
  };

  return {
    ...feature,
    parameters: newParams as unknown as Record<string, unknown>,
  };
}

/**
 * Create a default sketch with a rectangle.
 */
export function createDefaultRectSketch(
  planeRef: PlaneRef,
  width = 1,
  height = 1
): FeatureRecord {
  const rectEntity: RectangleEntity = {
    id: generateId(),
    type: 'rectangle',
    origin: [0, 0],
    width,
    height,
    rotation: 0,
  };

  return createSketchFeature({
    planeRef,
    entities: [rectEntity],
    dimensions: [],
  });
}
