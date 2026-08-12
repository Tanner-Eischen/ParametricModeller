import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { Diagnostic } from '../features';
import { formatDiagnostic, getErrors, getWarnings } from '../features';

const log = createModuleLogger('DiagnosticsPanel');

/**
 * Options for the DiagnosticsPanel.
 */
export interface DiagnosticsPanelOptions {
  container: HTMLElement;
}

/**
 * Panel displaying diagnostics (errors and warnings).
 */
export class DiagnosticsPanel {
  private container: HTMLElement;
  private contentElement: HTMLElement;
  private announcementElement: HTMLSpanElement;
  private diagnostics: Diagnostic[] = [];
  private lastAnnouncement = '';

  constructor(options: DiagnosticsPanelOptions) {
    this.container = options.container;
    this.contentElement = this.createContentElement();
    this.announcementElement = this.createAnnouncementElement();
    this.container.appendChild(this.contentElement);
    this.container.appendChild(this.announcementElement);
    this.setupEventListeners();
    log.debug('DiagnosticsPanel initialized');
  }

  private createAnnouncementElement(): HTMLSpanElement {
    const announcement = document.createElement('span');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.setAttribute('aria-label', 'Diagnostics summary');
    announcement.style.cssText = [
      'position:absolute',
      'width:1px',
      'height:1px',
      'padding:0',
      'margin:-1px',
      'overflow:hidden',
      'clip:rect(0,0,0,0)',
      'white-space:nowrap',
      'border:0',
    ].join(';');
    return announcement;
  }

  private createContentElement(): HTMLElement {
    const content = document.createElement('div');
    content.className = 'diagnostics-panel';
    content.setAttribute('role', 'region');
    content.setAttribute('aria-label', 'Model diagnostics');
    content.style.cssText = `
      display: flex;
      flex-direction: column;
      padding: 8px;
      gap: 4px;
      overflow-y: auto;
      max-height: 200px;
    `;
    return content;
  }

  private setupEventListeners(): void {
    eventBus.on('rebuild:complete', ({ diagnostics }) => {
      this.setDiagnostics(diagnostics as Diagnostic[]);
    });

    eventBus.on('rebuild:failed', ({ diagnostics }) => {
      this.setDiagnostics(diagnostics as Diagnostic[]);
    });
  }

  /**
   * Set the diagnostics to display.
   */
  setDiagnostics(diagnostics: Diagnostic[]): void {
    this.diagnostics = diagnostics;
    this.render();
    this.announceSummary();
    log.debug('Diagnostics updated', { count: diagnostics.length });
  }

  /**
   * Clear all diagnostics.
   */
  clear(): void {
    this.diagnostics = [];
    this.render();
    this.announceSummary();
  }

  private announceSummary(): void {
    const errors = this.errorCount;
    const warnings = this.warningCount;
    const summary = errors === 0 && warnings === 0
      ? 'Model diagnostics clear'
      : `Model diagnostics: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
    if (summary === this.lastAnnouncement) return;
    this.lastAnnouncement = summary;
    this.announcementElement.textContent = summary;
  }

  /**
   * Get error count.
   */
  get errorCount(): number {
    return getErrors(this.diagnostics).length;
  }

  /**
   * Get warning count.
   */
  get warningCount(): number {
    return getWarnings(this.diagnostics).length;
  }

  /**
   * Render the panel.
   */
  private render(): void {
    this.contentElement.innerHTML = '';

    if (this.diagnostics.length === 0) {
      this.renderEmpty();
      return;
    }

    // Summary header
    const header = this.renderHeader();
    this.contentElement.appendChild(header);

    // Diagnostic items
    for (const d of this.diagnostics) {
      const item = this.renderDiagnostic(d);
      this.contentElement.appendChild(item);
    }
  }

  /**
   * Render empty state.
   */
  private renderEmpty(): void {
    const empty = document.createElement('div');
    empty.textContent = 'No issues';
    empty.style.cssText = 'color: #4ade80; padding: 8px; text-align: center; font-size: 12px;';
    this.contentElement.appendChild(empty);
  }

  /**
   * Render summary header.
   */
  private renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      gap: 12px;
      padding: 4px 0;
      border-bottom: 1px solid #333;
      margin-bottom: 4px;
      font-size: 11px;
    `;

    const errors = getErrors(this.diagnostics);
    const warnings = getWarnings(this.diagnostics);

    if (errors.length > 0) {
      const errBadge = document.createElement('span');
      errBadge.textContent = `${errors.length} error${errors.length !== 1 ? 's' : ''}`;
      errBadge.style.cssText = 'color: #ff6b6b;';
      header.appendChild(errBadge);
    }

    if (warnings.length > 0) {
      const warnBadge = document.createElement('span');
      warnBadge.textContent = `${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`;
      warnBadge.style.cssText = 'color: #feca57;';
      header.appendChild(warnBadge);
    }

    return header;
  }

  /**
   * Render a single diagnostic.
   */
  private renderDiagnostic(d: Diagnostic): HTMLElement {
    const isActionable = d.featureId !== undefined;
    const item = document.createElement(isActionable ? 'button' : 'div');
    if (item instanceof HTMLButtonElement) {
      item.type = 'button';
      item.setAttribute('aria-label', `${formatDiagnostic(d)}. Select affected feature.`);
    }
    item.style.cssText = `
      display: block;
      width: 100%;
      margin: 0;
      padding: 6px 8px;
      border-radius: 4px;
      background: ${d.severity === 'error' ? '#3a1a1a' : '#3a3a1a'};
      border-top: none;
      border-right: none;
      border-bottom: none;
      border-left: 3px solid ${d.severity === 'error' ? '#ff6b6b' : '#feca57'};
      font-size: 11px;
      font-family: inherit;
      text-align: left;
      cursor: ${isActionable ? 'pointer' : 'default'};
    `;

    // Click to select the feature
    if (d.featureId !== undefined) {
      const featureId = d.featureId;
      item.addEventListener('click', () => {
        eventBus.emit('feature:selected', { featureId });
      });
    }

    const text = document.createElement('div');
    text.textContent = formatDiagnostic(d);
    text.style.cssText = 'color: #ddd;';
    item.appendChild(text);

    return item;
  }

  /**
   * Dispose the panel.
   */
  dispose(): void {
    this.container.removeChild(this.contentElement);
    log.debug('DiagnosticsPanel disposed');
  }
}
