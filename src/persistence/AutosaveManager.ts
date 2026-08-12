import { createModuleLogger } from '../core/logger';
import type { Document } from '../types';
import { deserialize, serialize } from './serializer';
import { resolveStorage, type StorageLike } from './storage';

const log = createModuleLogger('AutosaveManager');

const DEFAULT_STORAGE_KEY = 'modelling.autosaves.v1';
const DEFAULT_DEBOUNCE_MS = 1500;
const DEFAULT_LIMIT = 20;

interface StoredAutosaveEntry {
  id: string;
  documentKey: string;
  documentName: string;
  filePath: string | null;
  reason: string;
  savedAt: string;
  size: number;
  json: string;
}

export interface AutosaveEntrySummary {
  id: string;
  documentKey: string;
  documentName: string;
  filePath: string | null;
  reason: string;
  savedAt: string;
  size: number;
}

export interface RestoredAutosaveEntry extends AutosaveEntrySummary {
  document: Document;
}

export interface AutosaveContext {
  filePath?: string | null;
  reason?: string;
}

export interface AutosaveSaveResult {
  ok: true;
  entry: AutosaveEntrySummary;
  skipped: boolean;
}

export interface AutosaveErrorResult {
  ok: false;
  error: string;
}

export type AutosaveSaveOutcome = AutosaveSaveResult | AutosaveErrorResult;

export interface AutosaveManagerOptions {
  storage?: StorageLike | null;
  storageKey?: string;
  debounceMs?: number;
  maxEntries?: number;
  now?: () => string;
}

interface PendingAutosave {
  document: Document;
  context: Required<AutosaveContext>;
}

function cloneDocument(document: Document): Document {
  if (typeof structuredClone === 'function') {
    return structuredClone(document);
  }

  return JSON.parse(JSON.stringify(document)) as Document;
}

function normalizePath(filePath?: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.replace(/\//g, '\\').toLowerCase();
}

function createPathAutosaveKey(filePath?: string | null): string | null {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath) {
    return null;
  }

  return `path:${normalizedPath}`;
}

function isStoredAutosaveEntry(value: unknown): value is StoredAutosaveEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.documentKey === 'string' &&
    typeof candidate.documentName === 'string' &&
    (typeof candidate.filePath === 'string' || candidate.filePath === null) &&
    typeof candidate.reason === 'string' &&
    typeof candidate.savedAt === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.json === 'string'
  );
}

function toSummary(entry: StoredAutosaveEntry): AutosaveEntrySummary {
  return {
    id: entry.id,
    documentKey: entry.documentKey,
    documentName: entry.documentName,
    filePath: entry.filePath,
    reason: entry.reason,
    savedAt: entry.savedAt,
    size: entry.size,
  };
}

export function createDocumentAutosaveKey(
  document: Pick<Document, 'metadata'>,
  filePath?: string | null
): string {
  const pathKey = createPathAutosaveKey(filePath);
  if (pathKey) {
    return pathKey;
  }

  return `draft:${document.metadata.name}::${document.metadata.created}`;
}

export class AutosaveManager {
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly debounceMs: number;
  private readonly maxEntries: number;
  private readonly now: () => string;
  private pending: PendingAutosave | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AutosaveManagerOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_LIMIT);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  schedule(document: Document, context: AutosaveContext = {}): void {
    this.pending = {
      document: cloneDocument(document),
      context: {
        filePath: context.filePath ?? null,
        reason: context.reason ?? 'autosave',
      },
    };

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }

    this.timerId = setTimeout(() => {
      this.flushPending();
    }, this.debounceMs);
  }

  flushPending(): AutosaveSaveOutcome | null {
    if (!this.pending) {
      return null;
    }

    const pending = this.pending;

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    const result = this.saveNow(pending.document, pending.context);
    // Retain a failed pending snapshot so a quota or transient storage failure
    // can be retried explicitly instead of widening the data-loss window.
    if (result.ok) {
      this.pending = null;
    }
    return result;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  cancelPending(): void {
    this.pending = null;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  saveNow(document: Document, context: AutosaveContext = {}): AutosaveSaveOutcome {
    const resolvedContext = {
      filePath: context.filePath ?? null,
      reason: context.reason ?? 'autosave',
    };

    const serialized = serialize(document);
    if (!serialized.ok) {
      return serialized;
    }

    const documentKey = createDocumentAutosaveKey(document, resolvedContext.filePath);
    const entries = this.readEntries();
    const latestExisting = entries.find((entry) => entry.documentKey === documentKey) ?? null;
    if (latestExisting && latestExisting.json === serialized.json) {
      return {
        ok: true,
        entry: toSummary(latestExisting),
        skipped: true,
      };
    }

    const savedAt = this.now();
    const entry: StoredAutosaveEntry = {
      id: `${documentKey}@${savedAt}`,
      documentKey,
      documentName: document.metadata.name,
      filePath: resolvedContext.filePath,
      reason: resolvedContext.reason,
      savedAt,
      size: serialized.json.length,
      json: serialized.json,
    };

    const nextEntries = [entry, ...entries].slice(0, this.maxEntries);
    const writeError = this.writeEntries(nextEntries);
    if (writeError) {
      return { ok: false, error: writeError };
    }
    log.debug('Autosave written', {
      documentKey,
      reason: resolvedContext.reason,
    });

    return {
      ok: true,
      entry: toSummary(entry),
      skipped: false,
    };
  }

  list(): AutosaveEntrySummary[] {
    return this.readEntries().map((entry) => toSummary(entry));
  }

  getLatestByPath(filePath: string): AutosaveEntrySummary | null {
    const documentKey = createPathAutosaveKey(filePath);
    if (!documentKey) {
      return null;
    }

    const entry = this.readEntries().find((candidate) => candidate.documentKey === documentKey);
    return entry ? toSummary(entry) : null;
  }

  getLatest(document: Document, filePath?: string | null): AutosaveEntrySummary | null {
    const documentKey = createDocumentAutosaveKey(document, filePath);
    const entry = this.readEntries().find((candidate) => candidate.documentKey === documentKey);
    return entry ? toSummary(entry) : null;
  }

  restore(id: string): RestoredAutosaveEntry | null {
    const entry = this.readEntries().find((candidate) => candidate.id === id);
    if (!entry) {
      return null;
    }

    const result = deserialize(entry.json);
    if (!result.ok) {
      return null;
    }

    return {
      ...toSummary(entry),
      document: result.document,
    };
  }

  restoreLatestByPath(filePath: string): RestoredAutosaveEntry | null {
    const documentKey = createPathAutosaveKey(filePath);
    if (!documentKey) {
      return null;
    }

    return this.restoreLatestValid(documentKey);
  }

  restoreLatest(document: Document, filePath?: string | null): RestoredAutosaveEntry | null {
    return this.restoreLatestValid(createDocumentAutosaveKey(document, filePath));
  }

  remove(id: string): AutosaveEntrySummary[] {
    const entries = this.readEntries().filter((entry) => entry.id !== id);
    this.writeEntries(entries);
    return entries.map((entry) => toSummary(entry));
  }

  clear(): void {
    this.cancelPending();
    if (!this.storage) {
      return;
    }

    try {
      this.storage.removeItem(this.storageKey);
    } catch (error) {
      log.warn('Could not clear autosaves', error);
    }
  }

  dispose(): void {
    this.cancelPending();
  }

  private readEntries(): StoredAutosaveEntry[] {
    if (!this.storage) {
      return [];
    }

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isStoredAutosaveEntry);
    } catch {
      return [];
    }
  }

  private restoreLatestValid(documentKey: string): RestoredAutosaveEntry | null {
    const candidates = this.readEntries().filter((entry) => entry.documentKey === documentKey);
    for (const entry of candidates) {
      const result = deserialize(entry.json);
      if (!result.ok) {
        log.warn('Skipping unreadable autosave snapshot', { id: entry.id, error: result.error });
        continue;
      }

      return {
        ...toSummary(entry),
        document: result.document,
      };
    }

    return null;
  }

  private writeEntries(entries: StoredAutosaveEntry[]): string | null {
    if (!this.storage) {
      return 'Autosave storage is unavailable.';
    }

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(entries));
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown storage error';
      log.error('Autosave write failed', message);
      return `Autosave write failed: ${message}`;
    }
  }
}
