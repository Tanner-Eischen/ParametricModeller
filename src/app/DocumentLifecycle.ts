import type { Document } from '../types';
import type { AutosaveSaveOutcome } from '../persistence/AutosaveManager';

export type DocumentDisposition = 'save' | 'discard' | 'cancel';
export interface DocumentRevision {
  document: Document;
  revision: number | null;
}
export interface DocumentLifecycleDependencies {
  capture: () => DocumentRevision;
  isDirty: () => boolean;
  write: (document: Document) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  onSaved: (snapshot: DocumentRevision, path: string) => void;
  preserveRecovery: (document: Document) => AutosaveSaveOutcome;
  chooseDisposition: (name: string, action: string) => Promise<DocumentDisposition>;
  status: (message: string) => void;
}

/** Coordinates document replacement and asynchronous saves without owning model state. */
export class DocumentLifecycle {
  private epoch = 0;
  private replacing = false;
  private pendingSave: { epoch: number; promise: Promise<boolean> } | null = null;

  constructor(private readonly deps: DocumentLifecycleDependencies) {}

  get documentEpoch(): number { return this.epoch; }

  /** Call after seeding a new/opened document, never after undo or preview restoration. */
  reset(): void { this.epoch += 1; }

  beforeUnload(event: Pick<BeforeUnloadEvent, 'preventDefault' | 'returnValue'>): void {
    if (!this.deps.isDirty()) return;
    try {
      const recovery = this.deps.preserveRecovery(this.deps.capture().document);
      if (!recovery.ok) this.deps.status(`Recovery could not be saved: ${recovery.error}`);
    } catch (caught) {
      this.deps.status(`Recovery could not be saved: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      // Recovery is a fallback, not a substitute for the user's explicit save.
      event.preventDefault();
      event.returnValue = '';
    }
  }

  save(): Promise<boolean> {
    if (this.pendingSave?.epoch === this.epoch) return this.pendingSave.promise;
    if (this.pendingSave) {
      this.deps.status('The previous document is still saving. Try saving again when it finishes.');
      return Promise.resolve(false);
    }
    const epoch = this.epoch;
    const snapshot = structuredClone(this.deps.capture());
    const promise = this.write(snapshot, epoch);
    this.pendingSave = { epoch, promise };
    void promise.finally(() => {
      if (this.pendingSave?.promise === promise) this.pendingSave = null;
    });
    return promise;
  }

  private async write(snapshot: DocumentRevision, epoch: number): Promise<boolean> {
    try {
      const result = await this.deps.write(snapshot.document);
      if (epoch !== this.epoch) return false;
      if (!result.ok) {
        if (result.error !== 'Save cancelled') this.deps.status(`Save failed: ${result.error}`);
        return false;
      }
      this.deps.onSaved(snapshot, result.path);
      return true;
    } catch (caught) {
      if (epoch === this.epoch) {
        this.deps.status(`Save failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
      return false;
    }
  }

  async replace(action: string, apply: () => void, expectedEpoch = this.epoch): Promise<boolean> {
    if (this.replacing || expectedEpoch !== this.epoch) return false;
    this.replacing = true;
    try {
      const captured = this.deps.capture();
      if (this.deps.isDirty()) {
        const choice = await this.deps.chooseDisposition(captured.document.metadata.name, action);
        if (choice === 'cancel' || expectedEpoch !== this.epoch) return false;
        if (captured.revision !== this.deps.capture().revision) {
          this.deps.status('The document changed. Try the command again to review the latest changes.');
          return false;
        }
        if (choice === 'save') {
          if (!await this.save() || expectedEpoch !== this.epoch) return false;
          if (this.deps.isDirty()) {
            this.deps.status('Newer changes remain unsaved. Save them before replacing the document.');
            return false;
          }
        } else {
          const recovery = this.deps.preserveRecovery(captured.document);
          if (!recovery.ok) {
            this.deps.status(`Document kept open: recovery could not be saved (${recovery.error}). Save the file before continuing.`);
            return false;
          }
        }
      }
      if (expectedEpoch !== this.epoch) return false;
      apply();
      return true;
    } catch (caught) {
      this.deps.status(`Document replacement failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      return false;
    } finally {
      this.replacing = false;
    }
  }
}
