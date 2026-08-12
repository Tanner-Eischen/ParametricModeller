import { describe, expect, it } from 'vitest';
import legacyDocument from '../fixtures/document-v0.1.7.json';
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_MIGRATIONS,
  migrateDocumentSchema,
} from '../../src/persistence/Migrations';
import { deserialize, serialize } from '../../src/persistence/serializer';
import { validateBoardMetadata } from '../../src/woodworking/Materials';

describe('document schema migrations', () => {
  it('declares an ordered v0.1.x to current migration', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe('0.3.0');
    expect(SCHEMA_MIGRATIONS.map((migration) => migration.toVersion))
      .toEqual(['0.2.0', '0.3.0']);
  });

  it('losslessly migrates a legacy fixture and reports the applied migration', () => {
    const result = migrateDocumentSchema(legacyDocument);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.document.bodies).toEqual(legacyDocument.bodies);
    expect(result.document.features).toEqual(legacyDocument.features);
    expect(result.document.components).toEqual(legacyDocument.components);
    expect(result.document.componentInstances).toEqual(legacyDocument.componentInstances);
    expect(result.document.bodyPresentations).toEqual(legacyDocument.bodyPresentations);
    expect(result.document.bodyMetadata).toEqual({
      'body-1': {
        material: { id: 'white-oak', species: 'white oak' },
        grainAxis: [0, 0, 1],
        thicknessAxis: [1, 0, 0],
        sourceFeatureId: 'feature-1',
        isBoard: true,
        label: 'Front left leg',
        legacySupplierCode: 'WO-SELECT',
        stockAllowance: { length: 0, width: 0, thickness: 0 },
        bodyFrame: {
          origin: [0, 0, 0],
          xAxis: [0, 0, 1],
          yAxis: [0, -1, 0],
          zAxis: [1, 0, 0],
          provenance: {
            kind: 'derived',
            source: 'woodworking-orientation',
            sourceFeatureId: 'feature-1',
          },
        },
      },
    });
    expect(result.document.drawingDefinitions).toEqual([]);
    expect(result.document.manufacturingDefaults).toEqual({
      units: 'mm',
      stockAllowance: { length: 0, width: 0, thickness: 0 },
    });
    expect(result.document.pluginData).toEqual({ fixtureMarker: 'preserve-me' });
    expect(result.diagnostics).toEqual([
      {
        code: 'SCHEMA_MIGRATED',
        fromVersion: '0.1.7',
        toVersion: '0.2.0',
        message: 'Migrated document schema from 0.1.7 to 0.2.0.',
      },
      {
        code: 'SCHEMA_MIGRATED',
        fromVersion: '0.2.0',
        toVersion: CURRENT_SCHEMA_VERSION,
        message: 'Migrated document schema from 0.2.0 to 0.3.0.',
      },
    ]);

    // Migration always works on a clone.
    expect(result.document).not.toBe(legacyDocument);
    expect(legacyDocument.version).toBe('0.1.7');
  });

  it('round-trips a migrated fixture at the canonical current version', () => {
    const loaded = deserialize(JSON.stringify(legacyDocument));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(loaded.document.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(loaded.migrationDiagnostics).toHaveLength(2);

    const saved = serialize(loaded.document);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const savedDocument = JSON.parse(saved.json) as Record<string, unknown>;
    expect(savedDocument.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(savedDocument.bodyPresentations).toEqual(legacyDocument.bodyPresentations);
    expect(savedDocument.bodyMetadata).toEqual(loaded.document.bodyMetadata);
    expect(savedDocument.pluginData).toEqual({ fixtureMarker: 'preserve-me' });

    const board = loaded.document.bodyMetadata?.['body-1'];
    expect(board).toBeDefined();
    expect(() => validateBoardMetadata(board!)).not.toThrow();

    const reloaded = deserialize(saved.json);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.migrationDiagnostics).toEqual([]);
  });

  it('rejects malformed, unsupported-old, and future schema versions', () => {
    expect(migrateDocumentSchema({ version: '0.1' })).toMatchObject({
      ok: false,
      code: 'INVALID_SCHEMA_VERSION',
    });
    expect(migrateDocumentSchema({ version: '0.0.9' })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
    });
    expect(migrateDocumentSchema({ version: '0.3.1' })).toMatchObject({
      ok: false,
      code: 'FUTURE_SCHEMA_VERSION',
    });
    expect(migrateDocumentSchema({ version: '1.0.0' })).toMatchObject({
      ok: false,
      code: 'FUTURE_SCHEMA_VERSION',
    });
  });

  it('fails closed when legacy woodworking metadata cannot become usable', () => {
    expect(migrateDocumentSchema({
      ...legacyDocument,
      bodyMetadata: {
        'body-1': { material: 'white-oak', grainAxis: 'diagonal' },
      },
    })).toMatchObject({
      ok: false,
      code: 'MIGRATION_FAILED',
      error: expect.stringContaining('grainAxis'),
    });
  });

  it.each(['0.2.0', '0.2.1', '0.2.999'])(
    'losslessly migrates every 0.2.x patch from %s',
    (version) => {
      const oldDocument = {
        version,
        metadata: {
          name: 'Custom casework',
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-02T00:00:00.000Z',
          customMetadata: 'keep',
        },
        config: {
          units: 'inch',
          gridSpacing: { major: 1, minor: 0.25 },
          snapEnabled: true,
          customConfig: 42,
        },
        bodies: [{
          id: 'body:panel',
          name: 'Custom panel body',
          type: 'solid',
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1],
          visible: true,
          locked: false,
          customBodyField: 'keep',
        }],
        features: [
          {
            id: 'feature:sketch',
            type: 'sketch',
            name: 'Custom named sketch',
            parameters: {
              planeRef: { id: 'xy', type: 'world', worldPlane: 'xy' },
              entities: [{
                id: 'line:1',
                type: 'line',
                start: [0, 0],
                end: [2, 0],
              }],
              dimensions: [],
              customSketchParameter: { keep: true },
            },
            refsIn: [],
            refsOut: ['sketch:1'],
            suppressed: false,
          },
          {
            id: 'feature:extrude',
            type: 'extrude',
            name: 'Custom named extrude',
            parameters: {
              sketchId: 'feature:sketch',
              profileIndex: 7,
              distance: 0.75,
            },
            refsIn: ['feature:sketch'],
            refsOut: ['body:panel'],
            suppressed: false,
          },
        ],
        components: [],
        componentInstances: [],
        constraints: [{
          id: 'constraint:legacy',
          name: 'Keep custom mate',
          type: 'flush',
          refA: { instanceId: 'a', faceId: 'fa', bodyId: 'ba' },
          refB: { instanceId: 'b', faceId: 'fb', bodyId: 'bb' },
          offset: 0,
          satisfied: false,
          suppressed: false,
          customConstraintField: 'keep',
        }],
        activeComponentId: null,
        bodyMetadata: {
          'body:panel': {
            sourceFeatureId: 'feature:extrude',
            isBoard: true,
            label: 'Custom panel label',
            material: { id: 'oak', species: 'Oak' },
            grainAxis: [1, 0, 0],
            thicknessAxis: [0, 0, 1],
            customBodyMetadata: 'keep',
          },
        },
        pluginData: { keep: true },
      };

      const result = migrateDocumentSchema(oldDocument);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.document).toMatchObject({
        version: CURRENT_SCHEMA_VERSION,
        drawingDefinitions: [],
        manufacturingDefaults: {
          units: 'in',
          stockAllowance: { length: 0, width: 0, thickness: 0 },
        },
        pluginData: { keep: true },
      });
      expect(result.document.bodies).toEqual(oldDocument.bodies);
      expect(result.document.constraints).toEqual([{
        ...oldDocument.constraints[0],
        driving: false,
        status: 'legacy-validate-only',
      }]);
      const features = result.document.features as typeof oldDocument.features;
      expect(features.map((feature) => [feature.id, feature.name])).toEqual([
        ['feature:sketch', 'Custom named sketch'],
        ['feature:extrude', 'Custom named extrude'],
      ]);
      expect(features[0]?.parameters).toMatchObject({
        schemaVersion: 2,
        inferenceInputs: [],
        customSketchParameter: { keep: true },
      });
      expect(features[1]?.parameters.profileIndex).toBe(7);
      expect(result.document.bodyMetadata).toMatchObject({
        'body:panel': {
          label: 'Custom panel label',
          customBodyMetadata: 'keep',
          stockAllowance: { length: 0, width: 0, thickness: 0 },
          bodyFrame: {
            origin: [4, 5, 6],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            zAxis: [0, 0, 1],
            provenance: {
              kind: 'derived',
              source: 'woodworking-orientation',
              sourceFeatureId: 'feature:extrude',
            },
          },
        },
      });
      expect(result.diagnostics).toMatchObject([{
        fromVersion: version,
        toVersion: CURRENT_SCHEMA_VERSION,
      }]);
      expect(oldDocument.version).toBe(version);
    }
  );

  it('preserves authored 0.2 values and is idempotent after migration', () => {
    const authored = {
      version: '0.2.8',
      metadata: { name: 'Authored', created: 'c', modified: 'm' },
      config: {
        units: 'mm',
        gridSpacing: { major: 25, minor: 5 },
        snapEnabled: true,
      },
      bodies: [],
      features: [],
      constraints: [{
        id: 'constraint:newer',
        driving: true,
        status: 'authored-status',
      }],
      drawingDefinitions: [{
        id: 'drawing:stable',
        name: 'Assembly drawing',
        bodyIds: ['body:stable'],
      }],
      manufacturingDefaults: {
        units: 'mm',
        stockAllowance: { length: 2, customAllowance: 3 },
        kerf: 0.125,
      },
      bodyMetadata: {},
    };
    const first = migrateDocumentSchema(authored);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.document.drawingDefinitions).toEqual(authored.drawingDefinitions);
    expect(first.document.manufacturingDefaults).toEqual({
      units: 'mm',
      stockAllowance: {
        length: 2,
        width: 0,
        thickness: 0,
        customAllowance: 3,
      },
      kerf: 0.125,
    });
    expect(first.document.constraints).toEqual([{
      ...authored.constraints[0],
      driving: false,
      status: 'legacy-validate-only',
      legacyState: {
        driving: true,
        status: 'authored-status',
      },
    }]);

    const second = migrateDocumentSchema(first.document);
    expect(second).toEqual({
      ok: true,
      document: first.document,
      diagnostics: [],
    });
  });

  it('canonicalizes a direct 0.2 save and preserves additions after reload', () => {
    const oldDocument = {
      version: '0.2.4',
      metadata: {
        name: 'Direct save',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-02T00:00:00.000Z',
        customMetadata: 'keep',
      },
      config: {
        units: 'inch',
        gridSpacing: { major: 1, minor: 0.25 },
        snapEnabled: true,
        customConfig: 'keep',
      },
      bodies: [],
      features: [{
        id: 'sketch:save',
        type: 'sketch',
        name: 'Named save sketch',
        parameters: {
          planeRef: { id: 'xy', type: 'world', worldPlane: 'xy' },
          entities: [],
          dimensions: [],
          customSketchParameter: 'keep',
        },
        refsIn: [],
        refsOut: ['sketch:save'],
        suppressed: false,
      }],
      components: [],
      componentInstances: [],
      constraints: [],
      activeComponentId: null,
      bodyMetadata: {},
      customRoot: 'keep',
    };
    const saved = serialize(
      oldDocument as unknown as Parameters<typeof serialize>[0]
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const parsed = JSON.parse(saved.json) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      version: CURRENT_SCHEMA_VERSION,
      drawingDefinitions: [],
      manufacturingDefaults: {
        units: 'in',
        stockAllowance: { length: 0, width: 0, thickness: 0 },
      },
      customRoot: 'keep',
      metadata: { customMetadata: 'keep' },
      config: { customConfig: 'keep' },
      features: [{
        id: 'sketch:save',
        name: 'Named save sketch',
        parameters: {
          schemaVersion: 2,
          inferenceInputs: [],
          customSketchParameter: 'keep',
        },
      }],
    });

    const reloaded = deserialize(saved.json);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.migrationDiagnostics).toEqual([]);
    expect(reloaded.document).toMatchObject({
      version: CURRENT_SCHEMA_VERSION,
      customRoot: 'keep',
      metadata: { customMetadata: 'keep' },
      config: { customConfig: 'keep' },
      features: [{
        id: 'sketch:save',
        name: 'Named save sketch',
        parameters: { customSketchParameter: 'keep' },
      }],
    });
  });

  it('fails closed for malformed authored 0.2 schema additions', () => {
    const base = {
      version: '0.2.0',
      metadata: { name: 'Bad', created: 'c', modified: 'm' },
      config: {
        units: 'inch',
        gridSpacing: { major: 1, minor: 0.25 },
        snapEnabled: true,
      },
      bodies: [],
      features: [],
      constraints: [],
      bodyMetadata: {},
    };
    expect(migrateDocumentSchema({
      ...base,
      drawingDefinitions: null,
    })).toMatchObject({ ok: false, code: 'MIGRATION_FAILED' });
    expect(migrateDocumentSchema({
      ...base,
      manufacturingDefaults: [],
    })).toMatchObject({ ok: false, code: 'MIGRATION_FAILED' });
  });
});
