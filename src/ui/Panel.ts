import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('Panel');

export interface PanelOptions {
  title?: string;
  collapsible?: boolean;
}

export class Panel {
  private _container: HTMLElement;
  private header: HTMLElement;
  private content: HTMLElement;
  private collapsed = false;

  constructor(container: HTMLElement, options: PanelOptions = {}) {
    this._container = container;

    // Find or create header/content elements
    this.header = this._container.querySelector('.panel-header') as HTMLElement;
    this.content = this._container.querySelector('.panel-content') as HTMLElement;

    if (options.title) {
      this.setTitle(options.title);
    }

    if (options.collapsible) {
      this.setupCollapsible();
    }

    log.debug('Panel initialized');
  }

  private setupCollapsible(): void {
    this.header.style.cursor = 'pointer';
    this.header.addEventListener('click', () => this.toggle());
  }

  setTitle(title: string): void {
    this.header.textContent = title;
  }

  setContent(html: string): void {
    this.content.innerHTML = html;
  }

  appendContent(element: HTMLElement): void {
    this.content.appendChild(element);
  }

  clearContent(): void {
    this.content.innerHTML = '';
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.content.style.display = this.collapsed ? 'none' : 'block';
    log.debug('Panel toggled', { collapsed: this.collapsed });
  }

  expand(): void {
    this.collapsed = false;
    this.content.style.display = 'block';
  }

  collapse(): void {
    this.collapsed = true;
    this.content.style.display = 'none';
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }
}
