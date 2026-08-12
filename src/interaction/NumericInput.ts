export type NumericUnit = 'in' | 'mm' | 'cm' | 'ft' | 'm';

export interface NumericInputOptions {
  defaultUnit?: NumericUnit;
}

export type NumericInputResult =
  | {
      ok: true;
      value: number;
      unit: NumericUnit;
      isRelative: boolean;
      relativeOperator: '+' | '-' | null;
    }
  | { ok: false; error: string };

const UNIT_ALIASES: Array<[RegExp, NumericUnit]> = [
  [/(?:millimeters?|mm)$/i, 'mm'],
  [/(?:centimeters?|cm)$/i, 'cm'],
  [/(?:inches|inch|in|")$/i, 'in'],
  [/(?:feet|foot|ft|')$/i, 'ft'],
  [/(?:meters?|m)$/i, 'm'],
];

function convertToInches(value: number, unit: NumericUnit): number {
  switch (unit) {
    case 'mm':
      return value / 25.4;
    case 'cm':
      return value / 2.54;
    case 'ft':
      return value * 12;
    case 'm':
      return value * 39.37007874015748;
    case 'in':
    default:
      return value;
  }
}

class ArithmeticParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new Error(`Unexpected token at position ${this.index + 1}`);
    }
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      if (this.consume('+')) {
        value += this.parseTerm();
      } else if (this.consume('-')) {
        value -= this.parseTerm();
      } else {
        return value;
      }
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    while (true) {
      this.skipWhitespace();
      if (this.consume('*')) {
        value *= this.parseUnary();
      } else if (this.consume('/')) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new Error('Division by zero');
        }
        value /= divisor;
      } else {
        return value;
      }
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    if (this.consume('+')) {
      return this.parseUnary();
    }
    if (this.consume('-')) {
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.consume('(')) {
      const value = this.parseExpression();
      this.skipWhitespace();
      if (!this.consume(')')) {
        throw new Error('Missing closing parenthesis');
      }
      return value;
    }

    const start = this.index;
    let dotCount = 0;
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === '.') {
        dotCount += 1;
        if (dotCount > 1) break;
      } else if (!/\d/.test(character)) {
        break;
      }
      this.index += 1;
    }
    if (this.index === start || this.source.slice(start, this.index) === '.') {
      throw new Error(`Expected a number at position ${start + 1}`);
    }
    return Number(this.source.slice(start, this.index));
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] ?? '')) {
      this.index += 1;
    }
  }

  private consume(character: string): boolean {
    if (this.source[this.index] !== character) {
      return false;
    }
    this.index += 1;
    return true;
  }
}

function extractUnit(input: string, fallback: NumericUnit): { expression: string; unit: NumericUnit } {
  const trimmed = input.trim();
  for (const [pattern, unit] of UNIT_ALIASES) {
    const match = trimmed.match(pattern);
    if (match) {
      return { expression: trimmed.slice(0, -match[0].length).trim(), unit };
    }
  }
  return { expression: trimmed, unit: fallback };
}

/** Parses CAD-friendly values without evaluating JavaScript. All values are returned in inches. */
export function parseNumericInput(
  input: string,
  options: NumericInputOptions = {}
): NumericInputResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty input' };
  }

  const relativeOperator = trimmed[0] === '+' || trimmed[0] === '-'
    ? trimmed[0] as '+' | '-'
    : null;
  const { expression: expressionWithMixedNumbers, unit } = extractUnit(
    trimmed,
    options.defaultUnit ?? 'in'
  );
  if (!expressionWithMixedNumbers) {
    return { ok: false, error: 'Missing numeric expression' };
  }

  const expression = expressionWithMixedNumbers.replace(
    /(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/g,
    '($1+$2/$3)'
  );

  try {
    let value = new ArithmeticParser(expression).parse();
    if (!Number.isFinite(value)) {
      return { ok: false, error: 'Result is not finite' };
    }
    value = convertToInches(value, unit);

    return {
      ok: true,
      value,
      unit,
      isRelative: relativeOperator !== null,
      relativeOperator,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid expression' };
  }
}

export function resolveNumericInput(baseValue: number, result: Extract<NumericInputResult, { ok: true }>): number {
  return result.isRelative ? baseValue + result.value : result.value;
}
