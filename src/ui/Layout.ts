import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Layout');

export interface LayoutOptions {
  panelWidth?: number;
  statusBarHeight?: number;
}

export class Layout {
  private container: HTMLElement;
  private panelLeft: HTMLElement;
  private viewport: HTMLElement;
  private statusBar: HTMLElement;
  private options: Required<LayoutOptions>;

  constructor(container: HTMLElement, options: LayoutOptions = {}) {
    this.container = container;
    this.options = {
      panelWidth: options.panelWidth ?? 250,
      statusBarHeight: options.statusBarHeight ?? 24,
    };

    this.panelLeft = this.container.querySelector('#panel-left') as HTMLElement;
    this.viewport = this.container.querySelector('#viewport') as HTMLElement;
    this.statusBar = this.container.querySelector('#status-bar') as HTMLElement;

    this.applyLayout();
    log.debug('Layout initialized');
  }

  private applyLayout(): void {
    this.panelLeft.style.width = `${this.options.panelWidth}px`;
    this.statusBar.style.height = `${this.options.statusBarHeight}px`;
  }

  getPanelLeft(): HTMLElement {
    return this.panelLeft;
  }

  getViewport(): HTMLElement {
    return this.viewport;
  }

  getStatusBar(): HTMLElement {
    return this.statusBar;
  }

  setPanelWidth(width: number): void {
    this.options.panelWidth = width;
    this.panelLeft.style.width = `${width}px`;
    this.viewport.style.marginLeft = `${width}px`;
    log.debug('Panel width changed', { width });
  }

  getViewportSize(): { width: number; height: number } {
    return {
      width: this.viewport.clientWidth,
      height: this.viewport.clientHeight,
    };
  }
}
