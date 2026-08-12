import {
  cloneNormalizedSketch,
  type NormalizedSketchGeometry,
} from './NormalizedSketch';
import type {
  DrivingDistanceDimension,
  SketchConstraint,
  SketchRelation,
} from './SketchConstraints';

/** Serializable sketch sub-object selection. */
export interface SketchSelection {
  readonly pointIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly relationIds: readonly string[];
  readonly dimensionIds: readonly string[];
}

export type SketchSelectionDiagnosticCode = 'SELECTION_TARGET_NOT_FOUND';

export interface SketchSelectionDiagnostic {
  code: SketchSelectionDiagnosticCode;
  message: string;
  targetType: 'point' | 'segment' | 'relation' | 'dimension';
  targetId: string;
}

export interface DeleteSketchSelectionResult {
  geometry: NormalizedSketchGeometry;
  relations: SketchConstraint[];
  dimensions: DrivingDistanceDimension[];
  selection: SketchSelection;
  removedPointIds: string[];
  removedSegmentIds: string[];
  removedRelationIds: string[];
  removedDimensionIds: string[];
  diagnostics: SketchSelectionDiagnostic[];
}

export function createEmptySketchSelection(): SketchSelection {
  return {
    pointIds: [],
    segmentIds: [],
    relationIds: [],
    dimensionIds: [],
  };
}

/** Canonicalize a selection so persistence and equality do not depend on click order. */
export function normalizeSketchSelection(selection: SketchSelection): SketchSelection {
  return {
    pointIds: uniqueSorted(selection.pointIds),
    segmentIds: uniqueSorted(selection.segmentIds),
    relationIds: uniqueSorted(selection.relationIds),
    dimensionIds: uniqueSorted(selection.dimensionIds),
  };
}

/**
 * Delete a sketch selection as one immutable operation.
 *
 * Deleting a point also deletes every incident segment. Any point left
 * unreferenced by the remaining geometry is removed. Relations and dimensions
 * that reference removed geometry are removed in the same result.
 */
export function deleteSketchSelection(
  geometry: NormalizedSketchGeometry,
  selection: SketchSelection,
  relations?: readonly SketchConstraint[],
  dimensions?: readonly DrivingDistanceDimension[]
): DeleteSketchSelectionResult;
/** @deprecated Use the selection-first overload for new integrations. */
export function deleteSketchSelection(
  geometry: NormalizedSketchGeometry,
  relations: readonly SketchConstraint[],
  dimensions: readonly DrivingDistanceDimension[],
  selection: SketchSelection
): DeleteSketchSelectionResult;
export function deleteSketchSelection(
  geometry: NormalizedSketchGeometry,
  selectionOrRelations: SketchSelection | readonly SketchConstraint[],
  relationsOrDimensions: readonly SketchConstraint[] | readonly DrivingDistanceDimension[] = [],
  dimensionsOrSelection: readonly DrivingDistanceDimension[] | SketchSelection = []
): DeleteSketchSelectionResult {
  const selection = isSketchSelection(selectionOrRelations)
    ? selectionOrRelations
    : isSketchSelection(dimensionsOrSelection)
      ? dimensionsOrSelection
      : createEmptySketchSelection();
  const relations = isSketchSelection(selectionOrRelations)
    ? relationsOrDimensions as readonly SketchConstraint[]
    : selectionOrRelations;
  const dimensions = isSketchSelection(selectionOrRelations)
    ? isSketchSelection(dimensionsOrSelection)
      ? []
      : dimensionsOrSelection
    : relationsOrDimensions as readonly DrivingDistanceDimension[];
  const canonicalSelection = normalizeSketchSelection(selection);
  const pointIds = new Set(geometry.points.map((point) => point.id));
  const segmentIds = new Set(geometry.segments.map((segment) => segment.id));
  const relationIds = new Set(relations.map((relation) => relation.id));
  const dimensionIds = new Set(dimensions.map((dimension) => dimension.id));
  const diagnostics: SketchSelectionDiagnostic[] = [];

  collectMissingTargets(
    canonicalSelection.pointIds,
    pointIds,
    'point',
    diagnostics
  );
  collectMissingTargets(
    canonicalSelection.segmentIds,
    segmentIds,
    'segment',
    diagnostics
  );
  collectMissingTargets(
    canonicalSelection.relationIds,
    relationIds,
    'relation',
    diagnostics
  );
  collectMissingTargets(
    canonicalSelection.dimensionIds,
    dimensionIds,
    'dimension',
    diagnostics
  );

  const removedPointIds = new Set(
    canonicalSelection.pointIds.filter((id) => pointIds.has(id))
  );
  const removedSegmentIds = new Set(
    canonicalSelection.segmentIds.filter((id) => segmentIds.has(id))
  );

  for (const segment of geometry.segments) {
    if (
      removedPointIds.has(segment.startPointId)
      || removedPointIds.has(segment.endPointId)
    ) {
      removedSegmentIds.add(segment.id);
    }
  }
  const orphanCandidates = new Set(removedPointIds);
  for (const segment of geometry.segments) {
    if (!removedSegmentIds.has(segment.id)) continue;
    orphanCandidates.add(segment.startPointId);
    orphanCandidates.add(segment.endPointId);
  }

  const next = cloneNormalizedSketch(geometry);
  next.segments = next.segments.filter(
    (segment) => !removedSegmentIds.has(segment.id)
  );
  const retainedPointIds = new Set(
    next.segments.flatMap((segment) => [
      segment.startPointId,
      segment.endPointId,
    ])
  );
  for (const pointId of orphanCandidates) {
    if (!retainedPointIds.has(pointId)) removedPointIds.add(pointId);
  }
  next.points = next.points.filter((point) => !removedPointIds.has(point.id));

  const explicitlyRemovedRelationIds = new Set(
    canonicalSelection.relationIds.filter((id) => relationIds.has(id))
  );
  const explicitlyRemovedDimensionIds = new Set(
    canonicalSelection.dimensionIds.filter((id) => dimensionIds.has(id))
  );
  const removedRelationIds = new Set(explicitlyRemovedRelationIds);
  const removedDimensionIds = new Set(explicitlyRemovedDimensionIds);

  const nextRelations = relations.flatMap((relation): SketchConstraint[] => {
    if (
      explicitlyRemovedRelationIds.has(relation.id)
      || relationReferencesRemovedGeometry(
        relation,
        removedPointIds,
        removedSegmentIds
      )
    ) {
      removedRelationIds.add(relation.id);
      return [];
    }
    return [cloneConstraint(relation)];
  });
  const nextDimensions = dimensions.flatMap(
    (dimension): DrivingDistanceDimension[] => {
      if (
        explicitlyRemovedDimensionIds.has(dimension.id)
        || relationReferencesRemovedGeometry(
          dimension,
          removedPointIds,
          removedSegmentIds
        )
      ) {
        removedDimensionIds.add(dimension.id);
        return [];
      }
      return [{ ...dimension }];
    }
  );

  return {
    geometry: next,
    relations: nextRelations.sort(compareById),
    dimensions: nextDimensions.sort(compareById),
    selection: createEmptySketchSelection(),
    removedPointIds: [...removedPointIds].sort(),
    removedSegmentIds: [...removedSegmentIds].sort(),
    removedRelationIds: [...removedRelationIds].sort(),
    removedDimensionIds: [...removedDimensionIds].sort(),
    diagnostics: diagnostics.sort(
      (left, right) =>
        left.targetType.localeCompare(right.targetType)
        || left.targetId.localeCompare(right.targetId)
    ),
  };
}

function relationReferencesRemovedGeometry(
  relation: SketchRelation,
  pointIds: ReadonlySet<string>,
  segmentIds: ReadonlySet<string>
): boolean {
  switch (relation.type) {
    case 'coincident':
    case 'distance':
      return pointIds.has(relation.pointAId) || pointIds.has(relation.pointBId);
    case 'fixed':
      return pointIds.has(relation.pointId);
    case 'horizontal':
    case 'vertical':
      return segmentIds.has(relation.segmentId);
    case 'parallel':
    case 'perpendicular':
    case 'equal':
      return (
        segmentIds.has(relation.segmentAId)
        || segmentIds.has(relation.segmentBId)
      );
  }
}

function cloneConstraint(relation: SketchConstraint): SketchConstraint {
  return relation.type === 'fixed'
    ? { ...relation, position: [...relation.position] }
    : { ...relation };
}

function collectMissingTargets(
  selectedIds: readonly string[],
  existingIds: ReadonlySet<string>,
  targetType: SketchSelectionDiagnostic['targetType'],
  diagnostics: SketchSelectionDiagnostic[]
): void {
  for (const targetId of selectedIds) {
    if (existingIds.has(targetId)) continue;
    diagnostics.push({
      code: 'SELECTION_TARGET_NOT_FOUND',
      message: `Selected sketch ${targetType} "${targetId}" no longer exists.`,
      targetType,
      targetId,
    });
  }
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function isSketchSelection(
  value:
    | SketchSelection
    | readonly SketchConstraint[]
    | readonly DrivingDistanceDimension[]
): value is SketchSelection {
  return !Array.isArray(value)
    && 'pointIds' in value
    && 'segmentIds' in value
    && 'relationIds' in value
    && 'dimensionIds' in value;
}
