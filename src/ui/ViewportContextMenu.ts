/**
 * Right-click context menu for viewport interactions.
 * Extracted from App.ts for modularity.
 *
 * Pattern: injected deps (getters for reads, action callbacks for writes),
 * self-contained behavior, no App state ownership.
 */

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  separator?: boolean;
  [key: string]: unknown;
}

export interface ViewportContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  selectionInfo?: { kind: string; name: string } | null;
}

export interface ViewportContextMenuOptions {
  initialState?: ViewportContextMenuState;
  onAction?: (actionId: string) => void;
  onClose?: () => void;
}

export class ViewportContextMenu {
  private readonly container: HTMLElement;
  private readonly options: ViewportContextMenuOptions;
  private root: HTMLElement | null = null;
  private state: ViewportContextMenuState;

  constructor(container: HTMLElement, options: ViewportContextMenuOptions = {}) {
    this.container = container;
    this.options = options;
    this.state = options.initialState ?? {
      visible: false,
      x: 0,
      y: 0,
      items: [],
    };
  }

  /** Open the context menu at the given position */
  open(items: ContextMenuItem[], x: number, y: number, selectionInfo?: { kind: string; name: string }): void {
    this.state = {
      visible: true,
      x,
      y,
      items,
      selectionInfo: selectionInfo || null,
    };
    this.render();
  }

  /** Close the context menu */
  close(): void {
    this.state = { ...this.state, visible: false };
    this.render();
  }

  isVisible(): boolean {
    return this.state.visible;
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
  }

  private render(): void {
    if (!this.state.visible) {
      this.root?.remove();
      this.root = null;
      this.options.onClose?.();
      return;
    }

    if (!this.root) {
      this.root = document.createElement('div');
      this.root.className = 'viewport-context-menu';
      this.root.setAttribute('role', 'menu');
      this.root.setAttribute('aria-label', 'Viewport actions');
      this.container.appendChild(this.root);

      // Close on outside click
      const handleClickOutside = (event: Event) => {
        if (this.root && !this.root.contains(event.target as Node)) {
          this.close();
        }
      };
      document.addEventListener('mousedown', handleClickOutside);

      // Close on escape
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && this.state.visible) {
          this.close();
        }
      };
      document.addEventListener('keydown', handleEscape);

      // Cleanup on component dispose
      const originalDispose = this.dispose.bind(this);
      this.dispose = () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
        originalDispose();
      };
    }

    this.root.style.left = `${this.state.x}px`;
    this.root.style.top = `${this.state.y}px`;

    // Render menu items
    this.root.replaceChildren();

    if (this.state.selectionInfo) {
      const header = document.createElement('div');
      header.className = 'viewport-context-menu__header';
      header.textContent = `${this.state.selectionInfo.kind}: ${this.state.selectionInfo.name}`;
      this.root.appendChild(header);
    }

    let hasItems = false;
    for (const item of this.state.items) {
      if (item.separator) {
        const separator = document.createElement('hr');
        separator.className = 'viewport-context-menu__separator';
        this.root.appendChild(separator);
        continue;
      }

      hasItems = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'viewport-context-menu__item';
      button.textContent = item.label;
      button.dataset.testid = `context-menu-${item.id}`;
      button.disabled = item.disabled ?? false;
      button.addEventListener('click', () => {
        if (!item.disabled) {
          this.close();
          this.options.onAction?.(item.id);
        }
      });
      this.root.appendChild(button);
    }

    if (!hasItems) {
      const empty = document.createElement('div');
      empty.className = 'viewport-context-menu__empty';
      empty.textContent = 'No actions available';
      this.root.appendChild(empty);
    }
  }
}

export function createViewportContextMenu(
  options?: ViewportContextMenuOptions,
): ViewportContextMenu {
  return new ViewportContextMenu(document.body, options);
}
