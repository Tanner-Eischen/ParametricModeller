import { describe, expect, it } from 'vitest';
import { UndoRedoStack } from '../../src/core/UndoRedoStack';

interface TestSnapshot {
  value: number;
  nested?: { label: string };
}

describe('UndoRedoStack', () => {
  it('seeds with a clean initial snapshot and exposes state', () => {
    const stack = new UndoRedoStack<TestSnapshot>({
      now: () => '2026-03-24T10:00:00.000Z',
    });

    const entry = stack.seed({ value: 1 }, 'Initial sketch');
    const state = stack.getState();

    expect(entry.label).toBe('Initial sketch');
    expect(state.current?.label).toBe('Initial sketch');
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(state.isDirty).toBe(false);
    expect(stack.getPresent()).toEqual({ value: 1 });
  });

  it('does not create duplicate history entries for equivalent snapshots', () => {
    const stack = new UndoRedoStack<TestSnapshot>();
    stack.seed({ value: 1 }, 'Initial');

    const result = stack.commit({ value: 1 }, 'No-op');

    expect(result.committed).toBe(false);
    expect(stack.getState().history).toHaveLength(1);
    expect(stack.getState().current?.label).toBe('Initial');
  });

  it('supports undo/redo and truncates redo history after a new commit', () => {
    const stack = new UndoRedoStack<TestSnapshot>({
      now: (() => {
        let index = 0;
        return () => `2026-03-24T10:00:0${index++}.000Z`;
      })(),
    });

    stack.seed({ value: 1 }, 'Initial');
    stack.commit({ value: 2 }, 'Extrude');
    stack.commit({ value: 3 }, 'Pattern');

    const undoResult = stack.undo();
    expect(undoResult?.snapshot).toEqual({ value: 2 });
    expect(stack.getState().redo?.label).toBe('Pattern');

    const redoResult = stack.redo();
    expect(redoResult?.snapshot).toEqual({ value: 3 });

    stack.undo();
    stack.commit({ value: 4 }, 'Mirror');

    const state = stack.getState();
    expect(state.current?.label).toBe('Mirror');
    expect(state.canRedo).toBe(false);
    expect(state.history.map((entry) => entry.label)).toEqual([
      'Initial',
      'Extrude',
      'Mirror',
    ]);
  });

  it('tracks dirty state relative to markClean', () => {
    const stack = new UndoRedoStack<TestSnapshot>();
    stack.seed({ value: 1 }, 'Initial');
    stack.commit({ value: 2 }, 'Edit 1');

    expect(stack.isDirty()).toBe(true);

    stack.markClean();
    expect(stack.isDirty()).toBe(false);

    stack.commit({ value: 3 }, 'Edit 2');
    expect(stack.isDirty()).toBe(true);

    stack.undo();
    expect(stack.isDirty()).toBe(false);

    stack.markDirty();
    expect(stack.isDirty()).toBe(true);
  });

  it('returns cloned snapshots so callers cannot mutate stored history', () => {
    const stack = new UndoRedoStack<TestSnapshot>();
    stack.seed({ value: 1, nested: { label: 'A' } }, 'Initial');

    const present = stack.getPresent();
    expect(present).not.toBeNull();
    if (!present) {
      return;
    }

    present.nested!.label = 'Mutated';

    expect(stack.getPresent()).toEqual({ value: 1, nested: { label: 'A' } });
  });

  it('replaces present context without creating an undo step or changing dirty state', () => {
    const stack = new UndoRedoStack<TestSnapshot>();
    stack.seed({ value: 1, nested: { label: 'before' } }, 'Initial');

    expect(stack.replacePresent({ value: 1, nested: { label: 'selected' } })).toBe(true);
    expect(stack.getPresent()).toEqual({ value: 1, nested: { label: 'selected' } });
    expect(stack.getState().history).toHaveLength(1);
    expect(stack.isDirty()).toBe(false);
  });

  it('enforces history capacity while retaining the newest entries', () => {
    const stack = new UndoRedoStack<TestSnapshot>({ capacity: 2 });

    stack.seed({ value: 1 }, 'Initial');
    stack.commit({ value: 2 }, 'Second');
    stack.commit({ value: 3 }, 'Third');

    const state = stack.getState();
    expect(state.history.map((entry) => entry.label)).toEqual(['Second', 'Third']);
    expect(state.current?.label).toBe('Third');
    expect(state.undo?.label).toBe('Second');
  });
});
