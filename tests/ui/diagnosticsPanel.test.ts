/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../src/core';
import { DiagnosticsPanel } from '../../src/ui/DiagnosticsPanel';

describe('DiagnosticsPanel accessibility', () => {
  afterEach(() => {
    eventBus.clear();
    document.body.innerHTML = '';
  });

  it('renders feature diagnostics as keyboard-operable buttons', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new DiagnosticsPanel({ container });
    const onSelected = vi.fn();
    eventBus.on('feature:selected', onSelected);

    panel.setDiagnostics([
      { severity: 'error', code: 'BROKEN_REF', message: 'Select a replacement', featureId: 'feature-7' },
      { severity: 'warning', code: 'GENERAL', message: 'Document warning' },
    ]);

    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label'))
      .toBe('Model diagnostics');
    const action = container.querySelector<HTMLButtonElement>('button');
    expect(action?.type).toBe('button');
    expect(action?.getAttribute('aria-label')).toContain('Select affected feature');
    action?.click();
    expect(onSelected).toHaveBeenCalledWith({ featureId: 'feature-7' });
    expect(container.querySelectorAll('button')).toHaveLength(1);
    panel.dispose();
  });
});
