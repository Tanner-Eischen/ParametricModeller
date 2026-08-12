/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubObjectSelectionPanel } from '../../src/ui/SubObjectSelectionPanel';

describe('SubObjectSelectionPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the four selection modes with readable labels', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const panel = new SubObjectSelectionPanel(container);

    expect(container.textContent).toContain('Selection mode');
    expect(container.textContent).toContain('Body');
    expect(container.textContent).toContain('Face');
    expect(container.textContent).toContain('Edge');
    expect(container.textContent).toContain('Vertex');
    expect(panel.getMode()).toBe('body');

    panel.dispose();
  });

  it('updates the active mode and notifies listeners', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onModeChange = vi.fn();
    const panel = new SubObjectSelectionPanel(container, { onModeChange });

    const vertexButton = container.querySelector<HTMLButtonElement>('button[data-mode="vertex"]');
    expect(vertexButton).not.toBeNull();

    vertexButton?.click();

    expect(onModeChange).toHaveBeenCalledWith('vertex');
    expect(panel.getMode()).toBe('vertex');
    expect(vertexButton?.dataset.active).toBe('true');

    panel.dispose();
  });
});
