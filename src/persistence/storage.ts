export interface StorageLike {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function isStorageLike(value: unknown): value is StorageLike {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.clear === 'function' &&
    typeof candidate.getItem === 'function' &&
    typeof candidate.key === 'function' &&
    typeof candidate.removeItem === 'function' &&
    typeof candidate.setItem === 'function'
  );
}

class MemoryStorage implements StorageLike {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

export function createMemoryStorage(): StorageLike {
  return new MemoryStorage();
}

export function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }

  const maybeLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  if (!isStorageLike(maybeLocalStorage)) {
    return null;
  }

  try {
    const probeKey = '__modelling_storage_probe__';
    maybeLocalStorage.setItem(probeKey, probeKey);
    maybeLocalStorage.removeItem(probeKey);
    return maybeLocalStorage;
  } catch {
    return null;
  }
}
