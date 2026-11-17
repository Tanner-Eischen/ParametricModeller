import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentLifecycle, type DocumentDisposition, type DocumentLifecycleDependencies } from '../../src/app/DocumentLifecycle';
import { UndoRedoStack } from '../../src/core/UndoRedoStack';
import { AutosaveManager } from '../../src/persistence/AutosaveManager';
import { createMemoryStorage } from '../../src/persistence/storage';
import { createDefaultDocument, type Document } from '../../src/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
type WriteResult = Awaited<ReturnType<DocumentLifecycleDependencies['write']>>;
const managers: AutosaveManager[] = [];
afterEach(() => { managers.splice(0).forEach(manager => manager.dispose()); vi.restoreAllMocks(); });

function fixture() {
  const history = new UndoRedoStack<Document>({ now: () => '2026-11-16T12:00:00Z' });
  history.seed(createDefaultDocument('Chair'));
  const storage = createMemoryStorage();
  const recovery = new AutosaveManager({ storage, now: () => '2026-11-16T12:00:01Z' });
  managers.push(recovery);
  let path: string | null = null;
  const write = vi.fn<DocumentLifecycleDependencies['write']>().mockResolvedValue({ ok: true, path: 'chair.json' });
  const chooseDisposition = vi.fn<DocumentLifecycleDependencies['chooseDisposition']>().mockResolvedValue('cancel');
  const status = vi.fn<DocumentLifecycleDependencies['status']>();
  const onSaved = vi.fn<DocumentLifecycleDependencies['onSaved']>((snapshot, savedPath) => {
    path = savedPath;
    history.markClean(snapshot.revision);
  });
  const preserveRecovery = vi.fn<DocumentLifecycleDependencies['preserveRecovery']>(document => {
    recovery.schedule(document, { filePath: path, reason: 'before-document-replacement' });
    return recovery.flushPending()!;
  });
  const lifecycle = new DocumentLifecycle({
    capture: () => ({ document: history.getPresent()!, revision: history.getState().current?.id ?? null }),
    isDirty: () => history.isDirty(), write, onSaved, preserveRecovery, chooseDisposition, status,
  });
  const edit = (name: string) => {
    const document = history.getPresent()!;
    document.metadata.name = name;
    return history.commit(document, `Rename ${name}`).entry.id;
  };
  const replaceWith = vi.fn((name = 'New') => {
    history.seed(createDefaultDocument(name));
    path = null;
    lifecycle.reset();
  });
  const bytes = () => JSON.stringify({ document: history.getPresent(), history: history.getState(), path, recovery: storage.getItem('modelling.autosaves.v1') });
  return { history, storage, recovery, lifecycle, write, chooseDisposition, onSaved, preserveRecovery, status, edit, replaceWith, bytes, path: () => path };
}

describe('DocumentLifecycle', () => {
  it('replaces a clean document without asking for disposition', async () => {
    const f = fixture();
    expect(await f.lifecycle.replace('New', f.replaceWith)).toBe(true);
    expect(f.chooseDisposition).not.toHaveBeenCalled();
    expect(f.preserveRecovery).not.toHaveBeenCalled();
    expect(f.history.getPresent()!.metadata.name).toBe('New');
    expect(f.lifecycle.documentEpoch).toBe(1);
  });

  it('cancel leaves document, history, path and recovery byte-equivalent', async () => {
    const f = fixture(); f.edit('Edited chair');
    const before = f.bytes();
    expect(await f.lifecycle.replace('New', f.replaceWith)).toBe(false);
    expect(f.bytes()).toBe(before);
    expect(f.replaceWith).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it('discard preserves a restorable snapshot before applying replacement', async () => {
    const f = fixture(); f.edit('Edited chair');
    const before = f.history.getPresent()!;
    f.chooseDisposition.mockResolvedValue('discard');
    const apply = vi.fn(() => {
      expect(f.recovery.restoreLatest(before)?.document).toEqual(before);
      f.replaceWith();
    });
    expect(await f.lifecycle.replace('Open', apply)).toBe(true);
    expect(apply).toHaveBeenCalledOnce();
    expect(f.recovery.hasPending()).toBe(false);
    expect(f.history.isDirty()).toBe(false);
  });

  it('keeps the document and pending recovery when discard storage fails, then permits retry', async () => {
    const f = fixture(); f.edit('Edited chair');
    const before = f.history.getPresent();
    f.chooseDisposition.mockResolvedValue('discard');
    const writeFailure = vi.spyOn(f.storage, 'setItem').mockImplementation(() => { throw new Error('quota full'); });
    expect(await f.lifecycle.replace('New', f.replaceWith)).toBe(false);
    expect(f.history.getPresent()).toEqual(before);
    expect(f.history.isDirty()).toBe(true);
    expect(f.recovery.hasPending()).toBe(true);
    expect(f.replaceWith).not.toHaveBeenCalled();
    expect(f.status).toHaveBeenCalledWith(expect.stringContaining('recovery could not be saved'));
    writeFailure.mockRestore();
    expect(f.recovery.flushPending()?.ok).toBe(true);
    expect(f.recovery.restoreLatest(before!)?.document).toEqual(before);
  });

  it('does not replace or mark clean when the save dialog is cancelled', async () => {
    const f = fixture(); f.edit('Edited chair');
    const before = f.bytes();
    f.chooseDisposition.mockResolvedValue('save');
    f.write.mockResolvedValue({ ok: false, error: 'Save cancelled' });
    expect(await f.lifecycle.replace('Open', f.replaceWith)).toBe(false);
    expect(f.bytes()).toBe(before);
    expect(f.status).not.toHaveBeenCalled();
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(f.replaceWith).not.toHaveBeenCalled();
  });

  it('saves the captured revision before replacing the document', async () => {
    const f = fixture(); f.edit('Edited chair');
    const before = f.history.getPresent();
    f.chooseDisposition.mockResolvedValue('save');
    expect(await f.lifecycle.replace('New', f.replaceWith)).toBe(true);
    expect(f.write).toHaveBeenCalledWith(before);
    expect(f.onSaved).toHaveBeenCalledOnce();
    expect(f.preserveRecovery).not.toHaveBeenCalled();
    expect(f.replaceWith).toHaveBeenCalledOnce();
  });

  it('a delayed save leaves later edits dirty and undo to the saved revision clean', async () => {
    const f = fixture(); f.edit('Saved revision');
    const gate = deferred<WriteResult>(); f.write.mockReturnValue(gate.promise);
    const save = f.lifecycle.save();
    f.edit('Newer edit');
    gate.resolve({ ok: true, path: 'chair.json' });
    expect(await save).toBe(true);
    expect(f.write.mock.calls[0]![0].metadata.name).toBe('Saved revision');
    expect(f.history.getPresent()!.metadata.name).toBe('Newer edit');
    expect(f.history.isDirty()).toBe(true);
    f.history.undo(); expect(f.history.isDirty()).toBe(false);
    f.history.redo(); expect(f.history.isDirty()).toBe(true);
  });

  it('undo during an in-flight save does not falsely clean the earlier revision', async () => {
    const f = fixture(); f.edit('Saved revision');
    const gate = deferred<WriteResult>(); f.write.mockReturnValue(gate.promise);
    const save = f.lifecycle.save(); f.history.undo();
    gate.resolve({ ok: true, path: 'chair.json' }); await save;
    expect(f.history.isDirty()).toBe(true);
    f.history.redo(); expect(f.history.isDirty()).toBe(false);
  });

  it('a save of a truncated redo revision never marks its replacement clean', async () => {
    const f = fixture(); f.edit('Abandoned revision');
    const gate = deferred<WriteResult>(); f.write.mockReturnValue(gate.promise);
    const save = f.lifecycle.save(); f.history.undo(); f.edit('Other branch');
    gate.resolve({ ok: true, path: 'chair.json' }); await save;
    expect(f.history.isDirty()).toBe(true);
    expect(f.history.canRedo()).toBe(false);
    f.history.undo(); expect(f.history.isDirty()).toBe(true);
  });

  it('ignores completion of a previous document save after reset', async () => {
    const f = fixture(); f.edit('Old document');
    const gate = deferred<WriteResult>(); f.write.mockReturnValue(gate.promise);
    const save = f.lifecycle.save(); f.replaceWith('New document'); f.edit('New edited document');
    const before = f.bytes();
    gate.resolve({ ok: true, path: 'old.json' });
    expect(await save).toBe(false);
    expect(f.bytes()).toBe(before);
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(f.path()).toBeNull();
  });

  it('coalesces concurrent saves of one document into one write', async () => {
    const f = fixture(); f.edit('Saved revision');
    const gate = deferred<WriteResult>(); f.write.mockReturnValue(gate.promise);
    const first = f.lifecycle.save(); const second = f.lifecycle.save();
    expect(first).toBe(second); expect(f.write).toHaveBeenCalledOnce();
    gate.resolve({ ok: true, path: 'chair.json' });
    expect(await first).toBe(true); expect(await second).toBe(true);
    expect(f.onSaved).toHaveBeenCalledOnce();
  });

  it('rejects a new document save while the old document write is still pending', async () => {
    const f = fixture(); f.edit('Old');
    const gate = deferred<WriteResult>(); f.write.mockReturnValue(gate.promise);
    const oldSave = f.lifecycle.save(); f.replaceWith('New'); f.edit('New edit');
    const newSave = f.lifecycle.save();
    expect(f.write).toHaveBeenCalledOnce();
    gate.resolve({ ok: true, path: 'old.json' });
    expect(await oldSave).toBe(false); expect(await newSave).toBe(false);
    expect(f.onSaved).not.toHaveBeenCalled();
    f.write.mockResolvedValue({ ok: true, path: 'new.json' });
    expect(await f.lifecycle.save()).toBe(true);
    expect(f.path()).toBe('new.json');
  });

  it.each(['New', 'Open'])('rejects stale %s requests by document epoch', async action => {
    const f = fixture(); const oldEpoch = f.lifecycle.documentEpoch;
    f.replaceWith('Other document'); f.edit('Other edits');
    const before = f.bytes(); const apply = vi.fn();
    expect(await f.lifecycle.replace(action, apply, oldEpoch)).toBe(false);
    expect(f.bytes()).toBe(before); expect(apply).not.toHaveBeenCalled();
    expect(f.chooseDisposition).not.toHaveBeenCalled();
  });

  it.each(['save', 'discard'] as const)('rejects %s if the document changed during disposition', async choice => {
    const f = fixture(); f.edit('Before prompt');
    const gate = deferred<DocumentDisposition>(); f.chooseDisposition.mockReturnValue(gate.promise);
    const replace = f.lifecycle.replace('New', f.replaceWith);
    f.edit('After prompt'); const before = f.bytes(); gate.resolve(choice);
    expect(await replace).toBe(false); expect(f.bytes()).toBe(before);
    expect(f.write).not.toHaveBeenCalled(); expect(f.preserveRecovery).not.toHaveBeenCalled();
    expect(f.replaceWith).not.toHaveBeenCalled();
  });

  it('rejects replacement when new edits occur during its save', async () => {
    const f = fixture(); f.edit('Before save'); f.chooseDisposition.mockResolvedValue('save');
    const gate = deferred<WriteResult>(); f.write.mockReturnValue(gate.promise);
    const replace = f.lifecycle.replace('Open', f.replaceWith);
    await Promise.resolve(); expect(f.write).toHaveBeenCalledOnce();
    f.edit('During save'); gate.resolve({ ok: true, path: 'chair.json' });
    expect(await replace).toBe(false); expect(f.replaceWith).not.toHaveBeenCalled();
    expect(f.history.isDirty()).toBe(true);
    expect(f.status).toHaveBeenCalledWith(expect.stringContaining('Newer changes remain unsaved'));
  });

  it('rejects overlapping replacements and stale disposition after a reset', async () => {
    const f = fixture(); f.edit('Before prompt');
    const gate = deferred<DocumentDisposition>(); f.chooseDisposition.mockReturnValue(gate.promise);
    const first = f.lifecycle.replace('New', f.replaceWith);
    const secondApply = vi.fn();
    expect(await f.lifecycle.replace('Open', secondApply)).toBe(false);
    f.replaceWith('Externally opened'); gate.resolve('discard');
    expect(await first).toBe(false); expect(secondApply).not.toHaveBeenCalled();
    expect(f.preserveRecovery).not.toHaveBeenCalled();
    expect(f.history.getPresent()!.metadata.name).toBe('Externally opened');
  });

  it('reports write failure and releases the save slot for retry', async () => {
    const f = fixture(); f.edit('Unsaved'); f.write.mockRejectedValueOnce(new Error('disk full'));
    expect(await f.lifecycle.save()).toBe(false);
    expect(f.history.isDirty()).toBe(true);
    expect(f.status).toHaveBeenCalledWith('Save failed: disk full');
    expect(await f.lifecycle.save()).toBe(true);
  });
});

describe('DocumentLifecycle exit protection', () => {
  function exitEvent() {
    return { preventDefault: vi.fn(), returnValue: 'untouched' };
  }

  it('allows a clean document to exit without a recovery write or confirmation request', () => {
    const f = fixture(); const event = exitEvent(); const before = f.bytes();
    f.lifecycle.beforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBe('untouched');
    expect(f.preserveRecovery).not.toHaveBeenCalled();
    expect(f.bytes()).toBe(before);
  });

  it('preserves recoverable dirty work and requests exit confirmation without marking it clean', () => {
    const f = fixture(); f.edit('Unsaved chair'); const event = exitEvent();
    const before = f.history.getPresent()!;
    f.lifecycle.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe('');
    expect(f.recovery.restoreLatest(before)?.document).toEqual(before);
    expect(f.history.getPresent()).toEqual(before);
    expect(f.history.isDirty()).toBe(true);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.onSaved).not.toHaveBeenCalled();
  });

  it('still requests confirmation and retains pending recovery when storage fails', () => {
    const f = fixture(); f.edit('Unsaved chair'); const event = exitEvent();
    vi.spyOn(f.storage, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(() => f.lifecycle.beforeUnload(event)).not.toThrow();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe('');
    expect(f.history.isDirty()).toBe(true);
    expect(f.recovery.hasPending()).toBe(true);
    expect(f.recovery.list()).toHaveLength(0);
  });

  it('requests confirmation even when the preservation callback throws', () => {
    const f = fixture(); f.edit('Unsaved chair'); const event = exitEvent();
    const before = f.bytes();
    f.preserveRecovery.mockImplementation(() => { throw new Error('unexpected recovery exception'); });
    // Assert the exit-protection guarantee independently of whether the caller
    // reports or propagates the recovery exception.
    try { f.lifecycle.beforeUnload(event); } catch { /* confirmation must already be requested */ }
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe('');
    expect(f.bytes()).toBe(before);
    expect(f.history.isDirty()).toBe(true);
  });

  it('reports replacement apply exceptions accurately and releases the transition lock', async () => {
    const f = fixture();
    const brokenApply = vi.fn(() => { throw new Error('apply failed'); });
    expect(await f.lifecycle.replace('New', brokenApply)).toBe(false);
    expect(f.status).toHaveBeenCalledWith('Document replacement failed: apply failed');
    expect(await f.lifecycle.replace('New', f.replaceWith)).toBe(true);
    expect(f.replaceWith).toHaveBeenCalledOnce();
  });
});
