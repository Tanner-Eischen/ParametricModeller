import { describe, expect, it } from 'vitest';
import { RecentFilesStore } from '../../src/persistence/RecentFilesStore';
import { createMemoryStorage } from '../../src/persistence/storage';

describe('RecentFilesStore', () => {
  it('adds entries in most-recent-first order', () => {
    const storage = createMemoryStorage();
    let tick = 0;
    const store = new RecentFilesStore({
      storage,
      now: () => `2026-03-24T10:00:0${tick++}.000Z`,
    });

    store.add('C:\\Models\\Box.json');
    const entries = store.add('C:\\Models\\Leg.json');

    expect(entries.map((entry) => entry.name)).toEqual(['Leg.json', 'Box.json']);
    expect(entries[0]?.lastOpened).toBe('2026-03-24T10:00:01.000Z');
  });

  it('deduplicates paths case-insensitively and refreshes the updated entry', () => {
    const storage = createMemoryStorage();
    let tick = 0;
    const store = new RecentFilesStore({
      storage,
      now: () => `2026-03-24T10:00:0${tick++}.000Z`,
    });

    store.add('C:\\Models\\Box.json', 'Old Name');
    const entries = store.add('c:/models/box.json', 'Box.json');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      path: 'c:/models/box.json',
      name: 'Box.json',
      lastOpened: '2026-03-24T10:00:01.000Z',
    });
  });

  it('enforces the configured history limit', () => {
    const storage = createMemoryStorage();
    const store = new RecentFilesStore({
      storage,
      limit: 2,
      now: () => '2026-03-24T10:00:00.000Z',
    });

    store.add('C:\\Models\\One.json');
    store.add('C:\\Models\\Two.json');
    const entries = store.add('C:\\Models\\Three.json');

    expect(entries.map((entry) => entry.name)).toEqual(['Three.json', 'Two.json']);
  });

  it('removes and clears entries', () => {
    const storage = createMemoryStorage();
    const store = new RecentFilesStore({
      storage,
      now: () => '2026-03-24T10:00:00.000Z',
    });

    store.add('C:\\Models\\One.json');
    store.add('C:\\Models\\Two.json');

    const afterRemove = store.remove('c:/models/one.json');
    expect(afterRemove.map((entry) => entry.name)).toEqual(['Two.json']);

    store.clear();
    expect(store.list()).toEqual([]);
  });

  it('tolerates invalid persisted payloads', () => {
    const storage = createMemoryStorage();
    storage.setItem('broken.recent', '{not-json');

    const store = new RecentFilesStore({
      storage,
      storageKey: 'broken.recent',
    });

    expect(store.list()).toEqual([]);
  });
});
