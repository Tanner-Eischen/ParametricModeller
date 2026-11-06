/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { AutosaveManager } from '../../src/persistence/AutosaveManager';
import { loadFromFile } from '../../src/persistence/serializer';
import { createPortfolioFrameDocument } from '../../src/examples/portfolioFrame';
import { inspectPortfolioFrame } from '../../src/app/PortfolioFrameWorkflow';
import type { Document } from '../../src/types';

vi.mock('../../src/persistence/serializer', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/persistence/serializer')>(),
  loadFromFile: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe('portable frame recovery through App', () => {
  it('can recover an imported frame immediately after startup without another edit', async () => {
    const values = new Map<string, string>();
    const storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const autosave = new AutosaveManager({ storage });
    const imported = createPortfolioFrameDocument(20);
    vi.mocked(loadFromFile).mockResolvedValueOnce({ ok: true, path: 'frame-copy.json', document: imported });
    let current: Document | null = null;
    const dismiss = vi.fn(); const fit = vi.fn();
    const harness = Object.assign(Object.create(App.prototype), {
      autosaveManager: autosave,
      refreshUiChrome: vi.fn(),
      loadDocument: (doc: Document) => { current = structuredClone(doc); },
      buildDocumentSnapshot: () => structuredClone(current!),
      welcomeOverlay: { dismiss },
      fitViewToModel: fit,
      undoRedo: { markDirty: vi.fn() },
      refreshDocumentDirtyState: vi.fn(),
    });
    await harness.openDocument(true);
    expect(loadFromFile).toHaveBeenCalledWith({ portable: true });
    autosave.dispose();
    // A new manager models a fresh application instance reading persisted bytes.
    harness.autosaveManager = new AutosaveManager({ storage });
    current = null; dismiss.mockClear(); fit.mockClear();
    harness.openRecentFile({ path: 'frame-copy.json', name: 'Frame copy', lastOpened: '2026-11-06T00:00:00.000Z' });
    expect(inspectPortfolioFrame(current!)?.bounds).toEqual([26, 20, 0.75]);
    expect(current!.features).toEqual(imported.features);
    expect(current!.componentInstances).toEqual(imported.componentInstances);
    expect(dismiss).toHaveBeenCalledOnce();
    expect(fit).toHaveBeenCalledWith(false);
    expect(harness.undoRedo.markDirty).toHaveBeenCalledOnce();
    harness.autosaveManager.dispose();
  });

  it('keeps the current scene and recovery storage unchanged after a failed import', async () => {
    vi.mocked(loadFromFile).mockResolvedValueOnce({ ok: false, error: 'Invalid JSON' });
    const loadDocument = vi.fn(); const saveNow = vi.fn();
    const harness = Object.assign(Object.create(App.prototype), {
      refreshUiChrome: vi.fn(), loadDocument, autosaveManager: { saveNow },
    });
    await harness.openDocument(true);
    expect(loadDocument).not.toHaveBeenCalled();
    expect(saveNow).not.toHaveBeenCalled();
    expect(harness.portableImportPending).toBe(false);
  });
});
