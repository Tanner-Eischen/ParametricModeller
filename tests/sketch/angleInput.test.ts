import { describe, expect, it } from 'vitest';
import {
  parseAngleInput,
  resolveAngleInputDegrees,
} from '../../src/interaction/AngleInput';

describe('parseAngleInput', () => {
  it.each([
    ['45', 45],
    ['45deg', 45],
    ['45°', 45],
    ['(30 + 15) degrees', 45],
    ['0.7853981633974483rad', 45],
  ])('parses %s as %d degrees', (input, expectedDegrees) => {
    const result = parseAngleInput(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degrees).toBeCloseTo(expectedDegrees, 10);
    expect(result.radians).toBeCloseTo(expectedDegrees * Math.PI / 180, 10);
  });

  it('supports radians as the default unit and preserves relative input', () => {
    const radians = parseAngleInput('0.5', { defaultUnit: 'rad' });
    expect(radians.ok && radians.radians).toBeCloseTo(0.5, 10);

    const relative = parseAngleInput('+15deg');
    expect(relative).toMatchObject({
      ok: true,
      degrees: 15,
      isRelative: true,
      relativeOperator: '+',
    });
    if (relative.ok) {
      expect(resolveAngleInputDegrees(30, relative)).toBe(45);
    }
  });

  it.each(['', 'deg', '45mm', 'abc', '1/0rad'])(
    'rejects invalid angle input: %s',
    (input) => {
      expect(parseAngleInput(input).ok).toBe(false);
    }
  );
});
