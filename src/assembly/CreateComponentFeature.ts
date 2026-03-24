/**
 * Create Component Feature - Milestone 06: Assembly-lite
 *
 * Feature for creating a component from selected features.
 * This is an organizational feature that tags features with a component ID.
 */

import { createFeatureRecord, type FeatureRecord } from '../features/FeatureRecord';
import { error, type Diagnostic } from '../features/Diagnostics';

export const CREATE_COMPONENT_FEATURE_TYPE = 'createComponent';

/**
 * Parameters for the create component feature.
 */
export interface CreateComponentParams {
  name: string;
  featureIds: string[];  // Features to group into this component
}

/**
 * Create a create component feature.
 */
export function createComponentFeature(
  params: Partial<CreateComponentParams>,
  name = 'Component'
): FeatureRecord {
  const fullParams: CreateComponentParams = {
    name: params.name ?? name,
    featureIds: params.featureIds ?? [],
  };

  return createFeatureRecord(
    CREATE_COMPONENT_FEATURE_TYPE,
    name,
    fullParams as unknown as Record<string, unknown>,
    {
      refsIn: fullParams.featureIds,
    }
  );
}

/**
 * Validate create component parameters.
 */
export function validateCreateComponentParams(
  params: Record<string, unknown>
): { ok: true; data: CreateComponentParams } | { ok: false; error: string } {
  const name = params.name;
  const featureIds = params.featureIds;

  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, error: 'Component name is required' };
  }

  if (!Array.isArray(featureIds)) {
    return { ok: false, error: 'featureIds must be an array' };
  }

  const validatedIds: string[] = [];
  for (const id of featureIds) {
    if (typeof id !== 'string') {
      return { ok: false, error: 'All featureIds must be strings' };
    }
    validatedIds.push(id);
  }

  return {
    ok: true,
    data: {
      name: name.trim(),
      featureIds: validatedIds,
    },
  };
}

/**
 * Rebuild handler for create component feature.
 * This is an organizational feature - it doesn't create bodies.
 * The ComponentRebuilder handles the actual component rebuilding.
 */
export function rebuildCreateComponent(
  feature: FeatureRecord,
  _context: unknown
): { ok: true; bodies: []; diagnostics: Diagnostic[] } | { ok: false; error: string; diagnostics: Diagnostic[] } {
  const validation = validateCreateComponentParams(feature.parameters);

  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      diagnostics: [error('INVALID_PARAMS', validation.error, feature.id)],
    };
  }

  // This feature is organizational - it doesn't create bodies directly.
  // The actual component instance bodies are created by the ComponentRebuilder.
  return {
    ok: true,
    bodies: [],
    diagnostics: [],
  };
}
