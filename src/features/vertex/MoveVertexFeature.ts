/**
 * MoveVertex Feature - Vertex-level editing (Milestone 07).
 * Moves a vertex while preserving planarity of adjacent faces.
 */

import { error, type Diagnostic } from '../Diagnostics';
import type { FeatureRecord } from '../FeatureRecord';
import type { RebuildHandlerResult } from '../RebuildEngine';
import { getAllBodies, type RebuildContext } from '../RebuildContext';
import { cloneBody, type Body } from '../../geometry';
import { validateBody } from '../../geometry/Validation';
import type { VertexRef } from '../../geometry/SubObjectTypes';
import { checkPlanarityPreservation } from '../../geometry/SubObjectTypes';
import { createModuleLogger } from '../../core/logger';
import { createFeatureRecord } from '../FeatureRecord';

const log = createModuleLogger('MoveVertexFeature');

/**
 * Feature type identifier for move vertex.
 */
export const MOVE_VERTEX_FEATURE_TYPE = 'moveVertex';

/**
 * Move constraint type.
 */
export type MoveConstraint = 'plane' | 'x' | 'y' | 'z';

/**
 * Parameters for the move vertex feature.
 */
export interface MoveVertexParams {
  vertexRef: VertexRef;
  translation: [number, number, number];
  constrainToPlane?: boolean;
  constrainAxis?: 'x' | 'y' | 'z';
}

/**
 * Default parameters for move vertex.
 */
export const defaultMoveVertexParams: MoveVertexParams = {
  vertexRef: { featureId: '', bodyId: '', vertexId: '' },
  translation: [0, 0, 0],
  constrainToPlane: false,
};

/**
 * Validate move vertex parameters.
 */
export function validateMoveVertexParams(params: Partial<MoveVertexParams>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!params.vertexRef) {
    diagnostics.push(error('MISSING_VERTEX_REF', 'Vertex reference is required'));
  } else {
    if (!params.vertexRef.featureId) {
      diagnostics.push(error('MISSING_FEATURE_ID', 'Feature ID is required in vertex ref'));
    }
    if (!params.vertexRef.bodyId) {
      diagnostics.push(error('MISSING_BODY_ID', 'Body ID is required in vertex ref'));
    }
    if (!params.vertexRef.vertexId) {
      diagnostics.push(error('MISSING_VERTEX_ID', 'Vertex ID is required in vertex ref'));
    }
  }

  if (!params.translation) {
    diagnostics.push(error('MISSING_TRANSLATION', 'Translation is required'));
  } else {
    if (params.translation.length !== 3) {
      diagnostics.push(error('INVALID_TRANSLATION', 'Translation must be an array with 3 numbers'));
    }
    if (!params.translation.every(v => isFinite(v))) {
      diagnostics.push(error('INVALID_TRANSLATION', 'Translation values must be finite numbers'));
    }
  }

  if (params.constrainToPlane && params.constrainAxis) {
    diagnostics.push(error('INVALID_CONSTRAINT', 'Cannot constrain to both plane and axis simultaneously'));
  }

  if (params.constrainAxis && !['x', 'y', 'z'].includes(params.constrainAxis)) {
    diagnostics.push(error('INVALID_CONSTRAINT_AXIS', 'Constraint axis must be "x", "y", or "z"'));
  }

  return diagnostics;
}

/**
 * Create a move vertex feature.
 */
export function createMoveVertexFeature(
  params: Partial<MoveVertexParams>,
  name?: string
): FeatureRecord {
  const fullParams: MoveVertexParams = {
    ...defaultMoveVertexParams,
    ...params,
  };

  // Build refsIn from vertexRef
  const refsIn: string[] = [];
  if (fullParams.vertexRef.featureId) {
    refsIn.push(fullParams.vertexRef.featureId);
  }

  return createFeatureRecord(
    MOVE_VERTEX_FEATURE_TYPE,
    name ?? 'Move Vertex',
    fullParams as unknown as Record<string, unknown>,
    { refsIn }
  );
}

/**
 * Move a vertex in a body by the given translation.
 */
function moveVertexInBody(
  body: Body,
  vertexId: string,
  translation: [number, number, number]
): void {
  const vertex = body.vertices.get(vertexId);
  if (!vertex) return;

  // Update vertex position
  const newPosition: [number, number, number] = [
    vertex.position[0] + translation[0],
    vertex.position[1] + translation[1],
    vertex.position[2] + translation[2],
  ];

  body.vertices.set(vertexId, {
    ...vertex,
    position: newPosition,
  });
}

/**
 * Rebuild handler for the move vertex feature.
 */
export function rebuildMoveVertex(
  feature: FeatureRecord,
  context: RebuildContext
): RebuildHandlerResult {
  const params: MoveVertexParams = {
    ...defaultMoveVertexParams,
    ...(feature.parameters as Partial<MoveVertexParams>),
  };

  // Validate parameters
  const diagnostics = validateMoveVertexParams(params);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: 'Invalid move vertex parameters',
      diagnostics,
    };
  }

  // Get the body containing the vertex
  const allBodies = getAllBodies(context);
  const targetBody = allBodies.find(b => b.id === params.vertexRef.bodyId);

  if (!targetBody) {
    return {
      ok: false,
      error: `Body ${params.vertexRef.bodyId} not found`,
      diagnostics: [error('BODY_NOT_FOUND', `Body ${params.vertexRef.bodyId} not found`)],
    };
  }

  // Get the vertex
  const vertex = targetBody.vertices.get(params.vertexRef.vertexId);
  if (!vertex) {
    return {
      ok: false,
      error: `Vertex ${params.vertexRef.vertexId} not found`,
      diagnostics: [error('VERTEX_NOT_FOUND', `Vertex ${params.vertexRef.vertexId} not found`)],
    };
  }

  // Compute new position
  const newPosition: [number, number, number] = [
    vertex.position[0] + params.translation[0],
    vertex.position[1] + params.translation[1],
    vertex.position[2] + params.translation[2],
  ];

  // Check planarity preservation
  const planarityCheck = checkPlanarityPreservation(targetBody, params.vertexRef.vertexId, newPosition);
  if (!planarityCheck.ok) {
    return {
      ok: false,
      error: `Move would break planarity of faces: ${planarityCheck.violatingFaces.join(', ')}`,
      diagnostics: planarityCheck.violatingFaces.map(fid =>
        error('PLANARITY_VIOLATION', `Face ${fid} would become non-planar`)
      ),
    };
  }

  // Clone body for modification
  const modifiedBody = cloneBody(targetBody, targetBody.id);

  // Apply constraints if specified
  let finalTranslation = [...params.translation] as [number, number, number];
  if (params.constrainToPlane) {
    // Project translation onto the plane of the vertex's adjacent faces
    // For simplicity, we just use the original translation
    // A more sophisticated version would project onto the shared plane
  }
  if (params.constrainAxis) {
    const axisIndex = { x: 0, y: 1, z: 2 }[params.constrainAxis]!;
    const axis: [number, number, number] = [0, 0, 0];
    axis[axisIndex] = params.translation[axisIndex] ?? 0;
    finalTranslation = axis;
  }

  // Apply vertex move
  moveVertexInBody(modifiedBody, params.vertexRef.vertexId, finalTranslation);

  // Validate the result
  const validationResult = validateBody(modifiedBody);
  if (!validationResult.ok) {
    return {
      ok: false,
      error: 'Move vertex produced invalid body',
      diagnostics: validationResult.errors.map(e => error('INVALID_BODY', e.message)),
    };
  }

  log.info('Move vertex complete', {
    featureId: feature.id,
    vertexId: params.vertexRef.vertexId,
    translation: finalTranslation,
  });

  return {
    ok: true,
    bodies: [modifiedBody],
    diagnostics: [],
    replacedBodyIds: [targetBody.id],
  };
}
