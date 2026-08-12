/**
 * Snapping utilities for push/pull and other direct manipulation.
 * Milestone 03: Push/Pull as a Feature
 */

import { parseNumericInput as parseSharedNumericInput } from '../interaction/NumericInput';

/**
 * Settings for grid snapping.
 */
export interface SnapSettings {
  /** Whether snapping is enabled */
  enabled: boolean;
  /** Grid step size (default: 1/16 inch = 0.0625) */
  gridStep: number;
  /** Whether axis lock is active */
  axisLock: boolean;
  /** Which axis is locked (if axisLock is true) */
  axisLockAxis: 'x' | 'y' | 'z' | null;
}

/**
 * Default snap settings.
 */
export const defaultSnapSettings: SnapSettings = {
  enabled: true,
  gridStep: 0.0625, // 1/16 inch
  axisLock: false,
  axisLockAxis: null,
};

/**
 * Snap a value to the nearest grid step.
 */
export function snapToGrid(value: number, step?: number): number {
  const gridStep = step ?? defaultSnapSettings.gridStep;
  if (gridStep <= 0) return value;

  const snapped = Math.round(value / gridStep) * gridStep;

  // Handle floating point precision
  const stepText = gridStep.toString().toLowerCase();
  const [coefficient = '', exponentText] = stepText.split('e');
  const decimalPlaces = coefficient.includes('.')
    ? coefficient.length - coefficient.indexOf('.') - 1
    : 0;
  const exponent = exponentText ? Number(exponentText) : 0;
  const precision = Math.min(12, Math.max(0, decimalPlaces - exponent));
  return Number(snapped.toFixed(precision));
}

/**
 * Parse numeric input with optional units and relative operators.
 *
 * Supported formats:
 * - Plain number: "0.5", "1", "2.5"
 * - Relative: "+0.75", "-0.5"
 * - With units: "0.5 in", "5mm", "1 cm"
 * - Fractions: "1/2", "3/4 in", "1 1/2"
 *
 * Returns value in base units (inches).
 */
export function parseNumericInput(
  input: string
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = parseSharedNumericInput(input);
  return parsed.ok
    ? { ok: true, value: parsed.value }
    : { ok: false, error: parsed.error };
}

/**
 * Format a distance value for display.
 */
export function formatDistance(value: number, precision = 4): string {
  // Round to avoid floating point display issues
  const rounded = Number(value.toFixed(precision));

  // Format as fraction if close to a common fraction
  const fractions: [number, string][] = [
    [1 / 16, '1/16'],
    [1 / 8, '1/8'],
    [3 / 16, '3/16'],
    [1 / 4, '1/4'],
    [5 / 16, '5/16'],
    [3 / 8, '3/8'],
    [7 / 16, '7/16'],
    [1 / 2, '1/2'],
    [9 / 16, '9/16'],
    [5 / 8, '5/8'],
    [11 / 16, '11/16'],
    [3 / 4, '3/4'],
    [13 / 16, '13/16'],
    [7 / 8, '7/8'],
    [15 / 16, '15/16'],
  ];

  const tolerance = 0.001;
  for (const [frac, label] of fractions) {
    if (Math.abs(rounded - frac) < tolerance) {
      return `${label}"`;
    }
  }

  // Format as decimal
  return `${rounded}"`;
}

/**
 * Create a snap settings object.
 */
export function createSnapSettings(
  overrides?: Partial<SnapSettings>
): SnapSettings {
  return {
    ...defaultSnapSettings,
    ...overrides,
  };
}

/**
 * Toggle snap enabled state.
 */
export function toggleSnap(settings: SnapSettings): SnapSettings {
  return {
    ...settings,
    enabled: !settings.enabled,
  };
}

/**
 * Set axis lock.
 */
export function setAxisLock(
  settings: SnapSettings,
  axis: 'x' | 'y' | 'z' | null
): SnapSettings {
  return {
    ...settings,
    axisLock: axis !== null,
    axisLockAxis: axis,
  };
}
