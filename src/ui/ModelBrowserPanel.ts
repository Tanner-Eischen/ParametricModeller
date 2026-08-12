/**
 * Unified model browser for history, bodies, and assembly structure.
 *
 * The browser never mutates document data. Every document-changing operation
 * is emitted as a typed request and must be applied by the owning application.
 */

export type ModelBrowserNodeKind = 'feature' | 'body' | 'component' | 'instance';

export interface ModelBrowserTarget {
  kind: ModelBrowserNodeKind;
  id: string;
}

export interface ModelBrowserFeature {
  id: string;
  name: string;
  type: string;
  suppressed: boolean;
  refsIn: readonly string[];
  refsOut: readonly string[];
  visible?: boolean;
  locked?: boolean;
  /** Optional explicit dependent IDs. Otherwise they are derived from refsIn. */
  dependentIds?: readonly string[];
  /** Bodies hidden when later history is suppressed by rollback. */
  outputBodyIds?: readonly string[];
}

export interface ModelBrowserBody {
  id: string;
  name: string;
  visible?: boolean;
  locked?: boolean;
  sourceFeatureId?: string;
}

export interface ModelBrowserComponent {
  id: string;
  name: string;
  featureIds: readonly string[];
  bodyIds: readonly string[];
  visible?: boolean;
  locked?: boolean;
}

export interface ModelBrowserInstance {
  id: string;
  name: string;
  componentId: string;
  grounded?: boolean;
  visible?: boolean;
  locked?: boolean;
}

export interface ModelBrowserData {
  features: readonly ModelBrowserFeature[];
  bodies: readonly ModelBrowserBody[];
  components: readonly ModelBrowserComponent[];
  instances: readonly ModelBrowserInstance[];
}

export interface ModelBrowserRenameRequest {
  target: ModelBrowserTarget;
  name: string;
}

export interface ModelBrowserSuppressionRequest {
  featureId: string;
  suppressed: boolean;
}

export interface ModelBrowserVisibilityRequest {
  target: ModelBrowserTarget;
  visible: boolean;
}

export interface ModelBrowserLockRequest {
  target: ModelBrowserTarget;
  locked: boolean;
}

export interface ModelBrowserDependenciesRequest {
  featureId: string;
  dependencyIds: readonly string[];
  dependentIds: readonly string[];
}

export interface ModelBrowserRollbackRequest {
  featureId: string;
  featureIndex: number;
  removedFeatureIds: readonly string[];
  affectedBodyIds: readonly string[];
  requiresConfirmation: boolean;
  confirmationReason: string | null;
  /** Always true; requests are emitted only after any required confirmation. */
  confirmed: true;
}

export interface ModelBrowserPanelOptions {
  container: HTMLElement;
  onSelect?: (target: ModelBrowserTarget) => void;
  onRename?: (request: ModelBrowserRenameRequest) => void;
  onSetSuppressed?: (request: ModelBrowserSuppressionRequest) => void;
  onSetVisibility?: (request: ModelBrowserVisibilityRequest) => void;
  onSetLocked?: (request: ModelBrowserLockRequest) => void;
  onRollback?: (request: ModelBrowserRollbackRequest) => void;
  onShowDependencies?: (request: ModelBrowserDependenciesRequest) => void;
}

interface BrowserRow {
  target: ModelBrowserTarget;
  name: string;
  detail: string;
  visible: boolean;
  locked: boolean;
  suppressed?: boolean;
  depth?: number;
  featureType?: string;
}

interface PendingRollback {
  request: Omit<ModelBrowserRollbackRequest, 'confirmed'>;
  featureName: string;
}

const EMPTY_DATA: ModelBrowserData = {
  features: [],
  bodies: [],
  components: [],
  instances: [],
};

function targetKey(target: ModelBrowserTarget): string {
  return `${target.kind}:${target.id}`;
}

function copyTarget(target: ModelBrowserTarget): ModelBrowserTarget {
  return { kind: target.kind, id: target.id };
}

/** A callback-driven, keyboard-accessible model/history browser. */
export class ModelBrowserPanel {
  private readonly container: HTMLElement;
  private readonly options: ModelBrowserPanelOptions;
  private readonly root: HTMLElement;
  private data: ModelBrowserData = EMPTY_DATA;
  private selectedTarget: ModelBrowserTarget | null = null;
  private pendingRollback: PendingRollback | null = null;
  /** Sections collapsed by the user. History starts collapsed + sits last. */
  private collapsedSections = new Set<string>(['features']);
  /** Assemblies the user has folded closed. Default open so pieces are visible. */
  private collapsedAssemblies = new Set<string>();

  constructor(options: ModelBrowserPanelOptions) {
    this.container = options.container;
    this.options = options;
    this.root = document.createElement('aside');
    this.root.className = 'model-browser';
    this.root.dataset.testid = 'model-browser';
    this.root.setAttribute('aria-label', 'Model browser');
    this.root.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:8px',
      'padding:8px',
      'overflow:auto',
      'min-width:260px',
      'font-size:12px',
    ].join(';');
    this.container.appendChild(this.root);
    this.render();
  }

  /** Replace the displayed document snapshot while preserving valid selection. */
  setData(data: ModelBrowserData): void {
    this.data = {
      features: data.features.map((feature) => ({ ...feature })),
      bodies: data.bodies.map((body) => ({ ...body })),
      components: data.components.map((component) => ({ ...component })),
      instances: data.instances.map((instance) => ({ ...instance })),
    };
    if (this.selectedTarget && !this.hasTarget(this.selectedTarget)) {
      this.selectedTarget = null;
    }
    if (this.pendingRollback &&
      !this.data.features.some((feature) => feature.id === this.pendingRollback?.request.featureId)) {
      this.pendingRollback = null;
    }
    this.render();
  }

  getSelectedTarget(): ModelBrowserTarget | null {
    return this.selectedTarget ? copyTarget(this.selectedTarget) : null;
  }

  select(target: ModelBrowserTarget | null, notify = false): boolean {
    if (target && !this.hasTarget(target)) return false;
    this.selectedTarget = target ? copyTarget(target) : null;
    this.updateSelectionVisuals();
    if (target && notify) this.options.onSelect?.(copyTarget(target));
    return true;
  }

  private hasTarget(target: ModelBrowserTarget): boolean {
    const collection = target.kind === 'feature' ? this.data.features
      : target.kind === 'body' ? this.data.bodies
        : target.kind === 'component' ? this.data.components
          : this.data.instances;
    return collection.some((item) => item.id === target.id);
  }

  private render(): void {
    this.root.replaceChildren();

    // A body that belongs to an assembly is listed under that assembly, not
    // duplicated in Objects — this is why one solid no longer appears on many lists.
    const assemblyBodyIds = new Set<string>();
    for (const component of this.data.components) {
      for (const bodyId of component.bodyIds) assemblyBodyIds.add(bodyId);
    }
    const standaloneBodies = this.data.bodies.filter((body) => !assemblyBodyIds.has(body.id));

    this.root.appendChild(this.createSection({
      title: 'Objects',
      testId: 'objects',
      legend: 'Object = one solid piece. Assembly = several pieces grouped into one unit (open it to see its pieces). Edit history = the ordered list of modeling steps.',
      rows: standaloneBodies.map((body) => {
        const sourceFeature = body.sourceFeatureId
          ? this.data.features.find((feature) => feature.id === body.sourceFeatureId)
          : undefined;
        return {
          target: { kind: 'body' as const, id: body.id },
          name: body.name,
          detail: sourceFeature ? `piece · ${sourceFeature.name}` : 'independent piece',
          visible: body.visible ?? true,
          locked: body.locked ?? false,
        };
      }),
    }));

    this.root.appendChild(this.createSection({
      title: 'Assemblies',
      testId: 'assemblies',
      emptyText: 'No assemblies yet. Group pieces into one object with Shift+G.',
      rows: this.assemblyRows(),
    }));

    this.root.appendChild(this.createSection({
      title: 'Edit history',
      testId: 'features',
      subtitle: 'Ordered modeling operations (advanced)',
      collapsible: true,
      collapsed: this.collapsedSections.has('features'),
      onToggle: () => this.toggleSection('features'),
      rows: this.data.features.map((feature, index) => ({
        target: { kind: 'feature', id: feature.id },
        name: feature.name,
        detail: `${index + 1}. ${feature.type}`,
        visible: feature.visible ?? true,
        locked: feature.locked ?? false,
        suppressed: feature.suppressed,
        featureType: feature.type,
      })),
    }));

    if (this.pendingRollback) this.root.appendChild(this.createRollbackConfirmation());
    this.updateSelectionVisuals();
  }

  /** Build the Assemblies tree: each assembly (component) opens to its pieces + placed copies. */
  private assemblyRows(): BrowserRow[] {
    const rows: BrowserRow[] = [];
    for (const component of this.data.components) {
      const collapsed = this.collapsedAssemblies.has(component.id);
      const pieceCount = component.bodyIds.length;
      rows.push({
        target: { kind: 'component', id: component.id },
        name: component.name,
        detail: `assembly · ${pieceCount} piece${pieceCount === 1 ? '' : 's'}${collapsed ? ' (closed)' : ''}`,
        visible: component.visible ?? true,
        locked: component.locked ?? false,
        featureType: 'assembly',
      });
      if (!collapsed) {
        for (const bodyId of component.bodyIds) {
          const body = this.data.bodies.find((candidate) => candidate.id === bodyId);
          if (!body) continue;
          rows.push({
            target: { kind: 'body', id: body.id },
            name: body.name,
            detail: 'piece',
            visible: body.visible ?? true,
            locked: body.locked ?? false,
            depth: 1,
          });
        }
        for (const instance of this.data.instances.filter((item) => item.componentId === component.id)) {
          rows.push({
            target: { kind: 'instance', id: instance.id },
            name: instance.name,
            detail: instance.grounded ? 'placed piece · grounded' : 'placed piece',
            visible: instance.visible ?? true,
            locked: instance.locked ?? instance.grounded ?? false,
            depth: 1,
          });
        }
      }
    }
    return rows;
  }

  private toggleSection(section: string): void {
    if (this.collapsedSections.has(section)) this.collapsedSections.delete(section);
    else this.collapsedSections.add(section);
    this.render();
  }

  private toggleAssembly(componentId: string): void {
    if (this.collapsedAssemblies.has(componentId)) this.collapsedAssemblies.delete(componentId);
    else this.collapsedAssemblies.add(componentId);
    this.render();
  }

  private createSection(options: {
    title: string;
    testId: string;
    rows: BrowserRow[];
    legend?: string;
    subtitle?: string;
    emptyText?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    onToggle?: () => void;
  }): HTMLElement {
    const { title, testId, rows, legend, subtitle, emptyText, collapsible, collapsed, onToggle } = options;
    const section = document.createElement('section');
    section.dataset.testid = `model-browser-${testId}`;
    section.setAttribute('aria-labelledby', `model-browser-${testId}-heading`);
    section.style.cssText = 'border:1px solid #3b3b3b;border-radius:4px;overflow:hidden';

    const heading = document.createElement('h3');
    heading.id = `model-browser-${testId}-heading`;
    const count = rows.filter((row) => (row.depth ?? 0) === 0).length;
    const chevron = collapsible ? (collapsed ? '▸ ' : '▾ ') : '';
    heading.textContent = `${chevron}${title} (${count})`;
    heading.style.cssText = 'margin:0;padding:7px 8px;background:#252525;font-size:12px;color:#ccc';
    if (collapsible && onToggle) {
      heading.style.cursor = 'pointer';
      heading.setAttribute('role', 'button');
      heading.setAttribute('aria-expanded', String(!collapsed));
      heading.title = collapsed ? `Show ${title}` : `Hide ${title}`;
      heading.addEventListener('click', () => onToggle());
    }
    section.appendChild(heading);

    if (legend) {
      const legendEl = document.createElement('p');
      legendEl.className = 'model-browser-legend';
      legendEl.textContent = legend;
      legendEl.style.cssText = 'margin:0;padding:6px 8px;color:#9a9a9a;font-size:10px;line-height:1.4;border-top:1px solid #333;background:#222';
      section.appendChild(legendEl);
    }
    if (subtitle) {
      const sub = document.createElement('p');
      sub.textContent = subtitle;
      sub.style.cssText = 'margin:0;padding:4px 8px;color:#888;font-size:10px;font-style:italic;border-top:1px solid #333;background:#222';
      section.appendChild(sub);
    }

    const list = document.createElement('div');
    list.setAttribute('role', 'tree');
    list.setAttribute('aria-label', title);
    if (collapsible && collapsed) list.style.display = 'none';
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = emptyText ?? `No ${title.toLowerCase()}`;
      empty.dataset.testid = `model-browser-${testId}-empty`;
      empty.style.cssText = 'padding:8px;color:#888;font-style:italic';
      list.appendChild(empty);
    } else {
      for (const row of rows) list.appendChild(this.createRow(row));
    }
    section.appendChild(list);
    return section;
  }

  private createRow(row: BrowserRow): HTMLElement {
    const item = document.createElement('div');
    const key = targetKey(row.target);
    item.className = 'model-browser-row';
    item.dataset.nodeKey = key;
    item.dataset.nodeKind = row.target.kind;
    item.dataset.nodeId = row.target.id;
    if (row.featureType) item.dataset.featureType = row.featureType;
    item.dataset.testid = `model-browser-row-${key}`;
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-level', String((row.depth ?? 0) + 1));
    item.setAttribute('aria-selected', 'false');
    item.tabIndex = 0;
    item.style.cssText = [
      'display:grid',
      'grid-template-columns:minmax(80px,1fr) auto',
      'gap:4px',
      'align-items:center',
      `padding:5px 5px 5px ${7 + (row.depth ?? 0) * 18}px`,
      'border-top:1px solid #333',
      `opacity:${row.suppressed ? '0.55' : '1'}`,
    ].join(';');

    const label = document.createElement('span');
    label.dataset.role = 'label';
    label.style.cssText = 'min-width:0;cursor:default';
    const name = document.createElement('span');
    name.dataset.role = 'name';
    name.textContent = row.name;
    name.style.cssText = 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const detail = document.createElement('span');
    detail.textContent = row.detail;
    detail.style.cssText = 'display:block;color:#929292;font-size:10px;overflow:hidden;text-overflow:ellipsis';
    if (row.target.kind === 'component') {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'model-browser-assembly-toggle';
      toggle.dataset.testid = `model-browser-assembly-toggle-${row.target.id}`;
      const isCollapsed = this.collapsedAssemblies.has(row.target.id);
      toggle.textContent = isCollapsed ? '▸' : '▾';
      toggle.title = isCollapsed ? 'Open assembly to view its pieces' : 'Collapse assembly';
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.style.cssText = 'min-width:18px;height:18px;padding:0;font-size:11px;cursor:pointer;margin-right:4px;background:transparent;border:1px solid #444;color:#ccc;border-radius:3px';
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleAssembly(row.target.id);
      });
      label.appendChild(toggle);
    }
    label.append(name, detail);
    item.appendChild(label);

    const actions = document.createElement('span');
    actions.dataset.role = 'actions';
    actions.style.cssText = 'display:flex;gap:2px;align-items:center';
    actions.appendChild(this.createActionButton('Rename', 'rename', key,
      Boolean(this.options.onRename), () => this.beginRename(item, row)));
    actions.appendChild(this.createActionButton(
      row.visible ? 'Hide' : 'Show',
      'visibility',
      key,
      Boolean(this.options.onSetVisibility),
      () => this.options.onSetVisibility?.({ target: copyTarget(row.target), visible: !row.visible }),
    ));
    actions.appendChild(this.createActionButton(
      row.locked ? 'Unlock' : 'Lock',
      'lock',
      key,
      Boolean(this.options.onSetLocked),
      () => this.options.onSetLocked?.({ target: copyTarget(row.target), locked: !row.locked }),
    ));
    if (row.target.kind === 'feature') {
      actions.appendChild(this.createActionButton(
        row.suppressed ? 'Resume' : 'Suppress',
        'suppress',
        key,
        Boolean(this.options.onSetSuppressed),
        () => this.options.onSetSuppressed?.({
          featureId: row.target.id,
          suppressed: !row.suppressed,
        }),
      ));
      actions.appendChild(this.createActionButton(
        'Dependencies',
        'dependencies',
        key,
        Boolean(this.options.onShowDependencies),
        () => this.showDependencies(row.target.id),
      ));
      actions.appendChild(this.createActionButton(
        'Rollback',
        'rollback',
        key,
        Boolean(this.options.onRollback),
        () => this.requestRollback(row.target.id),
      ));
    }
    item.appendChild(actions);

    item.addEventListener('click', (event) => {
      if ((event.target as Element).closest('button,input')) return;
      this.activate(row.target);
    });
    item.addEventListener('keydown', (event) => this.handleRowKeydown(event, row.target));
    return item;
  }

  private createActionButton(
    label: string,
    action: string,
    key: string,
    enabled: boolean,
    handler: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label.slice(0, 1);
    button.title = label;
    button.setAttribute('aria-label', `${label} ${key}`);
    button.dataset.action = action;
    button.disabled = !enabled;
    button.style.cssText = 'min-width:22px;height:22px;padding:0 4px;font-size:10px;cursor:pointer';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  private activate(target: ModelBrowserTarget): void {
    this.selectedTarget = copyTarget(target);
    this.updateSelectionVisuals();
    this.options.onSelect?.(copyTarget(target));
  }

  private handleRowKeydown(event: KeyboardEvent, target: ModelBrowserTarget): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.activate(target);
      return;
    }
    const rows = Array.from(this.root.querySelectorAll<HTMLElement>('.model-browser-row'));
    const currentIndex = rows.indexOf(event.currentTarget as HTMLElement);
    let nextIndex = -1;
    if (event.key === 'ArrowDown') nextIndex = Math.min(rows.length - 1, currentIndex + 1);
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = rows.length - 1;
    if (nextIndex >= 0) {
      event.preventDefault();
      rows[nextIndex]?.focus();
    }
  }

  private beginRename(item: HTMLElement, row: BrowserRow): void {
    const label = item.querySelector<HTMLElement>('[data-role="label"]');
    if (!label || label.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = row.name;
    input.setAttribute('aria-label', `Rename ${row.target.kind} ${row.name}`);
    input.dataset.testid = `model-browser-rename-${targetKey(row.target)}`;
    label.replaceChildren(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this.render();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const nextName = input.value.trim();
        if (!nextName) {
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        this.options.onRename?.({ target: copyTarget(row.target), name: nextName });
        this.render();
      }
    });
  }

  private getDependentIds(featureId: string): string[] {
    const explicit = this.data.features.find((feature) => feature.id === featureId)?.dependentIds;
    if (explicit) return [...explicit];
    return this.data.features
      .filter((feature) => feature.refsIn.includes(featureId))
      .map((feature) => feature.id);
  }

  private showDependencies(featureId: string): void {
    const feature = this.data.features.find((item) => item.id === featureId);
    if (!feature) return;
    this.options.onShowDependencies?.({
      featureId,
      dependencyIds: [...feature.refsIn],
      dependentIds: this.getDependentIds(featureId),
    });
  }

  private requestRollback(featureId: string): void {
    const featureIndex = this.data.features.findIndex((feature) => feature.id === featureId);
    if (featureIndex < 0 || !this.options.onRollback) return;
    const removed = this.data.features.slice(featureIndex + 1);
    const request: Omit<ModelBrowserRollbackRequest, 'confirmed'> = {
      featureId,
      featureIndex,
      removedFeatureIds: removed.map((feature) => feature.id),
      affectedBodyIds: removed.flatMap((feature) => feature.outputBodyIds ?? feature.refsOut),
      requiresConfirmation: removed.length > 0,
      confirmationReason: removed.length > 0
        ? `${removed.length} later feature${removed.length === 1 ? '' : 's'} will be suppressed.`
        : null,
    };
    if (!request.requiresConfirmation) {
      this.options.onRollback({ ...request, confirmed: true });
      return;
    }
    this.pendingRollback = { request, featureName: this.data.features[featureIndex]?.name ?? featureId };
    this.render();
  }

  private createRollbackConfirmation(): HTMLElement {
    const pending = this.pendingRollback;
    const alert = document.createElement('div');
    alert.dataset.testid = 'model-browser-rollback-confirmation';
    alert.setAttribute('role', 'alertdialog');
    alert.setAttribute('aria-label', 'Confirm history rollback');
    alert.style.cssText = 'padding:8px;border:1px solid #b46b2a;background:#35291f;border-radius:4px';
    if (!pending) return alert;

    const message = document.createElement('p');
    message.style.cssText = 'margin:0 0 8px';
    message.textContent = `Roll back to ${pending.featureName}? ${pending.request.confirmationReason ?? ''}`;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = 'Confirm rollback';
    confirm.dataset.action = 'confirm-rollback';
    confirm.addEventListener('click', () => {
      const current = this.pendingRollback;
      this.pendingRollback = null;
      if (current) this.options.onRollback?.({ ...current.request, confirmed: true });
      this.render();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.dataset.action = 'cancel-rollback';
    cancel.style.marginLeft = '6px';
    cancel.addEventListener('click', () => {
      this.pendingRollback = null;
      this.render();
    });
    alert.append(message, confirm, cancel);
    return alert;
  }

  private updateSelectionVisuals(): void {
    const selectedKey = this.selectedTarget ? targetKey(this.selectedTarget) : null;
    for (const row of this.root.querySelectorAll<HTMLElement>('.model-browser-row')) {
      const selected = row.dataset.nodeKey === selectedKey;
      row.setAttribute('aria-selected', String(selected));
      row.style.background = selected ? '#1a5fb4' : '#2a2a2a';
    }
  }

  dispose(): void {
    if (this.root.parentElement === this.container) this.container.removeChild(this.root);
  }
}
