import { generateId } from '../../core/id';
import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildContext } from '../RebuildContext';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { createSketchOutput } from '../FeatureReferences';
import {
  type Sketch,
  type SketchEntity,
  type SketchDimension,
  type PlaneRef,
  type RectangleEntity,
  createSketch,
  validateRectangle,
} from '../../sketch';
import {
  cloneNormalizedSketch,
  legacyRectangleEdgeId,
  materializeLineEntities,
  normalizeSketchEntities,
  type NormalizedSketchGeometry,
} from '../../sketch/NormalizedSketch';
import type {
  DrivingDistanceDimension,
  SketchConstraint,
} from '../../sketch/SketchConstraints';
import { solveSketchConstraints } from '../../sketch/SketchConstraintSolver';
import { getConstructionPlaneFromRef } from '../../geometry/ConstructionPlane';
import {
  getProjectedModelEdgeSourceFeatureIds,
  refreshProjectedModelEdges,
} from '../../sketch/ModelEdgeProjection';

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
  /** Shared-point geometry used as the rebuild source of truth. */
  geometry?: NormalizedSketchGeometry;
  /** Persisted geometric relations. */
  relations?: SketchConstraint[];
  /** Persisted dimensions that drive shared-point geometry. */
  drivingDimensions?: DrivingDistanceDimension[];
  /** Detects edits made by legacy tuple/rectangle UI code. */
  legacySourceSignature?: string;
}

export interface NormalizedSketchParams extends SketchParams {
  geometry: NormalizedSketchGeometry;
  relations: SketchConstraint[];
  drivingDimensions: DrivingDistanceDimension[];
  legacySourceSignature: string;
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
  geometry: { schemaVersion: 1, points: [], segments: [] },
  relations: [],
  drivingDimensions: [],
  legacySourceSignature: '[]|[]',
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
  return {
    ...createSketch(params.planeRef, 'Sketch', id),
    entities: [...params.entities],
    dimensions: [...params.dimensions],
  };
}

/** Upgrade legacy entity tuples while preserving them as a lossless UI cache. */
export function migrateSketchParams(params: Partial<SketchParams>): NormalizedSketchParams {
  const entities = [...(params.entities ?? [])];
  const dimensions = [...(params.dimensions ?? [])];
  const legacySourceSignature = createLegacySourceSignature(entities, dimensions);
  const normalizedIsCurrent = params.geometry !== undefined
    && (params.legacySourceSignature === undefined
      || params.legacySourceSignature === legacySourceSignature);
  const geometry = normalizedIsCurrent
    ? cloneNormalizedSketch(params.geometry!)
    : normalizeSketchEntities(entities);
  const relations = normalizedIsCurrent
    ? [...(params.relations ?? [])]
    : createLegacyRelations(entities, geometry);
  const drivingDimensions = normalizedIsCurrent
    ? [...(params.drivingDimensions ?? [])]
    : createLegacyDrivingDimensions(entities, dimensions, geometry);

  return {
    planeRef: params.planeRef ?? defaultSketchParams.planeRef,
    entities,
    dimensions,
    geometry,
    relations,
    drivingDimensions,
    legacySourceSignature,
  };
}

export function migrateSketchFeature<T extends FeatureRecord>(feature: T): T {
  if (feature.type !== SKETCH_FEATURE_TYPE) return feature;
  return {
    ...feature,
    parameters: migrateSketchParams(
      feature.parameters as unknown as Partial<SketchParams>
    ) as unknown as Record<string, unknown>,
  } as T;
}

/** Resolve every authoritative feature dependency retained by a sketch. */
export function getSketchFeatureDependencyIds(
  params: Partial<SketchParams>
): string[] {
  const normalized = migrateSketchParams(params);
  const dependencies: string[] = [];
  if (normalized.planeRef.type === 'face') {
    const planeDependency = normalized.planeRef.featureId ?? normalized.planeRef.bodyId;
    if (planeDependency) dependencies.push(planeDependency);
  }
  dependencies.push(...getProjectedModelEdgeSourceFeatureIds(normalized.geometry));
  return [...new Set(dependencies)];
}

/** Keep refsIn derived from typed sketch parameters so stale refs cannot hide breakage. */
export function synchronizeSketchFeatureRefsIn(feature: FeatureRecord): void {
  if (feature.type !== SKETCH_FEATURE_TYPE) return;
  feature.refsIn = getSketchFeatureDependencyIds(
    feature.parameters as unknown as Partial<SketchParams>
  );
}

/**
 * Rebuild handler for the sketch feature.
 * Sketches don't create bodies - they store 2D geometry for extrude features.
 */
export function rebuildSketch(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const rawParams = applyLegacyDefaults(
    feature.parameters as unknown as Partial<SketchParams>
  );

  // Validate parameters
  const diagnostics = validateSketchParams(rawParams);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid sketch parameters',
      diagnostics,
    };
  }

  const params = migrateSketchParams(rawParams);
  let resolvedGeometry = params.geometry;
  if (getProjectedModelEdgeSourceFeatureIds(params.geometry).length > 0) {
    const plane = getConstructionPlaneFromRef(
      params.planeRef,
      context.allBodies,
      context.bodiesByFeature
    );
    if (!plane) {
      const diagnostic = error(
        'PROJECTED_EDGE_PLANE_UNRESOLVED',
        'The sketch plane required to refresh projected model edges is unavailable; restore the plane reference before rebuilding.',
        feature.id
      );
      return {
        ok: false,
        error: diagnostic.message,
        diagnostics: [diagnostic],
      };
    }
    const refreshResult = refreshProjectedModelEdges(
      params.geometry,
      plane,
      context.bodiesByFeature
    );
    if (!refreshResult.ok) {
      const diagnostic = error(
        `PROJECTED_EDGE_${refreshResult.error.code}`,
        refreshResult.error.message,
        feature.id,
        refreshResult.segmentId || refreshResult.error.sourceIds[0]
      );
      return {
        ok: false,
        error: diagnostic.message,
        diagnostics: [diagnostic],
      };
    }
    resolvedGeometry = refreshResult.geometry;
  }

  const solveResult = solveSketchConstraints(resolvedGeometry, [
    ...params.relations,
    ...params.drivingDimensions,
  ]);
  if (!solveResult.ok) {
    const solverDiagnostics = solveResult.diagnostics.map((diagnostic) => error(
      diagnostic.code,
      diagnostic.message,
      feature.id,
      diagnostic.relationIds[0] ?? diagnostic.entityIds[0]
    ));
    return {
      ok: false,
      error: solverDiagnostics[0]?.message ?? 'Sketch constraints could not be solved',
      diagnostics: solverDiagnostics,
    };
  }

  const liveSketch: Sketch = {
    id: feature.id,
    name: feature.name,
    planeRef: params.planeRef,
    entities: materializeLineEntities(solveResult.geometry),
    dimensions: [...params.dimensions],
  };

  // Sketch features don't create bodies - they just store 2D data
  // The refsOut will contain the sketch ID for extrude to reference
  return {
    ok: true,
    bodies: [],
    outputs: [createSketchOutput(feature.id, liveSketch)],
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
  const fullParams = migrateSketchParams(applyLegacyDefaults(params));

  const feature: FeatureRecord = {
    id: generateId(),
    type: SKETCH_FEATURE_TYPE,
    name,
    parameters: fullParams as unknown as Record<string, unknown>,
    refsIn: getSketchFeatureDependencyIds(fullParams),
    refsOut: [],
    suppressed: false,
  };

  // The sketch itself is an output reference
  feature.refsOut.push(feature.id);

  return feature;
}

/**
 * Get sketch data from a feature record.
 */
export function getSketchFromFeature(feature: FeatureRecord): Sketch | null {
  if (feature.type !== SKETCH_FEATURE_TYPE) return null;

  const params = migrateSketchParams(feature.parameters as unknown as SketchParams);
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

  const params = migrateSketchParams(feature.parameters as unknown as SketchParams);
  const newParams = migrateSketchParams({
    ...params,
    entities: [...params.entities, entity],
    legacySourceSignature: staleLegacySignature(),
  });

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

  const params = migrateSketchParams(feature.parameters as unknown as SketchParams);
  const newParams = migrateSketchParams({
    ...params,
    entities: params.entities.map((e): SketchEntity => {
      if (e.id === entityId) {
        return { ...e, ...updates } as SketchEntity;
      }
      return e;
    }),
    legacySourceSignature: staleLegacySignature(),
  });

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

  const params = migrateSketchParams(feature.parameters as unknown as SketchParams);
  const newParams = migrateSketchParams({
    ...params,
    dimensions: [...params.dimensions, dimension],
    legacySourceSignature: staleLegacySignature(),
  });

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

function createLegacySourceSignature(
  entities: readonly SketchEntity[],
  dimensions: readonly SketchDimension[]
): string {
  const sortedEntities = [...entities].sort((a, b) => a.id.localeCompare(b.id));
  const sortedDimensions = [...dimensions].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify(sortedEntities)}|${JSON.stringify(sortedDimensions)}`;
}

function createLegacyRelations(
  entities: readonly SketchEntity[],
  geometry: NormalizedSketchGeometry
): SketchConstraint[] {
  const segmentById = new Map(geometry.segments.map((segment) => [segment.id, segment]));
  const relations: SketchConstraint[] = [];
  for (const entity of [...entities].sort((a, b) => a.id.localeCompare(b.id))) {
    if (entity.type !== 'rectangle') continue;
    const edges = [0, 1, 2, 3].map((index) =>
      segmentById.get(legacyRectangleEdgeId(entity.id, index))!
    );
    if (edges.some((edge) => !edge)) continue;
    relations.push({
      id: `legacy:${entity.id}:fixed-origin`,
      type: 'fixed',
      pointId: edges[0]!.startPointId,
      position: [...entity.origin],
    });
    if (Math.abs(entity.rotation) <= 1e-10) {
      relations.push(
        { id: `legacy:${entity.id}:horizontal-0`, type: 'horizontal', segmentId: edges[0]!.id },
        { id: `legacy:${entity.id}:vertical-1`, type: 'vertical', segmentId: edges[1]!.id },
        { id: `legacy:${entity.id}:horizontal-2`, type: 'horizontal', segmentId: edges[2]!.id },
        { id: `legacy:${entity.id}:vertical-3`, type: 'vertical', segmentId: edges[3]!.id }
      );
    } else {
      relations.push(
        {
          id: `legacy:${entity.id}:parallel-0-2`,
          type: 'parallel',
          segmentAId: edges[0]!.id,
          segmentBId: edges[2]!.id,
        },
        {
          id: `legacy:${entity.id}:parallel-1-3`,
          type: 'parallel',
          segmentAId: edges[1]!.id,
          segmentBId: edges[3]!.id,
        },
        {
          id: `legacy:${entity.id}:perpendicular`,
          type: 'perpendicular',
          segmentAId: edges[0]!.id,
          segmentBId: edges[1]!.id,
        }
      );
    }
  }
  return relations;
}

function createLegacyDrivingDimensions(
  entities: readonly SketchEntity[],
  dimensions: readonly SketchDimension[],
  geometry: NormalizedSketchGeometry
): DrivingDistanceDimension[] {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const segmentById = new Map(geometry.segments.map((segment) => [segment.id, segment]));
  return [...dimensions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((dimension): DrivingDistanceDimension[] => {
      if (dimension.type === 'angle') return [];
      const entity = entityById.get(dimension.entityId);
      const segmentId = entity?.type === 'rectangle'
        ? legacyRectangleEdgeId(entity.id, dimension.type === 'height' ? 1 : 0)
        : dimension.entityId;
      const segment = segmentById.get(segmentId);
      if (!segment) return [];
      return [{
        id: dimension.id,
        type: 'distance',
        pointAId: segment.startPointId,
        pointBId: segment.endPointId,
        value: dimension.value,
        ...(dimension.name !== undefined ? { name: dimension.name } : {}),
      }];
    });
}

function staleLegacySignature(): string {
  return 'stale';
}

function applyLegacyDefaults(params: Partial<SketchParams>): SketchParams {
  return {
    ...params,
    planeRef: params.planeRef ?? defaultSketchParams.planeRef,
    entities: params.entities ?? [],
    dimensions: params.dimensions ?? [],
  };
}
