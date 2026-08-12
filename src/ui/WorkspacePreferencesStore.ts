import { resolveStorage, type StorageLike } from '../persistence/storage';

export const WORKSPACE_PREFERENCES_VERSION = 1 as const;
export const WORKSPACE_PREFERENCES_STORAGE_KEY = 'modelling.workspace-preferences.v1';

export type WorkspaceTheme = 'system' | 'light' | 'dark';
export type WorkspaceLengthUnit = 'in' | 'mm';
export type WorkspaceDrawingView = 'front' | 'top' | 'right';

export interface WorkspacePreferences {
  toolbarDensity: 'compact' | 'comfortable';
  sidebars: {
    left: { collapsed: boolean; width: number };
    right: { collapsed: boolean; width: number };
  };
  expandedSections: Record<string, boolean>;
  quickStartDismissed: boolean;
  theme: WorkspaceTheme;
  defaultUnit: WorkspaceLengthUnit;
  viewport: {
    showGrid: boolean;
    showAxes: boolean;
    showGrain: boolean;
  };
  snapping: {
    enabled: boolean;
    stepInches: number;
  };
  drawing: {
    views: WorkspaceDrawingView[];
    scale: number;
    includeDimensions: boolean;
    includeHiddenLines: boolean;
  };
}

export interface VersionedWorkspacePreferences {
  version: typeof WORKSPACE_PREFERENCES_VERSION;
  preferences: WorkspacePreferences;
}

export interface WorkspacePreferencesPatch {
  toolbarDensity?: WorkspacePreferences['toolbarDensity'];
  sidebars?: {
    left?: Partial<WorkspacePreferences['sidebars']['left']>;
    right?: Partial<WorkspacePreferences['sidebars']['right']>;
  };
  expandedSections?: Record<string, boolean>;
  quickStartDismissed?: boolean;
  theme?: WorkspaceTheme;
  defaultUnit?: WorkspaceLengthUnit;
  viewport?: Partial<WorkspacePreferences['viewport']>;
  snapping?: Partial<WorkspacePreferences['snapping']>;
  drawing?: Partial<WorkspacePreferences['drawing']>;
}

export type WorkspacePreferencesLoadIssue =
  | 'storage-unavailable'
  | 'corrupt'
  | 'unsupported-version'
  | null;

export interface WorkspacePreferencesStoreOptions {
  storage?: StorageLike | null;
  storageKey?: string;
  defaults?: WorkspacePreferencesPatch;
}

export type WorkspacePreferencesListener = (
  preferences: Readonly<WorkspacePreferences>
) => void;

const BASE_DEFAULTS: Readonly<WorkspacePreferences> = {
  toolbarDensity: 'compact',
  sidebars: {
    left: { collapsed: true, width: 250 },
    right: { collapsed: true, width: 300 },
  },
  expandedSections: {},
  quickStartDismissed: false,
  theme: 'system',
  defaultUnit: 'in',
  viewport: {
    showGrid: true,
    showAxes: true,
    showGrain: true,
  },
  snapping: {
    enabled: true,
    stepInches: 1 / 16,
  },
  drawing: {
    views: ['front', 'top', 'right'],
    scale: 1,
    includeDimensions: true,
    includeHiddenLines: false,
  },
};

/**
 * Persists machine/workspace preferences separately from the model document.
 *
 * Reads fail closed to validated defaults. Corrupt or future-version payloads are
 * deliberately left untouched so recovery or a later application version can inspect them.
 */
export class WorkspacePreferencesStore {
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly defaults: WorkspacePreferences;
  private readonly listeners = new Set<WorkspacePreferencesListener>();
  private current: WorkspacePreferences | null = null;
  private loadIssue: WorkspacePreferencesLoadIssue = null;

  constructor(options: WorkspacePreferencesStoreOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.storageKey = options.storageKey ?? WORKSPACE_PREFERENCES_STORAGE_KEY;
    this.defaults = normalizePreferences(
      mergePreferences(clonePreferences(BASE_DEFAULTS), options.defaults ?? {})
    );
  }

  load(): WorkspacePreferences {
    if (this.current) {
      return clonePreferences(this.current);
    }

    if (!this.storage) {
      this.loadIssue = 'storage-unavailable';
      this.current = clonePreferences(this.defaults);
      return clonePreferences(this.current);
    }

    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch {
      this.loadIssue = 'storage-unavailable';
      this.current = clonePreferences(this.defaults);
      return clonePreferences(this.current);
    }
    if (raw === null) {
      this.loadIssue = null;
      this.current = clonePreferences(this.defaults);
      try {
        const legacyToolbarCollapsed = this.storage.getItem('modelling.commandToolbarCollapsed');
        if (legacyToolbarCollapsed !== null) {
          this.current.toolbarDensity = legacyToolbarCollapsed === 'false'
            ? 'comfortable'
            : 'compact';
          this.persist(this.current);
          this.storage.removeItem('modelling.commandToolbarCollapsed');
        }
      } catch {
        this.loadIssue = 'storage-unavailable';
      }
      return clonePreferences(this.current);
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || parsed.version !== WORKSPACE_PREFERENCES_VERSION) {
        this.loadIssue = 'unsupported-version';
        this.current = clonePreferences(this.defaults);
        return clonePreferences(this.current);
      }
      if (!isWorkspacePreferences(parsed.preferences)) {
        this.loadIssue = 'corrupt';
        this.current = clonePreferences(this.defaults);
        return clonePreferences(this.current);
      }

      this.loadIssue = null;
      this.current = normalizePreferences(parsed.preferences);
      return clonePreferences(this.current);
    } catch {
      this.loadIssue = 'corrupt';
      this.current = clonePreferences(this.defaults);
      return clonePreferences(this.current);
    }
  }

  getLastLoadIssue(): WorkspacePreferencesLoadIssue {
    return this.loadIssue;
  }

  update(patch: WorkspacePreferencesPatch): WorkspacePreferences {
    const next = normalizePreferences(mergePreferences(this.load(), patch));
    this.current = next;
    this.persist(next);
    this.notify(next);
    return clonePreferences(next);
  }

  replace(preferences: WorkspacePreferences): WorkspacePreferences {
    const next = normalizePreferences(preferences);
    this.current = next;
    this.persist(next);
    this.notify(next);
    return clonePreferences(next);
  }

  reset(): WorkspacePreferences {
    this.loadIssue = null;
    try {
      this.storage?.removeItem(this.storageKey);
    } catch {
      this.loadIssue = 'storage-unavailable';
    }
    this.current = clonePreferences(this.defaults);
    this.notify(this.current);
    return clonePreferences(this.current);
  }

  subscribe(listener: WorkspacePreferencesListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persist(preferences: WorkspacePreferences): void {
    if (!this.storage) {
      return;
    }

    const document: VersionedWorkspacePreferences = {
      version: WORKSPACE_PREFERENCES_VERSION,
      preferences: clonePreferences(preferences),
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(document));
    } catch {
      this.loadIssue = 'storage-unavailable';
    }
  }

  private notify(preferences: WorkspacePreferences): void {
    for (const listener of this.listeners) {
      listener(clonePreferences(preferences));
    }
  }
}

function mergePreferences(
  base: WorkspacePreferences,
  patch: WorkspacePreferencesPatch
): WorkspacePreferences {
  return {
    toolbarDensity: patch.toolbarDensity ?? base.toolbarDensity,
    sidebars: {
      left: { ...base.sidebars.left, ...patch.sidebars?.left },
      right: { ...base.sidebars.right, ...patch.sidebars?.right },
    },
    expandedSections: patch.expandedSections
      ? { ...base.expandedSections, ...patch.expandedSections }
      : { ...base.expandedSections },
    quickStartDismissed: patch.quickStartDismissed ?? base.quickStartDismissed,
    theme: patch.theme ?? base.theme,
    defaultUnit: patch.defaultUnit ?? base.defaultUnit,
    viewport: { ...base.viewport, ...patch.viewport },
    snapping: { ...base.snapping, ...patch.snapping },
    drawing: {
      ...base.drawing,
      ...patch.drawing,
      views: patch.drawing?.views
        ? [...patch.drawing.views]
        : [...base.drawing.views],
    },
  };
}

function normalizePreferences(preferences: WorkspacePreferences): WorkspacePreferences {
  if (!isWorkspacePreferences(preferences)) {
    throw new Error('Workspace preferences are invalid');
  }
  return clonePreferences(preferences);
}

function clonePreferences(
  preferences: Readonly<WorkspacePreferences>
): WorkspacePreferences {
  return {
    toolbarDensity: preferences.toolbarDensity,
    sidebars: {
      left: { ...preferences.sidebars.left },
      right: { ...preferences.sidebars.right },
    },
    expandedSections: { ...preferences.expandedSections },
    quickStartDismissed: preferences.quickStartDismissed,
    theme: preferences.theme,
    defaultUnit: preferences.defaultUnit,
    viewport: { ...preferences.viewport },
    snapping: { ...preferences.snapping },
    drawing: {
      ...preferences.drawing,
      views: [...preferences.drawing.views],
    },
  };
}

function isWorkspacePreferences(value: unknown): value is WorkspacePreferences {
  if (!isRecord(value)) {
    return false;
  }
  if (value.toolbarDensity !== 'compact' && value.toolbarDensity !== 'comfortable') {
    return false;
  }
  if (
    !isRecord(value.sidebars)
    || !isSidebarPreference(value.sidebars.left)
    || !isSidebarPreference(value.sidebars.right)
    || !isRecord(value.expandedSections)
    || !Object.values(value.expandedSections).every((expanded) => typeof expanded === 'boolean')
    || typeof value.quickStartDismissed !== 'boolean'
  ) {
    return false;
  }
  if (!['system', 'light', 'dark'].includes(String(value.theme))) {
    return false;
  }
  if (value.defaultUnit !== 'in' && value.defaultUnit !== 'mm') {
    return false;
  }
  if (!isRecord(value.viewport) || !hasBooleanFields(value.viewport, [
    'showGrid', 'showAxes', 'showGrain',
  ])) {
    return false;
  }
  if (
    !isRecord(value.snapping)
    || typeof value.snapping.enabled !== 'boolean'
    || !isFinitePositive(value.snapping.stepInches)
  ) {
    return false;
  }
  if (
    !isRecord(value.drawing)
    || !Array.isArray(value.drawing.views)
    || value.drawing.views.length === 0
    || new Set(value.drawing.views).size !== value.drawing.views.length
    || !value.drawing.views.every((view) => (
      view === 'front' || view === 'top' || view === 'right'
    ))
    || !isFinitePositive(value.drawing.scale)
    || typeof value.drawing.includeDimensions !== 'boolean'
    || typeof value.drawing.includeHiddenLines !== 'boolean'
  ) {
    return false;
  }
  return true;
}

function isSidebarPreference(value: unknown): boolean {
  return isRecord(value)
    && typeof value.collapsed === 'boolean'
    && typeof value.width === 'number'
    && Number.isFinite(value.width)
    && value.width >= 180
    && value.width <= 640;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasBooleanFields(
  value: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.every((field) => typeof value[field] === 'boolean');
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
