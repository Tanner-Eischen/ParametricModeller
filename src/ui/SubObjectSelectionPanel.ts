/**
 * SubObjectSelectionPanel - Selection mode UI (Milestone 07).
 * Provides buttons to switch between body, face, edge, and vertex selection modes.
 */

import type { SubObjectType } from '../geometry/SubObjectTypes';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('SubObjectSelectionPanel');

/**
 * Options for creating a sub-object selection panel.
 */
export interface SubObjectSelectionPanelOptions {
  /** Initial selection mode */
  initialMode?: SubObjectType;
  /** Callback when mode changes */
  onModeChange?: (mode: SubObjectType) => void;
}

/**
 * Panel for switching between sub-object selection modes.
 */
export class SubObjectSelectionPanel {
  private container: HTMLElement;
  private options: SubObjectSelectionPanelOptions;
  private currentMode: SubObjectType;
  private buttons: Map<SubObjectType, HTMLButtonElement> = new Map();
  private disposed = false;

  constructor(container: HTMLElement, options: SubObjectSelectionPanelOptions = {}) {
    this.container = container;
    this.options = options;
    this.currentMode = options.initialMode ?? 'body';

    this.render();
    this.updateButtonStates();
    log.debug('SubObjectSelectionPanel initialized', { mode: this.currentMode });
  }

  /**
   * Render the panel UI.
   */
  private render(): void {
    this.container.innerHTML = '';
    this.container.className = 'subobject-selection-panel';

    const header = document.createElement('div');
    header.className = 'subobject-selection-panel__header';

    const title = document.createElement('div');
    title.className = 'subobject-selection-panel__title';
    title.textContent = 'Selection mode';
    header.appendChild(title);

    const description = document.createElement('p');
    description.className = 'subobject-selection-panel__description';
    description.textContent = 'Choose what the viewport can pick. Vertex mode reveals pick markers; Move Vertex starts only when requested.';
    header.appendChild(description);

    this.container.appendChild(header);

    const buttons = document.createElement('div');
    buttons.className = 'subobject-selection-panel__buttons';
    this.container.appendChild(buttons);

    const modes: { mode: SubObjectType; label: string; title: string }[] = [
      { mode: 'body', label: 'Body', title: 'Select whole bodies' },
      { mode: 'face', label: 'Face', title: 'Select faces for sketching and push/pull' },
      { mode: 'edge', label: 'Edge', title: 'Select edges for edge-aware tools' },
      { mode: 'vertex', label: 'Vertex', title: 'Select vertices for guarded vertex editing' },
    ];

    for (const { mode, label, title } of modes) {
      const button = document.createElement('button');
      button.textContent = label;
      button.title = title;
      button.className = 'subobject-selection-panel__button';
      button.dataset.mode = mode;
      button.setAttribute('aria-pressed', String(mode === this.currentMode));

      button.addEventListener('click', () => this.setMode(mode));
      buttons.appendChild(button);
      this.buttons.set(mode, button);
    }

    const note = document.createElement('p');
    note.className = 'subobject-selection-panel__note';
    note.textContent = 'Use the help menu for shortcut and workflow reminders.';
    this.container.appendChild(note);
  }

  /**
   * Update button states based on current mode.
   */
  private updateButtonStates(): void {
    for (const [mode, button] of this.buttons) {
      if (mode === this.currentMode) {
        button.dataset.active = 'true';
        button.setAttribute('aria-pressed', 'true');
      } else {
        delete button.dataset.active;
        button.setAttribute('aria-pressed', 'false');
      }
    }
  }

  /**
   * Set the current selection mode.
   */
  setMode(mode: SubObjectType): void {
    if (mode === this.currentMode) return;

    this.currentMode = mode;
    this.updateButtonStates();

    log.debug('Selection mode changed', { mode });

    if (this.options.onModeChange) {
      this.options.onModeChange(mode);
    }
  }

  /**
   * Get the current selection mode.
   */
  getMode(): SubObjectType {
    return this.currentMode;
  }

  /**
   * Dispose the panel.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.container.innerHTML = '';
    this.buttons.clear();
    log.debug('SubObjectSelectionPanel disposed');
  }
}

/**
 * Create a sub-object selection panel.
 */
export function createSubObjectSelectionPanel(
  container: HTMLElement,
  options?: SubObjectSelectionPanelOptions
): SubObjectSelectionPanel {
  return new SubObjectSelectionPanel(container, options);
}
