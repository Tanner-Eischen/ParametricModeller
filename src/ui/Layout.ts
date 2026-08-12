import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Layout');

export interface LayoutOptions {
  panelWidth?: number;
  taskPanelWidth?: number;
  collapsedPanelWidth?: number;
  statusBarHeight?: number;
  initialSidebarCollapsed?: Partial<Record<SidebarSide, boolean>>;
  onSidebarChange?: (side: SidebarSide, collapsed: boolean, width: number) => void;
}

export type SidebarSide = 'left' | 'right';

export class Layout {
  private container: HTMLElement;
  private toolbar: HTMLElement;
  private panelLeft: HTMLElement;
  private panelRight: HTMLElement;
  private viewport: HTMLElement;
  private statusBar: HTMLElement;
  private options: Required<LayoutOptions>;
  private sidebarToggleButtons: Record<SidebarSide, HTMLButtonElement>;
  private readonly onSidebarChange?: LayoutOptions['onSidebarChange'];
  private sidebarCollapsed: Record<SidebarSide, boolean> = {
    left: false,
    right: false,
  };
  private lastExpandedSidebar: SidebarSide | null = null;

  constructor(container: HTMLElement, options: LayoutOptions = {}) {
    this.container = container;
    this.onSidebarChange = options.onSidebarChange;
    this.options = {
      panelWidth: options.panelWidth ?? 250,
      taskPanelWidth: options.taskPanelWidth ?? 300,
      collapsedPanelWidth: options.collapsedPanelWidth ?? 36,
      statusBarHeight: options.statusBarHeight ?? 24,
      initialSidebarCollapsed: options.initialSidebarCollapsed ?? {},
      onSidebarChange: options.onSidebarChange ?? (() => {}),
    };
    this.sidebarCollapsed = {
      left: options.initialSidebarCollapsed?.left ?? false,
      right: options.initialSidebarCollapsed?.right ?? false,
    };

    this.toolbar = this.container.querySelector('#toolbar') as HTMLElement;
    this.panelLeft = this.container.querySelector('#panel-left') as HTMLElement;
    this.panelRight = this.container.querySelector('#panel-right') as HTMLElement;
    this.viewport = this.container.querySelector('#viewport') as HTMLElement;
    this.statusBar = this.container.querySelector('#status-bar') as HTMLElement;

    this.sidebarToggleButtons = {
      left: this.createSidebarToggle('left'),
      right: this.createSidebarToggle('right'),
    };
    document.addEventListener('keydown', (event) => this.handleDocumentKeyDown(event));

    this.applyLayout();
    log.debug('Layout initialized');
  }

  private applyLayout(): void {
    this.applySidebarState('left');
    this.applySidebarState('right');
    this.statusBar.style.height = `${this.options.statusBarHeight}px`;
  }

  private createSidebarToggle(side: SidebarSide): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sidebar-collapse-control sidebar-collapse-control--${side}`;
    button.dataset.testid = `${side}-sidebar-toggle`;
    button.setAttribute('aria-controls', `panel-${side}`);
    button.addEventListener('click', () => this.toggleSidebar(side));
    this.getSidebar(side).prepend(button);
    return button;
  }

  private getSidebar(side: SidebarSide): HTMLElement {
    return side === 'left' ? this.panelLeft : this.panelRight;
  }

  private getExpandedSidebarWidth(side: SidebarSide): number {
    return side === 'left' ? this.options.panelWidth : this.options.taskPanelWidth;
  }

  private applySidebarState(side: SidebarSide): void {
    const panel = this.getSidebar(side);
    const button = this.sidebarToggleButtons[side];
    const collapsed = this.sidebarCollapsed[side];
    const action = collapsed ? 'Expand' : 'Collapse';
    const name = side === 'left' ? 'model browser' : 'task panel';

    panel.dataset.collapsed = String(collapsed);
    panel.style.width = `${collapsed ? this.options.collapsedPanelWidth : this.getExpandedSidebarWidth(side)}px`;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${action} ${name}`);
    button.title = `${action} ${name}`;
    button.textContent = this.getToggleGlyph(side, collapsed);
  }

  private getToggleGlyph(side: SidebarSide, collapsed: boolean): string {
    if (side === 'left') {
      return collapsed ? '\u203a' : '\u2039';
    }
    return collapsed ? '\u2039' : '\u203a';
  }

  private notifyViewportResize(): void {
    this.viewport.dispatchEvent(new CustomEvent('layout:resize', {
      bubbles: false,
      detail: this.getViewportSize(),
    }));
    window.dispatchEvent(new Event('resize'));
  }

  getPanelLeft(): HTMLElement {
    return this.panelLeft;
  }

  getToolbar(): HTMLElement {
    return this.toolbar;
  }

  getPanelRight(): HTMLElement {
    return this.panelRight;
  }

  getViewport(): HTMLElement {
    return this.viewport;
  }

  getStatusBar(): HTMLElement {
    return this.statusBar;
  }

  setPanelWidth(width: number): void {
    this.options.panelWidth = width;
    this.applySidebarState('left');
    this.notifyViewportResize();
    this.onSidebarChange?.('left', this.sidebarCollapsed.left, width);
    log.debug('Panel width changed', { width });
  }

  setTaskPanelWidth(width: number): void {
    this.options.taskPanelWidth = width;
    this.applySidebarState('right');
    this.notifyViewportResize();
    this.onSidebarChange?.('right', this.sidebarCollapsed.right, width);
    log.debug('Task panel width changed', { width });
  }

  setSidebarCollapsed(side: SidebarSide, collapsed: boolean): void {
    if (this.sidebarCollapsed[side] === collapsed) {
      return;
    }

    this.sidebarCollapsed[side] = collapsed;
    if (!collapsed) this.lastExpandedSidebar = side;
    this.applySidebarState(side);
    this.notifyViewportResize();
    this.onSidebarChange?.(side, collapsed, this.getExpandedSidebarWidth(side));
    log.debug('Sidebar state changed', { side, collapsed });
  }

  toggleSidebar(side: SidebarSide): void {
    this.setSidebarCollapsed(side, !this.sidebarCollapsed[side]);
  }

  collapseSidebar(side: SidebarSide): void {
    this.setSidebarCollapsed(side, true);
  }

  expandSidebar(side: SidebarSide): void {
    this.setSidebarCollapsed(side, false);
  }

  isSidebarCollapsed(side: SidebarSide): boolean {
    return this.sidebarCollapsed[side];
  }

  getViewportSize(): { width: number; height: number } {
    return {
      width: this.viewport.clientWidth,
      height: this.viewport.clientHeight,
    };
  }

  private handleDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || window.innerWidth >= 1200) return;
    const candidates: SidebarSide[] = this.lastExpandedSidebar
      ? [this.lastExpandedSidebar, this.lastExpandedSidebar === 'left' ? 'right' : 'left']
      : ['right', 'left'];
    const side = candidates.find((candidate) =>
      !this.sidebarCollapsed[candidate] && (candidate === 'right' || window.innerWidth < 768)
    );
    if (!side) return;
    event.preventDefault();
    this.collapseSidebar(side);
    this.sidebarToggleButtons[side].focus();
  }
}
