import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import type { ShopDrawingDefinition } from '../../src/types';
import {
  assertDrawingReferencesExportable,
  canExportDrawingDefinition,
  deleteDrawingReferenceTarget,
  evaluateMeasurement,
  isPinnedMeasurementDimension,
  pinMeasurementIntoDrawing,
  refreshPinnedDrawingMeasurements,
  repairDrawingReference,
  validateDrawingReferences,
} from '../../src/woodworking';

const drawing = (): ShopDrawingDefinition => ({
  id: 'drawing-1',
  name: 'Apron detail',
  scope: { type: 'document' },
  views: ['front'],
  sheet: { width: 11, height: 8.5, orientation: 'landscape' },
  scale: 'fit',
  unit: 'in',
  precision: 3,
  showHiddenLines: false,
  dimensions: [],
  notes: [],
});

describe('drawing reference lifecycle', () => {
  it('pins, refreshes, explicitly repairs, and deletes exact measurement references', () => {
    const source = createBoxBody({
      width: 2, depth: 3, height: 4, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'source');
    const replacement = createBoxBody({
      width: 5, depth: 3, height: 4, anchorMode: 'corner', origin: [10, 0, 0],
    }, 'replacement');
    const evaluated = evaluateMeasurement('edge-measurement', 'edgeLength', [{
      kind: 'edge', featureId: 'source-feature', bodyId: source.id, edgeId: '+Y+Z',
    }], { bodies: [source] });
    if (!evaluated.ok) throw new Error(evaluated.diagnostics[0]?.message);
    const pinned = pinMeasurementIntoDrawing(drawing(), evaluated.result, {
      dimensionId: 'dimension-1', view: 'front', position: [2, 1],
    });

    expect(isPinnedMeasurementDimension(pinned.dimensions[0]!)).toBe(true);
    expect(validateDrawingReferences(pinned, { bodies: [source] })).toEqual([]);
    source.edges.delete('+Y+Z');
    const issues = validateDrawingReferences(pinned, { bodies: [source, replacement] });
    expect(issues).toMatchObject([{
      code: 'BROKEN_DIMENSION_REFERENCE',
      blocking: true,
      actions: [
        { kind: 'repair', expectedReferenceKind: 'edge' },
        { kind: 'delete-dimension' },
      ],
    }]);
    expect(canExportDrawingDefinition(pinned, { bodies: [source] }).allowed).toBe(false);
    expect(() => assertDrawingReferencesExportable(pinned, { bodies: [source] }))
      .toThrow('Use Repair or Delete');

    // Another equal-length source edge is deliberately not chosen automatically.
    expect(issues[0]?.target.id).toBe('dimension-1');
    const repaired = repairDrawingReference(pinned, {
      target: 'dimension',
      dimensionId: 'dimension-1',
      referenceIndex: 0,
      replacement: {
        kind: 'edge',
        featureId: 'replacement-feature',
        bodyId: replacement.id,
        edgeId: '+Y+Z',
      },
    }, { bodies: [source, replacement] });
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(validateDrawingReferences(repaired.definition, { bodies: [replacement] })).toEqual([]);
    const repairedDimension = repaired.definition.dimensions[0]!;
    expect(isPinnedMeasurementDimension(repairedDimension)).toBe(true);
    if (isPinnedMeasurementDimension(repairedDimension)) {
      expect(repairedDimension.measurement).toMatchObject({ length: 5 });
    }
    const refreshed = refreshPinnedDrawingMeasurements(repaired.definition, { bodies: [replacement] });
    const refreshedDimension = refreshed.dimensions[0]!;
    expect(isPinnedMeasurementDimension(refreshedDimension)).toBe(true);
    if (isPinnedMeasurementDimension(refreshedDimension)) {
      expect(refreshedDimension.measurement).toMatchObject({ length: 5 });
    }
    expect(deleteDrawingReferenceTarget(refreshed, { kind: 'dimension', id: 'dimension-1' }).dimensions)
      .toEqual([]);
  });

  it('reports broken manufacturing notes with explicit repair/delete actions', () => {
    const definition = drawing();
    definition.notes.push({
      id: 'callout-1', text: 'Cut dado', featureId: 'missing-feature', position: [1, 1],
    });
    expect(validateDrawingReferences(definition, {
      bodies: [], featureIds: new Set(['live-feature']),
    })).toMatchObject([{
      code: 'BROKEN_NOTE_REFERENCE',
      actions: [{ kind: 'repair-feature' }, { kind: 'delete-note' }],
    }]);
    const repaired = repairDrawingReference(definition, {
      target: 'note', noteId: 'callout-1', replacementFeatureId: 'live-feature',
    }, { bodies: [], featureIds: new Set(['live-feature']) });
    expect(repaired).toMatchObject({
      ok: true,
      definition: { notes: [{ featureId: 'live-feature' }] },
    });
  });
});
