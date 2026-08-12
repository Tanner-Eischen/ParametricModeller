import { createModuleLogger } from '../core/logger';
import { resolveStorage, type StorageLike } from './storage';

const log = createModuleLogger('RecentFilesStore');

const DEFAULT_STORAGE_KEY = 'modelling.recent-files.v1';
const DEFAULT_LIMIT = 12;

export interface RecentFileEntry {
  path: string;
  name: string;
  lastOpened: string;
}

export interface RecentFilesStoreOptions {
  storage?: StorageLike | null;
  storageKey?: string;
  limit?: number;
  now?: () => string;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\//g, '\\').toLowerCase();
}

function isRecentFileEntry(value: unknown): value is RecentFileEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.lastOpened === 'string'
  );
}

function getNameFromPath(path: string): string {
  const normalized = path.replace(/\//g, '\\');
  const segments = normalized.split('\\').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export class RecentFilesStore {
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly limit: number;
  private readonly now: () => string;

  constructor(options: RecentFilesStoreOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  list(): RecentFileEntry[] {
    return this.readEntries();
  }

  add(path: string, name = getNameFromPath(path)): RecentFileEntry[] {
    const trimmedPath = path.trim();
    if (trimmedPath.length === 0) {
      return this.readEntries();
    }

    const normalizedPath = normalizePath(trimmedPath);
    const entries = this.readEntries().filter(
      (entry) => normalizePath(entry.path) !== normalizedPath
    );

    entries.unshift({
      path: trimmedPath,
      name: name.trim() || getNameFromPath(trimmedPath),
      lastOpened: this.now(),
    });

    const limitedEntries = entries.slice(0, this.limit);
    this.writeEntries(limitedEntries);
    log.debug('Recent file recorded', { path: trimmedPath });
    return limitedEntries;
  }

  remove(path: string): RecentFileEntry[] {
    const normalizedPath = normalizePath(path);
    const entries = this.readEntries().filter(
      (entry) => normalizePath(entry.path) !== normalizedPath
    );
    this.writeEntries(entries);
    return entries;
  }

  clear(): void {
    if (!this.storage) {
      return;
    }

    this.storage.removeItem(this.storageKey);
  }

  private readEntries(): RecentFileEntry[] {
    if (!this.storage) {
      return [];
    }

    const raw = this.storage.getItem(this.storageKey);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isRecentFileEntry);
    } catch {
      return [];
    }
  }

  private writeEntries(entries: RecentFileEntry[]): void {
    if (!this.storage) {
      return;
    }

    this.storage.setItem(this.storageKey, JSON.stringify(entries));
  }
}
