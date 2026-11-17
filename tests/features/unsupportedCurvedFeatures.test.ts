import { describe, expect, it } from 'vitest';
import { createHoleFeature, rebuildHole } from '../../src/features/hole/HoleFeature';
import { createFilletFeature, rebuildFillet } from '../../src/features/fillet/FilletFeature';
import { createBoxFeature, rebuildBox } from '../../src/features/primitives/BoxFeature';
import { createRebuildEngine } from '../../src/features/RebuildEngine';

describe('unsupported curved features', () => {
  it.each(['hole', 'fillet'] as const)('fails closed for persisted %s history and allows suppression to recover', type => {
    const box = createBoxFeature();
    box.id = 'box';
    const unsupported = type === 'hole'
      ? createHoleFeature({ bodyRef: { bodyId: 'box_body', featureId: box.id }, position: [0, 0], faceId: '+Z', holeType: 'through', diameter: 1 })
      : createFilletFeature({ sourceFeatureId: box.id, edgeIds: ['+X+Y'], radius: 1 });
    expect(unsupported.refsIn).toEqual([box.id]);
    const engine = createRebuildEngine();
    engine.registerHandler('box', rebuildBox);
    engine.registerHandler('hole', rebuildHole);
    engine.registerHandler('fillet', rebuildFillet);
    const result = engine.rebuild([box, unsupported]);
    expect(result).toMatchObject({
      ok: false, featureId: unsupported.id,
      diagnostics: [{ code: `UNSUPPORTED_${type.toUpperCase()}`, featureId: unsupported.id }],
    });
    expect(result.bodiesByFeature.size).toBe(1);
    expect(result.outputsByFeature.has(unsupported.id)).toBe(false);
    const recovered = engine.rebuild([box, { ...unsupported, suppressed: true }]);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(recovered.bodies.map(body => body.id)).toEqual(['box_body']);
  });
});
