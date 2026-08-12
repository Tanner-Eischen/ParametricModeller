/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../src/core';
import { StatusBar } from '../../src/ui/StatusBar';

describe('StatusBar accessibility', () => {
  afterEach(() => {
    eventBus.clear();
    document.body.innerHTML = '';
  });

  it('announces application and selection status updates politely', () => {
    const container = document.createElement('footer');
    container.innerHTML = '<span id="status-left"></span><span id="status-center"></span><span id="status-right"></span>';
    document.body.appendChild(container);
    new StatusBar(container);

    const left = container.querySelector('#status-left')!;
    const center = container.querySelector('#status-center')!;
    expect(left.getAttribute('role')).toBe('status');
    expect(left.getAttribute('aria-live')).toBe('polite');
    expect(left.getAttribute('aria-atomic')).toBe('true');
    expect(center.getAttribute('aria-live')).toBe('polite');

    eventBus.emit('ui:status', { message: 'Extrude preview ready' });
    eventBus.emit('selection:change', {
      selectedIds: new Set(['body-1', 'body-2']),
      addedIds: new Set(['body-1', 'body-2']),
      removedIds: new Set<string>(),
    });
    expect(left.textContent).toBe('Extrude preview ready');
    expect(center.textContent).toBe('2 objects selected');
  });
});
