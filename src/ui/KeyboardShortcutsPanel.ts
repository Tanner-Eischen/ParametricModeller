/**
 * Keyboard shortcuts help panel.
 * Displays all available keyboard shortcuts in a modal overlay.
 */

import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('KeyboardShortcutsPanel');

/**
 * A keyboard shortcut entry.
 */
interface ShortcutEntry {
  /** The key combination (e.g., "Ctrl+S" or "B") */
  key: string;
  /** Description of what the shortcut does */
  action: string;
  /** Category for grouping */
  category: string;
}

/**
 * All keyboard shortcuts in the application.
 */
const SHORTCUTS: ShortcutEntry[] = [
  // Features
  { key: 'B', action: 'Add Box feature', category: 'Features' },
  { key: 'S', action: 'Add Sketch feature', category: 'Features' },
  { key: 'E', action: 'Extrude from last sketch', category: 'Features' },
  { key: 'C', action: 'Add Cut feature from last sketch', category: 'Features' },
  { key: 'F', action: 'Toggle face selection mode', category: 'Features' },
  { key: 'P', action: 'Enter push/pull mode', category: 'Features' },
  { key: 'L', action: 'Add Linear Pattern', category: 'Features' },
  { key: 'M', action: 'Add Mirror', category: 'Features' },
  { key: 'Ctrl+D', action: 'Duplicate selected feature/body', category: 'Features' },
  { key: 'V', action: 'Toggle vertex selection mode', category: 'Features' },
  { key: 'Shift+V', action: 'Add MoveVertex from selected vertex', category: 'Features' },

  // Assembly (Milestone 06)
  { key: 'Shift+G', action: 'Group features into component', category: 'Assembly' },
  { key: 'I', action: 'Add instance of selected component', category: 'Assembly' },

  // Editing
  { key: 'G', action: 'Toggle grid snap', category: 'Editing' },
  { key: 'Ctrl+Enter', action: 'Apply parameter changes', category: 'Editing' },
  { key: 'Delete', action: 'Delete selected', category: 'Editing' },

  // Navigation
  { key: 'Ctrl+P', action: 'Toggle camera projection', category: 'Navigation' },
  { key: 'Ctrl+R', action: 'Reset camera', category: 'Navigation' },
  { key: 'Ctrl+G', action: 'Toggle grid visibility', category: 'Navigation' },

  // File
  { key: 'Ctrl+S', action: 'Save document', category: 'File' },
  { key: 'Ctrl+O', action: 'Open document', category: 'File' },
  { key: 'Ctrl+N', action: 'New document', category: 'File' },

  // General
  { key: 'Escape', action: 'Exit mode / clear selection', category: 'General' },
  { key: '?', action: 'Show keyboard shortcuts', category: 'General' },
  { key: 'F1', action: 'Show keyboard shortcuts', category: 'General' },
];

/**
 * Options for the KeyboardShortcutsPanel.
 */
export interface KeyboardShortcutsPanelOptions {
  /** Container element to attach the panel to */
  container?: HTMLElement;
}

/**
 * A panel that displays keyboard shortcuts.
 */
export class KeyboardShortcutsPanel {
  private container: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private isVisible = false;

  constructor(options?: KeyboardShortcutsPanelOptions) {
    if (options?.container) {
      this.attachTo(options.container);
    }
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
    if (this.isVisible || !this.container) return;

    this.overlay = document.createElement('div');
    this.overlay.id = 'keyboard-shortcuts-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1e1e1e;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #444;
    `;
    header.innerHTML = `
      <h2 style="margin: 0; color: #fff; font-size: 18px; font-weight: 600;">Keyboard Shortcuts</h2>
      <span style="color: #888; font-size: 12px;">Press Escape or click outside to close</span>
    `;
    panel.appendChild(header);

    // Group shortcuts by category
    const categories = new Map<string, ShortcutEntry[]>();
    for (const shortcut of SHORTCUTS) {
      const list = categories.get(shortcut.category) ?? [];
      list.push(shortcut);
      categories.set(shortcut.category, list);
    }

    // Render each category
    const categoryOrder = ['Features', 'Assembly', 'Editing', 'Navigation', 'File', 'General'];
    for (const categoryName of categoryOrder) {
      const shortcuts = categories.get(categoryName);
      if (!shortcuts) continue;

      const categoryDiv = document.createElement('div');
      categoryDiv.style.cssText = `margin-bottom: 16px;`;

      const categoryHeader = document.createElement('div');
      categoryHeader.style.cssText = `
        color: #888;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      `;
      categoryHeader.textContent = categoryName;
      categoryDiv.appendChild(categoryHeader);

      const table = document.createElement('table');
      table.style.cssText = `
        width: 100%;
        border-collapse: collapse;
      `;

      for (const shortcut of shortcuts) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td style="
            padding: 6px 12px 6px 0;
            color: #fff;
            font-size: 13px;
          ">${this.formatKey(shortcut.key)}</td>
          <td style="
            padding: 6px 0;
            color: #aaa;
            font-size: 13px;
          ">${shortcut.action}</td>
        `;
        table.appendChild(row);
      }

      categoryDiv.appendChild(table);
      panel.appendChild(categoryDiv);
    }

    this.overlay.appendChild(panel);
    this.container.appendChild(this.overlay);
    this.isVisible = true;

    // Close on click outside
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    log.debug('Keyboard shortcuts panel shown');
  }

  /**
   * Hide the keyboard shortcuts panel.
   */
  hide(): void {
    if (!this.isVisible || !this.overlay) return;

    this.overlay.remove();
    this.overlay = null;
    this.isVisible = false;

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
    return `<kbd style="
      background: #333;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 2px 8px;
      font-family: monospace;
      font-size: 12px;
      color: #fff;
      white-space: nowrap;
    ">${key}</kbd>`;
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
