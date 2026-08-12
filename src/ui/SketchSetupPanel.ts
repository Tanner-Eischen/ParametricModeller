import { createModuleLogger } from '../core/logger';
import {
  parseNumericInput,
  type NumericInputResult,
  type NumericUnit,
} from '../interaction/NumericInput';

export type SketchPlaneSelection = 'xy' | 'xz' | 'yz';
export type SketchToolSelection =
  | 'select'
  | 'line'
  | 'rectangle'
  | 'center-rectangle'
  | 'regular-polygon'
  | 'dimension'
  | 'constraint'
  | 'trim'
  | 'extend'
  | 'project'
  | null;

export type SketchConstraintSelection =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'fixed'
  | 'distance'
  | 'angle';

export interface SketchProfileDiagnostic {
  code: string;
  message: string;
  severity?: 'error' | 'warning' | 'info';
  entityIds?: string[];
}

export interface SketchNumericSubmission {
  raw: string;
  result: NumericInputResult;
}

export interface SketchSetupPanelState {
  activePlane: SketchPlaneSelection | null;
  activeTool: SketchToolSelection;
  canSketchOnSelectedFace: boolean;
  canAddRectangle: boolean;
  canAddLine: boolean;
  canExitSketch: boolean;
  canCommit: boolean;
  canCancel: boolean;
  disabledTools: Exclude<SketchToolSelection, null>[];
  numericLabel: string;
  numericValue: string;
  numericUnit: NumericUnit;
  numericPlaceholder: string;
  numericError: string | null;
  numericEnabled: boolean;
  polygonSides: number;
  constraintType: SketchConstraintSelection;
  profileDiagnostics: SketchProfileDiagnostic[];
  statusMessage: string | null;
}

export interface SketchSetupPanelOptions {
  container?: HTMLElement;
  state?: Partial<SketchSetupPanelState>;
  onPickWorldPlane?: (plane: SketchPlaneSelection) => void;
  onSketchSelectedFace?: () => void;
  onAddRectangle?: () => void;
  onAddLine?: () => void;
  onSelectTool?: (tool: Exclude<SketchToolSelection, null>) => void;
  onNumericSubmit?: (submission: SketchNumericSubmission) => void;
  onNumericExpression?: (rawExpression: string) => void;
  onUnitChange?: (unit: NumericUnit) => void;
  onPolygonSidesChange?: (sides: number) => void;
  onConstraintChange?: (constraint: SketchConstraintSelection) => void;
  onProfileDiagnosticClick?: (diagnostic: SketchProfileDiagnostic, index: number) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  onExitSketch?: () => void;
}

const DEFAULT_STATE: SketchSetupPanelState = {
  activePlane: null,
  activeTool: null,
  canSketchOnSelectedFace: true,
  canAddRectangle: true,
  canAddLine: true,
  canExitSketch: true,
  canCommit: true,
  canCancel: true,
  disabledTools: [],
  numericLabel: 'Value',
  numericValue: '',
  numericUnit: 'in',
  numericPlaceholder: 'e.g. 3/4 in or 25 mm',
  numericError: null,
  numericEnabled: true,
  polygonSides: 6,
  constraintType: 'coincident',
  profileDiagnostics: [],
  statusMessage: null,
};

const TOOL_GROUPS: Array<{
  label: string;
  tools: Array<{ id: Exclude<SketchToolSelection, null>; label: string; title: string }>;
}> = [
  {
    label: 'Sketch primitives',
    tools: [
      { id: 'select', label: 'Select', title: 'Select and edit sketch geometry' },
      { id: 'line', label: 'Line', title: 'Draw connected line segments' },
      { id: 'rectangle', label: 'Rectangle', title: 'Draw a corner rectangle' },
      { id: 'center-rectangle', label: 'Center rectangle', title: 'Draw a rectangle from its center' },
      { id: 'regular-polygon', label: 'Polygon', title: 'Draw a regular polygon' },
    ],
  },
  {
    label: 'Constrain and modify',
    tools: [
      { id: 'dimension', label: 'Dimension', title: 'Add a driving dimension' },
      { id: 'constraint', label: 'Constraints', title: 'Apply a geometric constraint' },
      { id: 'trim', label: 'Trim', title: 'Trim geometry at its nearest boundary' },
      { id: 'extend', label: 'Extend', title: 'Extend geometry to a boundary' },
      { id: 'project', label: 'Project', title: 'Project model edges into this sketch' },
    ],
  },
];

const CONSTRAINTS: Array<{ id: SketchConstraintSelection; label: string }> = [
  { id: 'coincident', label: 'Coincident' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'parallel', label: 'Parallel' },
  { id: 'perpendicular', label: 'Perpendicular' },
  { id: 'equal', label: 'Equal' },
  { id: 'fixed', label: 'Fix' },
  { id: 'distance', label: 'Distance' },
];

const NUMERIC_UNITS: NumericUnit[] = ['in', 'mm', 'cm', 'ft', 'm'];
const log = createModuleLogger('SketchSetupPanel');

export class SketchSetupPanel {
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private state: SketchSetupPanelState = { ...DEFAULT_STATE };
  private readonly callbacks: Omit<SketchSetupPanelOptions, 'container' | 'state'>;
  private localNumericError: string | null = null;

  constructor(options: SketchSetupPanelOptions = {}) {
    this.state = {
      ...DEFAULT_STATE,
      ...(options.state ?? {}),
      disabledTools: [...(options.state?.disabledTools ?? DEFAULT_STATE.disabledTools)],
      profileDiagnostics: [...(options.state?.profileDiagnostics ?? DEFAULT_STATE.profileDiagnostics)],
    };
    const { container, state: _state, ...callbacks } = options;
    this.callbacks = callbacks;
    if (container) this.attachTo(container);
  }

  attachTo(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  refreshState(nextState: Partial<SketchSetupPanelState>): void {
    this.state = {
      ...this.state,
      ...nextState,
      ...(nextState.disabledTools ? { disabledTools: [...nextState.disabledTools] } : {}),
      ...(nextState.profileDiagnostics ? { profileDiagnostics: [...nextState.profileDiagnostics] } : {}),
    };
    this.localNumericError = null;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.container = null;
    log.debug('SketchSetupPanel disposed');
  }

  private render(): void {
    if (!this.container) return;

    this.root?.remove();
    this.root = document.createElement('section');
    this.root.className = 'sketch-setup-panel';
    this.root.setAttribute('aria-label', 'Sketch tools');

    this.root.appendChild(this.renderHeader());
    this.root.appendChild(this.renderPlaneControls());
    for (const group of TOOL_GROUPS) this.root.appendChild(this.renderToolGroup(group));
    this.root.appendChild(this.renderContextControls());
    this.root.appendChild(this.renderDiagnostics());
    this.root.appendChild(this.renderFooter());
    this.root.appendChild(this.renderHints());

    this.container.appendChild(this.root);
    log.debug('SketchSetupPanel rendered', this.state);
  }

  private renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'sketch-setup-panel__header';
    const title = document.createElement('div');
    title.className = 'sketch-setup-panel__title';
    title.textContent = 'Sketch setup';
    header.appendChild(title);
    const description = document.createElement('p');
    description.className = 'sketch-setup-panel__description';
    description.textContent = 'Choose a plane, draw precise profiles, then dimension and constrain them.';
    header.appendChild(description);
    return header;
  }

  private renderPlaneControls(): HTMLElement {
    const group = this.createGroup('World planes');
    const buttons = document.createElement('div');
    buttons.className = 'sketch-setup-panel__buttons';
    for (const plane of ['xy', 'xz', 'yz'] as const) {
      buttons.appendChild(this.createButton({
        label: plane.toUpperCase(),
        title: `Start a sketch on the ${plane.toUpperCase()} plane`,
        active: this.state.activePlane === plane,
        dataset: ['plane', plane],
        onClick: () => this.callbacks.onPickWorldPlane?.(plane),
      }));
    }
    group.appendChild(buttons);

    const faceButton = this.createButton({
      label: 'Sketch on selected face',
      title: 'Use the picked face as the sketch plane',
      disabled: !this.state.canSketchOnSelectedFace,
      className: 'sketch-setup-panel__action',
      onClick: () => this.callbacks.onSketchSelectedFace?.(),
    });
    group.appendChild(faceButton);
    return group;
  }

  private renderToolGroup(groupDefinition: (typeof TOOL_GROUPS)[number]): HTMLElement {
    const group = this.createGroup(groupDefinition.label);
    const buttons = document.createElement('div');
    buttons.className = 'sketch-setup-panel__buttons sketch-setup-panel__buttons--tools';
    for (const tool of groupDefinition.tools) {
      buttons.appendChild(this.createButton({
        label: tool.label,
        title: tool.title,
        active: this.state.activeTool === tool.id,
        disabled: this.isToolDisabled(tool.id),
        dataset: ['tool', tool.id],
        onClick: () => this.selectTool(tool.id),
      }));
    }
    group.appendChild(buttons);
    return group;
  }

  private renderContextControls(): HTMLElement {
    const group = this.createGroup('Tool options');
    group.classList.add('sketch-setup-panel__context');

    const status = document.createElement('div');
    status.className = 'sketch-setup-panel__status';
    status.setAttribute('role', 'status');
    status.textContent = this.state.statusMessage ?? this.getToolMessage();
    group.appendChild(status);

    if (this.state.activeTool === 'regular-polygon') {
      const row = this.createFieldRow('Sides');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '3';
      input.max = '64';
      input.step = '1';
      input.value = String(this.state.polygonSides);
      input.dataset.testid = 'polygon-sides';
      input.addEventListener('change', () => {
        const sides = Number(input.value);
        if (Number.isInteger(sides) && sides >= 3 && sides <= 64) {
          this.callbacks.onPolygonSidesChange?.(sides);
        }
      });
      row.appendChild(input);
      group.appendChild(row);
    }

    if (this.state.activeTool === 'constraint') {
      const row = this.createFieldRow('Constraint');
      const select = document.createElement('select');
      select.dataset.testid = 'constraint-choice';
      for (const constraint of CONSTRAINTS) {
        const option = document.createElement('option');
        option.value = constraint.id;
        option.textContent = constraint.label;
        option.selected = constraint.id === this.state.constraintType;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        this.callbacks.onConstraintChange?.(select.value as SketchConstraintSelection);
      });
      row.appendChild(select);
      group.appendChild(row);
    }

    if (this.shouldShowNumericInput()) group.appendChild(this.renderNumericInput());
    return group;
  }

  private renderNumericInput(): HTMLElement {
    const form = document.createElement('form');
    form.className = 'sketch-setup-panel__numeric';
    form.dataset.testid = 'sketch-numeric-form';

    const label = document.createElement('label');
    label.textContent = this.state.numericLabel;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = this.state.numericValue;
    input.placeholder = this.state.numericPlaceholder;
    input.autocomplete = 'off';
    input.dataset.testid = 'sketch-numeric-input';
    input.disabled = !this.state.numericEnabled;
    input.setAttribute(
      'aria-describedby',
      this.state.numericEnabled ? 'sketch-numeric-hint' : 'sketch-numeric-selection-required'
    );
    label.appendChild(input);
    form.appendChild(label);

    const unit = document.createElement('select');
    unit.setAttribute('aria-label', 'Default unit');
    unit.dataset.testid = 'sketch-unit';
    unit.disabled = !this.state.numericEnabled;
    for (const candidate of NUMERIC_UNITS) {
      const option = document.createElement('option');
      option.value = candidate;
      option.textContent = candidate;
      option.selected = candidate === this.state.numericUnit;
      unit.appendChild(option);
    }
    unit.addEventListener('change', () => this.callbacks.onUnitChange?.(unit.value as NumericUnit));
    form.appendChild(unit);

    const apply = document.createElement('button');
    apply.type = 'submit';
    apply.className = 'sketch-setup-panel__button';
    apply.textContent = 'Apply';
    apply.disabled = !this.state.numericEnabled;
    form.appendChild(apply);

    const hint = document.createElement('div');
    hint.id = this.state.numericEnabled ? 'sketch-numeric-hint' : 'sketch-numeric-selection-required';
    hint.className = 'sketch-setup-panel__field-hint';
    hint.textContent = this.state.numericEnabled
      ? 'Fractions, arithmetic, metric, and imperial units are accepted.'
      : 'Select exactly one segment or exactly two endpoints first.';
    form.appendChild(hint);

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      form.requestSubmit();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const raw = input.value;
      const result = parseNumericInput(raw, { defaultUnit: unit.value as NumericUnit });
      this.localNumericError = result.ok ? null : result.error;
      this.callbacks.onNumericExpression?.(raw);
      this.callbacks.onNumericSubmit?.({ raw, result });
      this.render();
    });

    const error = this.state.numericError ?? this.localNumericError;
    if (error) {
      const message = document.createElement('div');
      message.className = 'sketch-setup-panel__field-error';
      message.setAttribute('role', 'alert');
      message.textContent = error;
      form.appendChild(message);
    }
    return form;
  }

  private renderDiagnostics(): HTMLElement {
    const group = this.createGroup(`Profile diagnostics (${this.state.profileDiagnostics.length})`);
    group.classList.add('sketch-setup-panel__diagnostics');
    if (this.state.profileDiagnostics.length === 0) {
      const clear = document.createElement('div');
      clear.className = 'sketch-setup-panel__diagnostic-empty';
      clear.textContent = 'No profile issues detected.';
      group.appendChild(clear);
      return group;
    }

    const list = document.createElement('ul');
    for (const [index, diagnostic] of this.state.profileDiagnostics.entries()) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sketch-setup-panel__diagnostic';
      button.dataset.severity = diagnostic.severity ?? 'error';
      button.dataset.diagnosticCode = diagnostic.code;
      button.textContent = `${diagnostic.code}: ${diagnostic.message}`;
      button.addEventListener('click', () => this.callbacks.onProfileDiagnosticClick?.(diagnostic, index));
      item.appendChild(button);
      list.appendChild(item);
    }
    group.appendChild(list);
    return group;
  }

  private renderFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'sketch-setup-panel__footer';
    footer.appendChild(this.createButton({
      label: 'Commit',
      title: 'Commit the active tool (Enter)',
      disabled: !this.state.canCommit,
      className: 'sketch-setup-panel__action sketch-setup-panel__action--primary',
      onClick: () => this.callbacks.onCommit?.(),
    }));
    footer.appendChild(this.createButton({
      label: 'Cancel',
      title: 'Cancel the active tool (Escape)',
      disabled: !this.state.canCancel,
      className: 'sketch-setup-panel__action sketch-setup-panel__action--cancel',
      onClick: () => this.callbacks.onCancel?.(),
    }));
    footer.appendChild(this.createButton({
      label: 'Exit sketch',
      title: 'Leave sketch mode',
      disabled: !this.state.canExitSketch,
      className: 'sketch-setup-panel__action sketch-setup-panel__action--secondary',
      onClick: () => this.callbacks.onExitSketch?.(),
    }));
    return footer;
  }

  private renderHints(): HTMLElement {
    const hints = document.createElement('ul');
    hints.className = 'sketch-setup-panel__hints';
    hints.innerHTML = `
      <li>Start with XY, XZ, or YZ for a world plane, or attach the sketch to a selected face.</li>
      <li><kbd>Enter</kbd> commits the active operation; <kbd>Escape</kbd> cancels it without changing the document.</li>
      <li>Numeric fields accept fractions, expressions, and explicit units such as <code>3/4 in</code> or <code>25 mm</code>.</li>
    `;
    return hints;
  }

  private selectTool(tool: Exclude<SketchToolSelection, null>): void {
    this.callbacks.onSelectTool?.(tool);
    if (tool === 'rectangle') this.callbacks.onAddRectangle?.();
    if (tool === 'line') this.callbacks.onAddLine?.();
  }

  private isToolDisabled(tool: Exclude<SketchToolSelection, null>): boolean {
    if (this.state.disabledTools.includes(tool)) return true;
    if (tool === 'rectangle') return !this.state.canAddRectangle;
    if (tool === 'line') return !this.state.canAddLine;
    return false;
  }

  private shouldShowNumericInput(): boolean {
    return this.state.activeTool !== null && !['select', 'trim', 'extend', 'project'].includes(this.state.activeTool);
  }

  private getToolMessage(): string {
    switch (this.state.activeTool) {
      case 'line': return 'Click to place endpoints. Close the loop to create a profile.';
      case 'rectangle': return 'Pick two opposite corners.';
      case 'center-rectangle': return 'Pick the center, then an outside corner.';
      case 'regular-polygon': return 'Pick the center and a vertex; set the side count below.';
      case 'dimension': return 'Select geometry, then enter the driving value.';
      case 'constraint': return 'Choose a constraint and select compatible geometry.';
      case 'trim': return 'Select the segment portion to remove.';
      case 'extend': return 'Select an endpoint to extend to the nearest boundary.';
      case 'project': return 'Select planar model edges to project into the sketch.';
      case 'select': return 'Select geometry or handles to inspect and edit them.';
      default: return 'Choose a drawing or modify tool.';
    }
  }

  private createGroup(label: string): HTMLElement {
    const group = document.createElement('div');
    group.className = 'sketch-setup-panel__group';
    const heading = document.createElement('div');
    heading.className = 'sketch-setup-panel__group-label';
    heading.textContent = label;
    group.appendChild(heading);
    return group;
  }

  private createFieldRow(labelText: string): HTMLElement {
    const label = document.createElement('label');
    label.className = 'sketch-setup-panel__field';
    const text = document.createElement('span');
    text.textContent = labelText;
    label.appendChild(text);
    return label;
  }

  private createButton(options: {
    label: string;
    title: string;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    className?: string;
    dataset?: [string, string];
  }): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = options.className ?? 'sketch-setup-panel__button';
    button.textContent = options.label;
    button.title = options.title;
    button.disabled = options.disabled ?? false;
    button.dataset.active = String(options.active ?? false);
    button.setAttribute('aria-pressed', String(options.active ?? false));
    if (options.dataset) button.dataset[options.dataset[0]] = options.dataset[1];
    button.addEventListener('click', options.onClick);
    return button;
  }
}

export function createSketchSetupPanel(options: SketchSetupPanelOptions = {}): SketchSetupPanel {
  return new SketchSetupPanel(options);
}
