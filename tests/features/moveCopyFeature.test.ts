import { describe, expect, it } from 'vitest';
import {
  createBoxFeature,
  createMoveCopyFeature,
  createRebuildContext,
  rebuildBox,
  rebuildMoveCopy,
  registerBodies,
} from '../../src/features';
import type { Body } from '../../src/geometry/Body';

function sourceFixture(): { body: Body; context: ReturnType<typeof createRebuildContext> } {
  const sourceFeature = createBoxFeature({ width: 2, depth: 3, height: 4 });
  sourceFeature.id = 'source-feature';
  const sourceResult = rebuildBox(sourceFeature, createRebuildContext());
  if (!sourceResult.ok) throw new Error(sourceResult.error);
  return {
    body: sourceResult.bodies[0]!,
    context: registerBodies(
      createRebuildContext(),
      sourceFeature.id,
      sourceResult.bodies
    ),
  };
}

describe('MoveCopyFeature', () => {
  it('moves the exact source body and replaces it with stable topology', () => {
    const { body, context } = sourceFixture();
    const feature = createMoveCopyFeature(
      { featureId: 'source-feature', bodyId: body.id },
      [2, -1, 3],
      'move'
    );
    feature.id = 'move-feature';

    const result = rebuildMoveCopy(feature, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replacedBodyIds).toEqual([body.id]);
    expect(result.bodies[0]!.id).toBe(body.id);
    const sourcePosition = [...body.vertices.values()][0]!.position;
    const movedPosition = [...result.bodies[0]!.vertices.values()][0]!.position;
    expect(movedPosition).toEqual([
      sourcePosition[0] + 2,
      sourcePosition[1] - 1,
      sourcePosition[2] + 3,
    ]);
  });

  it('copies without replacing the source and is deterministic across ten rebuilds', () => {
    const { body, context } = sourceFixture();
    const feature = createMoveCopyFeature(
      { featureId: 'source-feature', bodyId: body.id },
      [1, 0, 0],
      'copy'
    );
    feature.id = 'copy-feature';

    const results = Array.from({ length: 10 }, () => rebuildMoveCopy(feature, context));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    const first = results[0]!;
    if (!first.ok) return;
    expect(first.replacedBodyIds).toBeUndefined();
    expect(first.bodies[0]!.id).toBe(`${body.id}_copy-feature_copy`);
  });

  it('fails closed when the exact body reference is unavailable', () => {
    const { context } = sourceFixture();
    const feature = createMoveCopyFeature(
      { featureId: 'source-feature', bodyId: 'missing-body' },
      [1, 0, 0],
      'copy'
    );

    expect(rebuildMoveCopy(feature, context)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'SOURCE_BODY_NOT_FOUND', entityId: 'missing-body' }],
    });
  });

  it('validates finite translations and complete source references', () => {
    const feature = createMoveCopyFeature(
      { featureId: '', bodyId: '' },
      [Number.NaN, 0, 0],
      'move'
    );
    const result = rebuildMoveCopy(feature, createRebuildContext());

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'MISSING_SOURCE_FEATURE',
      'MISSING_SOURCE_BODY',
      'INVALID_TRANSLATION',
    ]);
  });
});

