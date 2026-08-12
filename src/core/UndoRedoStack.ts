import { createModuleLogger } from './logger';

const log = createModuleLogger('UndoRedoStack');

export interface UndoRedoEntryMetadata {
  id: number;
  label: string;
  timestamp: string;
}

export interface UndoRedoCommitResult {
  committed: boolean;
  entry: UndoRedoEntryMetadata;
}

export interface UndoRedoNavigationResult<T> {
  entry: UndoRedoEntryMetadata;
  snapshot: T;
}

export interface UndoRedoStackState {
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  current: UndoRedoEntryMetadata | null;
  undo: UndoRedoEntryMetadata | null;
  redo: UndoRedoEntryMetadata | null;
  history: UndoRedoEntryMetadata[];
}

export interface UndoRedoStackOptions<T> {
  capacity?: number;
  clone?: (snapshot: T) => T;
  equals?: (left: T, right: T) => boolean;
  now?: () => string;
}

interface UndoRedoEntry<T> extends UndoRedoEntryMetadata {
  snapshot: T;
}

function defaultClone<T>(snapshot: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(snapshot);
  }

  return JSON.parse(JSON.stringify(snapshot)) as T;
}

function defaultEquals<T>(left: T, right: T): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return Object.is(left, right);
  }
}

function toMetadata<T>(entry: UndoRedoEntry<T>): UndoRedoEntryMetadata {
  return {
    id: entry.id,
    label: entry.label,
    timestamp: entry.timestamp,
  };
}

export class UndoRedoStack<T> {
  private readonly capacity: number;
  private readonly cloneSnapshot: (snapshot: T) => T;
  private readonly equalsSnapshot: (left: T, right: T) => boolean;
  private readonly now: () => string;
  private entries: UndoRedoEntry<T>[] = [];
  private cursor = -1;
  private nextId = 1;
  private cleanEntryId: number | null = null;

  constructor(options: UndoRedoStackOptions<T> = {}) {
    this.capacity = Math.max(1, options.capacity ?? 100);
    this.cloneSnapshot = options.clone ?? defaultClone;
    this.equalsSnapshot = options.equals ?? defaultEquals;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  seed(snapshot: T, label = 'Initial'): UndoRedoEntryMetadata {
    this.entries = [this.createEntry(snapshot, label)];
    this.cursor = 0;
    this.cleanEntryId = this.entries[0]!.id;
    log.debug('Undo/redo stack seeded', { label });
    return toMetadata(this.entries[0]!);
  }

  clear(): void {
    this.entries = [];
    this.cursor = -1;
    this.cleanEntryId = null;
    log.debug('Undo/redo stack cleared');
  }

  commit(snapshot: T, label: string): UndoRedoCommitResult {
    const current = this.getCurrentEntry();
    if (!current) {
      return {
        committed: true,
        entry: this.seed(snapshot, label),
      };
    }

    if (this.equalsSnapshot(current.snapshot, snapshot)) {
      return {
        committed: false,
        entry: toMetadata(current),
      };
    }

    if (this.cursor < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.cursor + 1);
    }

    const entry = this.createEntry(snapshot, label);
    this.entries.push(entry);
    this.cursor = this.entries.length - 1;
    this.trimToCapacity();

    log.debug('Undo/redo entry committed', {
      label,
      historyLength: this.entries.length,
    });

    return {
      committed: true,
      entry: toMetadata(this.entries[this.cursor]!),
    };
  }

  undo(): UndoRedoNavigationResult<T> | null {
    if (!this.canUndo()) {
      return null;
    }

    this.cursor -= 1;
    const entry = this.entries[this.cursor]!;
    log.debug('Undo applied', { label: entry.label });
    return {
      entry: toMetadata(entry),
      snapshot: this.cloneSnapshot(entry.snapshot),
    };
  }

  redo(): UndoRedoNavigationResult<T> | null {
    if (!this.canRedo()) {
      return null;
    }

    this.cursor += 1;
    const entry = this.entries[this.cursor]!;
    log.debug('Redo applied', { label: entry.label });
    return {
      entry: toMetadata(entry),
      snapshot: this.cloneSnapshot(entry.snapshot),
    };
  }

  markClean(): void {
    const current = this.getCurrentEntry();
    this.cleanEntryId = current?.id ?? null;
  }

  /** Force the present entry dirty, for example after recovering an autosave. */
  markDirty(): void {
    this.cleanEntryId = null;
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1;
  }

  isDirty(): boolean {
    const current = this.getCurrentEntry();
    if (!current) {
      return false;
    }

    return current.id !== this.cleanEntryId;
  }

  getPresent(): T | null {
    const current = this.getCurrentEntry();
    return current ? this.cloneSnapshot(current.snapshot) : null;
  }

  /** Refresh non-document context (for example selection) without adding an undo step. */
  replacePresent(snapshot: T): boolean {
    const current = this.getCurrentEntry();
    if (!current) return false;
    current.snapshot = this.cloneSnapshot(snapshot);
    return true;
  }

  getState(): UndoRedoStackState {
    const current = this.getCurrentEntry();
    const undo = this.canUndo() ? this.entries[this.cursor - 1]! : null;
    const redo = this.canRedo() ? this.entries[this.cursor + 1]! : null;

    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      isDirty: this.isDirty(),
      current: current ? toMetadata(current) : null,
      undo: undo ? toMetadata(undo) : null,
      redo: redo ? toMetadata(redo) : null,
      history: this.entries.map((entry) => toMetadata(entry)),
    };
  }

  private getCurrentEntry(): UndoRedoEntry<T> | null {
    if (this.cursor < 0 || this.cursor >= this.entries.length) {
      return null;
    }

    return this.entries[this.cursor] ?? null;
  }

  private createEntry(snapshot: T, label: string): UndoRedoEntry<T> {
    return {
      id: this.nextId++,
      label,
      timestamp: this.now(),
      snapshot: this.cloneSnapshot(snapshot),
    };
  }

  private trimToCapacity(): void {
    const overflow = this.entries.length - this.capacity;
    if (overflow <= 0) {
      return;
    }

    const removed = this.entries.slice(0, overflow);
    this.entries = this.entries.slice(overflow);
    this.cursor = Math.max(0, this.cursor - overflow);

    if (
      this.cleanEntryId !== null &&
      removed.some((entry) => entry.id === this.cleanEntryId)
    ) {
      this.cleanEntryId = null;
    }
  }
}

export function createUndoRedoStack<T>(options?: UndoRedoStackOptions<T>): UndoRedoStack<T> {
  return new UndoRedoStack(options);
}
