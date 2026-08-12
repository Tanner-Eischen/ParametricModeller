import {
  CollapsiblePanelSection,
  type CollapsiblePanelSectionOptions,
} from '../ui/CollapsiblePanelSection';
import type { WorkspacePreferences, WorkspacePreferencesStore } from '../ui/WorkspacePreferencesStore';
import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('PanelChrome');

export interface PanelSectionCreateOptions {
  description?: string;
  hidden?: boolean;
}

/**
 * Owns the registry of collapsible right/left panel sections and their
 * expand/collapse/show/hide state. Extracted from App so panel layout is a
 * single concern: callers create a titled section, then drive its visibility
 * without touching CollapsiblePanelSection internals.
 *
 * Expanded/collapsed state is persisted per-title via the workspace preferences
 * store; show/hide is transient (driven by app context such as active tools).
 */
export class PanelChrome {
  private readonly sections = new Map<string, CollapsiblePanelSection>();
  private readonly store: WorkspacePreferencesStore;
  private readonly getPreferences: () => WorkspacePreferences;
  private readonly onPreferencesChanged: (prefs: WorkspacePreferences) => void;

  constructor(deps: {
    store: WorkspacePreferencesStore;
    getPreferences: () => WorkspacePreferences;
    onPreferencesChanged: (prefs: WorkspacePreferences) => void;
  }) {
    this.store = deps.store;
    this.getPreferences = deps.getPreferences;
    this.onPreferencesChanged = deps.onPreferencesChanged;
  }

  /**
   * Create a titled section under `parent` and return its content element.
   * The section is registered so it can be expanded/collapsed/shown/hidden
   * later by title. Re-registering a title replaces the previous entry.
   */
  createContainer(
    parent: HTMLElement,
    title: string,
    options: PanelSectionCreateOptions = {},
  ): HTMLElement {
    const sectionOptions: CollapsiblePanelSectionOptions = {
      expanded: this.getPreferences().expandedSections[title] ?? false,
      onExpandedChange: (expanded) => {
        const updated = this.store.update({
          expandedSections: { [title]: expanded },
        });
        this.onPreferencesChanged(updated);
      },
    };
    if (options.description !== undefined) sectionOptions.description = options.description;
    if (options.hidden !== undefined) sectionOptions.hidden = options.hidden;
    const section = new CollapsiblePanelSection(parent, title, sectionOptions);
    this.sections.set(title, section);
    log.debug('Panel section created', { title });
    return section.content;
  }

  has(title: string): boolean {
    return this.sections.has(title);
  }

  expand(title: string): void {
    this.sections.get(title)?.setExpanded(true);
  }

  collapse(title: string): void {
    this.sections.get(title)?.setExpanded(false);
  }

  show(title: string): void {
    this.setHidden(title, false);
  }

  hide(title: string): void {
    this.setHidden(title, true);
  }

  /** Generalized visibility control used for context-driven sections. */
  setHidden(title: string, hidden: boolean): void {
    this.sections.get(title)?.setHidden(hidden);
  }

  focusToggle(title: string): void {
    this.sections.get(title)?.focusToggle();
  }
}
