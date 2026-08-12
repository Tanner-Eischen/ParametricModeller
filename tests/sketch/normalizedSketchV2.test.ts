import { describe, expect, it } from 'vitest';
import {
  getNormalizedSketchRelationsV2,
  migrateNormalizedSketchDataToV2,
  validateNormalizedSketchDataV2,
} from '../../src/sketch/NormalizedSketchV2';
import { createLineEntity } from '../../src/sketch/SketchTypes';

describe('normalized sketch data v2', () => {
  it('deterministically migrates legacy entities and persistent solver inputs', () => {
    const entities = [
      createLineEntity([1, 0], [2, 0], 'b'),
      createLineEntity([0, 0], [1, 0], 'a'),
    ];
    const data = migrateNormalizedSketchDataToV2({
      entities,
      relations: [{ id: 'horizontal', type: 'horizontal', segmentId: 'a' }],
      inferenceInputs: [{
        id: 'inferred',
        type: 'horizontal',
        segmentId: 'b',
      }],
    });
    const reversed = migrateNormalizedSketchDataToV2({
      entities: [...entities].reverse(),
      relations: [{ id: 'horizontal', type: 'horizontal', segmentId: 'a' }],
      inferenceInputs: [{
        id: 'inferred',
        type: 'horizontal',
        segmentId: 'b',
      }],
    });

    expect(reversed).toEqual(data);
    expect(data.schemaVersion).toBe(2);
    expect(data.geometry.schemaVersion).toBe(1);
    expect(getNormalizedSketchRelationsV2(data).map((relation) => relation.id))
      .toEqual(['horizontal', 'inferred']);
    expect(validateNormalizedSketchDataV2(data)).toEqual([]);
  });

  it('deep clones data and reports duplicate IDs or stale inference topology', () => {
    const data = migrateNormalizedSketchDataToV2({
      entities: [createLineEntity([0, 0], [1, 0], 'line')],
      relations: [{ id: 'duplicate', type: 'horizontal', segmentId: 'line' }],
      inferenceInputs: [
        { id: 'duplicate', type: 'vertical', segmentId: 'missing' },
      ],
    });
    const issues = validateNormalizedSketchDataV2(data);

    expect(issues.map((issue) => issue.code)).toEqual([
      'DUPLICATE_PERSISTENT_ID',
      'INVALID_INFERENCE_INPUT',
    ]);
  });
});
