import { describe, expect, it } from 'vitest';
import { parseNumericInput, resolveNumericInput } from '../../src/interaction/NumericInput';

describe('parseNumericInput', () => {
  it.each([
    ['2.5', 2.5],
    ['3/4 in', 0.75],
    ['1 1/2"', 1.5],
    ['25.4mm', 1],
    ['2.54 cm', 1],
    ['(2 + 3) * 4 / 2', 10],
    ['-2 + 3', 1],
    ['(12.7 + 12.7)mm', 1],
  ])('parses %s as %d inches', (input, expected) => {
    const result = parseNumericInput(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(expected, 10);
    }
  });

  it('preserves relative intent separately from the resolved value', () => {
    const result = parseNumericInput('+25.4mm');
    expect(result).toMatchObject({
      ok: true,
      value: 1,
      isRelative: true,
      relativeOperator: '+',
    });
    if (result.ok) {
      expect(resolveNumericInput(4, result)).toBeCloseTo(5);
    }

    const negative = parseNumericInput('-1/2in');
    expect(negative).toMatchObject({ ok: true, value: -0.5, relativeOperator: '-' });
    if (negative.ok) {
      expect(resolveNumericInput(4, negative)).toBeCloseTo(3.5);
    }
  });

  it.each(['', 'abc', '1/0', '(2 + 3', '2 ** 3', '1mm + 2'])('rejects unsafe or invalid input: %s', (input) => {
    expect(parseNumericInput(input).ok).toBe(false);
  });
});
