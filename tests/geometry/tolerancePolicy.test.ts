import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCE_POLICY,
  approximatelyEqual,
  createTolerancePolicy,
  quantizeToTolerance,
} from '../../src/geometry/TolerancePolicy';

describe('TolerancePolicy', () => {
  it('provides one immutable kernel policy', () => {
    expect(Object.isFrozen(DEFAULT_TOLERANCE_POLICY)).toBe(true);
    expect(DEFAULT_TOLERANCE_POLICY.planarity).toBeGreaterThan(DEFAULT_TOLERANCE_POLICY.linear);
  });

  it('creates validated overrides without mutating the default', () => {
    const policy = createTolerancePolicy({ linear: 0.0001 });
    expect(policy.linear).toBe(0.0001);
    expect(DEFAULT_TOLERANCE_POLICY.linear).toBe(1e-6);
    expect(() => createTolerancePolicy({ linear: 0 })).toThrow(/finite positive/);
  });

  it('compares and quantizes at an explicit tolerance', () => {
    expect(approximatelyEqual(1, 1.0005, 0.001)).toBe(true);
    expect(approximatelyEqual(1, 1.002, 0.001)).toBe(false);
    expect(quantizeToTolerance(1.0000004, 1e-6)).toBe(1);
  });
});
