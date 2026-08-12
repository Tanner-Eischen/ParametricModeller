import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AutosaveManager,
  createDocumentAutosaveKey,
} from '../../src/persistence/AutosaveManager';
import { RecentFilesStore } from '../../src/persistence/RecentFilesStore';
import type { Feature } from '../../src/types';
import { createMemoryStorage } from '../../src/persistence/storage';
import { createDefaultDocument, type Document } from '../../src/types';

function createDocument(name = 'Chair'): Document {
  return {
    ...createDefaultDocument(name),
    features: [
      {
        id: 'feature-1',
        type: 'box',
        name: 'Box 1',
        parameters: { width: 1 },
        suppressed: false,
        refsIn: [],
        refsOut: ['body-1'],
      },
    ],
    components: [
      {
        id: 'component-1',
        name: 'Assembly',
        featureIds: ['feature-1'],
        bodyIds: ['body-1'],
      },
    ],
    componentInstances: [
      {
        id: 'instance-1',
        componentId: 'component-1',
        name: 'Assembly Instance 1',
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1],
        lockedAxes: {
          translateX: false,
          translateY: false,
          translateZ: false,
          rotateX: false,
          rotateY: false,
          rotateZ: false,
        },
        grounded: false,
      },
    ],
    constraints: [
      {
        id: 'constraint-1',
        name: 'Flush 1',
        type: 'flush',
        refA: {
          instanceId: 'instance-1',
          faceId: 'face-a',
          bodyId: 'body-1',
        },
        refB: {
          instanceId: 'instance-1',
          faceId: 'face-b',
          bodyId: 'body-1',
        },
        offset: 0,
        satisfied: true,
        suppressed: false,
        driving: true,
        status: 'satisfied',
      },
    ],
    activeComponentId: 'component-1',
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AutosaveManager', () => {
  it('creates stable autosave keys from file paths or draft metadata', () => {
    const document = createDocument('Desk');

    expect(createDocumentAutosaveKey(document, 'C:/Models/Desk.json')).toBe(
      'path:c:\\models\\desk.json'
    );
    expect(createDocumentAutosaveKey(document, null)).toBe(
      `draft:${document.metadata.name}::${document.metadata.created}`
    );
  });

  it('saves, lists, and restores autosaves including assembly fields', () => {
    const storage = createMemoryStorage();
    const document = createDocument('Desk');
    const manager = new AutosaveManager({
      storage,
      now: () => '2026-03-24T10:00:00.000Z',
    });

    const result = manager.saveNow(document, {
      filePath: 'C:\\Models\\Desk.json',
      reason: 'manual-test',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.skipped).toBe(false);
    expect(manager.list()).toHaveLength(1);

    const restored = manager.restore(result.entry.id);
    expect(restored).not.toBeNull();
    expect(restored?.document.components).toEqual(document.components);
    expect(restored?.document.componentInstances).toEqual(document.componentInstances);
    expect(restored?.document.constraints).toEqual(document.constraints);
    expect(restored?.document.activeComponentId).toBe('component-1');
  });

  it('skips writing identical autosave payloads for the same document key', () => {
    const storage = createMemoryStorage();
    const document = createDocument();
    let tick = 0;
    const manager = new AutosaveManager({
      storage,
      now: () => `2026-03-24T10:00:0${tick++}.000Z`,
    });

    const first = manager.saveNow(document, { filePath: 'C:\\Models\\Chair.json' });
    const second = manager.saveNow(document, { filePath: 'C:\\Models\\Chair.json' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    expect(second.skipped).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(manager.list()).toHaveLength(1);
  });

  it('debounces scheduled autosaves and persists only the latest pending snapshot', () => {
    vi.useFakeTimers();

    const storage = createMemoryStorage();
    let tick = 0;
    const manager = new AutosaveManager({
      storage,
      debounceMs: 100,
      now: () => `2026-03-24T10:00:0${tick++}.000Z`,
    });

    const base = createDocument('Table');
    const updated = {
      ...base,
      metadata: {
        ...base.metadata,
        modified: '2026-03-24T10:00:05.000Z',
      },
      features: [
        ...base.features,
        {
          id: 'feature-2',
          type: 'box',
          name: 'Box 2',
          parameters: { width: 2 },
          suppressed: false,
          refsIn: [],
          refsOut: ['body-2'],
        },
      ] as Feature[],
    };

    manager.schedule(base, { reason: 'first-pass' });
    manager.schedule(updated, { reason: 'second-pass' });

    expect(manager.hasPending()).toBe(true);
    expect(manager.list()).toEqual([]);

    vi.advanceTimersByTime(100);

    expect(manager.hasPending()).toBe(false);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0]?.reason).toBe('second-pass');

    const restored = manager.restore(manager.list()[0]!.id);
    expect(restored?.document.features).toHaveLength(2);
  });

  it('flushes or removes autosaves on demand', () => {
    const storage = createMemoryStorage();
    const manager = new AutosaveManager({
      storage,
      now: () => '2026-03-24T10:00:00.000Z',
    });
    const document = createDocument('Bench');

    manager.schedule(document, { reason: 'dirty-change' });
    const flushed = manager.flushPending();

    expect(flushed?.ok).toBe(true);
    expect(manager.list()).toHaveLength(1);

    const entryId = manager.list()[0]!.id;
    const afterRemove = manager.remove(entryId);
    expect(afterRemove).toEqual([]);

    manager.saveNow(document, { reason: 'recreated' });
    expect(manager.list()).toHaveLength(1);

    manager.clear();
    expect(manager.list()).toEqual([]);
  });

  it('returns null for invalid or missing autosave records', () => {
    const storage = createMemoryStorage();
    storage.setItem('modelling.autosaves.v1', JSON.stringify([
      {
        id: 'broken',
        documentKey: 'draft:Broken',
        documentName: 'Broken',
        filePath: null,
        reason: 'broken',
        savedAt: '2026-03-24T10:00:00.000Z',
        size: 4,
        json: '{nope',
      },
    ]));

    const manager = new AutosaveManager({ storage });

    expect(manager.restore('missing')).toBeNull();
    expect(manager.restore('broken')).toBeNull();
  });

  it('finds and restores the latest autosave by recent-file path', () => {
    const storage = createMemoryStorage();
    let tick = 0;
    const manager = new AutosaveManager({
      storage,
      now: () => `2026-03-24T10:00:0${tick++}.000Z`,
    });
    const recentFiles = new RecentFilesStore({
      storage,
      now: () => `2026-03-24T10:05:0${tick++}.000Z`,
    });
    const recentPath = 'C:\\Models\\Stool.json';

    const original = createDocument('Stool');
    const updated = {
      ...original,
      metadata: {
        ...original.metadata,
        modified: '2026-03-24T10:00:30.000Z',
      },
      features: [
        ...original.features,
        {
          id: 'feature-2',
          type: 'box',
          name: 'Box 2',
          parameters: { width: 2 },
          suppressed: false,
          refsIn: [],
          refsOut: ['body-2'],
        },
      ] as Feature[],
    };

    recentFiles.add(recentPath);
    const first = manager.saveNow(original, { filePath: 'c:/models/stool.json', reason: 'first' });
    const second = manager.saveNow(updated, { filePath: recentPath, reason: 'latest' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    const latestSummary = manager.getLatestByPath(recentFiles.list()[0]!.path);
    const restored = manager.restoreLatestByPath(recentFiles.list()[0]!.path);

    expect(latestSummary?.id).toBe(second.entry.id);
    expect(latestSummary?.reason).toBe('latest');
    expect(restored?.id).toBe(second.entry.id);
    expect(restored?.document.features).toHaveLength(2);
  });

  it('returns null when a recent file path has no autosave snapshot', () => {
    const storage = createMemoryStorage();
    const manager = new AutosaveManager({ storage });
    const recentFiles = new RecentFilesStore({ storage });

    recentFiles.add('C:\\Models\\Missing.json');

    expect(manager.getLatestByPath(recentFiles.list()[0]!.path)).toBeNull();
    expect(manager.restoreLatestByPath(recentFiles.list()[0]!.path)).toBeNull();
  });

  it('returns null for a path when the latest matching autosave payload is unreadable', () => {
    const storage = createMemoryStorage();
    const manager = new AutosaveManager({ storage });
    storage.setItem('modelling.autosaves.v1', JSON.stringify([
      {
        id: 'path:c:\\models\\broken.json@2026-03-24T10:00:01.000Z',
        documentKey: 'path:c:\\models\\broken.json',
        documentName: 'Broken',
        filePath: 'C:\\Models\\Broken.json',
        reason: 'latest',
        savedAt: '2026-03-24T10:00:01.000Z',
        size: 4,
        json: '{bad',
      },
    ]));

    expect(manager.getLatestByPath('c:/models/broken.json')?.id).toBe(
      'path:c:\\models\\broken.json@2026-03-24T10:00:01.000Z'
    );
    expect(manager.restoreLatestByPath('C:\\Models\\Broken.json')).toBeNull();
  });

  it('skips a corrupted newest snapshot and restores the latest valid prior snapshot', () => {
    const storage = createMemoryStorage();
    let tick = 0;
    const manager = new AutosaveManager({
      storage,
      now: () => `2026-03-24T10:00:0${tick++}.000Z`,
    });
    const path = 'C:\\Models\\Recoverable.json';
    const original = createDocument('Recoverable');
    const updated: Document = {
      ...original,
      metadata: { ...original.metadata, modified: '2026-03-24T10:00:01.000Z' },
      features: [...original.features, {
        id: 'feature-2',
        type: 'box',
        name: 'Newest edit',
        parameters: { width: 2 },
        suppressed: false,
        refsIn: [],
        refsOut: ['body-2'],
      }],
    };

    const prior = manager.saveNow(original, { filePath: path, reason: 'valid-prior' });
    const newest = manager.saveNow(updated, { filePath: path, reason: 'corrupted-newest' });
    expect(prior.ok).toBe(true);
    expect(newest.ok).toBe(true);
    if (!prior.ok || !newest.ok) return;

    const raw = storage.getItem('modelling.autosaves.v1');
    expect(raw).not.toBeNull();
    const records = JSON.parse(raw!) as Array<Record<string, unknown>>;
    records[0]!.json = '{truncated-after-crash';
    storage.setItem('modelling.autosaves.v1', JSON.stringify(records));

    expect(manager.getLatestByPath(path)?.id).toBe(newest.entry.id);
    const restored = manager.restoreLatestByPath(path);
    expect(restored?.id).toBe(prior.entry.id);
    expect(restored?.reason).toBe('valid-prior');
    expect(restored?.document.features).toHaveLength(1);
  });

  it('bounds the scheduled-autosave crash window and flushes the captured snapshot', () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage();
    let tick = 0;
    const manager = new AutosaveManager({
      storage,
      debounceMs: 1_000,
      now: () => `2026-03-24T10:00:0${tick++}.000Z`,
    });
    const path = 'C:\\Models\\CrashWindow.json';
    const baseline = createDocument('Crash Window');
    const edited: Document = {
      ...baseline,
      metadata: { ...baseline.metadata, modified: '2026-03-24T10:00:01.000Z' },
      features: [...baseline.features, {
        id: 'feature-2',
        type: 'box',
        name: 'Pending edit',
        parameters: { width: 2 },
        suppressed: false,
        refsIn: [],
        refsOut: ['body-2'],
      }],
    };

    manager.saveNow(baseline, { filePath: path, reason: 'baseline' });
    manager.schedule(edited, { filePath: path, reason: 'scheduled-edit' });

    // A forced crash before the one-second deadline can lose only the pending
    // edit; the previously committed snapshot remains recoverable.
    const beforeDeadline = new AutosaveManager({ storage });
    expect(beforeDeadline.restoreLatestByPath(path)?.document.features).toHaveLength(1);
    expect(manager.hasPending()).toBe(true);

    const flushed = manager.flushPending();
    expect(flushed?.ok).toBe(true);
    expect(manager.hasPending()).toBe(false);

    const afterFlush = new AutosaveManager({ storage });
    const recovered = afterFlush.restoreLatestByPath(path);
    expect(recovered?.reason).toBe('scheduled-edit');
    expect(recovered?.document.features).toHaveLength(2);
  });

  it('retains a pending snapshot when storage fails so flush can be retried', () => {
    const backing = createMemoryStorage();
    let failWrites = true;
    const storage = {
      get length() { return backing.length; },
      clear: () => backing.clear(),
      getItem: (key: string) => backing.getItem(key),
      key: (index: number) => backing.key(index),
      removeItem: (key: string) => backing.removeItem(key),
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error('forced quota failure');
        backing.setItem(key, value);
      },
    };
    const manager = new AutosaveManager({ storage });
    manager.schedule(createDocument('Retryable'));

    const failed = manager.flushPending();
    expect(failed).toEqual({ ok: false, error: 'Autosave write failed: forced quota failure' });
    expect(manager.hasPending()).toBe(true);

    failWrites = false;
    expect(manager.flushPending()?.ok).toBe(true);
    expect(manager.hasPending()).toBe(false);
    expect(manager.list()).toHaveLength(1);
  });

  it('reports unavailable durable storage and retains a scheduled snapshot', () => {
    const manager = new AutosaveManager({ storage: null });
    const document = createDocument('Unsaved recovery');

    expect(manager.saveNow(document)).toEqual({
      ok: false,
      error: 'Autosave storage is unavailable.',
    });

    manager.schedule(document);
    expect(manager.flushPending()).toEqual({
      ok: false,
      error: 'Autosave storage is unavailable.',
    });
    expect(manager.hasPending()).toBe(true);
  });
});
