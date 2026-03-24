/**
 * Snapping utilities for push/pull and other direct manipulation.
 * Milestone 03: Push/Pull as a Feature
 */

import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Snapping');

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
  const precision = Math.max(0, Math.ceil(-Math.log10(gridStep)));
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
  const trimmed = input.trim().toLowerCase();

  if (!trimmed) {
    return { ok: false, error: 'Empty input' };
  }

  // Check for relative operator
  const isRelative = trimmed.startsWith('+') || trimmed.startsWith('-');
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const valuePart = isRelative ? trimmed.substring(1) : trimmed;

  // Parse the value
  let value: number;
  let remaining = valuePart.trim();

  // Try to parse as fraction (e.g., "1/2" or "3/4")
  const fractionMatch = remaining.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fractionMatch) {
    const numerator = parseFloat(fractionMatch[1]!);
    const denominator = parseFloat(fractionMatch[2]!);
    if (denominator === 0) {
      return { ok: false, error: 'Division by zero in fraction' };
    }
    value = numerator / denominator;
    remaining = remaining.substring(fractionMatch[0].length).trim();
  } else {
    // Try to parse as mixed number (e.g., "1 1/2")
    const mixedMatch = remaining.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/);
    if (mixedMatch) {
      const whole = parseFloat(mixedMatch[1]!);
      const numerator = parseFloat(mixedMatch[2]!);
      const denominator = parseFloat(mixedMatch[3]!);
      if (denominator === 0) {
        return { ok: false, error: 'Division by zero in fraction' };
      }
      value = whole + numerator / denominator;
      remaining = remaining.substring(mixedMatch[0].length).trim();
    } else {
      // Try to parse as decimal number
      const numberMatch = remaining.match(/^(-?\d+(?:\.\d+)?)/);
      if (!numberMatch) {
        return { ok: false, error: 'No valid number found' };
      }
      value = parseFloat(numberMatch[1]!);
      remaining = remaining.substring(numberMatch[0].length).trim();
    }
  }

  if (!isFinite(value)) {
    return { ok: false, error: 'Invalid number' };
  }

  // Parse unit suffix
  if (remaining) {
    // Remove any remaining whitespace
    const unit = remaining.trim();

    // Convert to inches
    if (unit === 'in' || unit === 'inch' || unit === 'inches' || unit === '"') {
      // Already in inches
    } else if (unit === 'mm' || unit === 'millimeter' || unit === 'millimeters') {
      value = value / 25.4;
    } else if (unit === 'cm' || unit === 'centimeter' || unit === 'centimeters') {
      value = value / 2.54;
    } else if (unit === 'ft' || unit === 'foot' || unit === 'feet' || unit === "'") {
      value = value * 12;
    } else if (unit === 'm' || unit === 'meter' || unit === 'meters') {
      value = value * 39.3701;
    } else {
      return { ok: false, error: `Unknown unit: ${unit}` };
    }
  }

  // Apply sign for relative values
  value = sign * Math.abs(value);

  log.debug('Parsed numeric input', { input, value, isRelative });

  return { ok: true, value };
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
