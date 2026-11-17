/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { eventBus } from '../../src/core';
import { UndoRedoStack } from '../../src/core/UndoRedoStack';
import { createRebuildEngine } from '../../src/features/RebuildEngine';
import { createBoxBody, defaultBoxParams } from '../../src/features/primitives/BoxFeature';
import { createFeatureRecord } from '../../src/features/FeatureRecord';
import { rebuildCircularPattern } from '../../src/features/pattern/CircularPatternFeature';
import { ToolSessionManager } from '../../src/interaction/ToolSessionManager';
import { CommandDispatcher } from '../../src/interaction/CommandDispatcher';
import { DocumentLifecycle } from '../../src/app/DocumentLifecycle';
import { AutosaveManager, DocumentManager, createMemoryStorage, loadFromFile } from '../../src/persistence';
import { createDefaultDocument, type Document } from '../../src/types';
import { strFromU8, unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

vi.mock('../../src/persistence', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/persistence')>(), loadFromFile: vi.fn(),
}));
const managers: AutosaveManager[] = [];
afterEach(() => {
  managers.splice(0).forEach(manager => manager.dispose());
  eventBus.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

/** Rendering is a boundary stub; all command, preview, rollback and history methods are App's actual methods. */
function harness() {
  const app = Object.create(App.prototype) as any;
  const source = createFeatureRecord('fixture', 'Two solids', {}, { id: 'source' });
  const first = createBoxBody({ ...defaultBoxParams, origin: [100, 0, 0] }, 'body-first');
  const selected = createBoxBody({ ...defaultBoxParams, origin: [20, 0, 0] }, 'body-selected');
  source.refsOut = [first.id, selected.id];
  const engine = createRebuildEngine();
  engine.registerHandler('fixture', () => ({ ok: true, bodies: [first, selected], diagnostics: [] }));
  engine.registerHandler('circularPattern', rebuildCircularPattern);
  const documentManager = new DocumentManager();
  documentManager.load({ ...createDefaultDocument('Chair'), features: [source] as unknown as Document['features'] }, 'chair.json');
  const autosaveManager = new AutosaveManager({ storage: createMemoryStorage() }); managers.push(autosaveManager);
  let selectedFeatureId: string | null = source.id;
  Object.assign(app, {
    documentManager, autosaveManager, rebuildEngine: engine, features: [source], rebuiltBodies: [first, selected],
    components: [], componentInstances: [], constraints: [], activeComponentId: null,
    bodyPresentations: new Map(), sceneObjects: new Map([[first.id, {}], [selected.id, {}]]),
    selection: { activeId: selected.id, selectedIds: new Set([selected.id]) }, selectionMode: 'body',
    selectedFace: null, selectedVertexRef: null, selectedEdgeRef: null,
    featurePreviewTransaction: null, featurePreviewFeatureId: null, featurePreviewHistoryLabel: null,
    featurePreviewParameterUpdateFailed: false, featurePreviewInvalidFieldIds: new Set(), featurePreviewSequence: 0,
    toolSessions: new ToolSessionManager(), commandDispatcher: new CommandDispatcher(),
    undoRedo: new UndoRedoStack(), sketchModeController: { isActive: false },
    featureTreePanel: {
      selectFeature: vi.fn((id: string | null) => { selectedFeatureId = id; }),
      getSelectedFeature: () => app.features.find((feature: any) => feature.id === selectedFeatureId) ?? null,
      setFeatures: vi.fn(() => { if (!app.features.some((feature: any) => feature.id === selectedFeatureId)) selectedFeatureId = null; }),
    },
    translationTriadGizmo: { hide: vi.fn() }, bodyRotateGizmo: { hide: vi.fn() }, gizmos: { releaseAll: vi.fn() },
    contextTaskPanel: { setFieldError: vi.fn(), setCommitEnabled: vi.fn() },
    propertyInspector: { setUnitContext: vi.fn() },
    portfolioFramePanel: { reset: vi.fn() },
    welcomeOverlay: { dismiss: vi.fn(), resetDismissed: vi.fn() },
    layout: { expandSidebar: vi.fn() }, panelChrome: { expand: vi.fn() }, fitViewToModel: vi.fn(),
    refreshUiChrome: vi.fn(), refreshModelBrowser: vi.fn(), removeMoveCopyPreviewClone: vi.fn(),
    isBodyVisible: () => true, isBodyLocked: () => false,
    loadAssemblyStateFromDocument: vi.fn(), restoreBodyPresentations: vi.fn(),
    selectFeatureById: vi.fn((id: string) => { selectedFeatureId = id; }),
  });
  app.rebuildAll = vi.fn((_label: string, _options: unknown) => {
    const result = engine.rebuild(app.features);
    if (result.ok) {
      app.rebuiltBodies = result.bodies;
      for (const feature of app.features) feature.refsOut = result.outputsByFeature.get(feature.id) ?? [];
    }
    return result;
  });
  app.undoRedo.seed(app.buildHistorySnapshot());
  const chooseDisposition = vi.fn().mockResolvedValue('cancel');
  app.documentLifecycle = new DocumentLifecycle({
    capture: () => ({ document: app.buildDocumentSnapshot(), revision: app.undoRedo.getState().current?.id ?? null }),
    isDirty: () => app.undoRedo.isDirty(), chooseDisposition,
    write: vi.fn().mockResolvedValue({ ok: true, path: 'chair.json' }),
    onSaved: ({ revision }) => app.undoRedo.markClean(revision),
    preserveRecovery: document => autosaveManager.saveNow(document), status: vi.fn(),
  });
  const applyDocument = (document: Document, options: { path?: string } = {}) => {
    app.features = structuredClone(document.features);
    documentManager.load(structuredClone(document), options.path);
    app.undoRedo.seed(app.buildHistorySnapshot());
    app.documentLifecycle.reset();
  };
  app.loadDocument = vi.fn(applyDocument);
  app.replaceWithNewDocument = vi.fn(() => applyDocument(createDefaultDocument('New')));
  const bytes = () => JSON.stringify({ document: app.buildDocumentSnapshot(), history: app.undoRedo.getState(), path: documentManager.currentFilePath });
  const makeDirty = () => {
    source.name = 'Edited source';
    app.commitDocumentHistory('Rename source');
  };
  return { app, source, selected, first, chooseDisposition, bytes, makeDirty };
}

describe('App circular pattern command integration', () => {
  it('uses the exact selected body and previews real geometry before Enter commits one undo entry', () => {
    const { app, selected, source } = harness();
    app.addCircularPatternFeature();
    expect(app.features).toHaveLength(2);
    const pattern = app.features[1];
    expect(pattern.parameters.sourceBodyRef).toEqual({ featureId: source.id, bodyId: selected.id });
    expect(app.toolSessions.activeSession.kind).toBe('circular-pattern');
    expect(app.rebuiltBodies).toHaveLength(7);
    expect(app.undoRedo.getState().history).toHaveLength(1);
    expect(app.autosaveManager.hasPending()).toBe(false);
    expect(app.toolSessions.routeKey('Enter')).toMatchObject({ ended: true, reason: 'committed' });
    expect(app.undoRedo.getState().history).toHaveLength(2);
    expect(app.undoRedo.getState().current.label).toBe('Add Circular Pattern');
    expect(app.undoRedo.getPresent().document.features).toHaveLength(2);
    expect(app.toolSessions.routeKey('Enter').handled).toBe(false);
    expect(app.undoRedo.getState().history).toHaveLength(2);
    expect(app.autosaveManager.hasPending()).toBe(true);
  });

  it('Escape restores byte-equivalent committed document and history through App cancellation', () => {
    const { app, bytes } = harness(); const before = bytes();
    app.addCircularPatternFeature();
    app.updateContextTaskField('feature-count', '4');
    app.updateContextTaskField('feature-angle', '180');
    expect(app.toolSessions.routeKey('Escape')).toMatchObject({ ended: true, reason: 'cancelled' });
    expect(bytes()).toBe(before);
    expect(app.rebuiltBodies).toHaveLength(2);
    expect(app.featurePreviewFeatureId).toBeNull();
    expect(app.autosaveManager.hasPending()).toBe(false);
  });

  it.each([['count', '2.5', '4'], ['angle', '0', '180'], ['count', '', '2']])('invalid %s blocks Enter and correction re-enables committing', (field, invalid, valid) => {
    const { app } = harness(); app.addCircularPatternFeature();
    app.updateContextTaskField(`feature-${field}`, invalid);
    expect(app.featurePreviewInvalidFieldIds.has(`feature-${field}`)).toBe(true);
    expect(app.toolSessions.routeKey('Enter')).toEqual({ handled: true, ended: false });
    expect(app.undoRedo.getState().history).toHaveLength(1);
    expect(app.contextTaskPanel.setCommitEnabled).toHaveBeenLastCalledWith(false);
    app.updateContextTaskField(`feature-${field}`, valid);
    expect(app.featurePreviewInvalidFieldIds.size).toBe(0);
    expect(app.contextTaskPanel.setCommitEnabled).toHaveBeenLastCalledWith(true);
    expect(app.toolSessions.routeKey('Enter')).toMatchObject({ ended: true, reason: 'committed' });
    expect(app.undoRedo.getState().history).toHaveLength(2);
    expect(app.features[1].parameters[field]).toBe(Number(valid));
  });

  it('rejects no-selection circular pattern instead of choosing another body', () => {
    const { app, bytes } = harness(); app.selection.selectedIds.clear(); app.selection.activeId = null;
    const before = bytes(); app.addCircularPatternFeature();
    expect(bytes()).toBe(before); expect(app.toolSessions.activeSession).toBeNull();
  });

  it('disabled Hole and Fillet cannot dispatch or change history and retain their custom reason', () => {
    const { app, bytes } = harness();
    const actions = app.createCommandActions();
    app.registerCommandActions(actions);
    const before = bytes();
    for (const id of ['addHole', 'addFillet']) {
      const action = actions.find((candidate: any) => candidate.id === id);
      const availability = app.getCommandAvailability(action);
      expect(availability.enabled).toBe(false);
      expect(availability.reason).toContain('not supported');
      expect(availability.reason).toBe(action.getAvailability().reason);
      expect(app.commandDispatcher.dispatch(id, undefined)).toEqual({ status: 'disabled' });
    }
    expect(bytes()).toBe(before);
  });
});

describe('App document replacement wrappers', () => {
  it('cancelling a dirty-document prompt blocks the frame example and its workspace side effects', async () => {
    const { app, bytes, makeDirty, chooseDisposition } = harness(); makeDirty();
    const before = bytes();
    await app.loadFrameExample();
    expect(chooseDisposition).toHaveBeenCalledWith('Chair', 'Loading the frame example');
    expect(bytes()).toBe(before);
    expect(app.loadDocument).not.toHaveBeenCalled();
    expect(app.welcomeOverlay.dismiss).not.toHaveBeenCalled();
    expect(app.layout.expandSidebar).not.toHaveBeenCalled();
    expect(app.panelChrome.expand).not.toHaveBeenCalled();
    expect(app.fitViewToModel).not.toHaveBeenCalled();
  });

  it.each(['new', 'open', 'recent'])('%s preserves the current document on disposition cancel', async action => {
    const { app, bytes, makeDirty, chooseDisposition } = harness(); makeDirty();
    const other = createDefaultDocument('Opened');
    vi.mocked(loadFromFile).mockResolvedValue({ ok: true, document: other, path: 'other.json' });
    app.autosaveManager.saveNow(other, { filePath: 'other.json' });
    const before = bytes();
    if (action === 'new') await app.newDocument();
    else if (action === 'open') await app.openDocument();
    else await app.openRecentFile({ path: 'other.json', name: 'Opened', lastOpened: '' });
    expect(chooseDisposition).toHaveBeenCalledOnce();
    expect(bytes()).toBe(before);
    expect(app.loadDocument).not.toHaveBeenCalled();
    expect(app.replaceWithNewDocument).not.toHaveBeenCalled();
    if (action === 'open') expect(loadFromFile).toHaveBeenCalledWith({ portable: false });
  });

  it('passes the pre-picker epoch so late Open cannot overwrite a newer document', async () => {
    const { app, bytes } = harness();
    let resolve!: (result: Awaited<ReturnType<typeof loadFromFile>>) => void;
    vi.mocked(loadFromFile).mockReturnValue(new Promise(done => { resolve = done; }));
    const opening = app.openDocument();
    await app.newDocument(); const before = bytes();
    resolve({ ok: true, document: createDefaultDocument('Late open'), path: 'late.json' });
    await opening;
    expect(bytes()).toBe(before); expect(app.loadDocument).not.toHaveBeenCalled();
    expect(app.documentManager.getDocument().metadata.name).toBe('New');
  });

  it('loads a recent autosave through the guard and keeps recovered work dirty', async () => {
    const { app, chooseDisposition, makeDirty } = harness(); makeDirty(); chooseDisposition.mockResolvedValue('discard');
    const other = createDefaultDocument('Recovered');
    app.autosaveManager.saveNow(other, { filePath: 'recover.json' });
    await app.openRecentFile({ path: 'recover.json', name: 'Recovered', lastOpened: '' });
    expect(chooseDisposition).toHaveBeenCalledOnce();
    expect(app.loadDocument).toHaveBeenCalledWith(other, { path: 'recover.json', seedHistory: true, recordRecent: true });
    expect(app.undoRedo.isDirty()).toBe(true);
    expect(app.documentManager.currentFilePath).toBe('recover.json');
  });
});

function mockDownloads() {
  const blobs: Blob[] = [];
  const clicks: Array<{ href: string; filename: string }> = [];
  const NativeURL = URL;
  const createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:audit-export'; });
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, filename: this.download });
  });
  const readBytes = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return { blobs, clicks, createObjectURL, revokeObjectURL, readBytes };
}

describe('App model export integration', () => {
  it('exports all visible solids regardless of selection and excludes hidden bodies', async () => {
    const { app, first } = harness(); const download = mockDownloads();
    // Only the second body is selected, but both visible bodies must be exported.
    await app.exportModel('stl');
    expect(download.blobs).toHaveLength(1);
    const allText = new TextDecoder().decode(await download.readBytes(download.blobs[0]!));
    expect(allText.match(/facet normal /g)).toHaveLength(24);
    app.isBodyVisible = (id: string) => id !== first.id;
    await app.exportModel('stl');
    const visibleText = new TextDecoder().decode(await download.readBytes(download.blobs[1]!));
    expect(visibleText.match(/facet normal /g)).toHaveLength(12);
    expect(download.clicks.map(item => item.filename)).toEqual(['Chair.stl', 'Chair.stl']);
    expect(download.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('blocks export on a fresh history failure instead of downloading stale displayed geometry', async () => {
    const { app } = harness(); const download = mockDownloads(); const status = vi.fn(); eventBus.on('ui:status', status);
    expect(app.rebuiltBodies).toHaveLength(2);
    app.features.push(createFeatureRecord('unregistered', 'Broken history', {}));
    await app.exportModel('stl');
    expect(download.createObjectURL).not.toHaveBeenCalled();
    expect(download.clicks).toHaveLength(0);
    expect(status).toHaveBeenCalledWith({ message: expect.stringContaining('Export blocked:') });
    expect(app.rebuiltBodies).toHaveLength(2);
  });

  it('blocks downloads while an active modeling preview owns the document', async () => {
    const { app } = harness(); const download = mockDownloads(); const status = vi.fn(); eventBus.on('ui:status', status);
    app.addCircularPatternFeature();
    await app.exportModel('3mf');
    expect(download.createObjectURL).not.toHaveBeenCalled();
    expect(download.clicks).toHaveLength(0);
    expect(status).toHaveBeenLastCalledWith({ message: 'Finish or cancel the active tool before exporting.' });
    expect(app.undoRedo.getState().history).toHaveLength(1);
  });

  it('downloads a real binary 3MF package with a sanitized filename and millimeter model', async () => {
    const { app } = harness(); const download = mockDownloads();
    app.documentManager.getDocument().metadata.name = 'Chair: legs';
    await app.exportModel('3mf');
    expect(download.clicks).toEqual([{ href: 'blob:audit-export', filename: 'Chair_ legs.3mf' }]);
    expect(download.blobs[0]!.type).toBe('model/3mf');
    const bytes = await download.readBytes(download.blobs[0]!);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const archive = unzipSync(bytes);
    expect(Object.keys(archive).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const xml = new DOMParser().parseFromString(strFromU8(archive['3D/3dmodel.model']!), 'application/xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(xml.documentElement.getAttribute('unit')).toBe('millimeter');
    expect(xml.querySelectorAll('build item')).toHaveLength(2);
    expect(download.revokeObjectURL).toHaveBeenCalledWith('blob:audit-export');
  });
});

describe('App manufacturing export guards', () => {
  function exportHarness() {
    const f = harness();
    f.app.getCutListParts = vi.fn();
    f.app.ensureDrawingDefinition = vi.fn();
    f.app.downloadTextFile = vi.fn();
    f.app.downloadBinaryFile = vi.fn();
    return f;
  }

  it.each(['cut-list', 'drawing'])('failed history blocks %s before collecting parts, drawing state, or downloads', async kind => {
    const { app, bytes } = exportHarness();
    app.features.push(createFeatureRecord('unregistered', 'Broken history', {}));
    const before = bytes(); const status = vi.fn(); eventBus.on('ui:status', status);
    if (kind === 'cut-list') app.exportCutList();
    else await app.exportShopDrawing('svg');
    expect(app.getCutListParts).not.toHaveBeenCalled();
    expect(app.ensureDrawingDefinition).not.toHaveBeenCalled();
    expect(app.downloadTextFile).not.toHaveBeenCalled();
    expect(app.downloadBinaryFile).not.toHaveBeenCalled();
    expect(bytes()).toBe(before);
    expect(status).toHaveBeenCalledWith({ message: expect.stringContaining('export blocked:') });
  });

  it.each(['cut-list', 'drawing'])('an active preview blocks %s before any manufacturing state is read or changed', async kind => {
    const { app, bytes } = exportHarness(); app.addCircularPatternFeature();
    const before = bytes(); app.rebuildAll.mockClear();
    if (kind === 'cut-list') app.exportCutList();
    else await app.exportShopDrawing('pdf');
    expect(app.rebuildAll).not.toHaveBeenCalled();
    expect(app.getCutListParts).not.toHaveBeenCalled();
    expect(app.ensureDrawingDefinition).not.toHaveBeenCalled();
    expect(app.downloadTextFile).not.toHaveBeenCalled();
    expect(app.downloadBinaryFile).not.toHaveBeenCalled();
    expect(bytes()).toBe(before);
  });

  it.each(['revision', 'epoch'])('a stale cut-list %s blocks allowance mutation and the final download', stale => {
    const { app, bytes, makeDirty } = exportHarness();
    const expected = { revision: app.undoRedo.getState().current.id, epoch: app.documentLifecycle.documentEpoch };
    if (stale === 'revision') makeDirty(); else app.documentLifecycle.reset();
    const before = bytes(); const status = vi.fn(); eventBus.on('ui:status', status);
    const commit = vi.spyOn(app, 'commitDocumentHistory');
    app.rebuildAll.mockClear();
    app.exportCutListPreview({ title: 'Old review', rows: [] }, { canExport: true, rows: [] }, expected);
    expect(app.rebuildAll).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(app.downloadTextFile).not.toHaveBeenCalled();
    expect(bytes()).toBe(before);
    expect(status).toHaveBeenLastCalledWith({ message: expect.stringContaining('The model changed. Reopen the cut list') });
  });

  it('rebuilds a successful manufacturing guard with history tracking disabled', () => {
    const { app, bytes } = exportHarness(); const before = bytes();
    app.rebuiltBodies = [];
    expect(() => app.refreshManufacturingExport()).not.toThrow();
    expect(app.rebuildAll).toHaveBeenCalledWith('Validate manufacturing output', { trackHistory: false });
    expect(app.rebuiltBodies).toHaveLength(2);
    expect(app.undoRedo.getState().history).toHaveLength(1);
    expect(app.autosaveManager.hasPending()).toBe(false);
    expect(bytes()).toBe(before);
  });

  it('revalidates history at final cut-list download even when the review revision still matches', () => {
    const { app, bytes } = exportHarness();
    const expected = { revision: app.undoRedo.getState().current.id, epoch: app.documentLifecycle.documentEpoch };
    app.features.push(createFeatureRecord('unregistered', 'Broken history', {}));
    const before = bytes(); const commit = vi.spyOn(app, 'commitDocumentHistory');
    app.exportCutListPreview({ title: 'Review', rows: [] }, { canExport: true, rows: [] }, expected);
    expect(app.rebuildAll).toHaveBeenCalledWith('Validate manufacturing output', { trackHistory: false });
    expect(commit).not.toHaveBeenCalled();
    expect(app.downloadTextFile).not.toHaveBeenCalled();
    expect(bytes()).toBe(before);
  });
});

describe('App assembly-only document loading', () => {
  it('routes a document with components and no features through rebuild instead of legacy display fallback', () => {
    const { app } = harness();
    const doc = createDefaultDocument('Assembly only');
    doc.components = [{ id: 'empty-component', name: 'Empty', featureIds: [], bodyIds: [] }];
    Object.assign(app, {
      viewport: { remove: vi.fn(), add: vi.fn() }, meshCache: { clear: vi.fn() },
      keyboardShortcutsPanel: { getIsVisible: () => false }, welcomeOverlay: { resetDismissed: vi.fn() },
      diagnosticsPanel: { clear: vi.fn() },
      propertyInspector: { setUnitContext: vi.fn(), clear: vi.fn() },
      assemblyConstraintStatuses: new Map(), instanceBodyIdsByInstance: new Map(), instanceBodySourceIds: new Map(),
      restoreHistorySelection: vi.fn(), updateAssemblyPanel: vi.fn(), createLegacyBoxMesh: vi.fn(),
      loadAssemblyStateFromDocument: (App.prototype as any).loadAssemblyStateFromDocument,
    });
    (App.prototype as any).loadDocument.call(app, doc, { seedHistory: false, recordRecent: false });
    expect(app.features).toHaveLength(0);
    expect(app.components).toEqual(doc.components);
    expect(app.rebuildAll).toHaveBeenCalledWith('Load Document', { trackHistory: false });
    expect(app.createLegacyBoxMesh).not.toHaveBeenCalled();
    expect(app.rebuiltBodies).toHaveLength(0);
  });
});
