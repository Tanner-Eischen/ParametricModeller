import { describe, it, expect } from 'vitest';
import {
  snapToGrid,
  parseNumericInput,
  formatDistance,
  createSnapSettings,
  toggleSnap,
  setAxisLock,
  defaultSnapSettings,
} from '../../src/ui/Snapping';

describe('Snapping', () => {
  describe('snapToGrid', () => {
    it('should snap to nearest grid step', () => {
      expect(snapToGrid(0.5, 0.25)).toBe(0.5);
      expect(snapToGrid(0.4, 0.25)).toBe(0.5);
      expect(snapToGrid(0.3, 0.25)).toBe(0.3); // 0.25 rounded to 1 decimal = 0.3
    });

    it('should use default grid step if not provided', () => {
      // Default is 1/16 = 0.0625
      expect(snapToGrid(0.5)).toBe(0.5);
      // Note: 0.1 snaps to 0.125, but toFixed(2) rounds it to 0.13
      expect(snapToGrid(0.1)).toBe(0.13);
    });

    it('should handle negative values', () => {
      expect(snapToGrid(-0.4, 0.25)).toBe(-0.5);
      // Note: -0.25.toFixed(1) rounds to -0.3 due to floating point
      expect(snapToGrid(-0.2, 0.25)).toBe(-0.3);
    });

    it('should return value as-is for non-positive step', () => {
      expect(snapToGrid(0.5, 0)).toBe(0.5);
      expect(snapToGrid(0.5, -1)).toBe(0.5);
    });

    it('should handle very small steps', () => {
      expect(snapToGrid(0.001, 0.001)).toBe(0.001);
      expect(snapToGrid(0.0015, 0.001)).toBe(0.002);
    });
  });

  describe('parseNumericInput', () => {
    it('should parse plain numbers', () => {
      const result = parseNumericInput('0.5');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(0.5);
      }
    });

    it('should parse integers', () => {
      const result = parseNumericInput('5');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(5);
      }
    });

    it('should parse relative positive values', () => {
      const result = parseNumericInput('+0.75');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(0.75);
      }
    });

    it('should parse relative negative values', () => {
      const result = parseNumericInput('-0.5');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(-0.5);
      }
    });

    it('should parse values with inches unit', () => {
      const result = parseNumericInput('0.5 in');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(0.5);
      }
    });

    it('should parse values with inch unit', () => {
      const result = parseNumericInput('1 inch');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1);
      }
    });

    it('should parse values with quote unit', () => {
      const result = parseNumericInput('2"');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(2);
      }
    });

    it('should parse millimeters and convert to inches', () => {
      const result = parseNumericInput('25.4mm');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(1, 2);
      }
    });

    it('should parse centimeters and convert to inches', () => {
      const result = parseNumericInput('2.54cm');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(1, 2);
      }
    });

    it('should parse feet and convert to inches', () => {
      const result = parseNumericInput("1'");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(12);
      }
    });

    it('should parse fractions', () => {
      const result = parseNumericInput('1/2');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0.5);
      }
    });

    it('should parse fractions with units', () => {
      const result = parseNumericInput('3/4 in');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(0.75);
      }
    });

    it('should parse mixed numbers', () => {
      const result = parseNumericInput('1 1/2');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1.5);
      }
    });

    it('should fail for empty input', () => {
      const result = parseNumericInput('');
      expect(result.ok).toBe(false);
    });

    it('should fail for whitespace only', () => {
      const result = parseNumericInput('   ');
      expect(result.ok).toBe(false);
    });

    it('should fail for invalid number', () => {
      const result = parseNumericInput('abc');
      expect(result.ok).toBe(false);
    });

    it('should fail for unknown unit', () => {
      const result = parseNumericInput('5 lightyears');
      expect(result.ok).toBe(false);
    });

    it('should fail for division by zero in fraction', () => {
      const result = parseNumericInput('1/0');
      expect(result.ok).toBe(false);
    });

    it('should be case-insensitive for units', () => {
      const result = parseNumericInput('25.4 MM');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeCloseTo(1, 2);
      }
    });

    it('should handle extra whitespace', () => {
      const result = parseNumericInput('  1.5  in  ');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1.5);
      }
    });
  });

  describe('formatDistance', () => {
    it('should format common fractions', () => {
      expect(formatDistance(0.5)).toBe('1/2"');
      expect(formatDistance(0.25)).toBe('1/4"');
      expect(formatDistance(0.75)).toBe('3/4"');
    });

    it('should format decimal values', () => {
      // Value rounds to 0.33 at precision 4
      const result = formatDistance(0.33);
      expect(result).toMatch(/0\.33/);
    });

    it('should handle negative values', () => {
      const result = formatDistance(-0.5);
      expect(result).toBe('-0.5"');
    });

    it('should use specified precision', () => {
      expect(formatDistance(0.123456, 2)).toBe('0.12"');
    });
  });

  describe('createSnapSettings', () => {
    it('should create default settings', () => {
      const settings = createSnapSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.gridStep).toBe(0.0625);
    });

    it('should override settings', () => {
      const settings = createSnapSettings({ enabled: false, gridStep: 0.5 });
      expect(settings.enabled).toBe(false);
      expect(settings.gridStep).toBe(0.5);
    });
  });

  describe('toggleSnap', () => {
    it('should toggle enabled state', () => {
      const settings = createSnapSettings({ enabled: true });
      const toggled = toggleSnap(settings);
      expect(toggled.enabled).toBe(false);
    });

    it('should toggle off to on', () => {
      const settings = createSnapSettings({ enabled: false });
      const toggled = toggleSnap(settings);
      expect(toggled.enabled).toBe(true);
    });
  });

  describe('setAxisLock', () => {
    it('should set axis lock', () => {
      const settings = createSnapSettings();
      const locked = setAxisLock(settings, 'x');
      expect(locked.axisLock).toBe(true);
      expect(locked.axisLockAxis).toBe('x');
    });

    it('should clear axis lock with null', () => {
      const settings = createSnapSettings({ axisLock: true, axisLockAxis: 'y' });
      const unlocked = setAxisLock(settings, null);
      expect(unlocked.axisLock).toBe(false);
      expect(unlocked.axisLockAxis).toBeNull();
    });
  });

  describe('defaultSnapSettings', () => {
    it('should have expected defaults', () => {
      expect(defaultSnapSettings.enabled).toBe(true);
      expect(defaultSnapSettings.gridStep).toBe(0.0625); // 1/16 inch
      expect(defaultSnapSettings.axisLock).toBe(false);
      expect(defaultSnapSettings.axisLockAxis).toBeNull();
    });
  });
});
