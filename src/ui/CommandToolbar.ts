import { createModuleLogger } from '../core/logger';
import {
  COMMAND_DEFINITIONS,
  DEFAULT_EXPANDED_TOOLBAR_GROUPS,
  TOOLBAR_GROUP_ORDER,
  type AppCommandDefinition,
  type AppCommandId,
  type CommandAvailability,
  type CommandGroup,
} from './CommandCatalog';

const log = createModuleLogger('CommandToolbar');

export interface CommandToolbarAction {
  id: AppCommandId;
  onTrigger: () => void;
  isActive?: () => boolean;
  isDisabled?: () => boolean;
  getAvailability?: () => CommandAvailability;
}

export interface CommandToolbarOptions {
  container?: HTMLElement;
  actions: CommandToolbarAction[];
}

export class CommandToolbar {
  private static readonly STORAGE_KEY = 'modelling.commandToolbarCollapsed';
  private static readonly COLLAPSED_GROUPS_KEY = 'modelling.commandToolbarCollapsedGroups';
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private actionsById = new Map<AppCommandId, CommandToolbarAction>();
  private buttons = new Map<AppCommandId, HTMLButtonElement>();
  private collapsed = true;
  /** Categories the user has folded closed. Groups not present here are expanded. */
  private collapsedGroups: Set<CommandGroup> = new Set();

  constructor(options: CommandToolbarOptions) {
    for (const action of options.actions) {
      this.actionsById.set(action.id, action);
    }

    this.collapsed = this.readCollapsedState();
    this.collapsedGroups = this.readCollapsedGroupsState();

    if (options.container) {
      this.attachTo(options.container);
    }
  }

  attachTo(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  refresh(): void {
    for (const [id, button] of this.buttons) {
      const action = this.actionsById.get(id);
      if (!action) {
        continue;
      }

      const active = action.isActive?.() ?? false;
      const availability = action.getAvailability?.();
      const disabled = availability ? !availability.enabled : (action.isDisabled?.() ?? false);

      button.dataset.active = String(active);
      button.disabled = disabled;
      button.title = disabled && availability?.reason
        ? `${button.dataset.enabledTitle} — ${availability.reason}`
        : button.dataset.enabledTitle ?? button.title;
      button.setAttribute('aria-label', button.title);
      if (availability?.reason) button.dataset.disabledReason = availability.reason;
      else delete button.dataset.disabledReason;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    this.ensureEnabledRovingTabStop();
  }

  dispose(): void {
    if (this.root) {
      this.root.remove();
    }

    this.root = null;
    this.container = null;
    this.buttons.clear();
    log.debug('CommandToolbar disposed');
  }

  private render(): void {
    if (!this.container) {
      return;
    }

    this.root?.remove();
    this.root = document.createElement('div');
    this.root.className = 'command-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Modeling commands');
    this.root.dataset.collapsed = String(this.collapsed);
    this.buttons.clear();

    const header = document.createElement('div');
    header.className = 'command-toolbar__header';

    const summary = document.createElement('div');
    summary.className = 'command-toolbar__summary';
    summary.textContent = this.collapsed
      ? 'Tools'
      : 'Tools • hover any icon to see its name and shortcut';
    header.appendChild(summary);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'command-toolbar__toggle';
    toggle.textContent = this.collapsed ? 'Expand' : 'Collapse';
    toggle.title = this.collapsed ? 'Expand the toolbar' : 'Collapse the toolbar';
    toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.persistCollapsedState();
      this.render();
    });
    header.appendChild(toggle);

    this.root.appendChild(header);

    const groups = document.createElement('div');
    groups.className = 'command-toolbar__groups';

    for (const group of TOOLBAR_GROUP_ORDER) {
      const definitions = this.getDefinitionsForGroup(group);
      if (definitions.length === 0) {
        continue;
      }

      const groupElement = document.createElement('section');
      groupElement.className = 'command-toolbar__group';
      const isGroupCollapsed = this.collapsedGroups.has(group);
      groupElement.dataset.collapsed = String(isGroupCollapsed);
      groupElement.dataset.testid = `command-toolbar-group-${group}`;

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'command-toolbar__group-header';
      const chevron = document.createElement('span');
      chevron.className = 'command-toolbar__group-chevron';
      chevron.textContent = isGroupCollapsed ? '▸' : '▾';
      const label = document.createElement('span');
      label.className = 'command-toolbar__group-label';
      label.textContent = group;
      const count = document.createElement('span');
      count.className = 'command-toolbar__group-count';
      count.textContent = String(definitions.length);
      header.append(chevron, label, count);
      header.setAttribute('aria-expanded', String(!isGroupCollapsed));
      header.title = isGroupCollapsed
        ? `${group} — ${definitions.length} tool${definitions.length === 1 ? '' : 's'}. Click to expand.`
        : `Hide ${group} tools`;
      header.setAttribute('aria-haspopup', 'true');
      header.addEventListener('click', () => {
        this.toggleGroupCollapsed(group);
        this.render();
      });

      groupElement.appendChild(header);

      const buttons = document.createElement('div');
      buttons.className = 'command-toolbar__buttons';

      for (const definition of definitions) {
        const action = this.actionsById.get(definition.id);
        if (!action) {
          continue;
        }

        const button = this.createButton(definition, action);
        this.buttons.set(definition.id, button);
        buttons.appendChild(button);
      }

      groupElement.appendChild(buttons);
      groups.appendChild(groupElement);
    }

    this.root.appendChild(groups);
    this.container.appendChild(this.root);
    this.configureRovingTabIndex();
    this.refresh();
    log.debug('CommandToolbar rendered', { groups: TOOLBAR_GROUP_ORDER.length });
  }

  private getDefinitionsForGroup(group: CommandGroup): AppCommandDefinition[] {
    return COMMAND_DEFINITIONS.filter(
      (definition) =>
        definition.toolbarGroup === group
        && this.actionsById.has(definition.id)
    );
  }

  private toggleGroupCollapsed(group: CommandGroup): void {
    if (this.collapsedGroups.has(group)) {
      this.collapsedGroups.delete(group);
    } else {
      this.collapsedGroups.add(group);
    }
    this.persistCollapsedGroupsState();
  }

  private readCollapsedGroupsState(): Set<CommandGroup> {
    const stored = this.readStoredToolsPreference();
    if (stored) return new Set(stored as CommandGroup[]);
    // First run: expand the modeling groups, fold the chrome groups into chips.
    return new Set(
      TOOLBAR_GROUP_ORDER.filter((group) => !DEFAULT_EXPANDED_TOOLBAR_GROUPS.has(group)),
    );
  }

  private readStoredToolsPreference(): string[] | null {
    try {
      const raw = window.localStorage.getItem(CommandToolbar.COLLAPSED_GROUPS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private persistCollapsedGroupsState(): void {
    try {
      window.localStorage.setItem(
        CommandToolbar.COLLAPSED_GROUPS_KEY,
        JSON.stringify([...this.collapsedGroups]),
      );
    } catch {
      // Ignore storage access failures.
    }
  }

  private createButton(
    definition: AppCommandDefinition,
    action: CommandToolbarAction
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-toolbar__button';
    button.dataset.testid = `command-${definition.id}`;
    const tooltipText = definition.shortcut
      ? `${definition.label} · ${definition.shortcut}`
      : definition.label;
    button.title = definition.shortcut
      ? `${definition.label} (${definition.shortcut}) - ${definition.description}`
      : `${definition.label} - ${definition.description}`;
    button.dataset.enabledTitle = button.title;
    button.dataset.tooltip = tooltipText;
    button.setAttribute('aria-label', button.title);

    const icon = document.createElement('span');
    icon.className = 'command-toolbar__button-icon';
    icon.appendChild(createCommandIcon(definition));
    button.appendChild(icon);

    const meta = document.createElement('span');
    meta.className = 'command-toolbar__button-meta';

    const label = document.createElement('span');
    label.className = 'command-toolbar__button-label';
    label.textContent = definition.label;
    meta.appendChild(label);

    if (definition.shortcut) {
      const shortcut = document.createElement('span');
      shortcut.className = 'command-toolbar__button-shortcut';
      shortcut.textContent = definition.shortcut;
      meta.appendChild(shortcut);
    }

    button.appendChild(meta);

    button.addEventListener('click', () => {
      if (button.disabled) {
        return;
      }

      action.onTrigger();
      this.refresh();
    });

    return button;
  }

  private configureRovingTabIndex(): void {
    const buttons = [...this.buttons.values()];
    buttons.forEach((button, index) => {
      button.tabIndex = index === 0 ? 0 : -1;
    });
    this.root?.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const enabled = buttons.filter((button) => !button.disabled);
      if (enabled.length === 0) return;
      const current = Math.max(0, enabled.indexOf(document.activeElement as HTMLButtonElement));
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
      buttons.forEach((button) => {
        button.tabIndex = -1;
      });
      enabled[next]!.tabIndex = 0;
      enabled[next]!.focus();
      event.preventDefault();
    });
  }

  private ensureEnabledRovingTabStop(): void {
    const buttons = [...this.buttons.values()];
    const enabled = buttons.filter((button) => !button.disabled);
    if (enabled.length === 0) {
      buttons.forEach((button) => {
        button.tabIndex = -1;
      });
      return;
    }
    const current = enabled.find((button) => button.tabIndex === 0);
    buttons.forEach((button) => {
      button.tabIndex = -1;
    });
    (current ?? enabled[0]!).tabIndex = 0;
  }

  private readCollapsedState(): boolean {
    try {
      const stored = window.localStorage.getItem(CommandToolbar.STORAGE_KEY);
      if (stored === 'expanded') {
        return false;
      }
      if (stored === 'collapsed') {
        return true;
      }
    } catch {
      // Ignore storage access failures and fall back to compact mode.
    }

    return true;
  }

  private persistCollapsedState(): void {
    try {
      window.localStorage.setItem(
        CommandToolbar.STORAGE_KEY,
        this.collapsed ? 'collapsed' : 'expanded'
      );
    } catch {
      // Ignore storage access failures.
    }
  }
}

function createCommandIcon(definition: AppCommandDefinition): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const paths: Partial<Record<AppCommandId, string>> = {
    undo: 'M9 7 5 11l4 4M6 11h7a5 5 0 0 1 5 5',
    redo: 'm15 7 4 4-4 4m3-4h-7a5 5 0 0 0-5 5',
    addBox: 'm5 8 7-4 7 4v8l-7 4-7-4Zm0 0 7 4 7-4m-7 4v8',
    addSketch: 'M5 18 16 7l3 3L8 21H5Zm9-9 3 3',
    addExtrude: 'M12 20V6m-5 5 5-5 5 5M6 20h12',
    addExtrudeCut: 'M12 4v14m-5-5 5 5 5-5M5 4h14',
    addWoodJoint: 'M5 5h6v6H5Zm8 8h6v6h-6Zm-2-2 2 2m-2 2 4-4',
    addMiterCut: 'M5 19h14L9 5Zm4-14 10 10',
    openCommandPalette: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm5 11 4 4',
    addMirror: 'M12 3v18M7 7l-3 5 3 5M17 7l3 5-3 5',
    addLinearPattern: 'M4 9h2v2H4Zm6 0h2v2h-2Zm6 0h2v2h-2ZM4 15h2v2H4Zm6 0h2v2h-2Zm6 0h2v2h-2Z',
    addDuplicate: 'M9 9h10v10H9Zm-2-6h10v4M7 9h6v8H7',
    addMove: 'M5 12h12m-4-4 4 4-4 4',
    addRotate: 'M12 12m-7 0a7 7 0 1 0 14 0M12 5V2M9 4l3-2 3 2',
    addMoveVertex: 'M12 2v6m0 8v6M5 12h6m2 0h6M12 12m-2 0a2 2 0 1 0 4 0',
    addUnion: 'M8 8h8v8H8Zm-3 5a5 5 0 0 1 5-5m6 6a5 5 0 0 1-5 5',
    addJoin: 'M4 9h7v6H4Zm9 0h7v6h-7Zm-2 0v6',
    toggleGrid: 'M4 4h16v16H4Zm0 8h16M4 12v8m16-8v8m-8-8v8',
    toggleProjection: 'M12 3 3 8l9 5 9-5Zm-9 9 9 5 9-5',
    resetCamera: 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7',
    fitView: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    measureSelection: 'M3 17l5-5 4 4 5-7m2 0h-4m0-4v4',
    exportCutList: 'M14 3H6v18h12V7Zm0 0 4 4M9 13h6M9 17h6',
    exportDrawing: 'M4 4h16v16H4Zm0 10h16M8 14v4M16 14v4',
    deleteSelected: 'M6 7h12M9 7V4h6v3m-7 0 1 13h8l1-13',
    rebuild: 'M12 5a7 7 0 1 0 7 7M19 5v4h-4',
    enterPushPull: 'M12 4v8m0 0-3-3m3 3 3-3M6 14h12v4H6Z',
    addFaceSketch: 'M5 19h14l-7-12Zm7-12v12',
    rotateAboutEdge: 'M12 4v8l5 3M4 6h8M4 18h8',
    placePointToPoint: 'M5 5l6 6m2 2 6 6M5 5h4M5 5v4M19 19h-4M19 19v-4',
    alignFaces: 'M4 6h16M4 18h16M9 6v12m6-12v12',
    createComponent: 'M4 9h7v6H4Zm9 0h7v6h-7Z',
    addInstance: 'M8 8h8v8H8ZM12 4v4M12 16v4',
    createMate: 'M5 7h6v4H5Zm8 6h6v4h-6Zm-1-6 5 10',
    saveDocument: 'M5 5h14v14H5Zm0 4h14M9 5v4h6V5M9 14h6v5H9',
    newDocument: 'M12 5v14M5 12h14',
    openDocument: 'M4 6h16v12H4Zm0 3h16M8 14h4',
  };
  const pathData = paths[definition.id];
  if (pathData) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }
  // Fall back to a clean 2-letter monogram derived from the label. Every tool
  // gets a distinguishable mark — no more identical generic-line icons.
  const monogram = labelMonogram(definition.label);
  const text = document.createElementNS(namespace, 'text');
  text.setAttribute('x', '12');
  text.setAttribute('y', '12');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('font-size', '8');
  text.setAttribute('font-weight', '700');
  text.setAttribute('font-family', 'system-ui, sans-serif');
  text.setAttribute('fill', 'currentColor');
  text.textContent = monogram;
  svg.appendChild(text);
  return svg;
}

function labelMonogram(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
