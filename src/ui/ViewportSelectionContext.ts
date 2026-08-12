import type { SubObjectType } from '../geometry/SubObjectTypes';

const SELECTION_MODES: ReadonlyArray<{
  mode: SubObjectType;
  label: string;
  title: string;
}> = [
  { mode: 'body', label: 'Body', title: 'Select and move whole bodies' },
  { mode: 'face', label: 'Face', title: 'Select planar faces' },
  { mode: 'edge', label: 'Edge', title: 'Select and manipulate edges' },
  { mode: 'vertex', label: 'Vertex', title: 'Select and manipulate vertices' },
];

export interface ViewportSelectionDisplay {
  /** User-facing selection type, such as "Body" or "Planar face". */
  kind: string;
  /** Human-readable model name. Topology IDs should not be supplied here. */
  name: string;
  /** Optional concise context, such as dimensions or a face orientation. */
  detail?: string;
}

export interface ViewportSelectionAction {
  id: string;
  label: string;
  title?: string;
  disabled?: boolean;
  primary?: boolean;
}

export interface ViewportSelectionContextState {
  mode: SubObjectType;
  selection: ViewportSelectionDisplay | null;
  actions?: readonly ViewportSelectionAction[];
  hint?: string;
}

export interface ViewportSelectionContextOptions {
  initialState?: ViewportSelectionContextState;
  onModeChange?: (mode: SubObjectType) => void;
  onAction?: (actionId: string) => void;
}

/**
 * Compact viewport affordance for choosing a pick mode and acting on the
 * current selection. It intentionally consumes display labels rather than
 * stable model IDs so normal selection feedback stays readable.
 */
export class ViewportSelectionContext {
  private readonly container: HTMLElement;
  private readonly options: ViewportSelectionContextOptions;
  private readonly root: HTMLElement;
  private state: ViewportSelectionContextState;
  private disposed = false;

  constructor(container: HTMLElement, options: ViewportSelectionContextOptions = {}) {
    this.container = container;
    this.options = options;
    this.state = options.initialState ?? {
      mode: 'body',
      selection: null,
    };

    this.root = document.createElement('section');
    this.root.className = 'viewport-selection-context';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Current selection');
    this.root.dataset.testid = 'selection-context';
    // Camera controls listen on the viewport container. Do not let presses on
    // this overlay become orbit gestures before a button can receive `click`.
    for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
      this.root.addEventListener(eventName, (event) => event.stopPropagation());
    }
    this.container.appendChild(this.root);
    this.render();
  }

  refresh(state: ViewportSelectionContextState): void {
    if (this.disposed) return;
    this.state = state;
    this.render();
  }

  getMode(): SubObjectType {
    return this.state.mode;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
  }

  private render(): void {
    this.root.replaceChildren();

    const modeGroup = document.createElement('div');
    modeGroup.className = 'viewport-selection-context__modes';
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', 'Selection mode');

    for (const definition of SELECTION_MODES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'viewport-selection-context__mode';
      button.textContent = definition.label;
      button.title = definition.title;
      button.dataset.testid = `selection-mode-${definition.mode}`;
      button.setAttribute('aria-pressed', String(this.state.mode === definition.mode));
      if (this.state.mode === definition.mode) {
        button.dataset.active = 'true';
      }
      button.addEventListener('click', () => {
        if (this.state.mode === definition.mode) return;
        this.state = { ...this.state, mode: definition.mode };
        this.render();
        this.options.onModeChange?.(definition.mode);
      });
      modeGroup.appendChild(button);
    }
    this.root.appendChild(modeGroup);

    const summary = document.createElement('div');
    summary.className = 'viewport-selection-context__summary';
    summary.setAttribute('aria-live', 'polite');

    if (!this.state.selection) {
      const hint = document.createElement('p');
      hint.className = 'viewport-selection-context__hint';
      hint.dataset.testid = 'selection-hint';
      hint.textContent = this.state.hint ?? `Click a ${this.state.mode} to select it.`;
      summary.appendChild(hint);
      this.root.appendChild(summary);
      return;
    }

    const heading = document.createElement('div');
    heading.className = 'viewport-selection-context__heading';

    const kind = document.createElement('span');
    kind.className = 'viewport-selection-context__kind';
    kind.dataset.testid = 'selection-kind';
    kind.textContent = this.state.selection.kind;
    heading.appendChild(kind);

    const name = document.createElement('strong');
    name.className = 'viewport-selection-context__name';
    name.dataset.testid = 'selection-name';
    name.textContent = this.state.selection.name;
    heading.appendChild(name);
    summary.appendChild(heading);

    if (this.state.selection.detail) {
      const detail = document.createElement('span');
      detail.className = 'viewport-selection-context__detail';
      detail.dataset.testid = 'selection-detail';
      detail.textContent = this.state.selection.detail;
      summary.appendChild(detail);
    }

    const availableActions = this.state.actions ?? [];
    if (availableActions.length > 0) {
      const actions = document.createElement('div');
      actions.className = 'viewport-selection-context__actions';
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', 'Selection actions');

      for (const action of availableActions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'viewport-selection-context__action';
        if (action.primary) button.dataset.primary = 'true';
        button.dataset.testid = `selection-action-${action.id}`;
        button.textContent = action.label;
        button.title = action.title ?? action.label;
        button.disabled = action.disabled ?? false;
        button.addEventListener('click', () => this.options.onAction?.(action.id));
        actions.appendChild(button);
      }
      summary.appendChild(actions);
    }

    this.root.appendChild(summary);
  }
}

export function createViewportSelectionContext(
  container: HTMLElement,
  options?: ViewportSelectionContextOptions,
): ViewportSelectionContext {
  return new ViewportSelectionContext(container, options);
}
