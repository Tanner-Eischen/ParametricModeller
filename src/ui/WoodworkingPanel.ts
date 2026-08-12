export type WoodworkingAxis = 'x' | 'y' | 'z';

export interface WoodworkingMetadataDraft {
  isBoard: boolean;
  label: string;
  material: string;
  thicknessAxis: WoodworkingAxis;
  grainAxis: WoodworkingAxis;
  notes: string;
}

export interface WoodworkingMeasurementView {
  length: string;
  width: string;
  thickness: string;
  units: string;
}

export interface WoodworkingPanelState {
  bodyId: string | null;
  bodyName: string | null;
  metadata: WoodworkingMetadataDraft;
  measurement: WoodworkingMeasurementView | null;
  canExport: boolean;
}

export interface WoodworkingPanelOptions {
  container: HTMLElement;
  onMetadataChange: (bodyId: string, metadata: WoodworkingMetadataDraft) => void;
  onExportCutList: () => void;
  onExportDrawing: () => void;
  onExportDrawingPdf?: () => void;
  onExportDrawingDxf?: () => void;
}

const DEFAULT_METADATA: WoodworkingMetadataDraft = {
  isBoard: false,
  label: '',
  material: 'Unspecified',
  thicknessAxis: 'z',
  grainAxis: 'x',
  notes: '',
};

export class WoodworkingPanel {
  private readonly options: WoodworkingPanelOptions;
  private state: WoodworkingPanelState = {
    bodyId: null,
    bodyName: null,
    metadata: { ...DEFAULT_METADATA },
    measurement: null,
    canExport: false,
  };

  constructor(options: WoodworkingPanelOptions) {
    this.options = options;
    this.render();
  }

  refresh(state: WoodworkingPanelState): void {
    this.state = {
      ...state,
      metadata: { ...state.metadata },
    };
    this.render();
  }

  dispose(): void {
    this.options.container.replaceChildren();
  }

  private render(): void {
    const root = document.createElement('div');
    root.className = 'woodworking-panel';
    root.dataset.testid = 'woodworking-panel';

    root.appendChild(this.renderMeasurement());
    root.appendChild(this.renderMetadataEditor());
    root.appendChild(this.renderExportActions());
    this.options.container.replaceChildren(root);
  }

  private renderMeasurement(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'woodworking-panel__measurement';
    const heading = document.createElement('h3');
    heading.textContent = this.state.bodyName ? `Measure: ${this.state.bodyName}` : 'Measurement';
    section.appendChild(heading);

    if (!this.state.measurement) {
      const empty = document.createElement('p');
      empty.className = 'woodworking-panel__empty';
      empty.textContent = 'Select a solid body to measure and tag it for the cut list.';
      section.appendChild(empty);
      return section;
    }

    const values = document.createElement('dl');
    values.className = 'woodworking-panel__dimensions';
    for (const [label, value] of [
      ['Length', this.state.measurement.length],
      ['Width', this.state.measurement.width],
      ['Thickness', this.state.measurement.thickness],
    ] as const) {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = `${value} ${this.state.measurement.units}`;
      values.append(term, description);
    }
    section.appendChild(values);
    return section;
  }

  private renderMetadataEditor(): HTMLElement {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'woodworking-panel__metadata';
    fieldset.disabled = !this.state.bodyId;
    const legend = document.createElement('legend');
    legend.textContent = 'Board metadata';
    fieldset.appendChild(legend);

    const board = document.createElement('input');
    board.type = 'checkbox';
    board.checked = this.state.metadata.isBoard;
    fieldset.appendChild(this.wrapControl('Include in cut list', board));

    const label = this.createTextInput(this.state.metadata.label, 'Part label');
    fieldset.appendChild(this.wrapControl('Label', label));
    const material = this.createTextInput(this.state.metadata.material, 'e.g. White oak');
    fieldset.appendChild(this.wrapControl('Material', material));
    const thicknessAxis = this.createAxisSelect(this.state.metadata.thicknessAxis);
    fieldset.appendChild(this.wrapControl('Thickness axis', thicknessAxis));
    const grainAxis = this.createAxisSelect(this.state.metadata.grainAxis);
    fieldset.appendChild(this.wrapControl('Grain axis', grainAxis));
    const notes = this.createTextInput(this.state.metadata.notes, 'Optional shop notes');
    fieldset.appendChild(this.wrapControl('Notes', notes));

    const commit = (): void => {
      if (!this.state.bodyId) return;
      this.options.onMetadataChange(this.state.bodyId, {
        isBoard: board.checked,
        label: label.value.trim(),
        material: material.value.trim() || 'Unspecified',
        thicknessAxis: thicknessAxis.value as WoodworkingAxis,
        grainAxis: grainAxis.value as WoodworkingAxis,
        notes: notes.value.trim(),
      });
    };
    for (const control of [board, label, material, thicknessAxis, grainAxis, notes]) {
      control.addEventListener('change', commit);
    }
    return fieldset;
  }

  private renderExportActions(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'woodworking-panel__actions';
    const cutList = document.createElement('button');
    cutList.type = 'button';
    cutList.textContent = 'Export cut list (CSV)';
    cutList.disabled = !this.state.canExport;
    cutList.addEventListener('click', this.options.onExportCutList);
    const drawing = document.createElement('button');
    drawing.type = 'button';
    drawing.textContent = 'Export drawing (SVG)';
    drawing.disabled = !this.state.canExport;
    drawing.addEventListener('click', this.options.onExportDrawing);
    const pdf = document.createElement('button');
    pdf.type = 'button';
    pdf.textContent = 'Export drawing (PDF)';
    pdf.disabled = !this.state.canExport;
    pdf.addEventListener('click', () => this.options.onExportDrawingPdf?.());
    const dxf = document.createElement('button');
    dxf.type = 'button';
    dxf.textContent = 'Export drawing (DXF)';
    dxf.disabled = !this.state.canExport;
    dxf.addEventListener('click', () => this.options.onExportDrawingDxf?.());
    actions.append(cutList, drawing, pdf, dxf);
    return actions;
  }

  private createTextInput(value: string, placeholder: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    return input;
  }

  private createAxisSelect(value: WoodworkingAxis): HTMLSelectElement {
    const select = document.createElement('select');
    for (const axis of ['x', 'y', 'z'] as const) {
      const option = document.createElement('option');
      option.value = axis;
      option.textContent = axis.toUpperCase();
      option.selected = value === axis;
      select.appendChild(option);
    }
    return select;
  }

  private wrapControl(labelText: string, control: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = labelText;
    label.append(text, control);
    return label;
  }
}

export function createDefaultWoodworkingMetadata(): WoodworkingMetadataDraft {
  return { ...DEFAULT_METADATA };
}
