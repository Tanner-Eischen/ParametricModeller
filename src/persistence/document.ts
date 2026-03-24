import type { Document } from '../types';
import { createDefaultDocument } from '../types';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Document');

export class DocumentManager {
  private document: Document;
  private isDirty = false;
  private filePath: string | null = null;

  constructor() {
    this.document = createDefaultDocument();
    log.info('DocumentManager initialized');
  }

  getDocument(): Document {
    return this.document;
  }

  get isDocumentDirty(): boolean {
    return this.isDirty;
  }

  get currentFilePath(): string | null {
    return this.filePath;
  }

  new(name = 'Untitled'): void {
    this.document = createDefaultDocument(name);
    this.isDirty = false;
    this.filePath = null;
    log.info('New document created', { name });
  }

  load(doc: Document, path?: string): void {
    this.document = doc;
    this.isDirty = false;
    this.filePath = path ?? null;
    log.info('Document loaded', { name: doc.metadata.name, path });
  }

  markDirty(): void {
    if (!this.isDirty) {
      this.isDirty = true;
      log.debug('Document marked dirty');
    }
  }

  setFilePath(path: string): void {
    this.filePath = path;
    log.debug('File path set', { path });
  }

  updateMetadata(updates: Partial<Document['metadata']>): void {
    this.document = {
      ...this.document,
      metadata: {
        ...this.document.metadata,
        ...updates,
        modified: new Date().toISOString(),
      },
    };
    this.markDirty();
  }

  addBody(body: Document['bodies'][number]): void {
    this.document = {
      ...this.document,
      bodies: [...this.document.bodies, body],
    };
    this.markDirty();
    log.debug('Body added', { id: body.id, name: body.name });
  }

  removeBody(id: string): void {
    this.document = {
      ...this.document,
      bodies: this.document.bodies.filter((b) => b.id !== id),
    };
    this.markDirty();
    log.debug('Body removed', { id });
  }

  updateBody(id: string, updates: Partial<Document['bodies'][number]>): void {
    this.document = {
      ...this.document,
      bodies: this.document.bodies.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      ),
    };
    this.markDirty();
    log.debug('Body updated', { id });
  }

  addFeature(feature: Document['features'][number]): void {
    this.document = {
      ...this.document,
      features: [...this.document.features, feature],
    };
    this.markDirty();
    log.debug('Feature added', { id: feature.id, type: feature.type });
  }

  removeFeature(id: string): void {
    this.document = {
      ...this.document,
      features: this.document.features.filter((f) => f.id !== id),
    };
    this.markDirty();
    log.debug('Feature removed', { id });
  }
}
