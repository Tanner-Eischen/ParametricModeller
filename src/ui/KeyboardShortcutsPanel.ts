/**
 * Keyboard shortcuts help panel.
 * Displays available commands and basic workflow guidance in a modal overlay.
 */

import { createModuleLogger } from '../core/logger';
import {
  MOUSE_HELP,
  SHORTCUT_CATEGORY_ORDER,
  getShortcutHelpEntries,
} from './CommandCatalog';

const log = createModuleLogger('KeyboardShortcutsPanel');

const GENERAL_TIPS = [
  'Use the top toolbar for feature creation if you do not want to memorize shortcuts.',
  'Click a body to select it. Hold Shift while clicking to add or remove from the selection.',
  'Select a feature in the left panel to edit its parameters in the property inspector.',
  'Use Edit > Undo and Edit > Redo to step backward and forward through feature history.',
  'Use the Sketch setup panel to pick XY/XZ/YZ, sketch on a face, and add rectangle or line primitives.',
  'In vertex mode, clicking a vertex opens an in-viewport Move Vertex prompt so you do not have to hunt for the next tool.',
  'Press Escape to exit the current mode or clear the current selection.',
];

const DISCOVERY_SECTIONS = [
  {
    title: 'Selection modes',
    rows: [
      {
        label: 'Body / Face / Edge / Vertex',
        action: 'Use the selection-mode buttons in the left panel to switch what the viewport can pick.',
      },
      {
        label: 'Vertex mode',
        action: 'Use vertex selection for guarded vertex editing. Picking a vertex opens a Move Vertex prompt, and active features expose drag arrows in the viewport.',
      },
      {
        label: 'Rotate / Join',
        action: 'Select one body to rotate it, or select two or more bodies and press J to join them.',
      },
    ],
  },
  {
    title: 'File workflow',
    rows: [
      {
        label: 'Open',
        action: 'Open a saved document from File > Open; recently used documents stay available there.',
      },
      {
        label: 'Recent files',
        action: 'Use the recent-files panel or File menu to reopen documents quickly.',
      },
      {
        label: 'Save',
        action: 'Save early and often so the current history tree is easy to return to.',
      },
    ],
  },
  {
    title: 'Sketch workflow',
    rows: [
      {
        label: 'Sketch setup',
        action: 'Use the sketch setup panel to pick a plane, sketch on a face, or add rectangle and line primitives.',
      },
      {
        label: 'Plane picker',
        action: 'XY, XZ, and YZ are the quickest starting points for a new profile.',
      },
      {
        label: 'Line loops',
        action: 'Use Line to click each corner of a custom profile, then click near the first point to close the loop before extruding it.',
      },
      {
        label: 'Fit View',
        action: 'Use the toolbar to zoom to the current model extents.',
      },
    ],
  },
] as const;

/**
 * Options for the KeyboardShortcutsPanel.
 */
export interface KeyboardShortcutsPanelOptions {
  /** Container element to attach the panel to */
  container?: HTMLElement;
  /** Invoked when panel visibility changes */
  onVisibilityChange?: (visible: boolean) => void;
  /** Invoked when Quick Start link is clicked */
  onShowQuickStart?: () => void;
}

/**
 * A panel that displays keyboard shortcuts.
 */
export class KeyboardShortcutsPanel {
  private container: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private isVisible = false;
  private onVisibilityChange: ((visible: boolean) => void) | undefined;
  private onShowQuickStart: (() => void) | undefined;

  constructor(options?: KeyboardShortcutsPanelOptions) {
    if (options?.container) {
      this.attachTo(options.container);
    }
    this.onVisibilityChange = options?.onVisibilityChange;
    this.onShowQuickStart = options?.onShowQuickStart;
    log.debug('KeyboardShortcutsPanel created');
  }

  /**
   * Attach the panel to a container element.
   */
  attachTo(container: HTMLElement): void {
    this.container = container;
  }

  /**
   * Show the keyboard shortcuts panel.
   */
  show(): void {
    if (this.isVisible || !this.container) {
      return;
    }

    this.overlay = document.createElement('div');
    this.overlay.id = 'keyboard-shortcuts-overlay';
    this.overlay.className = 'help-overlay';

    const panel = document.createElement('div');
    panel.className = 'help-panel';

    const header = document.createElement('div');
    header.className = 'help-panel-header';
    header.innerHTML = `
      <div>
        <p class="help-panel-eyebrow">Help</p>
        <h2 class="help-panel-title">Commands and shortcuts</h2>
      </div>
      <span class="help-panel-close-hint">Press Escape or click outside to close</span>
    `;
    panel.appendChild(header);

    const intro = document.createElement('div');
    intro.className = 'help-panel-intro';
    intro.innerHTML = `
      <p>The toolbar exposes the same commands as the keyboard shortcuts below.</p>
      <ul>
        ${GENERAL_TIPS.map((tip) => `<li>${tip}</li>`).join('')}
      </ul>
    `;
    panel.appendChild(intro);

    const helpEntries = getShortcutHelpEntries();
    for (const categoryName of SHORTCUT_CATEGORY_ORDER) {
      const shortcuts = helpEntries.filter((entry) => entry.category === categoryName);
      if (shortcuts.length === 0) {
        continue;
      }

      const categoryDiv = document.createElement('section');
      categoryDiv.className = 'help-panel-section';

      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'help-panel-section-title';
      categoryHeader.textContent = categoryName;
      categoryDiv.appendChild(categoryHeader);

      const table = document.createElement('table');
      table.className = 'help-panel-table';

      for (const shortcut of shortcuts) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td class="help-panel-keycell">${this.formatKey(shortcut.key)}</td>
          <td class="help-panel-actioncell">
            <span>${shortcut.action}</span>
          </td>
        `;
        table.appendChild(row);
      }

      categoryDiv.appendChild(table);
      panel.appendChild(categoryDiv);
    }

    for (const section of DISCOVERY_SECTIONS) {
      const discoverySection = document.createElement('section');
      discoverySection.className = 'help-panel-section';

      const discoveryHeader = document.createElement('div');
      discoveryHeader.className = 'help-panel-section-title';
      discoveryHeader.textContent = section.title;
      discoverySection.appendChild(discoveryHeader);

      const discoveryTable = document.createElement('table');
      discoveryTable.className = 'help-panel-table';

      for (const rowData of section.rows) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td class="help-panel-keycell">${rowData.label}</td>
          <td class="help-panel-actioncell"><span>${rowData.action}</span></td>
        `;
        discoveryTable.appendChild(row);
      }

      discoverySection.appendChild(discoveryTable);
      panel.appendChild(discoverySection);
    }

    const mouseSection = document.createElement('section');
    mouseSection.className = 'help-panel-section';

    const mouseHeader = document.createElement('div');
    mouseHeader.className = 'help-panel-section-title';
    mouseHeader.textContent = 'Mouse';
    mouseSection.appendChild(mouseHeader);

    const mouseTable = document.createElement('table');
    mouseTable.className = 'help-panel-table';

    for (const tip of MOUSE_HELP) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="help-panel-keycell">${this.formatKey(tip.gesture)}</td>
        <td class="help-panel-actioncell"><span>${tip.action}</span></td>
      `;
      mouseTable.appendChild(row);
    }

    mouseSection.appendChild(mouseTable);
    panel.appendChild(mouseSection);

    // Quick start link section
    const quickSection = document.createElement('section');
    quickSection.className = 'help-panel-section';

    const quickHeader = document.createElement('div');
    quickHeader.className = 'help-panel-section-title';
    quickHeader.textContent = 'Quick start';
    quickSection.appendChild(quickHeader);

    const quickLink = document.createElement('a');
    quickLink.href = '#';
    quickLink.textContent = 'Show Quick Start overlay again';
    quickLink.style.display = 'block';
    quickLink.style.marginTop = '8px';
    quickLink.style.color = '#5da9ff';
    quickLink.style.textDecoration = 'underline';
    quickLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.hide();
      this.onShowQuickStart?.();
    });
    quickSection.appendChild(quickLink);
    panel.appendChild(quickSection);

    this.overlay.appendChild(panel);
    this.container.appendChild(this.overlay);
    this.isVisible = true;
    this.onVisibilityChange?.(true);

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.hide();
      }
    });

    log.debug('Keyboard shortcuts panel shown');
  }

  /**
   * Hide the keyboard shortcuts panel.
   */
  hide(): void {
    if (!this.isVisible || !this.overlay) {
      return;
    }

    this.overlay.remove();
    this.overlay = null;
    this.isVisible = false;
    this.onVisibilityChange?.(false);

    log.debug('Keyboard shortcuts panel hidden');
  }

  /**
   * Toggle the panel visibility.
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Check if the panel is currently visible.
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Format a key combination for display.
   */
  private formatKey(key: string): string {
    return `<kbd class="help-panel-kbd">${key}</kbd>`;
  }

  /**
   * Dispose of the panel.
   */
  dispose(): void {
    this.hide();
    this.container = null;
    log.debug('KeyboardShortcutsPanel disposed');
  }
}

/**
 * Create a keyboard shortcuts panel.
 */
export function createKeyboardShortcutsPanel(
  options?: KeyboardShortcutsPanelOptions
): KeyboardShortcutsPanel {
  return new KeyboardShortcutsPanel(options);
}
