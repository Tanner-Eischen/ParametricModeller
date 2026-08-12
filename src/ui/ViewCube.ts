import {
  NAMED_VIEW_ORDER,
  NAMED_VIEWS,
  type NamedViewId,
} from '../rendering/NamedViews';

export interface ViewCubeOptions {
  container?: HTMLElement;
  onSelect: (view: NamedViewId) => void;
  initialView?: NamedViewId | null;
}

const KEYBOARD_VIEWS: Readonly<Partial<Record<string, NamedViewId>>> = {
  ArrowUp: 'top',
  ArrowDown: 'bottom',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'isometric',
  f: 'front',
  b: 'back',
  t: 'top',
  l: 'left',
  r: 'right',
  i: 'isometric',
};

export class ViewCube {
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private readonly buttons = new Map<NamedViewId, HTMLButtonElement>();
  private readonly onSelect: (view: NamedViewId) => void;
  private activeView: NamedViewId | null;
  private pointerSelection: NamedViewId | null = null;

  constructor(options: ViewCubeOptions) {
    this.onSelect = options.onSelect;
    this.activeView = options.initialView ?? null;

    if (options.container) {
      this.attachTo(options.container);
    }
  }

  attachTo(container: HTMLElement): void {
    this.dispose();
    this.container = container;
    this.render();
  }

  setActiveView(view: NamedViewId | null): void {
    this.activeView = view;
    for (const [id, button] of this.buttons) {
      const isActive = id === view;
      button.dataset.active = String(isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  getActiveView(): NamedViewId | null {
    return this.activeView;
  }

  focus(): void {
    this.root?.focus();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.container = null;
    this.buttons.clear();
  }

  private render(): void {
    if (!this.container) {
      return;
    }

    const root = document.createElement('div');
    root.className = 'view-cube';
    root.dataset.testid = 'view-cube';
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Named camera views');
    root.addEventListener('keydown', (event) => this.handleKeyDown(event));

    for (const id of NAMED_VIEW_ORDER) {
      const definition = NAMED_VIEWS[id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `view-cube__view view-cube__view--${id}`;
      button.dataset.testid = `view-cube-${id}`;
      button.dataset.view = id;
      button.title = `${definition.label} view`;
      button.setAttribute('aria-label', `${definition.label} view`);
      button.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        this.pointerSelection = id;
        this.select(id);
      });
      button.addEventListener('click', () => {
        if (this.pointerSelection === id) {
          this.pointerSelection = null;
          return;
        }
        this.select(id);
      });
      button.addEventListener('pointercancel', () => {
        this.pointerSelection = null;
      });
      button.textContent = this.getButtonLabel(id);
      this.buttons.set(id, button);
      root.appendChild(button);
    }

    this.root = root;
    this.container.appendChild(root);
    this.setActiveView(this.activeView);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const view = KEYBOARD_VIEWS[event.key] ?? KEYBOARD_VIEWS[event.key.toLowerCase()];
    if (!view) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.select(view);
  }

  private select(view: NamedViewId): void {
    this.setActiveView(view);
    this.onSelect(view);
  }

  private getButtonLabel(view: NamedViewId): string {
    switch (view) {
      case 'top': return 'T';
      case 'front': return 'F';
      case 'right': return 'R';
      case 'back': return 'B';
      case 'left': return 'L';
      case 'bottom': return 'U';
      case 'isometric': return 'Iso';
    }
  }
}
