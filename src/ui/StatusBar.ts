import { eventBus } from '../core/eventBus';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('StatusBar');

export class StatusBar {
  private _container: HTMLElement;
  private leftSection: HTMLElement;
  private centerSection: HTMLElement;
  private rightSection: HTMLElement;

  constructor(container: HTMLElement) {
    this._container = container;

    this.leftSection = this._container.querySelector('#status-left') as HTMLElement;
    this.centerSection = this._container.querySelector('#status-center') as HTMLElement;
    this.rightSection = this._container.querySelector('#status-right') as HTMLElement;

    this.leftSection.setAttribute('role', 'status');
    this.leftSection.setAttribute('aria-live', 'polite');
    this.leftSection.setAttribute('aria-atomic', 'true');
    this.leftSection.setAttribute('aria-label', 'Application status');
    this.centerSection.setAttribute('aria-live', 'polite');
    this.centerSection.setAttribute('aria-atomic', 'true');
    this.centerSection.setAttribute('aria-label', 'Selection status');
    this.rightSection.setAttribute('aria-label', 'Document units');

    this.setupEventListeners();
    log.debug('StatusBar initialized');
  }

  private setupEventListeners(): void {
    eventBus.on('ui:status', ({ message, announce }) => {
      if (announce === false) {
        this.setVisualMessage(message);
        return;
      }
      this.setMessage(message);
    });

    eventBus.on('selection:change', ({ selectedIds }) => {
      if (selectedIds.size === 0) {
        this.setCenterMessage('');
      } else {
        this.setCenterMessage(`${selectedIds.size} object${selectedIds.size > 1 ? 's' : ''} selected`);
      }
    });
  }

  setLeftMessage(message: string): void {
    this.leftSection.textContent = message;
  }

  setCenterMessage(message: string): void {
    this.centerSection.textContent = message;
  }

  setRightMessage(message: string): void {
    this.rightSection.textContent = message;
  }

  setMessage(message: string): void {
    this.setLeftMessage(message);
  }

  private setVisualMessage(message: string): void {
    this.leftSection.setAttribute('aria-live', 'off');
    this.leftSection.textContent = message;
    queueMicrotask(() => this.leftSection.setAttribute('aria-live', 'polite'));
  }

  setUnits(units: 'inch' | 'mm'): void {
    this.setRightMessage(`Units: ${units === 'inch' ? 'Inches' : 'Millimeters'}`);
  }
}
