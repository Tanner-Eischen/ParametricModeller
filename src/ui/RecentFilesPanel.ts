import { createModuleLogger } from '../core/logger';
import type { RecentFileEntry } from '../persistence';

const log = createModuleLogger('RecentFilesPanel');

export interface RecentFilesPanelOptions {
  container?: HTMLElement;
  recentFiles?: RecentFileEntry[];
  onOpenRecent?: (entry: RecentFileEntry) => void;
  onClearRecent?: () => void;
}

export class RecentFilesPanel {
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private recentFiles: RecentFileEntry[] = [];
  private onOpenRecent: ((entry: RecentFileEntry) => void) | undefined;
  private onClearRecent: (() => void) | undefined;

  constructor(options: RecentFilesPanelOptions = {}) {
    this.recentFiles = [...(options.recentFiles ?? [])];
    this.onOpenRecent = options.onOpenRecent;
    this.onClearRecent = options.onClearRecent;

    if (options.container) {
      this.attachTo(options.container);
    }
  }

  attachTo(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  setRecentFiles(entries: RecentFileEntry[]): void {
    this.recentFiles = [...entries];
    this.render();
  }

  refresh(): void {
    this.render();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.container = null;
    log.debug('RecentFilesPanel disposed');
  }

  private render(): void {
    if (!this.container) {
      return;
    }

    this.root?.remove();
    this.root = document.createElement('section');
    this.root.className = 'recent-files-panel';

    const header = document.createElement('div');
    header.className = 'recent-files-panel__header';

    const title = document.createElement('div');
    title.className = 'recent-files-panel__title';
    title.textContent = 'Recent files';
    header.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'recent-files-panel__description';
    subtitle.textContent = 'Quickly reopen documents you have already worked on.';
    header.appendChild(subtitle);

    this.root.appendChild(header);

    if (this.recentFiles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recent-files-panel__empty';
      empty.textContent =
        'No recent files yet. Open a document once and it will appear here for fast reopening.';
      this.root.appendChild(empty);
      this.container.appendChild(this.root);
      return;
    }

    const list = document.createElement('div');
    list.className = 'recent-files-panel__list';

    for (const entry of this.recentFiles) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-files-panel__item';
      button.title = entry.path;
      button.addEventListener('click', () => this.onOpenRecent?.(entry));

      const name = document.createElement('span');
      name.className = 'recent-files-panel__item-name';
      name.textContent = entry.name;
      button.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'recent-files-panel__item-meta';
      meta.textContent = `${entry.path} | ${new Date(entry.lastOpened).toLocaleString()}`;
      button.appendChild(meta);

      if (!this.onOpenRecent) {
        button.disabled = true;
      }

      list.appendChild(button);
    }

    this.root.appendChild(list);

    if (this.onClearRecent) {
      const footer = document.createElement('div');
      footer.className = 'recent-files-panel__footer';

      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'recent-files-panel__clear';
      clearButton.textContent = 'Clear recent files';
      clearButton.addEventListener('click', () => this.onClearRecent?.());
      footer.appendChild(clearButton);

      this.root.appendChild(footer);
    }

    this.container.appendChild(this.root);
    log.debug('RecentFilesPanel rendered', { count: this.recentFiles.length });
  }
}

export function createRecentFilesPanel(options: RecentFilesPanelOptions = {}): RecentFilesPanel {
  return new RecentFilesPanel(options);
}
