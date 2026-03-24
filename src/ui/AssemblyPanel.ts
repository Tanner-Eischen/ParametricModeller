/**
 * Assembly Panel - Milestone 06: Assembly-lite
 *
 * UI panel for managing components, instances, and constraints.
 */

import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type {
  Component,
  ComponentInstance,
  MateConstraint,
} from '../assembly/AssemblyTypes';

const log = createModuleLogger('AssemblyPanel');

/**
 * Options for the AssemblyPanel.
 */
export interface AssemblyPanelOptions {
  container: HTMLElement;
}

/**
 * Panel displaying assembly components, instances, and constraints.
 */
export class AssemblyPanel {
  private container: HTMLElement;
  private panelElement: HTMLElement;
  private components: Component[] = [];
  private instances: ComponentInstance[] = [];
  private constraints: MateConstraint[] = [];
  private selectedComponentId: string | null = null;
  private selectedInstanceId: string | null = null;

  constructor(options: AssemblyPanelOptions) {
    this.container = options.container;
    this.panelElement = this.createPanel();
    this.container.appendChild(this.panelElement);
    this.setupEventListeners();
    log.debug('AssemblyPanel initialized');
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'assembly-panel';
    panel.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      overflow-y: auto;
      flex: 1;
      font-size: 12px;
    `;

    // Components section
    const componentsSection = this.createSection('Components', () => this.addComponent());
    const componentsList = this.createListElement('components-list');
    componentsSection.appendChild(componentsList);
    panel.appendChild(componentsSection);

    // Instances section
    const instancesSection = this.createSection('Instances', () => this.addInstance());
    const instancesList = this.createListElement('instances-list');
    instancesSection.appendChild(instancesList);
    panel.appendChild(instancesSection);

    // Constraints section
    const constraintsSection = this.createSection('Constraints', () => this.addConstraint());
    const constraintsList = this.createListElement('constraints-list');
    constraintsSection.appendChild(constraintsList);
    panel.appendChild(constraintsSection);

    return panel;
  }

  private createSection(title: string, onAdd: () => void): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText = `
      border: 1px solid #333;
      border-radius: 4px;
      margin-bottom: 8px;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      background: #252525;
      border-bottom: 1px solid #333;
      font-weight: bold;
      color: #aaa;
    `;
    header.textContent = title;

    // Add button
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.style.cssText = `
      background: #4a9eff;
      border: none;
      color: white;
      width: 20px;
      height: 20px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
    `;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onAdd();
    });
    header.appendChild(addBtn);

    section.appendChild(header);
    return section;
  }

  private createListElement(className: string): HTMLElement {
    const list = document.createElement('div');
    list.className = className;
    list.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      min-height: 40px;
    `;
    return list;
  }

  private setupEventListeners(): void {
    // Listen for assembly events
    eventBus.on('component:created', ({ componentId, name }) => {
      log.debug('Component created event', { componentId, name });
    });

    eventBus.on('instance:added', ({ instanceId, componentId }) => {
      log.debug('Instance added event', { instanceId, componentId });
    });

    eventBus.on('constraint:added', ({ constraintId, type }) => {
      log.debug('Constraint added event', { constraintId, type });
    });

    eventBus.on('constraint:solved', ({ constraintId, satisfied }) => {
      this.updateConstraintStatus(constraintId, satisfied);
    });
  }

  /**
   * Set the assembly data.
   */
  setAssemblyData(
    components: Component[],
    instances: ComponentInstance[],
    constraints: MateConstraint[]
  ): void {
    this.components = [...components];
    this.instances = [...instances];
    this.constraints = [...constraints];
    this.render();
    log.debug('Assembly data set', {
      components: components.length,
      instances: instances.length,
      constraints: constraints.length,
    });
  }

  /**
   * Render all sections.
   */
  private render(): void {
    this.renderComponents();
    this.renderInstances();
    this.renderConstraints();
  }

  /**
   * Render components list.
   */
  private renderComponents(): void {
    const list = this.panelElement.querySelector('.components-list') as HTMLElement;
    if (!list) return;

    list.innerHTML = '';

    if (this.components.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No components (press G to create)';
      empty.style.cssText = 'color: #666; padding: 8px; text-align: center; font-style: italic;';
      list.appendChild(empty);
      return;
    }

    for (const component of this.components) {
      const item = this.createComponentItem(component);
      list.appendChild(item);
    }
  }

  /**
   * Create a component item element.
   */
  private createComponentItem(component: Component): HTMLElement {
    const item = document.createElement('div');
    item.dataset.componentId = component.id;
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      cursor: pointer;
      border-radius: 3px;
      background: ${this.selectedComponentId === component.id ? '#1a5fb4' : '#2a2a2a'};
    `;

    // Icon
    const icon = document.createElement('span');
    icon.textContent = '📦';
    icon.style.cssText = 'font-size: 14px;';
    item.appendChild(icon);

    // Name
    const name = document.createElement('span');
    name.textContent = component.name;
    name.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    item.appendChild(name);

    // Feature count
    const count = document.createElement('span');
    count.textContent = `${component.featureIds.length} features`;
    count.style.cssText = 'font-size: 10px; color: #888;';
    item.appendChild(count);

    // Click handler
    item.addEventListener('click', () => {
      this.selectedComponentId = component.id;
      this.renderComponents();
      eventBus.emit('ui:status', { message: `Selected component: ${component.name}` });
    });

    // Double-click to edit in place
    item.addEventListener('dblclick', () => {
      eventBus.emit('edit:enter-component', { componentId: component.id });
    });

    return item;
  }

  /**
   * Render instances list.
   */
  private renderInstances(): void {
    const list = this.panelElement.querySelector('.instances-list') as HTMLElement;
    if (!list) return;

    list.innerHTML = '';

    if (this.instances.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No instances (select a component and press I)';
      empty.style.cssText = 'color: #666; padding: 8px; text-align: center; font-style: italic;';
      list.appendChild(empty);
      return;
    }

    for (const instance of this.instances) {
      const item = this.createInstanceItem(instance);
      list.appendChild(item);
    }
  }

  /**
   * Create an instance item element.
   */
  private createInstanceItem(instance: ComponentInstance): HTMLElement {
    const item = document.createElement('div');
    item.dataset.instanceId = instance.id;
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      cursor: pointer;
      border-radius: 3px;
      background: ${this.selectedInstanceId === instance.id ? '#1a5fb4' : '#2a2a2a'};
      ${instance.grounded ? 'border-left: 3px solid #4caf50;' : ''}
    `;

    // Icon
    const icon = document.createElement('span');
    icon.textContent = '📍';
    icon.style.cssText = 'font-size: 14px;';
    item.appendChild(icon);

    // Name
    const name = document.createElement('span');
    name.textContent = instance.name;
    name.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    item.appendChild(name);

    // Grounded indicator
    if (instance.grounded) {
      const grounded = document.createElement('span');
      grounded.textContent = '🔒';
      grounded.style.cssText = 'font-size: 10px;';
      item.appendChild(grounded);
    }

    // Click handler
    item.addEventListener('click', () => {
      this.selectedInstanceId = instance.id;
      this.renderInstances();
      eventBus.emit('ui:status', { message: `Selected instance: ${instance.name}` });
    });

    return item;
  }

  /**
   * Render constraints list.
   */
  private renderConstraints(): void {
    const list = this.panelElement.querySelector('.constraints-list') as HTMLElement;
    if (!list) return;

    list.innerHTML = '';

    if (this.constraints.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No constraints';
      empty.style.cssText = 'color: #666; padding: 8px; text-align: center; font-style: italic;';
      list.appendChild(empty);
      return;
    }

    for (const constraint of this.constraints) {
      const item = this.createConstraintItem(constraint);
      list.appendChild(item);
    }
  }

  /**
   * Create a constraint item element.
   */
  private createConstraintItem(constraint: MateConstraint): HTMLElement {
    const item = document.createElement('div');
    item.dataset.constraintId = constraint.id;
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 3px;
      background: ${constraint.satisfied ? '#1b4d1b' : constraint.suppressed ? '#333' : '#4d1b1b'};
      opacity: ${constraint.suppressed ? 0.5 : 1};
    `;

    // Icon
    const icon = document.createElement('span');
    icon.textContent = constraint.type === 'flush' ? '🔗' : '↔';
    icon.style.cssText = 'font-size: 14px;';
    item.appendChild(icon);

    // Name
    const name = document.createElement('span');
    name.textContent = constraint.name;
    name.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    item.appendChild(name);

    // Status indicator
    const status = document.createElement('span');
    status.textContent = constraint.satisfied ? '✓' : constraint.errorMessage ? '⚠' : '?';
    status.style.cssText = 'font-size: 12px;';
    item.appendChild(status);

    return item;
  }

  /**
   * Update constraint status.
   */
  private updateConstraintStatus(constraintId: string, satisfied: boolean): void {
    const constraint = this.constraints.find(c => c.id === constraintId);
    if (constraint) {
      constraint.satisfied = satisfied;
      this.renderConstraints();
    }
  }

  /**
   * Add a component (triggers event).
   */
  private addComponent(): void {
    // This will be handled by the keyboard shortcut in App.ts
    eventBus.emit('ui:status', { message: 'Press G to create a component from selected features' });
  }

  /**
   * Add an instance (triggers event).
   */
  private addInstance(): void {
    if (!this.selectedComponentId) {
      eventBus.emit('ui:status', { message: 'Select a component first' });
      return;
    }
    // This will be handled in App.ts
    eventBus.emit('instance:added', {
      instanceId: 'new',
      componentId: this.selectedComponentId,
    });
  }

  /**
   * Add a constraint (triggers constraint creation mode).
   */
  private addConstraint(): void {
    if (this.instances.length < 2) {
      eventBus.emit('ui:status', { message: 'Need at least 2 instances to create a constraint' });
      return;
    }
    eventBus.emit('ui:status', { message: 'Select first face for constraint' });
    // Constraint creation will be handled by ConstraintCreationController
  }

  /**
   * Get selected component.
   */
  getSelectedComponent(): Component | null {
    if (!this.selectedComponentId) return null;
    return this.components.find(c => c.id === this.selectedComponentId) ?? null;
  }

  /**
   * Get selected instance.
   */
  getSelectedInstance(): ComponentInstance | null {
    if (!this.selectedInstanceId) return null;
    return this.instances.find(i => i.id === this.selectedInstanceId) ?? null;
  }

  /**
   * Dispose the panel.
   */
  dispose(): void {
    this.container.removeChild(this.panelElement);
    log.debug('AssemblyPanel disposed');
  }
}
