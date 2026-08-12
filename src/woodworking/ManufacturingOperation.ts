import type { PlacementDatumRef } from '../features/placement';

/**
 * Stable, process-neutral manufacturing intent emitted by modeling features.
 *
 * These records deliberately describe the desired removal instead of choosing
 * a particular machine or generating toolpaths.  CAM and shop-drawing layers
 * can refine them without making the feature tree machine-specific.
 */
export type ManufacturingOperationKind =
  | 'mortise'
  | 'tenon'
  | 'dado'
  | 'groove'
  | 'rabbet'
  | 'lap'
  | 'bridle'
  | 'notch'
  | 'sawCut'
  | 'chamfer'
  | 'miter';

export type ManufacturingProcess =
  | 'saw'
  | 'router'
  | 'drill'
  | 'chisel'
  | 'handTool';

export interface ManufacturingRemoval {
  shape: 'rectangularPrism' | 'triangularPrism' | 'planeCut';
  width?: number;
  depth?: number;
  length?: number;
  angleDegrees?: number;
  kerf?: number;
}

export interface ManufacturingOperation {
  /** Deterministic identity within the owning feature. */
  id: string;
  featureId: string;
  memberBodyId: string;
  kind: ManufacturingOperationKind;
  process: ManufacturingProcess;
  sequence: number;
  /** Exact persisted datum used to set up this operation. */
  datumRef: PlacementDatumRef;
  removal: ManufacturingRemoval;
  sideClearance: number;
  endClearance: number;
  notes?: string;
}

export function sortManufacturingOperations(
  operations: readonly ManufacturingOperation[]
): ManufacturingOperation[] {
  return [...operations].sort((left, right) =>
    left.sequence - right.sequence || left.id.localeCompare(right.id)
  );
}
