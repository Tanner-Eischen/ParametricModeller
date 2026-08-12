/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewportSelectionContext } from '../../src/ui/ViewportSelectionContext';

describe('ViewportSelectionContext', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('keeps all pick modes visible and announces mode changes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onModeChange = vi.fn();
    const context = new ViewportSelectionContext(container, { onModeChange });

    const region = container.querySelector('[data-testid="selection-context"]');
    expect(region?.getAttribute('aria-label')).toBe('Current selection');

    for (const mode of ['body', 'face', 'edge', 'vertex']) {
      expect(container.querySelector(`[data-testid="selection-mode-${mode}"]`)).not.toBeNull();
    }

    const faceButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="selection-mode-face"]',
    );
    faceButton?.click();

    expect(context.getMode()).toBe('face');
    expect(
      container.querySelector('[data-testid="selection-mode-face"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      container.querySelector('[data-testid="selection-mode-body"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith('face');

    context.dispose();
  });

  it('refreshes readable selection details and invokes supplied actions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onAction = vi.fn();
    const context = new ViewportSelectionContext(container, { onAction });

    context.refresh({
      mode: 'face',
      selection: {
        kind: 'Planar face',
        name: 'Table top · upper face',
        detail: '24 in × 18 in',
      },
      actions: [
        { id: 'push-pull', label: 'Push/Pull', primary: true },
        { id: 'sketch', label: 'Sketch' },
      ],
    });

    expect(container.querySelector('[data-testid="selection-kind"]')?.textContent).toBe(
      'Planar face',
    );
    expect(container.querySelector('[data-testid="selection-name"]')?.textContent).toBe(
      'Table top · upper face',
    );
    expect(container.querySelector('[data-testid="selection-detail"]')?.textContent).toBe(
      '24 in × 18 in',
    );

    container.querySelector<HTMLButtonElement>('[data-testid="selection-action-push-pull"]')?.click();
    expect(onAction).toHaveBeenCalledWith('push-pull');
    expect(container.textContent).not.toContain('face_1234');

    context.dispose();
  });

  it('keeps overlay pointer gestures away from viewport camera controls', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const parentPointerDown = vi.fn();
    container.addEventListener('pointerdown', parentPointerDown);
    const context = new ViewportSelectionContext(container, {
      initialState: {
        mode: 'body',
        selection: { kind: 'Body', name: 'Side panel' },
        actions: [{ id: 'move', label: 'Move' }],
      },
    });

    const move = container.querySelector<HTMLButtonElement>(
      '[data-testid="selection-action-move"]',
    );
    move?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(parentPointerDown).not.toHaveBeenCalled();
    context.dispose();
  });

  it('shows a compact no-selection hint and removes itself on dispose', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const context = new ViewportSelectionContext(container, {
      initialState: {
        mode: 'edge',
        selection: null,
        hint: 'Click an edge. Hover shows what will be selected.',
      },
    });

    expect(container.querySelector('[data-testid="selection-hint"]')?.textContent).toBe(
      'Click an edge. Hover shows what will be selected.',
    );
    expect(container.querySelector('[data-testid="selection-action-move"]')).toBeNull();

    context.dispose();
    expect(container.querySelector('[data-testid="selection-context"]')).toBeNull();
  });
});
