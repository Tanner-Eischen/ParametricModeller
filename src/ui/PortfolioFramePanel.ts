import type { PortfolioFrameState } from '../app/PortfolioFrameWorkflow';

/** Explicit controls for the authored square-butt example, not arbitrary assemblies. */
export class PortfolioFramePanel {
  private readonly input: HTMLInputElement;
  private readonly apply: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private readonly error: HTMLElement;
  private lastLength: number | null = null;

  constructor(container: HTMLElement, onApply: (length: number) => void) {
    const root = document.createElement('form');
    root.className = 'portfolio-frame-panel';
    root.setAttribute('aria-label', 'Frame example controls');
    const label = document.createElement('label');
    label.className = 'portfolio-frame-panel__field';
    label.textContent = 'Frame board length (in)';
    this.input = document.createElement('input');
    this.input.type = 'number';
    this.input.step = 'any';
    this.input.setAttribute('aria-label', 'Frame board length (in)');
    label.appendChild(this.input);
    this.apply = document.createElement('button');
    this.apply.type = 'submit';
    this.apply.className = 'portfolio-frame-panel__apply';
    this.apply.textContent = 'Apply frame length';
    this.summary = document.createElement('p');
    this.summary.className = 'portfolio-frame-panel__summary';
    this.summary.setAttribute('role', 'status');
    this.summary.dataset.testid = 'frame-example-summary';
    const note = document.createElement('p');
    note.className = 'portfolio-frame-panel__note';
    note.textContent = 'This example edit updates its board length and four placements together. Other assemblies are not constrained by this control.';
    this.error = document.createElement('p');
    this.error.className = 'portfolio-frame-panel__error';
    this.error.setAttribute('role', 'alert');
    this.error.hidden = true;
    root.addEventListener('submit', event => {
      event.preventDefault();
      if (!this.apply.disabled) onApply(this.input.valueAsNumber);
    });
    root.append(label, this.apply, this.summary, note, this.error);
    container.appendChild(root);
  }

  refresh(state: PortfolioFrameState | null, busy = false): void {
    if (!state) this.reset();
    if (state && state.length !== this.lastLength) {
      this.input.value = String(state.length);
      this.lastLength = state.length;
      this.setError(null);
    }
    this.input.disabled = !state || busy || state.error !== null;
    this.apply.disabled = this.input.disabled;
    this.summary.textContent = state && !state.error
      ? `${state.bodyCount} physical boards; outer dimensions ${state.bounds.map(n => Number(n.toFixed(6))).join(' × ')} in`
      : 'Load the frame example for coordinated length editing.';
    if (state?.error) this.setError(state.error);
  }

  reset(): void {
    this.lastLength = null;
    this.input.value = '';
    this.setError(null);
  }

  setError(message: string | null): void {
    this.error.textContent = message ?? '';
    this.error.hidden = message === null;
    this.input.setAttribute('aria-invalid', String(message !== null));
  }
}
