/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SketchSetupPanel } from '../../src/ui/SketchSetupPanel';

describe('SketchSetupPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders plane selection, primitive actions, and workflow hints', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const panel = new SketchSetupPanel({ container });

    expect(container.textContent).toContain('Sketch setup');
    expect(container.textContent).toContain('World planes');
    expect(container.textContent).toContain('Sketch primitives');
    expect(container.textContent).toContain('Rectangle');
    expect(container.textContent).toContain('Line');
    expect(container.textContent).toContain('Sketch on selected face');
    expect(container.textContent).toContain('Start with XY, XZ, or YZ');

    panel.dispose();
  });

  it('refreshes button state and notifies callbacks', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onPickWorldPlane = vi.fn();
    const onSketchSelectedFace = vi.fn();
    const onAddRectangle = vi.fn();
    const onAddLine = vi.fn();
    const onExitSketch = vi.fn();

    const panel = new SketchSetupPanel({
      container,
      state: {
        activePlane: 'xy',
        canSketchOnSelectedFace: false,
        canAddRectangle: true,
        canAddLine: false,
        canExitSketch: true,
      },
      onPickWorldPlane,
      onSketchSelectedFace,
      onAddRectangle,
      onAddLine,
      onExitSketch,
    });

    const xzButton = container.querySelector<HTMLButtonElement>('button[data-plane="xz"]');
    const faceButton = container.querySelector<HTMLButtonElement>('.sketch-setup-panel__action');
    const lineButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.sketch-setup-panel__button'))
      .find((button) => button.textContent === 'Line');
    const rectangleButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.sketch-setup-panel__button'))
      .find((button) => button.textContent === 'Rectangle');
    const exitButton = container.querySelector<HTMLButtonElement>('.sketch-setup-panel__action--secondary');

    expect(container.querySelector<HTMLButtonElement>('button[data-plane="xy"]')?.dataset.active).toBe('true');
    expect(faceButton?.disabled).toBe(true);
    expect(lineButton?.disabled).toBe(true);

    xzButton?.click();
    rectangleButton?.click();
    lineButton?.click();
    faceButton?.click();
    exitButton?.click();

    expect(onPickWorldPlane).toHaveBeenCalledWith('xz');
    expect(onAddRectangle).toHaveBeenCalledTimes(1);
    expect(onAddLine).toHaveBeenCalledTimes(0);
    expect(onSketchSelectedFace).toHaveBeenCalledTimes(0);
    expect(onExitSketch).toHaveBeenCalledTimes(1);

    panel.refreshState({
      activePlane: 'yz',
      canSketchOnSelectedFace: true,
      canAddLine: true,
    });

    const refreshedFaceButton = container.querySelector<HTMLButtonElement>('.sketch-setup-panel__action');
    const refreshedLineButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.sketch-setup-panel__button'))
      .find((button) => button.textContent === 'Line');

    expect(container.querySelector<HTMLButtonElement>('button[data-plane="yz"]')?.dataset.active).toBe('true');
    expect(refreshedFaceButton?.disabled).toBe(false);
    expect(refreshedLineButton?.disabled).toBe(false);

    panel.dispose();
  });

  it('exposes the complete professional tool set through one callback', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onSelectTool = vi.fn();
    const panel = new SketchSetupPanel({ container, onSelectTool });

    const expectedTools = [
      'select',
      'line',
      'rectangle',
      'center-rectangle',
      'regular-polygon',
      'dimension',
      'constraint',
      'trim',
      'extend',
      'project',
    ];
    for (const tool of expectedTools) {
      const button = container.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`);
      expect(button).not.toBeNull();
      button?.click();
    }

    expect(onSelectTool.mock.calls.map(([tool]) => tool)).toEqual(expectedTools);
    panel.dispose();
  });

  it('parses CAD numeric expressions and reports validation errors', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onNumericSubmit = vi.fn();
    const onNumericExpression = vi.fn();
    const panel = new SketchSetupPanel({
      container,
      state: { activeTool: 'dimension', numericUnit: 'mm', numericLabel: 'Distance' },
      onNumericSubmit,
      onNumericExpression,
    });

    let input = container.querySelector<HTMLInputElement>('[data-testid="sketch-numeric-input"]')!;
    let form = container.querySelector<HTMLFormElement>('[data-testid="sketch-numeric-form"]')!;
    input.value = '25.4 mm';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onNumericExpression).toHaveBeenCalledWith('25.4 mm');
    expect(onNumericSubmit).toHaveBeenLastCalledWith({
      raw: '25.4 mm',
      result: expect.objectContaining({ ok: true, value: 1, unit: 'mm' }),
    });

    input = container.querySelector<HTMLInputElement>('[data-testid="sketch-numeric-input"]')!;
    form = container.querySelector<HTMLFormElement>('[data-testid="sketch-numeric-form"]')!;
    input.value = '1 / 0';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onNumericSubmit).toHaveBeenLastCalledWith({
      raw: '1 / 0',
      result: expect.objectContaining({ ok: false, error: 'Division by zero' }),
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Division by zero');
    panel.dispose();
  });

  it('submits numeric input on Enter without leaking the key to universal tool routing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onNumericSubmit = vi.fn();
    const panel = new SketchSetupPanel({
      container,
      state: { activeTool: 'dimension', numericUnit: 'in', numericLabel: 'Distance' },
      onNumericSubmit,
    });
    const documentKeyDown = vi.fn();
    document.addEventListener('keydown', documentKeyDown);
    const input = container.querySelector<HTMLInputElement>('[data-testid="sketch-numeric-input"]')!;
    input.value = '3/4';

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));

    expect(onNumericSubmit).toHaveBeenCalledWith({
      raw: '3/4',
      result: expect.objectContaining({ ok: true, value: 0.75 }),
    });
    expect(documentKeyDown).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentKeyDown);
    panel.dispose();
  });

  it('surfaces polygon, constraint, diagnostic, commit, and cancel controls', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onPolygonSidesChange = vi.fn();
    const onConstraintChange = vi.fn();
    const onProfileDiagnosticClick = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const diagnostic = {
      code: 'OPEN_ENDPOINT',
      message: 'Connect this endpoint to close the profile.',
      severity: 'error' as const,
      entityIds: ['line-1'],
    };
    const panel = new SketchSetupPanel({
      container,
      state: { activeTool: 'regular-polygon', polygonSides: 6, profileDiagnostics: [diagnostic] },
      onPolygonSidesChange,
      onConstraintChange,
      onProfileDiagnosticClick,
      onCommit,
      onCancel,
    });

    const sides = container.querySelector<HTMLInputElement>('[data-testid="polygon-sides"]')!;
    sides.value = '8';
    sides.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onPolygonSidesChange).toHaveBeenCalledWith(8);

    container.querySelector<HTMLButtonElement>('[data-diagnostic-code="OPEN_ENDPOINT"]')?.click();
    expect(onProfileDiagnosticClick).toHaveBeenCalledWith(diagnostic, 0);

    panel.refreshState({ activeTool: 'constraint', constraintType: 'horizontal' });
    const constraint = container.querySelector<HTMLSelectElement>('[data-testid="constraint-choice"]')!;
    constraint.value = 'perpendicular';
    constraint.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onConstraintChange).toHaveBeenCalledWith('perpendicular');

    Array.from(container.querySelectorAll<HTMLButtonElement>('.sketch-setup-panel__footer button'))
      .find((button) => button.textContent === 'Commit')?.click();
    Array.from(container.querySelectorAll<HTMLButtonElement>('.sketch-setup-panel__footer button'))
      .find((button) => button.textContent === 'Cancel')?.click();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Enter commits');
    expect(container.textContent).toContain('Escape cancels');
    panel.dispose();
  });
});
