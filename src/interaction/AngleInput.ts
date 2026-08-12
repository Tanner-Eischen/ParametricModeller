import { parseNumericInput } from './NumericInput';

export type AngleUnit = 'deg' | 'rad';

export interface AngleInputOptions {
  defaultUnit?: AngleUnit;
}

export type AngleInputResult =
  | {
      ok: true;
      /** Canonical value used by current feature parameters. */
      degrees: number;
      radians: number;
      unit: AngleUnit;
      isRelative: boolean;
      relativeOperator: '+' | '-' | null;
    }
  | { ok: false; error: string };

const ANGLE_UNIT_PATTERNS: Array<[RegExp, AngleUnit]> = [
  [/(?:degrees?|deg|°)$/i, 'deg'],
  [/(?:radians?|rad)$/i, 'rad'],
];

/**
 * Parse a safe numeric angle expression.
 *
 * Bare values default to degrees. Supported suffixes are `deg`, `°`, and
 * `rad`; distance units are rejected by the shared numeric parser.
 */
export function parseAngleInput(
  input: string,
  options: AngleInputOptions = {}
): AngleInputResult {
  const extracted = extractAngleUnit(input, options.defaultUnit ?? 'deg');
  if (!extracted.expression) {
    return { ok: false, error: 'Missing numeric angle expression' };
  }
  if (hasDistanceUnit(extracted.expression)) {
    return { ok: false, error: 'Distance units are not valid for an angle' };
  }
  const numeric = parseNumericInput(extracted.expression);
  if (!numeric.ok) return numeric;

  const radians = extracted.unit === 'rad'
    ? numeric.value
    : numeric.value * Math.PI / 180;
  const degrees = extracted.unit === 'deg'
    ? numeric.value
    : numeric.value * 180 / Math.PI;
  if (!Number.isFinite(degrees) || !Number.isFinite(radians)) {
    return { ok: false, error: 'Angle result is not finite' };
  }

  return {
    ok: true,
    degrees,
    radians,
    unit: extracted.unit,
    isRelative: numeric.isRelative,
    relativeOperator: numeric.relativeOperator,
  };
}

export function resolveAngleInputDegrees(
  baseDegrees: number,
  result: Extract<AngleInputResult, { ok: true }>
): number {
  return result.isRelative ? baseDegrees + result.degrees : result.degrees;
}

function extractAngleUnit(
  input: string,
  fallback: AngleUnit
): { expression: string; unit: AngleUnit } {
  const trimmed = input.trim();
  for (const [pattern, unit] of ANGLE_UNIT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        expression: trimmed.slice(0, -match[0].length).trim(),
        unit,
      };
    }
  }
  return { expression: trimmed, unit: fallback };
}

function hasDistanceUnit(expression: string): boolean {
  return /(?:millimeters?|mm|centimeters?|cm|inches|inch|in|"|feet|foot|ft|'|meters?|m)$/i
    .test(expression.trim());
}
