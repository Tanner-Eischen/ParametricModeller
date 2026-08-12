/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewCube } from '../../src/ui/ViewCube';

describe('ViewCube', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an accessible button for every named view', () => {
    const cube = new ViewCube({ container, onSelect: vi.fn() });

    const root = container.querySelector('[data-testid="view-cube"]');
    expect(root?.getAttribute('role')).toBe('group');
    expect(root?.getAttribute('aria-label')).toBe('Named camera views');
    expect(container.querySelectorAll('button')).toHaveLength(7);
    expect(container.querySelector('[aria-label="Isometric view"]')).not.toBeNull();

    cube.dispose();
  });

  it('selects a pointer-clicked view and exposes active state', () => {
    const onSelect = vi.fn();
    const cube = new ViewCube({ container, onSelect });
    const front = container.querySelector<HTMLButtonElement>('[data-testid="view-cube-front"]');

    front?.click();

    expect(onSelect).toHaveBeenCalledWith('front');
    expect(cube.getActiveView()).toBe('front');
    expect(front?.getAttribute('aria-pressed')).toBe('true');
  });

  it('supports keyboard navigation from the overlay', () => {
    const onSelect = vi.fn();
    const cube = new ViewCube({ container, onSelect });
    const root = container.querySelector<HTMLElement>('[data-testid="view-cube"]');

    root?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowUp', bubbles: true, cancelable: true,
    }));
    root?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Home', bubbles: true, cancelable: true,
    }));

    expect(onSelect).toHaveBeenNthCalledWith(1, 'top');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'isometric');
    expect(cube.getActiveView()).toBe('isometric');
  });

  it('ignores modified shortcuts so application commands keep precedence', () => {
    const onSelect = vi.fn();
    new ViewCube({ container, onSelect });
    const root = container.querySelector<HTMLElement>('[data-testid="view-cube"]');

    root?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', ctrlKey: true, bubbles: true,
    }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('can be reattached and disposed without leaving duplicate overlays', () => {
    const second = document.createElement('div');
    document.body.appendChild(second);
    const cube = new ViewCube({ container, onSelect: vi.fn(), initialView: 'top' });

    cube.attachTo(second);
    expect(container.querySelector('[data-testid="view-cube"]')).toBeNull();
    expect(second.querySelectorAll('[data-testid="view-cube"]')).toHaveLength(1);
    expect(second.querySelector('[data-testid="view-cube-top"]')?.getAttribute('aria-pressed')).toBe('true');

    cube.dispose();
    expect(second.children).toHaveLength(0);
  });
});
