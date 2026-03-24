import type { Document } from '../types';
import { createDefaultDocument } from '../types';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Serializer');

const SCHEMA_VERSION = '0.1.0';

export interface SerializeResult {
  ok: true;
  json: string;
}

export interface SerializeError {
  ok: false;
  error: string;
}

export type SerializeOutcome = SerializeResult | SerializeError;

export interface DeserializeResult {
  ok: true;
  document: Document;
}

export interface DeserializeError {
  ok: false;
  error: string;
}

export type DeserializeOutcome = DeserializeResult | DeserializeError;

/**
 * Serialize a document to JSON string
 */
export function serialize(doc: Document): SerializeOutcome {
  try {
    const json = JSON.stringify(doc, null, 2);
    log.debug('Document serialized', { size: json.length });
    return { ok: true, json };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown serialization error';
    log.error('Serialization failed', error);
    return { ok: false, error };
  }
}

/**
 * Deserialize a JSON string to a document
 */
export function deserialize(json: string): DeserializeOutcome {
  try {
    const parsed = JSON.parse(json) as unknown;

    // Validate basic structure
    if (!isDocumentLike(parsed)) {
      return { ok: false, error: 'Invalid document structure' };
    }

    // Check version compatibility
    const version = parsed.version as string;
    if (!isVersionCompatible(version)) {
      return {
        ok: false,
        error: `Incompatible schema version: ${version}. Expected ${SCHEMA_VERSION}.x`,
      };
    }

    // Validate and normalize the document
    const doc = normalizeDocument(parsed);

    log.debug('Document deserialized', { name: doc.metadata.name });
    return { ok: true, document: doc };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown deserialization error';
    log.error('Deserialization failed', error);
    return { ok: false, error };
  }
}

/**
 * Check if parsed object looks like a document
 */
function isDocumentLike(value: unknown): value is Partial<Document> {
  if (typeof value !== 'object' || value === null) return false;

  const doc = value as Record<string, unknown>;
  return (
    typeof doc.version === 'string' &&
    typeof doc.metadata === 'object' &&
    Array.isArray((doc as Record<string, unknown>).bodies)
  );
}

/**
 * Check if version is compatible with current schema
 */
function isVersionCompatible(version: string): boolean {
  const parts = version.split('.');
  if (parts.length < 2) return false;

  const major = parseInt(parts[0]!, 10);
  const minor = parseInt(parts[1]!, 10);

  // Only accept 0.1.x versions for now
  return major === 0 && minor === 1;
}

/**
 * Normalize a document to ensure all required fields exist
 */
function normalizeDocument(partial: Partial<Document>): Document {
  const defaults = createDefaultDocument(partial.metadata?.name);

  return {
    version: partial.version ?? defaults.version,
    metadata: {
      name: partial.metadata?.name ?? defaults.metadata.name,
      created: partial.metadata?.created ?? defaults.metadata.created,
      modified: partial.metadata?.modified ?? defaults.metadata.modified,
    },
    config: {
      units: partial.config?.units ?? defaults.config.units,
      gridSpacing: partial.config?.gridSpacing ?? defaults.config.gridSpacing,
      snapEnabled: partial.config?.snapEnabled ?? defaults.config.snapEnabled,
    },
    bodies: partial.bodies ?? [],
    features: partial.features ?? [],
  };
}

/**
 * Save document to file using File System Access API or download
 */
export async function saveToFile(
  doc: Document,
  suggestedName = 'model.json'
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const result = serialize(doc);
  if (!result.ok) return result;

  try {
    // Try File System Access API first (supported in modern browsers)
    if ('showSaveFilePicker' in window) {
      const handle = await (window as Window & { showSaveFilePicker: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'Parametric Model',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(result.json);
      await writable.close();

      log.info('Document saved', { name: handle.name });
      return { ok: true, path: handle.name };
    }

    // Fallback to download
    downloadFile(result.json, suggestedName);
    return { ok: true, path: suggestedName };
  } catch (err) {
    // User cancelled
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Save cancelled' };
    }

    const error = err instanceof Error ? err.message : 'Unknown save error';
    log.error('Save failed', error);
    return { ok: false, error };
  }
}

/**
 * Load document from file using File System Access API or file input
 */
export async function loadFromFile(): Promise<
  { ok: true; document: Document; path: string } | { ok: false; error: string }
> {
  try {
    // Try File System Access API first
    if ('showOpenFilePicker' in window) {
      const handles = await (window as Window & { showOpenFilePicker: (options: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
        types: [
          {
            description: 'Parametric Model',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });

      const handle = handles[0];
      if (!handle) {
        return { ok: false, error: 'No file selected' };
      }

      const file = await handle.getFile();
      const json = await file.text();

      const result = deserialize(json);
      if (!result.ok) return result;

      log.info('Document loaded', { name: handle.name });
      return { ok: true, document: result.document, path: handle.name };
    }

    // Fallback to file input
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ ok: false, error: 'No file selected' });
          return;
        }

        const json = await file.text();
        const result = deserialize(json);

        if (result.ok) {
          log.info('Document loaded', { name: file.name });
          resolve({ ok: true, document: result.document, path: file.name });
        } else {
          resolve(result);
        }
      };

      input.click();
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Open cancelled' };
    }

    const error = err instanceof Error ? err.message : 'Unknown load error';
    log.error('Load failed', error);
    return { ok: false, error };
  }
}

/**
 * Trigger a file download
 */
function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}
