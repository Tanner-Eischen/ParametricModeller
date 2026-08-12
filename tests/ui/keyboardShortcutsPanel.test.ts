/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { KeyboardShortcutsPanel } from '../../src/ui/KeyboardShortcutsPanel';

describe('KeyboardShortcutsPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows shortcut help plus workflow discovery sections', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const panel = new KeyboardShortcutsPanel({ container });
    panel.show();

    expect(container.textContent).toContain('Commands and shortcuts');
    expect(container.textContent).toContain('Undo');
    expect(container.textContent).toContain('Redo');
    expect(container.textContent).toContain('Shift+V');
    expect(container.textContent).toContain('Selection modes');
    expect(container.textContent).toContain('File workflow');
    expect(container.textContent).toContain('Sketch workflow');
    expect(container.textContent).toContain('Sketch setup');
    expect(container.textContent).toContain('Recent files');
    expect(container.textContent).toContain('Fit View');

    panel.dispose();
  });
});
