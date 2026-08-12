import { createModuleLogger } from '../core/logger';

const log = createModuleLogger('VertexEditPrompt');

type AxisConstraint = 'x' | 'y' | 'z' | undefined;
type Translation = [number, number, number];

export interface VertexEditPromptOptions {
  container?: HTMLElement;
}

export interface VertexEditSelectionState {
  vertexId: string;
  onStart: () => void;
}

export interface VertexEditActiveState {
  vertexId: string;
  translation: Translation;
  constrainAxis?: AxisConstraint;
  onSetConstraint?: (axis: AxisConstraint) => void;
}

export class VertexEditPrompt {
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private state:
    | { mode: 'hidden' }
    | { mode: 'selection'; data: VertexEditSelectionState }
    | { mode: 'editing'; data: VertexEditActiveState } = { mode: 'hidden' };

  constructor(options: VertexEditPromptOptions = {}) {
    if (options.container) {
      this.attachTo(options.container);
    }
  }

  attachTo(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  showSelection(data: VertexEditSelectionState): void {
    this.state = { mode: 'selection', data };
    this.render();
  }

  showEditing(data: VertexEditActiveState): void {
    this.state = { mode: 'editing', data };
    this.render();
  }

  hide(): void {
    this.state = { mode: 'hidden' };
    this.render();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.container = null;
    log.debug('VertexEditPrompt disposed');
  }

  private render(): void {
    if (!this.container) {
      return;
    }

    if (!this.root) {
      this.root = document.createElement('div');
      this.root.className = 'vertex-edit-prompt';
      this.container.appendChild(this.root);
    }

    this.root.innerHTML = '';
    this.root.hidden = this.state.mode === 'hidden';

    if (this.state.mode === 'hidden') {
      return;
    }

    const card = document.createElement('section');
    card.className = 'vertex-edit-prompt__card';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'vertex-edit-prompt__eyebrow';
    eyebrow.textContent = this.state.mode === 'selection' ? 'Vertex ready' : 'Vertex editing';
    card.appendChild(eyebrow);

    const title = document.createElement('h3');
    title.className = 'vertex-edit-prompt__title';
    title.textContent = this.state.mode === 'selection'
      ? `Selected ${this.state.data.vertexId}`
      : `Moving ${this.state.data.vertexId}`;
    card.appendChild(title);

    const description = document.createElement('p');
    description.className = 'vertex-edit-prompt__description';
    description.textContent = this.state.mode === 'selection'
      ? 'Start a guarded Move Vertex feature directly from here instead of hunting through panels.'
      : 'Drag the viewport arrows for quick edits, then fine-tune the numbers in Properties if needed.';
    card.appendChild(description);

    if (this.state.mode === 'selection') {
      const actions = document.createElement('div');
      actions.className = 'vertex-edit-prompt__actions';

      const startButton = document.createElement('button');
      startButton.type = 'button';
      startButton.className = 'vertex-edit-prompt__button vertex-edit-prompt__button--primary';
      startButton.textContent = 'Move Vertex';
      startButton.title = 'Create a guarded Move Vertex feature and start dragging in the viewport';
      startButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.state.mode === 'selection') {
          this.state.data.onStart();
        }
      });
      actions.appendChild(startButton);

      const shortcut = document.createElement('span');
      shortcut.className = 'vertex-edit-prompt__shortcut';
      shortcut.textContent = 'Shortcut: Shift+V';
      actions.appendChild(shortcut);

      card.appendChild(actions);
    } else {
      const metrics = document.createElement('div');
      metrics.className = 'vertex-edit-prompt__metrics';
      for (const [label, value] of [
        ['dX', this.state.data.translation[0]],
        ['dY', this.state.data.translation[1]],
        ['dZ', this.state.data.translation[2]],
      ] as Array<[string, number]>) {
        const metric = document.createElement('div');
        metric.className = 'vertex-edit-prompt__metric';

        const metricLabel = document.createElement('span');
        metricLabel.className = 'vertex-edit-prompt__metric-label';
        metricLabel.textContent = label;
        metric.appendChild(metricLabel);

        const metricValue = document.createElement('span');
        metricValue.className = 'vertex-edit-prompt__metric-value';
        metricValue.textContent = value.toFixed(3);
        metric.appendChild(metricValue);

        metrics.appendChild(metric);
      }
      card.appendChild(metrics);

      const constraintHeader = document.createElement('div');
      constraintHeader.className = 'vertex-edit-prompt__constraint-header';
      constraintHeader.textContent = 'Axis lock';
      card.appendChild(constraintHeader);

      const constraints = document.createElement('div');
      constraints.className = 'vertex-edit-prompt__constraints';
      for (const option of [
        { label: 'Free', value: undefined as AxisConstraint },
        { label: 'X', value: 'x' as AxisConstraint },
        { label: 'Y', value: 'y' as AxisConstraint },
        { label: 'Z', value: 'z' as AxisConstraint },
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'vertex-edit-prompt__chip';
        if (this.state.data.constrainAxis === option.value ||
          (option.value === undefined && this.state.data.constrainAxis === undefined)) {
          button.dataset.active = 'true';
        }
        button.textContent = option.label;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (this.state.mode === 'editing') {
            this.state.data.onSetConstraint?.(option.value);
          }
        });
        constraints.appendChild(button);
      }
      card.appendChild(constraints);

      const note = document.createElement('p');
      note.className = 'vertex-edit-prompt__note';
      note.textContent = 'Press Escape to leave the current selection.';
      card.appendChild(note);
    }

    this.root.appendChild(card);
  }
}
