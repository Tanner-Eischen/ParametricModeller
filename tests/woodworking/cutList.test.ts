import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import type { BoardMetadata, CutListPart } from '../../src/woodworking';
import {
  buildCutListDocument,
  cutListDocumentToCsv,
  cutListToCsv,
  groupCutList,
} from '../../src/woodworking';

const oak: BoardMetadata = {
  material: { id: 'oak-fas', species: 'White Oak', grade: 'FAS' },
  grainAxis: [1, 0, 0],
  thicknessAxis: [0, 0, 1],
  grainPattern: 'straight',
};

function part(
  id: string,
  origin: [number, number, number],
  name: string,
  width = 30,
  metadata = oak
): CutListPart {
  return {
    body: createBoxBody({
      width,
      depth: 4,
      height: 0.75,
      anchorMode: 'corner',
      origin,
    }, id),
    metadata,
    name,
  };
}

describe('woodworking cut lists', () => {
  it('groups translated duplicate geometry and is independent of input order', () => {
    const left = part('left', [0, 0, 0], 'Left rail');
    const right = part('right', [100, -20, 8], 'Right rail');
    const short = part('short', [0, 10, 0], 'Short rail', 20);

    const forward = groupCutList([right, short, left]);
    const reverse = groupCutList([left, short, right]);

    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(2);
    const pair = forward.find((group) => group.quantity === 2);
    expect(pair).toMatchObject({
      quantity: 2,
      dimensions: { length: 30, width: 4, thickness: 0.75 },
      partIds: ['left', 'right'],
      partNames: ['Left rail', 'Right rail'],
    });
  });

  it('does not group parts made from distinct materials', () => {
    const walnut: BoardMetadata = {
      ...oak,
      material: { id: 'walnut', species: 'Walnut' },
    };
    expect(groupCutList([
      part('oak', [0, 0, 0], 'Rail', 30, oak),
      part('walnut', [0, 0, 0], 'Rail', 30, walnut),
    ])).toHaveLength(2);
  });

  it('exports metric dimensions as RFC 4180-safe CSV', () => {
    const quoted: BoardMetadata = {
      ...oak,
      material: { id: 'oak-special', species: 'Oak, White', grade: 'Select "A"' },
    };
    const groups = groupCutList([
      part('a', [0, 0, 0], 'Rail, left', 10, quoted),
      part('b', [20, 0, 0], 'Rail "right"', 10, quoted),
    ]);

    const csv = cutListToCsv(groups, { unit: 'mm', precision: 2 });
    expect(csv).toContain('"Rail ""right""; Rail, left",2,"Oak, White","Select ""A""",254,101.6,19.05,mm,straight');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('fails closed when required material identity is absent', () => {
    const invalid = { ...oak, material: { id: '', species: 'Oak' } };
    expect(() => groupCutList([part('invalid', [0, 0, 0], 'Invalid', 10, invalid)]))
      .toThrow('Material id is required');
  });

  it('keeps finished and stock dimensions distinct in a versioned cut-list document', () => {
    const rough: BoardMetadata = {
      ...oak,
      material: { ...oak.material, stockCode: 'OAK-4/4' },
      stockAllowance: { length: 0.5, width: 0.25, thickness: 0.125 },
      notes: 'Leave long for fitting',
    };
    const document = buildCutListDocument([
      part('right', [50, 0, 0], 'Right stile', 30, rough),
      part('left', [0, 0, 0], 'Left stile', 30, rough),
    ], {
      title: 'Base Cabinet',
      unit: 'in',
      generatedAt: '2026-07-30T12:00:00.000Z',
    });

    expect(document).toMatchObject({
      version: 1,
      title: 'Base Cabinet',
      generatedAt: '2026-07-30T12:00:00.000Z',
      summary: { groupCount: 1, partCount: 2 },
      rows: [{
        quantity: 2,
        finishedDimensions: { length: 30, width: 4, thickness: 0.75 },
        stockAllowance: { length: 0.5, width: 0.25, thickness: 0.125 },
        stockDimensions: { length: 30.5, width: 4.25, thickness: 0.875 },
        notes: ['Leave long for fitting'],
      }],
    });
    const csv = cutListDocumentToCsv(document, { precision: 3 });
    expect(csv).toContain(
      'Left stile; Right stile,2,White Oak,FAS,OAK-4/4,30,4,0.75,30.5,4.25,0.875,in,straight'
    );
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('does not group parts that require different stock allowances', () => {
    const rough = {
      ...oak,
      stockAllowance: { length: 0.5 },
    };
    expect(groupCutList([
      part('finished', [0, 0, 0], 'Finished', 30, oak),
      part('rough', [40, 0, 0], 'Rough', 30, rough),
    ])).toHaveLength(2);
  });

  it('keeps density-specific material records deterministic and rejects damaged bodies', () => {
    const light = {
      ...oak,
      material: { ...oak.material, densityKgM3: 650 },
    };
    const heavy = {
      ...oak,
      material: { ...oak.material, densityKgM3: 700 },
    };
    const left = part('light', [0, 0, 0], 'Light', 30, light);
    const right = part('heavy', [40, 0, 0], 'Heavy', 30, heavy);
    expect(groupCutList([left, right])).toEqual(groupCutList([right, left]));
    expect(groupCutList([left, right])).toHaveLength(2);

    const damaged = part('damaged', [0, 0, 0], 'Damaged');
    damaged.body.edges.delete(damaged.body.faces.get('+X')!.boundaryEdgeIds[0]!);
    expect(() => groupCutList([damaged])).toThrow('not a closed planar solid');
  });
});
