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
  it('rejects duplicate ids, unavailable views, and non-finite pin positions', () => {
    const source = createBoxBody({
      width: 2, depth: 3, height: 4, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'source');
    const evaluated = evaluateMeasurement('body-measurement', 'bodyDimensions', [{
      kind: 'body', featureId: 'source-feature', bodyId: source.id,
    }], { bodies: [source] });
    if (!evaluated.ok) throw new Error(evaluated.diagnostics[0]?.message);

    const definition = drawing();
    definition.dimensions.push({
      id: 'duplicate', kind: 'linear', references: [], view: 'front', position: [0, 0],
    });
    expect(() => pinMeasurementIntoDrawing(definition, evaluated.result, {
      dimensionId: 'duplicate', view: 'front', position: [0, 0],
    })).toThrow('must be unique');
    expect(() => pinMeasurementIntoDrawing(drawing(), evaluated.result, {
      dimensionId: 'top-dimension', view: 'top', position: [0, 0],
    })).toThrow('view is not enabled');
    expect(() => pinMeasurementIntoDrawing(drawing(), evaluated.result, {
      dimensionId: 'bad-position', view: 'front', position: [Number.NaN, 0],
    })).toThrow('two finite values');
  });

  it('pins angular measurements and preserves optional annotation text', () => {
    const source = createBoxBody({
      width: 2, depth: 3, height: 4, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'source');
    const edgeIds = [...source.edges.keys()];
    const evaluated = evaluateMeasurement('angle-measurement', 'edgeAngle', edgeIds.slice(0, 2).map(
      (edgeId) => ({ kind: 'edge' as const, featureId: 'source-feature', bodyId: source.id, edgeId })
    ), { bodies: [source] });
    if (!evaluated.ok) throw new Error(evaluated.diagnostics[0]?.message);

    const pinned = pinMeasurementIntoDrawing(drawing(), evaluated.result, {
      dimensionId: 'angle', view: 'front', position: [2, 3], prefix: 'A=', suffix: ' deg',
    });
    expect(pinned.dimensions[0]).toMatchObject({
      id: 'angle', kind: 'angular', prefix: 'A=', suffix: ' deg',
      references: [{ kind: 'edge' }, { kind: 'edge' }],
    });
  });

  it('validates ordinary vertex, edge, and face references with map-backed bodies', () => {
    const source = createBoxBody({
      width: 2, depth: 3, height: 4, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'source');
    const definition = drawing();
    const references = [
      { bodyId: source.id, topologyId: [...source.vertices.keys()][0]!, kind: 'vertex' as const },
      { bodyId: source.id, topologyId: [...source.edges.keys()][0]!, kind: 'edge' as const },
      { bodyId: source.id, topologyId: [...source.faces.keys()][0]!, kind: 'face' as const },
    ];
    definition.dimensions.push({
      id: 'ordinary', kind: 'linear', references, view: 'front', position: [1, 1],
    });
    const bodies = new Map([[source.id, source]]);
    expect(validateDrawingReferences(definition, { bodies })).toEqual([]);
    expect(canExportDrawingDefinition(definition, { bodies })).toEqual({ allowed: true, issues: [] });
    expect(() => assertDrawingReferencesExportable(definition, { bodies })).not.toThrow();

    definition.dimensions[0]!.references = [
      { bodyId: source.id, topologyId: 'missing-vertex', kind: 'vertex' },
      { bodyId: source.id, topologyId: 'missing-edge', kind: 'edge' },
      { bodyId: source.id, topologyId: 'missing-face', kind: 'face' },
      { bodyId: 'missing-body', topologyId: 'missing-face', kind: 'face' },
    ];
    expect(validateDrawingReferences(definition, { bodies })).toHaveLength(4);
  });

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
    expect(deleteDrawingReferenceTarget(definition, { kind: 'note', id: 'callout-1' }).notes)
      .toEqual([]);
  });

  it('rejects missing targets, unavailable replacements, and replacement type changes', () => {
    const source = createBoxBody({
      width: 2, depth: 3, height: 4, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'source');
    const definition = drawing();
    definition.notes.push({ id: 'note', text: 'Dado', position: [0, 0] });
    definition.dimensions.push({
      id: 'dimension',
      kind: 'linear',
      references: [{
        bodyId: source.id, topologyId: [...source.edges.keys()][0]!, kind: 'edge',
      }],
      view: 'front',
      position: [0, 0],
    });
    const context = { bodies: [source], featureIds: new Set(['live-feature']) };

    expect(repairDrawingReference(definition, {
      target: 'note', noteId: 'missing', replacementFeatureId: 'live-feature',
    }, context)).toMatchObject({ ok: false, message: expect.stringContaining('not found') });
    expect(repairDrawingReference(definition, {
      target: 'note', noteId: 'note', replacementFeatureId: 'missing-feature',
    }, context)).toMatchObject({ ok: false, message: expect.stringContaining('existing feature') });
    expect(repairDrawingReference(definition, {
      target: 'dimension', dimensionId: 'missing', referenceIndex: 0,
      replacement: { kind: 'body', featureId: 'source-feature', bodyId: source.id },
    }, context)).toMatchObject({ ok: false, message: expect.stringContaining('not found') });
    expect(repairDrawingReference(definition, {
      target: 'dimension', dimensionId: 'dimension', referenceIndex: 0,
      replacement: {
        kind: 'face', featureId: 'source-feature', bodyId: source.id,
        faceId: [...source.faces.keys()][0]!,
      },
    }, context)).toMatchObject({ ok: false, message: expect.stringContaining('type must match') });
    expect(repairDrawingReference(definition, {
      target: 'dimension', dimensionId: 'dimension', referenceIndex: 0,
      replacement: {
        kind: 'edge', featureId: 'source-feature', bodyId: source.id, edgeId: 'missing-edge',
      },
    }, context)).toMatchObject({ ok: false, message: expect.stringContaining('no longer resolves') });
  });
});
