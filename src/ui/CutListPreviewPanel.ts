import { parseNumericInput } from '../interaction/NumericInput';
import type {
  CutListDocument,
  CutListDocumentRow,
} from '../woodworking/CutList';
import type { ManufacturingOperation } from '../woodworking/ManufacturingOperation';
import { convertLength, type LengthUnit } from '../woodworking/Measurements';

export type CutListAllowanceDimension = 'length' | 'width' | 'thickness';

export interface CutListPreviewIssue {
  rowKey: string;
  dimension?: CutListAllowanceDimension;
  message: string;
}

export interface CutListPreviewRow {
  key: string;
  quantity: number;
  material: string;
  grade: string;
  partNumbers: string[];
  notes: string[];
  operationSummary: string;
  finishedDimensions: Record<CutListAllowanceDimension, number>;
  allowances: Record<CutListAllowanceDimension, number>;
  cutDimensions: Record<CutListAllowanceDimension, number>;
  allowanceInputs: Record<CutListAllowanceDimension, string>;
  allowanceErrors: Partial<Record<CutListAllowanceDimension, string>>;
}

export interface CutListPreviewModel {
  title: string;
  unit: LengthUnit;
  rows: CutListPreviewRow[];
  issues: CutListPreviewIssue[];
  canExport: boolean;
  summary: { groupCount: number; partCount: number };
}

export interface CutListPreviewModelOptions {
  operations?: readonly ManufacturingOperation[];
  partNumbersByBodyId?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}

export interface CutListPreviewPanelOptions extends CutListPreviewModelOptions {
  container: HTMLElement;
  document: CutListDocument;
  onAllowanceChange?: (
    rowKey: string,
    allowance: Record<CutListAllowanceDimension, number>
  ) => void;
  onExport: (model: CutListPreviewModel) => void;
  onClose?: () => void;
}

const DIMENSIONS: readonly CutListAllowanceDimension[] = ['length', 'width', 'thickness'];

/** Build the stable display model without mutating the cut-list document. */
export function buildCutListPreviewModel(
  document: CutListDocument,
  options: CutListPreviewModelOptions = {}
): CutListPreviewModel {
  const rows = [...document.rows]
    .sort((left, right) => compareText(left.key, right.key))
    .map((row) => buildRow(row, document.unit, options));
  const issues = rows.flatMap((row) => DIMENSIONS.flatMap((dimension) => {
    const value = row.allowances[dimension];
    return Number.isFinite(value) && value >= 0
      ? []
      : [{
          rowKey: row.key,
          dimension,
          message: `${capitalize(dimension)} allowance must be a finite non-negative value.`,
        } satisfies CutListPreviewIssue];
  }));
  for (const issue of issues) {
    if (!issue.dimension) continue;
    const row = rows.find((candidate) => candidate.key === issue.rowKey);
    if (row) row.allowanceErrors[issue.dimension] = issue.message;
  }
  return {
    title: document.title,
    unit: document.unit,
    rows,
    issues,
    canExport: issues.length === 0 && rows.length > 0,
    summary: {
      groupCount: rows.length,
      partCount: rows.reduce((sum, row) => sum + row.quantity, 0),
    },
  };
}

export class CutListPreviewPanel {
  private readonly options: CutListPreviewPanelOptions;
  private model: CutListPreviewModel;
  private root: HTMLElement | null = null;
  private exportButton: HTMLButtonElement | null = null;
  private issueSummary: HTMLElement | null = null;
  private previouslyFocused: HTMLElement | null = null;
  private openState = false;

  constructor(options: CutListPreviewPanelOptions) {
    this.options = options;
    this.model = buildCutListPreviewModel(options.document, options);
    this.render();
  }

  open(): void {
    if (!this.root || this.openState) return;
    this.previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.openState = true;
    this.root.hidden = false;
    this.root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  close(): void {
    if (!this.root || !this.openState) return;
    this.openState = false;
    this.root.hidden = true;
    this.options.onClose?.();
    if (this.previouslyFocused?.isConnected) this.previouslyFocused.focus();
    this.previouslyFocused = null;
  }

  refresh(document: CutListDocument, options: CutListPreviewModelOptions = {}): void {
    const operations = options.operations ?? this.options.operations;
    const partNumbersByBodyId = options.partNumbersByBodyId ?? this.options.partNumbersByBodyId;
    this.model = buildCutListPreviewModel(document, {
      ...(operations ? { operations } : {}),
      ...(partNumbersByBodyId ? { partNumbersByBodyId } : {}),
    });
    const wasOpen = this.openState;
    this.render();
    if (wasOpen) this.open();
  }

  getModel(): CutListPreviewModel {
    return cloneModel(this.model);
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.exportButton = null;
    this.issueSummary = null;
  }

  private render(): void {
    const root = document.createElement('section');
    root.className = 'cut-list-preview';
    root.dataset.testid = 'cut-list-preview';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'cut-list-preview-title');
    root.hidden = true;

    const heading = document.createElement('h2');
    heading.id = 'cut-list-preview-title';
    heading.tabIndex = -1;
    heading.dataset.autofocus = 'true';
    heading.textContent = `${this.model.title} cut list`;

    const summary = document.createElement('p');
    summary.textContent = `${this.model.summary.partCount} parts in ${this.model.summary.groupCount} groups. Finished and cut sizes are shown in ${this.model.unit}.`;

    this.issueSummary = document.createElement('p');
    this.issueSummary.dataset.testid = 'cut-list-preview-issues';
    this.issueSummary.setAttribute('aria-live', 'polite');
    this.updateIssueSummary();

    root.append(heading, summary, this.issueSummary, this.renderTable());

    const actions = document.createElement('div');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.close());
    this.exportButton = document.createElement('button');
    this.exportButton.type = 'button';
    this.exportButton.dataset.testid = 'cut-list-preview-export';
    this.exportButton.textContent = 'Export CSV';
    this.exportButton.disabled = !this.model.canExport;
    this.exportButton.addEventListener('click', () => {
      if (this.model.canExport) this.options.onExport(this.getModel());
    });
    actions.append(close, this.exportButton);
    root.appendChild(actions);
    root.addEventListener('keydown', (event) => this.handleKeyDown(event));

    this.options.container.replaceChildren(root);
    this.root = root;
    this.openState = false;
  }

  private renderTable(): HTMLTableElement {
    const table = document.createElement('table');
    const caption = document.createElement('caption');
    caption.textContent = 'Cut-list preview with editable stock allowances';
    table.appendChild(caption);
    const headers = [
      'Part numbers', 'Quantity', 'Material', 'Grade',
      'Finished L', 'Finished W', 'Finished T',
      'Allowance L', 'Allowance W', 'Allowance T',
      'Cut L', 'Cut W', 'Cut T', 'Operations', 'Notes',
    ];
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const label of headers) {
      const header = document.createElement('th');
      header.scope = 'col';
      header.textContent = label;
      headerRow.appendChild(header);
    }
    head.appendChild(headerRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    for (const row of this.model.rows) body.appendChild(this.renderRow(row));
    table.appendChild(body);
    return table;
  }

  private renderRow(row: CutListPreviewRow): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.dataset.rowKey = row.key;
    appendTextCell(tr, row.partNumbers.join('; ') || '—', true);
    appendTextCell(tr, String(row.quantity));
    appendTextCell(tr, row.material);
    appendTextCell(tr, row.grade || '—');
    for (const dimension of DIMENSIONS) {
      appendTextCell(tr, formatDisplay(row.finishedDimensions[dimension], this.model.unit));
    }
    for (const dimension of DIMENSIONS) {
      const cell = document.createElement('td');
      const label = document.createElement('label');
      const input = document.createElement('input');
      const inputId = allowanceInputId(row.key, dimension);
      input.id = inputId;
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = row.allowanceInputs[dimension];
      input.setAttribute('aria-label', `${row.partNumbers.join(', ') || 'Part group'} ${dimension} allowance in ${this.model.unit}`);
      input.addEventListener('input', () => this.updateAllowance(row.key, dimension, input.value));
      const unit = document.createElement('span');
      unit.textContent = this.model.unit;
      label.append(input, unit);
      const error = document.createElement('span');
      error.id = `${inputId}-error`;
      error.dataset.allowanceError = dimension;
      error.setAttribute('role', 'alert');
      const initialError = row.allowanceErrors[dimension];
      error.hidden = !initialError;
      error.textContent = initialError ?? '';
      input.setAttribute('aria-invalid', initialError ? 'true' : 'false');
      if (initialError) input.setAttribute('aria-describedby', error.id);
      cell.append(label, error);
      tr.appendChild(cell);
    }
    for (const dimension of DIMENSIONS) {
      const cell = appendTextCell(tr, formatDisplay(row.cutDimensions[dimension], this.model.unit));
      cell.dataset.cutDimension = dimension;
    }
    appendTextCell(tr, row.operationSummary || '—');
    appendTextCell(tr, row.notes.join('; ') || '—');
    return tr;
  }

  private updateAllowance(
    rowKey: string,
    dimension: CutListAllowanceDimension,
    raw: string
  ): void {
    const row = this.model.rows.find((candidate) => candidate.key === rowKey);
    if (!row) return;
    row.allowanceInputs[dimension] = raw;
    const parsed = parseNumericInput(raw, { defaultUnit: this.model.unit });
    const error = !parsed.ok
      ? parsed.error
      : parsed.value < 0
        ? 'Allowance must be non-negative.'
        : null;
    if (error) {
      row.allowanceErrors[dimension] = error;
    } else if (parsed.ok) {
      delete row.allowanceErrors[dimension];
      row.allowances[dimension] = parsed.value;
      row.cutDimensions[dimension] = row.finishedDimensions[dimension] + parsed.value;
      this.options.onAllowanceChange?.(row.key, { ...row.allowances });
    }
    this.rebuildIssues();
    this.updateAllowanceDom(row, dimension);
  }

  private rebuildIssues(): void {
    this.model.issues = this.model.rows.flatMap((row) =>
      DIMENSIONS.flatMap((dimension) => row.allowanceErrors[dimension]
        ? [{
            rowKey: row.key,
            dimension,
            message: row.allowanceErrors[dimension]!,
          }]
        : [])
    );
    this.model.canExport = this.model.rows.length > 0 && this.model.issues.length === 0;
    if (this.exportButton) this.exportButton.disabled = !this.model.canExport;
    this.updateIssueSummary();
  }

  private updateAllowanceDom(
    row: CutListPreviewRow,
    dimension: CutListAllowanceDimension
  ): void {
    const tr = [...(this.root?.querySelectorAll<HTMLTableRowElement>('tr[data-row-key]') ?? [])]
      .find((candidate) => candidate.dataset.rowKey === row.key);
    const input = [...(tr?.querySelectorAll<HTMLInputElement>('input') ?? [])]
      .find((candidate) => candidate.id === allowanceInputId(row.key, dimension));
    const error = tr?.querySelector<HTMLElement>(`[data-allowance-error="${dimension}"]`);
    const message = row.allowanceErrors[dimension];
    if (input) {
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message && error) input.setAttribute('aria-describedby', error.id);
      else input.removeAttribute('aria-describedby');
    }
    if (error) {
      error.hidden = !message;
      error.textContent = message ?? '';
    }
    const cut = tr?.querySelector<HTMLElement>(`[data-cut-dimension="${dimension}"]`);
    if (cut) cut.textContent = formatDisplay(row.cutDimensions[dimension], this.model.unit);
  }

  private updateIssueSummary(): void {
    if (!this.issueSummary) return;
    this.issueSummary.textContent = this.model.issues.length === 0
      ? 'Ready to export.'
      : `Export blocked: ${this.model.issues.length} allowance value${this.model.issues.length === 1 ? '' : 's'} need attention.`;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab' || !this.root) return;
    const focusable = [...this.root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function buildRow(
  row: CutListDocumentRow,
  unit: LengthUnit,
  options: CutListPreviewModelOptions
): CutListPreviewRow {
  const allowances = { ...row.stockAllowance };
  const finishedDimensions = { ...row.finishedDimensions };
  return {
    key: row.key,
    quantity: row.quantity,
    material: row.material.species,
    grade: row.material.grade ?? '',
    partNumbers: [...new Set(row.partIds.flatMap((bodyId) => {
      const partNumber = lookupPartNumber(options.partNumbersByBodyId, bodyId);
      return partNumber?.trim() ? [partNumber.trim()] : [];
    }))].sort(compareText),
    notes: [...row.notes].sort(compareText),
    operationSummary: summarizeOperations(row.partIds, options.operations ?? []),
    finishedDimensions,
    allowances,
    cutDimensions: {
      length: finishedDimensions.length + allowances.length,
      width: finishedDimensions.width + allowances.width,
      thickness: finishedDimensions.thickness + allowances.thickness,
    },
    allowanceInputs: {
      length: formatInput(allowances.length, unit),
      width: formatInput(allowances.width, unit),
      thickness: formatInput(allowances.thickness, unit),
    },
    allowanceErrors: {},
  };
}

function summarizeOperations(
  bodyIds: readonly string[],
  operations: readonly ManufacturingOperation[]
): string {
  const selected = operations
    .filter((operation) => bodyIds.includes(operation.memberBodyId))
    .sort((left, right) => compareText(left.kind, right.kind)
      || compareText(left.process, right.process)
      || left.sequence - right.sequence
      || compareText(left.id, right.id));
  const counts = new Map<string, number>();
  for (const operation of selected) {
    const label = `${formatEnum(operation.kind)} (${formatEnum(operation.process)})`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => compareText(left, right))
    .map(([label, count]) => `${label} ×${count}`)
    .join('; ');
}

function lookupPartNumber(
  lookup: CutListPreviewModelOptions['partNumbersByBodyId'],
  bodyId: string
): string | undefined {
  if (!lookup) return undefined;
  return typeof (lookup as ReadonlyMap<string, string>).get === 'function'
    ? (lookup as ReadonlyMap<string, string>).get(bodyId)
    : (lookup as Readonly<Record<string, string>>)[bodyId];
}

function appendTextCell(
  row: HTMLTableRowElement,
  value: string,
  rowHeader = false
): HTMLTableCellElement {
  const cell = document.createElement(rowHeader ? 'th' : 'td');
  if (rowHeader) (cell as HTMLTableCellElement).scope = 'row';
  cell.textContent = value;
  row.appendChild(cell);
  return cell as HTMLTableCellElement;
}

function formatDisplay(valueInInches: number, unit: LengthUnit): string {
  const value = convertLength(valueInInches, 'in', unit);
  return `${Number(value.toFixed(unit === 'mm' ? 3 : 4))} ${unit}`;
}

function formatInput(valueInInches: number, unit: LengthUnit): string {
  return String(Number(convertLength(valueInInches, 'in', unit).toFixed(6)));
}

function allowanceInputId(rowKey: string, dimension: CutListAllowanceDimension): string {
  return `cut-list-allowance-${safeId(rowKey)}-${dimension}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `_${character.charCodeAt(0).toString(16)}_`);
}

function capitalize(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

function formatEnum(value: string): string {
  return capitalize(value.replace(/([a-z])([A-Z])/g, '$1 $2'));
}

function cloneModel(model: CutListPreviewModel): CutListPreviewModel {
  return {
    ...model,
    summary: { ...model.summary },
    issues: model.issues.map((issue) => ({ ...issue })),
    rows: model.rows.map((row) => ({
      ...row,
      partNumbers: [...row.partNumbers],
      notes: [...row.notes],
      finishedDimensions: { ...row.finishedDimensions },
      allowances: { ...row.allowances },
      cutDimensions: { ...row.cutDimensions },
      allowanceInputs: { ...row.allowanceInputs },
      allowanceErrors: { ...row.allowanceErrors },
    })),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
