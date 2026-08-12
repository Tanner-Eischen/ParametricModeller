/**
 * Numeric tolerances used by the modeling kernel.
 *
 * Model-space values are expressed in the document base unit (inches today).
 * Screen-space picking tolerances intentionally live in the interaction layer.
 */
export interface TolerancePolicy {
  /** General equality and welding tolerance. */
  linear: number;
  /** Maximum distance from a supporting plane. */
  planarity: number;
  /** Endpoint/profile graph coincidence tolerance. */
  profile: number;
  /** Near-zero area threshold for planar profiles. */
  area: number;
  /** Near-parallel direction threshold. */
  angular: number;
  /** Bounds allowance for fail-closed planar operations. */
  operationBounds: number;
  /** Extra distance used to guarantee a through-all cut exits the body. */
  throughAllExtension: number;
}

export const DEFAULT_TOLERANCE_POLICY: Readonly<TolerancePolicy> = Object.freeze({
  linear: 1e-6,
  planarity: 0.001,
  profile: 1e-6,
  area: 1e-10,
  angular: 1e-6,
  operationBounds: 0.001,
  throughAllExtension: 0.01,
});

export function createTolerancePolicy(
  overrides: Partial<TolerancePolicy> = {}
): Readonly<TolerancePolicy> {
  const policy = { ...DEFAULT_TOLERANCE_POLICY, ...overrides };
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Tolerance ${name} must be a finite positive number`);
    }
  }
  return Object.freeze(policy);
}

export function approximatelyEqual(
  left: number,
  right: number,
  tolerance = DEFAULT_TOLERANCE_POLICY.linear
): boolean {
  return Math.abs(left - right) <= tolerance;
}

export function quantizeToTolerance(
  value: number,
  tolerance = DEFAULT_TOLERANCE_POLICY.linear
): number {
  if (!Number.isFinite(value)) {
    throw new Error('Only finite values can be quantized');
  }
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error('Tolerance must be a finite positive number');
  }
  return Math.round(value / tolerance) * tolerance;
}
