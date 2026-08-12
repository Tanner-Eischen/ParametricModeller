import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, type StorageLike } from '../../src/persistence/storage';
import {
  WORKSPACE_PREFERENCES_STORAGE_KEY,
  WorkspacePreferencesStore,
} from '../../src/ui/WorkspacePreferencesStore';

describe('WorkspacePreferencesStore', () => {
  it('loads defaults and persists versioned workspace-only preferences', () => {
    const storage = createMemoryStorage();
    const store = new WorkspacePreferencesStore({ storage });

    expect(store.load()).toMatchObject({
      theme: 'system',
      defaultUnit: 'in',
      viewport: { showGrid: true },
      drawing: { views: ['front', 'top', 'right'], scale: 1 },
    });

    store.update({
      theme: 'dark',
      viewport: { showGrid: false },
      drawing: { scale: 0.5, includeHiddenLines: true },
    });

    expect(JSON.parse(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)!)).toEqual({
      version: 1,
      preferences: expect.objectContaining({
        theme: 'dark',
        viewport: expect.objectContaining({ showGrid: false }),
        drawing: expect.objectContaining({ scale: 0.5, includeHiddenLines: true }),
      }),
    });
    expect(new WorkspacePreferencesStore({ storage }).load()).toEqual(store.load());
  });

  it('falls back to independent defaults for corrupt and unsupported payloads', () => {
    const storage = createMemoryStorage();
    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, '{not-json');
    const corrupt = new WorkspacePreferencesStore({ storage });
    const first = corrupt.load();

    expect(first.theme).toBe('system');
    expect(corrupt.getLastLoadIssue()).toBe('corrupt');
    first.viewport.showGrid = false;
    expect(corrupt.load().viewport.showGrid).toBe(true);
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBe('{not-json');

    storage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 99,
      preferences: {},
    }));
    const future = new WorkspacePreferencesStore({ storage });
    expect(future.load().theme).toBe('system');
    expect(future.getLastLoadIssue()).toBe('unsupported-version');
  });

  it('validates replacements, resets storage, and notifies subscribers', () => {
    const storage = createMemoryStorage();
    const store = new WorkspacePreferencesStore({ storage });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(() => store.update({ drawing: { views: [] } })).toThrow(
      'Workspace preferences are invalid'
    );
    const updated = store.update({ defaultUnit: 'mm', snapping: { stepInches: 0.125 } });
    expect(listener).toHaveBeenLastCalledWith(updated);

    unsubscribe();
    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(store.load().defaultUnit).toBe('in');
  });

  it('continues in memory when storage writes fail', () => {
    const memory = createMemoryStorage();
    const failing: StorageLike = {
      get length() { return memory.length; },
      clear: () => memory.clear(),
      getItem: (key) => memory.getItem(key),
      key: (index) => memory.key(index),
      removeItem: (key) => memory.removeItem(key),
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = new WorkspacePreferencesStore({ storage: failing });
    expect(store.update({ theme: 'light' }).theme).toBe('light');
    expect(store.getLastLoadIssue()).toBe('storage-unavailable');
    expect(store.load().theme).toBe('light');
  });
});
