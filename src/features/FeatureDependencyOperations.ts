import { error, warning, type Diagnostic } from './Diagnostics';
import type { DependencyGraph } from './DependencyGraph';

export type FeatureDependencyOperation = 'remove' | 'suppress';

export interface FeatureDependencyPlanOptions {
  /** Explicitly include downstream features in a dependent-first plan. */
  cascade?: boolean;
}

/**
 * A read-only plan. Callers must apply featureIds in the returned order and
 * must never infer a cascade when `allowed` is false.
 */
export interface FeatureDependencyOperationPlan {
  operation: FeatureDependencyOperation;
  targetFeatureId: string;
  cascade: boolean;
  allowed: boolean;
  /** Dependent-first IDs to remove or suppress. Empty when blocked. */
  featureIds: string[];
  /** Unsuppressed downstream features affected by the operation. */
  activeDependentIds: string[];
  /** Already-suppressed downstream features retained for diagnostics. */
  suppressedDependentIds: string[];
  diagnostics: Diagnostic[];
}

export function planFeatureRemoval(
  graph: DependencyGraph,
  targetFeatureId: string,
  options: FeatureDependencyPlanOptions = {}
): FeatureDependencyOperationPlan {
  return planFeatureDependencyOperation(graph, 'remove', targetFeatureId, options);
}

export function planFeatureSuppression(
  graph: DependencyGraph,
  targetFeatureId: string,
  options: FeatureDependencyPlanOptions = {}
): FeatureDependencyOperationPlan {
  return planFeatureDependencyOperation(graph, 'suppress', targetFeatureId, options);
}

export function planFeatureDependencyOperation(
  graph: DependencyGraph,
  operation: FeatureDependencyOperation,
  targetFeatureId: string,
  options: FeatureDependencyPlanOptions = {}
): FeatureDependencyOperationPlan {
  const cascade = options.cascade === true;
  const target = graph.featuresById.get(targetFeatureId);
  if (!target) {
    return {
      operation,
      targetFeatureId,
      cascade,
      allowed: false,
      featureIds: [],
      activeDependentIds: [],
      suppressedDependentIds: [],
      diagnostics: [error(
        'FEATURE_NOT_FOUND',
        `Feature "${targetFeatureId}" does not exist. Refresh the model tree before trying to ${operation} it.`,
        targetFeatureId
      )],
    };
  }

  const transitiveDependentIds = graph.getTransitiveDependents(targetFeatureId);
  const activeDependentIds = transitiveDependentIds.filter(
    (featureId) => !graph.featuresById.get(featureId)?.suppressed
  );
  const suppressedDependentIds = transitiveDependentIds.filter(
    (featureId) => graph.featuresById.get(featureId)?.suppressed === true
  );
  const diagnostics: Diagnostic[] = [];

  if (activeDependentIds.length > 0 && !cascade) {
    diagnostics.push(error(
      'ACTIVE_DEPENDENTS_BLOCK_OPERATION',
      describeBlockedOperation(graph, operation, target.name, activeDependentIds),
      targetFeatureId
    ));
    return {
      operation,
      targetFeatureId,
      cascade,
      allowed: false,
      featureIds: [],
      activeDependentIds,
      suppressedDependentIds,
      diagnostics,
    };
  }

  if (suppressedDependentIds.length > 0 && operation === 'remove' && !cascade) {
    diagnostics.push(warning(
      'SUPPRESSED_DEPENDENTS_RETAIN_BROKEN_REFS',
      `Removing "${target.name}" will leave ${formatFeatureNames(graph, suppressedDependentIds)} with explicit broken references. Use cascade removal to remove them too.`,
      targetFeatureId
    ));
  }

  if (operation === 'suppress' && target.suppressed) {
    return {
      operation,
      targetFeatureId,
      cascade,
      allowed: true,
      featureIds: [],
      activeDependentIds,
      suppressedDependentIds,
      diagnostics,
    };
  }

  const dependentIdsToInclude = cascade
    ? operation === 'remove'
      ? transitiveDependentIds
      : activeDependentIds
    : [];

  return {
    operation,
    targetFeatureId,
    cascade,
    allowed: true,
    featureIds: orderDependentFirst(graph, [targetFeatureId, ...dependentIdsToInclude]),
    activeDependentIds,
    suppressedDependentIds,
    diagnostics,
  };
}

function describeBlockedOperation(
  graph: DependencyGraph,
  operation: FeatureDependencyOperation,
  targetName: string,
  activeDependentIds: string[]
): string {
  const names = formatFeatureNames(graph, activeDependentIds);
  return `Cannot ${operation} "${targetName}" because active dependent features would break: ${names}. Repair those references or request an explicit cascade ${operation}.`;
}

function formatFeatureNames(graph: DependencyGraph, featureIds: string[]): string {
  return featureIds
    .map((featureId) => {
      const feature = graph.featuresById.get(featureId);
      return feature ? `"${feature.name}" (${feature.id})` : `"${featureId}"`;
    })
    .join(', ');
}

function orderDependentFirst(graph: DependencyGraph, featureIds: string[]): string[] {
  const historyIndex = new Map(
    Array.from(graph.featuresById.keys(), (featureId, index) => [featureId, index])
  );
  return Array.from(new Set(featureIds)).sort(
    (left, right) => (historyIndex.get(right) ?? -1) - (historyIndex.get(left) ?? -1)
  );
}
