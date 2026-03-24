import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { FeatureRecord } from '../features';

const log = createModuleLogger('FeatureTreePanel');

/**
 * Options for the FeatureTreePanel.
 */
export interface FeatureTreePanelOptions {
  /** Container element for the panel */
  container: HTMLElement;
}

/**
 * Panel displaying the feature tree.
 */
export class FeatureTreePanel {
  private container: HTMLElement;
  private listElement: HTMLElement;
  private features: FeatureRecord[] = [];
  private selectedFeatureId: string | null = null;

  constructor(options: FeatureTreePanelOptions) {
    this.container = options.container;
    this.listElement = this.createListElement();
    this.container.appendChild(this.listElement);
    this.setupEventListeners();
    log.debug('FeatureTreePanel initialized');
  }

  private createListElement(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'feature-tree';
    list.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px;
      overflow-y: auto;
      flex: 1;
    `;
    return list;
  }

  private setupEventListeners(): void {
    // Listen for feature selection events
    eventBus.on('feature:selected', ({ featureId }) => {
      this.selectFeature(featureId);
    });

    eventBus.on('feature:added', ({ feature }) => {
      this.addFeature(feature as FeatureRecord);
    });

    eventBus.on('feature:removed', ({ featureId }) => {
      this.removeFeature(featureId);
    });

    eventBus.on('document:loaded', ({ features }) => {
      this.setFeatures(features as FeatureRecord[]);
    });
  }

  /**
   * Set the features to display.
   */
  setFeatures(features: FeatureRecord[]): void {
    this.features = [...features];
    this.selectedFeatureId = null;
    this.render();
    log.debug('Features set', { count: features.length });
  }

  /**
   * Add a feature to the list.
   */
  addFeature(feature: FeatureRecord): void {
    this.features.push(feature);
    this.renderItem(feature);
    log.debug('Feature added to tree', { id: feature.id, type: feature.type });
  }

  /**
   * Remove a feature from the list.
   */
  removeFeature(featureId: string): void {
    this.features = this.features.filter((f) => f.id !== featureId);
    if (this.selectedFeatureId === featureId) {
      this.selectedFeatureId = null;
    }
    this.render();
    log.debug('Feature removed from tree', { id: featureId });
  }

  /**
   * Select a feature by ID.
   */
  selectFeature(featureId: string | null): void {
    this.selectedFeatureId = featureId;
    this.updateSelectionVisuals();

    if (featureId) {
      const feature = this.features.find((f) => f.id === featureId);
      if (feature) {
        eventBus.emit('ui:property-inspector', { feature });
      }
    }
  }

  /**
   * Get the currently selected feature.
   */
  getSelectedFeature(): FeatureRecord | null {
    if (!this.selectedFeatureId) return null;
    return this.features.find((f) => f.id === this.selectedFeatureId) ?? null;
  }

  /**
   * Render the full list.
   */
  private render(): void {
    this.listElement.innerHTML = '';

    if (this.features.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No features';
      empty.style.cssText = 'color: #666; padding: 8px; text-align: center;';
      this.listElement.appendChild(empty);
      return;
    }

    for (const feature of this.features) {
      this.renderItem(feature);
    }

    this.updateSelectionVisuals();
  }

  /**
   * Render a single feature item.
   */
  private renderItem(feature: FeatureRecord): HTMLElement {
    const item = document.createElement('div');
    item.className = 'feature-item';
    item.dataset.featureId = feature.id;
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      border-radius: 4px;
      user-select: none;
      background: ${feature.suppressed ? '#333' : '#2a2a2a'};
      opacity: ${feature.suppressed ? '0.5' : '1'};
    `;

    // Icon
    const icon = document.createElement('span');
    icon.textContent = this.getFeatureIcon(feature.type);
    icon.style.cssText = 'font-size: 16px; width: 20px; text-align: center;';
    item.appendChild(icon);

    // Name
    const name = document.createElement('span');
    name.textContent = feature.name;
    name.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    item.appendChild(name);

    // Type badge
    const badge = document.createElement('span');
    badge.textContent = feature.type.toUpperCase();
    badge.style.cssText = `
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      background: #444;
      color: #aaa;
    `;
    item.appendChild(badge);

    // Click handler
    item.addEventListener('click', () => {
      this.selectFeature(feature.id);
    });

    this.listElement.appendChild(item);
    return item;
  }

  /**
   * Update visual selection state.
   */
  private updateSelectionVisuals(): void {
    const items = this.listElement.querySelectorAll('.feature-item');
    items.forEach((item) => {
      const el = item as HTMLElement;
      const featureId = el.dataset.featureId;
      if (featureId === this.selectedFeatureId) {
        el.style.background = '#1a5fb4';
      } else {
        const feature = this.features.find((f) => f.id === featureId);
        el.style.background = feature?.suppressed ? '#333' : '#2a2a2a';
      }
    });
  }

  /**
   * Get an icon for a feature type.
   */
  private getFeatureIcon(type: string): string {
    const icons: Record<string, string> = {
      box: '▢',
      sketch: '✎',
      extrude: '↑',
      extrudeCut: '⬇',
      revolve: '↻',
      fillet: '⌒',
      chamfer: '◇',
      boolean_union: '∪',
      boolean_subtract: '∩',
      boolean_intersect: '∧',
      mirror: '⇆',
      linearPattern: '≡',
      pattern_linear: '≡',
      pattern_circular: '◎',
      createComponent: '📦',
      addInstance: '📍',
      moveVertex: '✥',
      duplicate: '⧉',
    };
    return icons[type] ?? '?';
  }

  /**
   * Dispose the panel.
   */
  dispose(): void {
    this.container.removeChild(this.listElement);
    log.debug('FeatureTreePanel disposed');
  }
}
