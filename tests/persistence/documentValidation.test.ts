import { describe, expect, it } from 'vitest';
import { validateDocumentStructure } from '../../src/persistence/DocumentValidation';
import { deserialize, serialize } from '../../src/persistence/serializer';
import { createDefaultDocument, type Document } from '../../src/types';
import { createComponentInstance, createMateConstraint } from '../../src/assembly/AssemblyTypes';
import legacyDocument from '../fixtures/document-v0.1.7.json';

function completeDocument(): Document {
  const document = createDefaultDocument();
  document.components = [{ id: 'component', name: 'Component', featureIds: ['missing-feature'], bodyIds: ['missing-body'] }];
  document.componentInstances = [createComponentInstance('component', 'Instance')];
  document.constraints = [createMateConstraint('flush', {
    instanceId: 'missing-a', bodyId: 'missing-a', faceId: 'missing-face-a',
  }, { instanceId: 'missing-b', bodyId: 'missing-b', faceId: 'missing-face-b' })];
  return document;
}

describe('document structure validation', () => {
  it('permits unresolved geometry and unknown feature types for rebuild diagnostics', () => {
    const document = completeDocument();
    document.features = [{
      id: 'plugin', type: 'plugin-feature', name: 'Unknown plugin', parameters: { brokenGeometricRef: null },
      refsIn: ['missing-feature'], refsOut: ['missing-body'], suppressed: false,
    }] as unknown as Document['features'];
    expect(validateDocumentStructure(document)).toBeNull();
    expect(deserialize(JSON.stringify(document)).ok).toBe(true);
  });

  it('normalizes omitted defaultable fields but rejects missing required normalized shape', () => {
    const partial = { version: '0.3.0', metadata: {}, bodies: [], config: { gridSpacing: { major: 2 } } };
    expect(validateDocumentStructure(partial)).toContain('metadata.name');
    expect(validateDocumentStructure(partial, { allowLegacyDefaults: true })).toBeNull();
    const result = deserialize(JSON.stringify(partial));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateDocumentStructure(result.document)).toBeNull();
    expect(result.document.config.gridSpacing).toEqual({ major: 2, minor: 0.25 });
    expect(result.document.features).toEqual([]);
    expect(result.document.componentInstances).toEqual([]);
  });

  it('preserves legacy migration and extra authored metadata', () => {
    const result = deserialize(JSON.stringify(legacyDocument));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateDocumentStructure(result.document)).toBeNull();
    expect(result.document.bodyMetadata?.['body-1']?.grainAxis).toEqual([0, 0, 1]);
    expect(result.document).toMatchObject({ pluginData: legacyDocument.pluginData });
  });

  const malformed: Array<[string, (document: any) => void]> = [
    ['metadata', (document) => { document.metadata = null; }],
    ['metadata.name', (document) => { document.metadata.name = 42; }],
    ['metadata.created', (document) => { document.metadata.created = {}; }],
    ['config', (document) => { document.config = []; }],
    ['config.gridSpacing', (document) => { document.config.gridSpacing = 'large'; }],
    ['config.gridSpacing.minor', (document) => { document.config.gridSpacing.minor = null; }],
    ['features', (document) => { document.features = {}; }],
    ['features[0]', (document) => { document.features = [null]; }],
    ['features[0].refsIn', (document) => { document.features = [{ id: 'f', name: 'Feature', type: 'unknown', parameters: {}, refsIn: {}, refsOut: [], suppressed: false }]; }],
    ['features[0].parameters', (document) => { document.features = [{ id: 'f', name: 'Feature', type: 'sketch', parameters: null, refsIn: [], refsOut: [], suppressed: false }]; }],
    ['components', (document) => { document.components = null; }],
    ['components[0].featureIds', (document) => { document.components[0].featureIds = 'feature'; }],
    ['components[0].bodyIds[0]', (document) => { document.components[0].bodyIds = [{}]; }],
    ['componentInstances[0].transform', (document) => { document.componentInstances[0].transform = null; }],
    ['componentInstances[0].transform', (document) => { document.componentInstances[0].transform = [1, 2, 3]; }],
    ['componentInstances[0].lockedAxes.translateX', (document) => { document.componentInstances[0].lockedAxes.translateX = 'yes'; }],
    ['constraints[0].refA', (document) => { document.constraints[0].refA = []; }],
    ['constraints[0].refB.bodyId', (document) => { document.constraints[0].refB.bodyId = 123; }],
    ['bodyMetadata', (document) => { document.bodyMetadata = []; }],
    ['bodyMetadata["body"]', (document) => { document.bodyMetadata = { body: 'oak' }; }],
    ['bodyPresentations["body"].visible', (document) => { document.bodyPresentations = { body: { name: 'Body', visible: 'yes', locked: false } }; }],
    ['drawingDefinitions', (document) => { document.drawingDefinitions = {}; }],
    ['bodies[0].transform', (document) => { document.bodies = [{ id: 'b', name: 'Body', type: 'solid', transform: null, visible: true, locked: false }]; }],
  ];
  it.each(malformed)('rejects malformed %s before migration/normalization and without mutation', (path, mutate) => {
    const document = completeDocument();
    mutate(document);
    const before = JSON.stringify(document);
    expect(validateDocumentStructure(document)).toContain(path);
    const result = deserialize(before);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(path) });
    expect(serialize(document)).toMatchObject({ ok: false, error: expect.stringContaining(path) });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('rejects non-finite instance transforms on save before JSON can turn them into null', () => {
    const document = completeDocument();
    document.componentInstances[0]!.transform[12] = Infinity;
    expect(serialize(document)).toMatchObject({ ok: false, error: expect.stringContaining('transform[12]') });
  });
});
