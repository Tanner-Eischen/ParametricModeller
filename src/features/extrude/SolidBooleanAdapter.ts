import type { Body } from '../../geometry';

export type SolidBooleanOperation = 'Add' | 'Cut';

export interface SolidBooleanRequest {
  operation: SolidBooleanOperation;
  featureId: string;
  targetBody: Body;
  toolBody: Body;
}

export type SolidBooleanAdapterResult =
  | { ok: true; body: Body; bodies?: Body[]; primaryBodyId?: string | null }
  | { ok: false; code: string; message: string; referenceIds?: string[] };

/** Adapter seam for the planar boolean kernel; implementations must not mutate inputs. */
export interface SolidBooleanAdapter {
  apply(request: SolidBooleanRequest): SolidBooleanAdapterResult;
}

export const unavailableSolidBooleanAdapter: SolidBooleanAdapter = {
  apply: ({ operation }) => ({
    ok: false,
    code: 'BOOLEAN_KERNEL_UNAVAILABLE',
    message: `${operation} requires the planar boolean kernel, which is not available in this rebuild context.`,
  }),
};
