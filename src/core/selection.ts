import { eventBus } from './eventBus';

export interface SelectionState {
  selectedIds: Set<string>;
  activeId: string | null;
}

export function createSelectionState(): SelectionState {
  return {
    selectedIds: new Set(),
    activeId: null,
  };
}

export function select(state: SelectionState, id: string, additive = false): SelectionState {
  const newSelectedIds = additive
    ? new Set(state.selectedIds)
    : new Set<string>();

  const wasSelected = state.selectedIds.has(id);

  if (additive && wasSelected) {
    // Toggle off in additive mode
    newSelectedIds.delete(id);
  } else {
    newSelectedIds.add(id);
  }

  const addedIds = new Set<string>();
  const removedIds = new Set<string>();

  if (!wasSelected && newSelectedIds.has(id)) {
    addedIds.add(id);
  } else if (wasSelected && !newSelectedIds.has(id)) {
    removedIds.add(id);
  }

  if (!additive) {
    // All previous selections are removed
    for (const prevId of state.selectedIds) {
      if (!newSelectedIds.has(prevId)) {
        removedIds.add(prevId);
      }
    }
  }

  const newState: SelectionState = {
    selectedIds: newSelectedIds,
    activeId: newSelectedIds.size > 0 ? id : null,
  };

  if (addedIds.size > 0 || removedIds.size > 0) {
    eventBus.emit('selection:change', {
      selectedIds: newSelectedIds,
      addedIds,
      removedIds,
    });
  }

  return newState;
}

export function selectMultiple(
  state: SelectionState,
  ids: string[],
  additive = false
): SelectionState {
  const newSelectedIds = additive
    ? new Set(state.selectedIds)
    : new Set<string>();

  const addedIds = new Set<string>();
  const removedIds = new Set<string>();

  if (!additive) {
    for (const prevId of state.selectedIds) {
      if (!ids.includes(prevId)) {
        removedIds.add(prevId);
      }
    }
  }

  for (const id of ids) {
    const wasSelected = state.selectedIds.has(id);
    if (!wasSelected) {
      addedIds.add(id);
    }
    newSelectedIds.add(id);
  }

  const newState: SelectionState = {
    selectedIds: newSelectedIds,
    activeId: newSelectedIds.size > 0 ? ids[ids.length - 1] ?? null : null,
  };

  if (addedIds.size > 0 || removedIds.size > 0) {
    eventBus.emit('selection:change', {
      selectedIds: newSelectedIds,
      addedIds,
      removedIds,
    });
  }

  return newState;
}

export function clearSelection(state: SelectionState): SelectionState {
  if (state.selectedIds.size === 0) {
    return state;
  }

  const removedIds = new Set(state.selectedIds);

  eventBus.emit('selection:change', {
    selectedIds: new Set(),
    addedIds: new Set(),
    removedIds,
  });

  return {
    selectedIds: new Set(),
    activeId: null,
  };
}

export function isSelected(state: SelectionState, id: string): boolean {
  return state.selectedIds.has(id);
}

export function getSelectedIds(state: SelectionState): string[] {
  return Array.from(state.selectedIds);
}
