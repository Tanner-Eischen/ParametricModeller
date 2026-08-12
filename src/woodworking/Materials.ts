import type { BoardOrientation } from './Measurements';

export type GrainPattern = 'straight' | 'rift' | 'quarter' | 'flat' | 'end' | 'mixed';

export interface Material {
  /** Stable catalogue identifier used by cut-list grouping. */
  id: string;
  species: string;
  grade?: string;
  stockCode?: string;
  densityKgM3?: number;
}

/** Extra stock left for milling, expressed as total allowance in model inches. */
export interface StockAllowance {
  length: number;
  width: number;
  thickness: number;
}

export interface BoardMetadata extends BoardOrientation {
  material: Material;
  grainPattern?: GrainPattern;
  /** Optional human-readable part/board identifier. */
  partNumber?: string;
  notes?: string;
  /** Per-dimension stock added to the measured finished size. */
  stockAllowance?: Partial<StockAllowance>;
}

export function validateBoardMetadata(metadata: BoardMetadata): void {
  if (metadata.material.id.trim().length === 0) {
    throw new Error('Material id is required');
  }
  if (metadata.material.species.trim().length === 0) {
    throw new Error('Material species is required');
  }
  if (
    metadata.material.densityKgM3 !== undefined
    && (!Number.isFinite(metadata.material.densityKgM3) || metadata.material.densityKgM3 <= 0)
  ) {
    throw new Error('Material densityKgM3 must be a finite positive number');
  }
  for (const [dimension, allowance] of Object.entries(metadata.stockAllowance ?? {})) {
    if (
      !['length', 'width', 'thickness'].includes(dimension)
      || typeof allowance !== 'number'
      || !Number.isFinite(allowance)
      || allowance < 0
    ) {
      throw new Error(`Stock allowance ${dimension} must be a finite non-negative number`);
    }
  }
}
