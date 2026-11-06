/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortfolioFramePanel } from '../../src/ui/PortfolioFramePanel';
import { COMMAND_DEFINITIONS } from '../../src/ui/CommandCatalog';

describe('PortfolioFramePanel', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('submits a visible length edit and shows measured current bounds', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const apply = vi.fn(); const panel = new PortfolioFramePanel(host, apply);
    panel.refresh({ length: 18, bodyCount: 4, bounds: [24, 18, 0.75], error: null });
    const input = host.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('Frame board length (in)');
    expect(host.textContent).toContain('4 physical boards; outer dimensions 24 × 18 × 0.75 in');
    input.value = '20'; host.querySelector('button')!.click();
    expect(apply).toHaveBeenCalledWith(20);
    panel.refresh({ length: 20, bodyCount: 4, bounds: [26, 20, 0.75], error: null });
    expect(input.value).toBe('20');
    expect(host.textContent).toContain('26 × 20 × 0.75');
  });

  it('keeps a rejected input visible until corrected and disables editing during a tool', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const apply = vi.fn(); const panel = new PortfolioFramePanel(host, apply);
    const state = { length: 18, bodyCount: 4, bounds: [24, 18, 0.75] as [number, number, number], error: null };
    panel.refresh(state);
    host.querySelector('input')!.value = '3'; panel.setError('Length must be greater than 6 inches');
    panel.refresh(state);
    expect(host.querySelector('input')!.value).toBe('3');
    expect(host.querySelector('[role=alert]')!.textContent).toContain('greater than 6');
    panel.refresh(state, true); host.querySelector('button')!.click();
    expect(apply).not.toHaveBeenCalled();
    panel.refresh({ ...state, error: 'The example history changed' });
    expect(host.querySelector('button')!.disabled).toBe(true);
    expect(host.querySelector('[role=alert]')!.textContent).toContain('history changed');
  });

  it('makes all three portable workflow actions discoverable in the File/palette catalog', () => {
    for (const label of ['Frame example', 'Import scene JSON', 'Download scene JSON']) {
      expect(COMMAND_DEFINITIONS.find(command => command.label === label)?.toolbarGroup).toBe('File');
    }
  });

  it('clears a rejected draft when another snapshot is loaded, even at the same length', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const panel = new PortfolioFramePanel(host, vi.fn());
    const state = { length: 18, bodyCount: 4, bounds: [24, 18, 0.75] as [number, number, number], error: null };
    panel.refresh(state); host.querySelector('input')!.value = '3'; panel.setError('Rejected');
    panel.reset(); panel.refresh(state);
    expect(host.querySelector('input')!.value).toBe('18');
    expect(host.querySelector('[role=alert]')!.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('input')!.getAttribute('aria-invalid')).toBe('false');
  });

  it('clears validation error on a successful length change and resets on an unrelated document', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const panel = new PortfolioFramePanel(host, vi.fn());
    panel.refresh({ length: 18, bodyCount: 4, bounds: [24, 18, 0.75], error: null });
    panel.setError('Rejected');
    panel.refresh({ length: 20, bodyCount: 4, bounds: [26, 20, 0.75], error: null });
    expect(host.querySelector('[role=alert]')!.hasAttribute('hidden')).toBe(true);
    panel.refresh(null);
    expect(host.querySelector('input')!.value).toBe('');
    expect(host.querySelector('button')!.disabled).toBe(true);
  });
});
