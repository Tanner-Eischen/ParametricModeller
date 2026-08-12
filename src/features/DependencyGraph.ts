import { error, type Diagnostic } from './Diagnostics';
import type { FeatureRecord } from './FeatureRecord';

export interface DependencyGraph {
  featuresById: Map<string, FeatureRecord>;
  dependenciesByFeature: Map<string, string[]>;
  dependentsByFeature: Map<string, string[]>;
  diagnostics: Diagnostic[];
  getDirectDependents(featureId: string): string[];
  getTransitiveDependents(featureId: string): string[];
}

/**
 * Build and validate the history dependency graph without reordering history.
 * Forward references are invalid because feature-tree order is part of the
 * parametric model's meaning.
 */
export function createDependencyGraph(features: FeatureRecord[]): DependencyGraph {
  const diagnostics: Diagnostic[] = [];
  const featuresById = new Map<string, FeatureRecord>();
  const indexById = new Map<string, number>();

  features.forEach((feature, index) => {
    if (featuresById.has(feature.id)) {
      diagnostics.push(error(
        'DUPLICATE_FEATURE_ID',
        `Feature ID "${feature.id}" is used more than once. Assign each feature a unique ID before rebuilding.`,
        feature.id
      ));
      return;
    }
    featuresById.set(feature.id, feature);
    indexById.set(feature.id, index);
  });

  const dependenciesByFeature = new Map<string, string[]>();
  const dependentsByFeature = new Map<string, string[]>();

  for (const feature of features) {
    const dependencies = getFeatureDependencyIds(feature);
    dependenciesByFeature.set(feature.id, dependencies);

    for (const dependencyId of dependencies) {
      const dependency = featuresById.get(dependencyId);
      if (!dependency) {
        diagnostics.push(error(
          'MISSING_DEPENDENCY',
          `Feature "${feature.name}" references missing feature "${dependencyId}". Restore the feature or repair the reference.`,
          feature.id,
          dependencyId
        ));
        continue;
      }

      const existingDependents = dependentsByFeature.get(dependencyId) ?? [];
      if (!existingDependents.includes(feature.id)) {
        existingDependents.push(feature.id);
        dependentsByFeature.set(dependencyId, existingDependents);
      }

      if (dependency.suppressed && !feature.suppressed) {
        diagnostics.push(error(
          'SUPPRESSED_DEPENDENCY',
          `Feature "${feature.name}" depends on suppressed feature "${dependency.name}". Unsuppress it or repair the reference.`,
          feature.id,
          dependencyId
        ));
      }

      const featureIndex = indexById.get(feature.id);
      const dependencyIndex = indexById.get(dependencyId);
      if (
        featureIndex !== undefined &&
        dependencyIndex !== undefined &&
        dependencyIndex >= featureIndex
      ) {
        diagnostics.push(error(
          'FORWARD_DEPENDENCY',
          `Feature "${feature.name}" references "${dependency.name}" at or after its own history position. Move the dependency earlier or repair the reference.`,
          feature.id,
          dependencyId
        ));
      }
    }
  }

  diagnostics.push(...findCycleDiagnostics(features, dependenciesByFeature, featuresById));

  const getDirectDependents = (featureId: string): string[] => [
    ...(dependentsByFeature.get(featureId) ?? []),
  ];

  const getTransitiveDependents = (featureId: string): string[] => {
    const result: string[] = [];
    const visited = new Set<string>([featureId]);
    const queue = [...getDirectDependents(featureId)];

    while (queue.length > 0) {
      const dependentId = queue.shift();
      if (!dependentId || visited.has(dependentId)) continue;
      visited.add(dependentId);
      result.push(dependentId);
      queue.push(...getDirectDependents(dependentId));
    }
    return result;
  };

  return {
    featuresById,
    dependenciesByFeature,
    dependentsByFeature,
    diagnostics,
    getDirectDependents,
    getTransitiveDependents,
  };
}

function getFeatureDependencyIds(feature: FeatureRecord): string[] {
  // Older face-based sketches stored the selected body entity ID in refsIn,
  // before references carried an owning feature ID. It is not safe to treat
  // that entity ID as a feature dependency. New typed references can replace
  // this compatibility exception without changing persisted legacy scenes.
  if (feature.type === 'sketch') {
    const planeRef = (feature.parameters as {
      planeRef?: { type?: unknown; bodyId?: unknown; featureId?: unknown };
    }).planeRef;
    if (
      planeRef?.type === 'face' &&
      typeof planeRef.bodyId === 'string' &&
      typeof planeRef.featureId !== 'string'
    ) {
      return Array.from(new Set(feature.refsIn.filter((id) => id !== planeRef.bodyId)));
    }
  }

  return Array.from(new Set(feature.refsIn));
}

function findCycleDiagnostics(
  features: FeatureRecord[],
  dependenciesByFeature: Map<string, string[]>,
  featuresById: Map<string, FeatureRecord>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const visit = (featureId: string): void => {
    if (state.get(featureId) === 'visited') return;
    if (state.get(featureId) === 'visiting') {
      const start = stack.indexOf(featureId);
      const cycle = [...stack.slice(Math.max(0, start)), featureId];
      const members = Array.from(new Set(cycle.slice(0, -1))).sort();
      const key = members.join('|');
      if (!reported.has(key)) {
        reported.add(key);
        diagnostics.push(error(
          'DEPENDENCY_CYCLE',
          `Dependency cycle detected: ${cycle.join(' -> ')}. Remove one of these references to rebuild.`,
          featureId
        ));
      }
      return;
    }

    state.set(featureId, 'visiting');
    stack.push(featureId);
    for (const dependencyId of dependenciesByFeature.get(featureId) ?? []) {
      if (featuresById.has(dependencyId)) visit(dependencyId);
    }
    stack.pop();
    state.set(featureId, 'visited');
  };

  for (const feature of features) visit(feature.id);
  return diagnostics;
}
