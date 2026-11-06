/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { createUndoRedoStack, eventBus } from '../../src/core';
import { createPortfolioFrameDocument } from '../../src/examples/portfolioFrame';
import { inspectPortfolioFrame } from '../../src/app/PortfolioFrameWorkflow';
import type { Document } from '../../src/types';

describe('App frame-edit history integration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('commits once before the final chrome refresh, then undoes/redoes the same edit and names it correctly', () => {
    // Exercise the production App handlers, geometry helper and history stack.
    // Rendering/document installation is the boundary: it refreshes chrome
    // while loading, just as loadDocument does, before the edit is committed.
    let current = createPortfolioFrameDocument();
    const history = createUndoRedoStack<{ document: Document; selection: null }>();
    history.seed({ document: current, selection: null }, 'Load Document');
    history.markClean();
    const undoButton = document.createElement('button');
    const refreshStates: boolean[] = [];
    const refreshUiChrome = () => {
      undoButton.disabled = !history.canUndo();
      refreshStates.push(history.canUndo());
    };
    const status = vi.spyOn(eventBus, 'emit');
    const harness = Object.assign(Object.create(App.prototype), {
      toolSessions: { activeSession: null },
      undoRedo: history,
      documentManager: { currentFilePath: null },
      portfolioFramePanel: { setError: vi.fn(), reset: vi.fn() },
      panelChrome: { expand: vi.fn() },
      autosaveManager: { schedule: vi.fn() },
      cancelActiveInteraction: vi.fn(),
      refreshPresentHistorySelection: vi.fn(),
      buildDocumentSnapshot: () => structuredClone(current),
      buildHistorySnapshot: () => ({ document: structuredClone(current), selection: null }),
      buildHistorySelectionSnapshot: () => null,
      refreshDocumentDirtyState: vi.fn(),
      refreshUiChrome,
      loadDocument: (snapshot: Document) => {
        current = structuredClone(snapshot);
        refreshUiChrome();
      },
    });

    expect(harness.applyPortfolioFrameLength(20)).toBe(true);
    expect(refreshStates).toEqual([false, true]);
    expect(undoButton.disabled).toBe(false);
    expect(history.getState().history).toHaveLength(2);
    expect(history.getState().current?.label).toBe('Resize frame example');
    expect(inspectPortfolioFrame(current)?.bounds).toEqual([26, 20, 0.75]);

    harness.undoLastChange();
    expect(inspectPortfolioFrame(current)?.bounds).toEqual([24, 18, 0.75]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(status).toHaveBeenCalledWith('ui:status', { message: 'Undo: Resize frame example' });

    harness.redoLastChange();
    expect(inspectPortfolioFrame(current)?.bounds).toEqual([26, 20, 0.75]);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(history.getState().history).toHaveLength(2);
    expect(status).toHaveBeenCalledWith('ui:status', { message: 'Redo: Resize frame example' });
  });
});
