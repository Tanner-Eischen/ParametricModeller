/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContextTaskPanel,
  type ContextTaskPanelState,
} from '../../src/ui/ContextTaskPanel';

const state: ContextTaskPanelState = {
  toolName: 'Extrude',
  instructions: ['Select a closed profile.', 'Drag the arrow or enter a distance.'],
  status: 'Preview ready',
  fields: [
    { id: 'distance', label: 'Distance', type: 'number', value: 12, unit: 'mm', min: 0.1 },
    {
      id: 'operation', label: 'Operation', type: 'select', value: 'new',
      options: [{ value: 'new', label: 'New body' }, { value: 'cut', label: 'Cut' }],
    },
    { id: 'symmetric', label: 'Symmetric', type: 'checkbox', value: false },
    { id: 'target', label: 'Target', type: 'readonly', value: 'Body 1' },
    { id: 'warning', label: 'Profile', type: 'text', value: '', error: 'Profile is open' },
  ],
  actions: [{ id: 'flip', label: 'Flip direction', shortcut: 'F' }],
  canCommit: true,
  canCancel: true,
};

describe('ContextTaskPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the active tool, instructions, parameters, actions, and footer visible', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new ContextTaskPanel({ container, state });

    const root = container.querySelector<HTMLElement>('.context-task-panel');
    expect(root?.getAttribute('aria-label')).toBe('Extrude task controls');
    expect(root?.textContent).toContain('Select a closed profile.');
    expect(root?.textContent).toContain('Preview ready');
    expect(container.querySelectorAll('.context-task-panel__field')).toHaveLength(5);
    expect(container.querySelector('[data-action-id="flip"]')?.textContent).toContain('Flip direction');
    expect(container.querySelector('[data-testid="context-task-commit"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Profile is open');
    panel.dispose();
  });

  it('reports generic field and action changes without mutating authoritative state', () => {
    const container = document.createElement('div');
    const onFieldChange = vi.fn();
    const onAction = vi.fn();
    const panel = new ContextTaskPanel({ container, state, onFieldChange, onAction });

    const distance = container.querySelector<HTMLInputElement>('#context-task-field-distance');
    if (!distance) throw new Error('Expected distance input');
    distance.value = '25';
    distance.dispatchEvent(new Event('input', { bubbles: true }));
    const symmetric = container.querySelector<HTMLInputElement>('#context-task-field-symmetric');
    container.querySelector<HTMLButtonElement>('[data-action-id="flip"]')?.click();

    expect(onFieldChange).toHaveBeenCalledWith('distance', 25);
    if (!symmetric) throw new Error('Expected symmetric checkbox');
    symmetric.checked = true;
    symmetric.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onFieldChange).toHaveBeenCalledWith('symmetric', true);
    expect(onAction).toHaveBeenCalledWith('flip');
    expect(state.fields?.[0]?.value).toBe(12);
    panel.dispose();
  });

  it('supports pointer and keyboard commit/cancel while honoring disabled state', () => {
    const container = document.createElement('div');
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const panel = new ContextTaskPanel({ container, state, onCommit, onCancel });

    container.querySelector<HTMLButtonElement>('[data-testid="context-task-commit"]')?.click();
    const input = container.querySelector<HTMLInputElement>('#context-task-field-distance');
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCancel).toHaveBeenCalledOnce();

    panel.refreshState({ ...state, canCommit: false, canCancel: false });
    const nextInput = container.querySelector<HTMLInputElement>('#context-task-field-distance');
    nextInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    nextInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.querySelector<HTMLButtonElement>('[data-testid="context-task-commit"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="context-task-cancel"]')?.disabled).toBe(true);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCancel).toHaveBeenCalledOnce();

    panel.setCommitEnabled(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="context-task-commit"]')?.disabled).toBe(false);
    container.querySelector<HTMLButtonElement>('[data-testid="context-task-commit"]')?.click();
    expect(onCommit).toHaveBeenCalledTimes(3);
    panel.dispose();
  });

  it('updates field errors live without replacing the focused control', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new ContextTaskPanel({
      container,
      state,
    });
    const input = container.querySelector<HTMLInputElement>('#context-task-field-distance');
    expect(input).not.toBeNull();
    input?.focus();

    panel.setFieldError('distance', 'Distance must be non-zero.');

    expect(document.activeElement).toBe(input);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toContain('context-task-field-distance-error');
    expect(container.querySelector('#context-task-field-distance-error')?.textContent)
      .toBe('Distance must be non-zero.');

    panel.setFieldError('distance', null);
    expect(document.activeElement).toBe(input);
    expect(input?.hasAttribute('aria-invalid')).toBe(false);
    expect(container.querySelector('#context-task-field-distance-error')).toBeNull();
    panel.dispose();
  });

  it('renders the complete Miter Cut task and routes Enter and Escape', () => {
    const container = document.createElement('div');
    const onFieldChange = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const panel = new ContextTaskPanel({
      container,
      state: {
        toolName: 'Miter Cut',
        instructions: 'Set the angle and choose whether to keep both pieces or discard the offcut.',
        status: 'Previewing',
        fields: [
          {
            id: 'feature-resultMode',
            label: 'Result',
            type: 'select',
            value: 'split',
            options: [
              { value: 'split', label: 'Keep both pieces' },
              { value: 'trim', label: 'Trim end' },
            ],
          },
          { id: 'feature-angleDegrees', label: 'Angle', type: 'number', value: 45, unit: 'deg' },
          { id: 'feature-inset', label: 'Inset', type: 'text', value: '0', unit: 'in' },
          {
            id: 'feature-tiltAxis',
            label: 'Angle across',
            type: 'select',
            value: 'u',
            options: [{ value: 'u', label: 'Face U' }, { value: 'v', label: 'Face V' }],
          },
        ],
        canCommit: true,
        canCancel: true,
      },
      onFieldChange,
      onCommit,
      onCancel,
    });

    const root = container.querySelector<HTMLElement>('[data-testid="context-task-panel"]');
    const result = root?.querySelector<HTMLSelectElement>('#context-task-field-feature-resultMode');
    const angle = root?.querySelector<HTMLInputElement>('#context-task-field-feature-angleDegrees');

    expect(root?.getAttribute('aria-label')).toBe('Miter Cut task controls');
    expect(root?.querySelectorAll('[data-field-id]')).toHaveLength(4);
    expect(result?.options[0]?.textContent).toBe('Keep both pieces');
    expect(result?.options[1]?.textContent).toBe('Trim end');
    expect(root?.textContent).toContain('Angle across');

    if (!result || !angle) throw new Error('Expected Miter Cut task controls');
    result.value = 'trim';
    result.dispatchEvent(new Event('change', { bubbles: true }));
    angle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    angle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onFieldChange).toHaveBeenCalledWith('feature-resultMode', 'trim');
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    panel.dispose();
  });

  it('removes controls when there is no active task and can attach later', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const panel = new ContextTaskPanel({ container: first });
    expect(panel.isActive()).toBe(false);
    expect(first.children).toHaveLength(0);
    panel.attachTo(second);
    panel.refreshState(state);
    expect(panel.isActive()).toBe(true);
    expect(second.querySelector('.context-task-panel')).not.toBeNull();
    panel.refreshState(null);
    expect(second.children).toHaveLength(0);
  });
});
