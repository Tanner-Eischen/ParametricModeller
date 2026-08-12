import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('ContextTaskPanel');

export type ContextTaskFieldValue = string | number | boolean | null;

export interface ContextTaskSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ContextTaskFieldDescriptor {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'readonly';
  value: ContextTaskFieldValue;
  options?: readonly ContextTaskSelectOption[];
  placeholder?: string;
  unit?: string;
  help?: string;
  error?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export interface ContextTaskActionDescriptor {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
  title?: string;
  shortcut?: string;
  disabled?: boolean;
}

export interface ContextTaskPanelState {
  toolName: string;
  instructions: string | readonly string[];
  status?: string;
  fields?: readonly ContextTaskFieldDescriptor[];
  actions?: readonly ContextTaskActionDescriptor[];
  canCommit?: boolean;
  canCancel?: boolean;
  commitLabel?: string;
  cancelLabel?: string;
}

export interface ContextTaskPanelOptions {
  container?: HTMLElement;
  state?: ContextTaskPanelState | null;
  onFieldChange?: (fieldId: string, value: ContextTaskFieldValue) => void;
  onAction?: (actionId: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
}

export class ContextTaskPanel {
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private state: ContextTaskPanelState | null;
  private rendering = false;
  private renderPending = false;
  private readonly callbacks: Omit<ContextTaskPanelOptions, 'container' | 'state'>;

  constructor(options: ContextTaskPanelOptions = {}) {
    this.state = options.state ?? null;
    const { container, state: _state, ...callbacks } = options;
    this.callbacks = callbacks;
    if (container) this.attachTo(container);
  }

  attachTo(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  refreshState(state: ContextTaskPanelState | null): void {
    this.state = state;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  isActive(): boolean {
    return this.state !== null;
  }

  setCommitEnabled(enabled: boolean): void {
    if (!this.state) return;
    this.state = { ...this.state, canCommit: enabled };
    const commit = this.root?.querySelector<HTMLButtonElement>('[data-testid="context-task-commit"]');
    if (commit) commit.disabled = !enabled;
  }

  setFieldError(fieldId: string, error: string | null): void {
    if (!this.state?.fields) return;
    const field = this.state.fields.find((candidate) => candidate.id === fieldId);
    if (!field) return;
    this.state = {
      ...this.state,
      fields: this.state.fields.map((candidate) => {
        if (candidate.id !== fieldId) return candidate;
        const { error: _existingError, ...descriptor } = candidate;
        return error ? { ...descriptor, error } : descriptor;
      }),
    };

    const wrapper = Array.from(
      this.root?.querySelectorAll<HTMLElement>('.context-task-panel__field') ?? []
    ).find((candidate) => candidate.dataset.fieldId === fieldId);
    const control = wrapper?.querySelector<HTMLElement>('.context-task-panel__control');
    if (!wrapper || !control) return;

    const inputId = `context-task-field-${fieldId}`;
    const errorId = `${inputId}-error`;
    wrapper.querySelector(`#${errorId}`)?.remove();
    if (error) {
      const message = document.createElement('div');
      message.id = errorId;
      message.className = 'context-task-panel__error';
      message.setAttribute('role', 'alert');
      message.textContent = error;
      wrapper.appendChild(message);
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute(
        'aria-describedby',
        field.help ? `${inputId}-help ${errorId}` : errorId
      );
      return;
    }

    control.removeAttribute('aria-invalid');
    if (field.help) control.setAttribute('aria-describedby', `${inputId}-help`);
    else control.removeAttribute('aria-describedby');
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.container = null;
    log.debug('ContextTaskPanel disposed');
  }

  private render(): void {
    if (this.rendering) {
      this.renderPending = true;
      return;
    }

    this.rendering = true;
    try {
      this.renderNow();
    } finally {
      this.rendering = false;
      if (this.renderPending) {
        this.renderPending = false;
        this.render();
      }
    }
  }

  private renderNow(): void {
    this.root?.remove();
    this.root = null;
    if (!this.container || !this.state) return;

    const root = document.createElement('section');
    root.className = 'context-task-panel';
    root.dataset.testid = 'context-task-panel';
    root.setAttribute('aria-label', `${this.state.toolName} task controls`);
    root.addEventListener('keydown', (event) => this.handleKeyDown(event));

    const header = document.createElement('header');
    header.className = 'context-task-panel__header';
    const title = document.createElement('h2');
    title.className = 'context-task-panel__title';
    title.textContent = this.state.toolName;
    header.appendChild(title);
    if (this.state.status) {
      const status = document.createElement('div');
      status.className = 'context-task-panel__status';
      status.setAttribute('role', 'status');
      status.textContent = this.state.status;
      header.appendChild(status);
    }
    root.appendChild(header);
    root.appendChild(this.renderInstructions());

    if (this.state.fields?.length) {
      const fields = document.createElement('div');
      fields.className = 'context-task-panel__fields';
      fields.setAttribute('aria-label', 'Tool parameters');
      for (const field of this.state.fields) fields.appendChild(this.renderField(field));
      root.appendChild(fields);
    }

    if (this.state.actions?.length) {
      const actions = document.createElement('div');
      actions.className = 'context-task-panel__actions';
      for (const action of this.state.actions) actions.appendChild(this.renderAction(action));
      root.appendChild(actions);
    }

    root.appendChild(this.renderFooter());
    this.container.appendChild(root);
    this.root = root;
    log.debug('Context task panel rendered', { toolName: this.state.toolName });
  }

  private renderInstructions(): HTMLElement {
    const instructions = document.createElement('div');
    instructions.className = 'context-task-panel__instructions';
    const lines = typeof this.state?.instructions === 'string'
      ? [this.state.instructions]
      : this.state?.instructions ?? [];
    if (lines.length === 1) {
      const text = document.createElement('p');
      text.textContent = lines[0] ?? '';
      instructions.appendChild(text);
    } else {
      const list = document.createElement('ol');
      for (const line of lines) {
        const item = document.createElement('li');
        item.textContent = line;
        list.appendChild(item);
      }
      instructions.appendChild(list);
    }
    return instructions;
  }

  private renderField(field: ContextTaskFieldDescriptor): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'context-task-panel__field';
    wrapper.dataset.fieldId = field.id;
    const inputId = `context-task-field-${field.id}`;

    const label = document.createElement('label');
    label.htmlFor = inputId;
    label.textContent = field.label;
    wrapper.appendChild(label);

    let control: HTMLInputElement | HTMLSelectElement | HTMLOutputElement;
    if (field.type === 'select') {
      const select = document.createElement('select');
      for (const descriptor of field.options ?? []) {
        const option = document.createElement('option');
        option.value = descriptor.value;
        option.textContent = descriptor.label;
        option.disabled = descriptor.disabled ?? false;
        option.selected = descriptor.value === String(field.value ?? '');
        select.appendChild(option);
      }
      select.addEventListener('change', () => this.callbacks.onFieldChange?.(field.id, select.value));
      control = select;
    } else if (field.type === 'readonly') {
      const output = document.createElement('output');
      output.textContent = String(field.value ?? '');
      control = output;
    } else {
      const input = document.createElement('input');
      input.type = field.type;
      if (field.type === 'checkbox') {
        input.checked = Boolean(field.value);
        input.addEventListener('change', () => this.callbacks.onFieldChange?.(field.id, input.checked));
      } else {
        input.value = String(field.value ?? '');
        input.placeholder = field.placeholder ?? '';
        if (field.type === 'number') {
          if (field.min !== undefined) input.min = String(field.min);
          if (field.max !== undefined) input.max = String(field.max);
          if (field.step !== undefined) input.step = String(field.step);
        }
        const notifyValueChange = (): void => {
          const value = field.type === 'number' && input.value !== '' ? Number(input.value) : input.value;
          this.callbacks.onFieldChange?.(field.id, value);
        };
        input.addEventListener('change', notifyValueChange);
        input.addEventListener('input', notifyValueChange);
      }
      control = input;
    }

    control.id = inputId;
    control.className = 'context-task-panel__control';
    if ('disabled' in control) control.disabled = field.disabled ?? false;
    if (field.error) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', `${inputId}-error`);
    } else if (field.help) {
      control.setAttribute('aria-describedby', `${inputId}-help`);
    }
    wrapper.appendChild(control);
    if (field.unit) {
      const unit = document.createElement('span');
      unit.className = 'context-task-panel__unit';
      unit.textContent = field.unit;
      wrapper.appendChild(unit);
    }
    if (field.help) {
      const help = document.createElement('small');
      help.id = `${inputId}-help`;
      help.className = 'context-task-panel__help';
      help.textContent = field.help;
      wrapper.appendChild(help);
    }
    if (field.error) {
      const error = document.createElement('div');
      error.id = `${inputId}-error`;
      error.className = 'context-task-panel__error';
      error.setAttribute('role', 'alert');
      error.textContent = field.error;
      wrapper.appendChild(error);
    }
    return wrapper;
  }

  private renderAction(action: ContextTaskActionDescriptor): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `context-task-panel__action context-task-panel__action--${action.kind ?? 'secondary'}`;
    button.dataset.actionId = action.id;
    button.disabled = action.disabled ?? false;
    button.title = action.title ?? action.label;
    button.textContent = action.shortcut ? `${action.label} (${action.shortcut})` : action.label;
    button.addEventListener('click', () => this.callbacks.onAction?.(action.id));
    return button;
  }

  private renderFooter(): HTMLElement {
    const footer = document.createElement('footer');
    footer.className = 'context-task-panel__footer';
    const commit = document.createElement('button');
    commit.type = 'button';
    commit.className = 'context-task-panel__commit';
    commit.dataset.testid = 'context-task-commit';
    commit.disabled = !(this.state?.canCommit ?? true);
    commit.textContent = this.state?.commitLabel ?? 'Commit';
    commit.title = `${commit.textContent} (Enter)`;
    commit.addEventListener('click', () => this.callbacks.onCommit?.());
    footer.appendChild(commit);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'context-task-panel__cancel';
    cancel.dataset.testid = 'context-task-cancel';
    cancel.disabled = !(this.state?.canCancel ?? true);
    cancel.textContent = this.state?.cancelLabel ?? 'Cancel';
    cancel.title = `${cancel.textContent} (Escape)`;
    cancel.addEventListener('click', () => this.callbacks.onCancel?.());
    footer.appendChild(cancel);
    return footer;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && (this.state?.canCancel ?? true)) {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onCancel?.();
      return;
    }
    if (event.key === 'Enter' && (this.state?.canCommit ?? true)) {
      const target = event.target;
      if (target instanceof HTMLButtonElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onCommit?.();
    }
  }
}
