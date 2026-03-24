import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSelectionState,
  select,
  selectMultiple,
  clearSelection,
  isSelected,
  getSelectedIds,
} from '../src/core/selection';
import type { SelectionState } from '../src/core/selection';

describe('selection', () => {
  let state: SelectionState;

  beforeEach(() => {
    state = createSelectionState();
  });

  describe('createSelectionState', () => {
    it('should create empty selection state', () => {
      expect(state.selectedIds.size).toBe(0);
      expect(state.activeId).toBeNull();
    });
  });

  describe('select', () => {
    it('should select an object', () => {
      state = select(state, 'obj-1');
      expect(isSelected(state, 'obj-1')).toBe(true);
      expect(state.selectedIds.size).toBe(1);
    });

    it('should set activeId to selected object', () => {
      state = select(state, 'obj-1');
      expect(state.activeId).toBe('obj-1');
    });

    it('should replace selection by default', () => {
      state = select(state, 'obj-1');
      state = select(state, 'obj-2');

      expect(isSelected(state, 'obj-1')).toBe(false);
      expect(isSelected(state, 'obj-2')).toBe(true);
      expect(state.selectedIds.size).toBe(1);
    });

    it('should add to selection in additive mode', () => {
      state = select(state, 'obj-1');
      state = select(state, 'obj-2', true);

      expect(isSelected(state, 'obj-1')).toBe(true);
      expect(isSelected(state, 'obj-2')).toBe(true);
      expect(state.selectedIds.size).toBe(2);
    });

    it('should toggle off in additive mode', () => {
      state = select(state, 'obj-1');
      state = select(state, 'obj-2', true);
      state = select(state, 'obj-1', true);

      expect(isSelected(state, 'obj-1')).toBe(false);
      expect(isSelected(state, 'obj-2')).toBe(true);
    });

    it('should clear activeId when selection is empty', () => {
      state = select(state, 'obj-1');
      state = select(state, 'obj-1', true); // Toggle off

      expect(state.activeId).toBeNull();
    });
  });

  describe('selectMultiple', () => {
    it('should select multiple objects', () => {
      state = selectMultiple(state, ['obj-1', 'obj-2', 'obj-3']);
      expect(state.selectedIds.size).toBe(3);
      expect(isSelected(state, 'obj-1')).toBe(true);
      expect(isSelected(state, 'obj-2')).toBe(true);
      expect(isSelected(state, 'obj-3')).toBe(true);
    });

    it('should replace selection by default', () => {
      state = select(state, 'obj-0');
      state = selectMultiple(state, ['obj-1', 'obj-2']);

      expect(isSelected(state, 'obj-0')).toBe(false);
      expect(state.selectedIds.size).toBe(2);
    });

    it('should add to selection in additive mode', () => {
      state = select(state, 'obj-0');
      state = selectMultiple(state, ['obj-1', 'obj-2'], true);

      expect(isSelected(state, 'obj-0')).toBe(true);
      expect(state.selectedIds.size).toBe(3);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selections', () => {
      state = select(state, 'obj-1');
      state = select(state, 'obj-2', true);
      state = clearSelection(state);

      expect(state.selectedIds.size).toBe(0);
      expect(state.activeId).toBeNull();
    });

    it('should return same state if already empty', () => {
      const emptyState = createSelectionState();
      const result = clearSelection(emptyState);

      // Should be equivalent (different object but same content)
      expect(result.selectedIds.size).toBe(0);
      expect(result.activeId).toBeNull();
    });
  });

  describe('isSelected', () => {
    it('should return true for selected object', () => {
      state = select(state, 'obj-1');
      expect(isSelected(state, 'obj-1')).toBe(true);
    });

    it('should return false for unselected object', () => {
      state = select(state, 'obj-1');
      expect(isSelected(state, 'obj-2')).toBe(false);
    });

    it('should return false for empty state', () => {
      expect(isSelected(state, 'obj-1')).toBe(false);
    });
  });

  describe('getSelectedIds', () => {
    it('should return array of selected IDs', () => {
      state = select(state, 'obj-1');
      state = select(state, 'obj-2', true);
      state = select(state, 'obj-3', true);

      const ids = getSelectedIds(state);
      expect(ids).toHaveLength(3);
      expect(ids).toContain('obj-1');
      expect(ids).toContain('obj-2');
      expect(ids).toContain('obj-3');
    });

    it('should return empty array for no selection', () => {
      const ids = getSelectedIds(state);
      expect(ids).toHaveLength(0);
    });
  });
});
