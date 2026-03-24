import { generateId } from '../core/id';

/**
 * A feature record in the feature tree.
 * Features are the building blocks of parametric models.
 */
export interface FeatureRecord {
  /** Unique identifier */
  id: string;
  /** Feature type (e.g., 'box', 'extrude') */
  type: string;
  /** Display name */
  name: string;
  /** Feature-specific parameters */
  parameters: Record<string, unknown>;
  /** IDs of features or entities this feature depends on */
  refsIn: string[];
  /** IDs of entities created by this feature */
  refsOut: string[];
  /** Whether this feature is suppressed (skipped during rebuild) */
  suppressed: boolean;
}

/**
 * Create a new feature record.
 */
export function createFeatureRecord(
  type: string,
  name: string,
  parameters: Record<string, unknown>,
  options?: {
    id?: string;
    refsIn?: string[];
    suppressed?: boolean;
  }
): FeatureRecord {
  return {
    id: options?.id ?? generateId(),
    type,
    name,
    parameters: { ...parameters },
    refsIn: options?.refsIn ?? [],
    refsOut: [],
    suppressed: options?.suppressed ?? false,
  };
}

/**
 * Update feature parameters.
 */
export function updateFeatureParameters(
  feature: FeatureRecord,
  parameters: Record<string, unknown>
): FeatureRecord {
  return {
    ...feature,
    parameters: { ...parameters },
  };
}

/**
 * Set feature suppressed state.
 */
export function setFeatureSuppressed(
  feature: FeatureRecord,
  suppressed: boolean
): FeatureRecord {
  return {
    ...feature,
    suppressed,
  };
}

/**
 * Add an output reference to a feature.
 */
export function addOutputRef(feature: FeatureRecord, refId: string): FeatureRecord {
  if (feature.refsOut.includes(refId)) {
    return feature;
  }
  return {
    ...feature,
    refsOut: [...feature.refsOut, refId],
  };
}

/**
 * Check if a feature is a base feature (no dependencies).
 */
export function isBaseFeature(feature: FeatureRecord): boolean {
  return feature.refsIn.length === 0;
}

/**
 * Serialize feature to JSON.
 */
export function serializeFeature(feature: FeatureRecord): object {
  return {
    id: feature.id,
    type: feature.type,
    name: feature.name,
    parameters: feature.parameters,
    refsIn: feature.refsIn,
    refsOut: feature.refsOut,
    suppressed: feature.suppressed,
  };
}

/**
 * Deserialize feature from JSON.
 */
export function deserializeFeature(data: {
  id: string;
  type: string;
  name: string;
  parameters: Record<string, unknown>;
  refsIn: string[];
  refsOut: string[];
  suppressed: boolean;
}): FeatureRecord {
  return {
    id: data.id,
    type: data.type,
    name: data.name,
    parameters: data.parameters,
    refsIn: data.refsIn,
    refsOut: data.refsOut,
    suppressed: data.suppressed,
  };
}
