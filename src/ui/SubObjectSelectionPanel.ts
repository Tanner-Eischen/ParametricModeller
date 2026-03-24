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
    this.container.style.display = 'flex';
    this.container.style.gap = '4px';
    this.container.style.padding = '4px';

    const modes: { mode: SubObjectType; label: string; title: string }[] = [
      { mode: 'body', label: 'B', title: 'Body selection' },
      { mode: 'face', label: 'F', title: 'Face selection' },
      { mode: 'edge', label: 'E', title: 'Edge selection' },
      { mode: 'vertex', label: 'V', title: 'Vertex selection' },
    ];

    for (const { mode, label, title } of modes) {
      const button = document.createElement('button');
      button.textContent = label;
      button.title = title;
      button.style.cssText = `
        padding: 4px 8px;
        border: 1px solid #444;
        border-radius: 4px;
        background: #2a2a2a;
        color: #ccc;
        cursor: pointer;
        font-size: 12px;
        min-width: 28px;
      `;

      button.addEventListener('click', () => this.setMode(mode));
      this.container.appendChild(button);
      this.buttons.set(mode, button);
    }
  }

  /**
   * Update button states based on current mode.
   */
  private updateButtonStates(): void {
    for (const [mode, button] of this.buttons) {
      if (mode === this.currentMode) {
        button.style.background = '#4a4a4a';
        button.style.color = '#fff';
        button.style.borderColor = '#666';
      } else {
        button.style.background = '#2a2a2a';
        button.style.color = '#ccc';
        button.style.borderColor = '#444';
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
