import { describe, expect, it } from 'vitest';
import {
  validateBoardMetadata,
  type BoardMetadata,
} from '../../src/woodworking/Materials';

function metadata(overrides: Partial<BoardMetadata> = {}): BoardMetadata {
  return {
    material: { id: 'oak', species: 'White oak' },
    grainAxis: [1, 0, 0],
    thicknessAxis: [0, 0, 1],
    ...overrides,
  };
}

describe('validateBoardMetadata', () => {
  it('accepts valid metadata with omitted optional manufacturing values', () => {
    expect(() => validateBoardMetadata(metadata())).not.toThrow();
  });

  it('rejects missing material identity and species', () => {
    expect(() => validateBoardMetadata(metadata({
      material: { id: ' ', species: 'White oak' },
    }))).toThrow('Material id is required');
    expect(() => validateBoardMetadata(metadata({
      material: { id: 'oak', species: ' ' },
    }))).toThrow('Material species is required');
  });

  it('rejects non-positive or non-finite density while accepting a valid density', () => {
    expect(() => validateBoardMetadata(metadata({
      material: { id: 'oak', species: 'White oak', densityKgM3: 680 },
    }))).not.toThrow();
    for (const densityKgM3 of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateBoardMetadata(metadata({
        material: { id: 'oak', species: 'White oak', densityKgM3 },
      }))).toThrow('Material densityKgM3 must be a finite positive number');
    }
  });

  it('rejects unknown, negative, and non-finite stock allowances', () => {
    expect(() => validateBoardMetadata(metadata({
      stockAllowance: { length: 0, width: 0.125, thickness: 0.25 },
    }))).not.toThrow();
    expect(() => validateBoardMetadata(metadata({
      stockAllowance: { length: -0.01 },
    }))).toThrow('Stock allowance length');
    expect(() => validateBoardMetadata(metadata({
      stockAllowance: { width: Number.NaN },
    }))).toThrow('Stock allowance width');
    expect(() => validateBoardMetadata(metadata({
      stockAllowance: { unsupported: 1 } as never,
    }))).toThrow('Stock allowance unsupported');
  });
});
