/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WelcomeOverlay } from '../../src/ui/WelcomeOverlay';

describe('WelcomeOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('dismisses from the close button and stays hidden through refreshes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const overlay = new WelcomeOverlay({
      container,
      actions: [
        {
          label: 'New Box',
          description: 'Create a box',
          onTrigger: vi.fn(),
        },
      ],
    });

    overlay.setVisible(true);
    expect(container.textContent).toContain('Start a design');
    expect(container.textContent).toContain('Choose one starting point.');
    expect(container.textContent).not.toContain('Tip:');
    const closeButton = container.querySelector('.welcome-overlay__close');
    expect(closeButton).not.toBeNull();
    expect(closeButton?.textContent).toBe('Close');

    closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    overlay.refresh();
    overlay.setVisible(true);

    expect(overlay.getIsVisible()).toBe(false);
    overlay.dispose();
  });

  it('can be shown again after resetting the dismissed state', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const overlay = new WelcomeOverlay({
      container,
      actions: [
        {
          label: 'New Box',
          description: 'Create a box',
          onTrigger: vi.fn(),
        },
      ],
    });

    overlay.dismiss();
    overlay.resetDismissed();
    overlay.setVisible(true);

    expect(overlay.getIsVisible()).toBe(true);
    overlay.dispose();
  });

  it('keeps viewport pointer controls from capturing quick-start button presses', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewportPointerDown = vi.fn();
    container.addEventListener('pointerdown', viewportPointerDown);
    const onTrigger = vi.fn();
    const overlay = new WelcomeOverlay({
      container,
      actions: [{ label: 'New Box', description: 'Create a box', onTrigger }],
    });
    overlay.setVisible(true);

    const action = container.querySelector<HTMLButtonElement>('.welcome-overlay__button')!;
    action.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(viewportPointerDown).not.toHaveBeenCalled();
    action.click();
    expect(onTrigger).toHaveBeenCalledOnce();
    overlay.dispose();
  });

  it('is non-modal, preserves focus, and dismisses with Escape', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open quick start';
    document.body.appendChild(opener);
    opener.focus();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const overlay = new WelcomeOverlay({
      container,
      actions: [{ label: 'New Box', description: 'Create a box', onTrigger: vi.fn() }],
    });

    overlay.setVisible(true);
    const card = container.querySelector<HTMLElement>('[role="region"]');
    const close = container.querySelector<HTMLButtonElement>('.welcome-overlay__close');
    const action = container.querySelector<HTMLButtonElement>('.welcome-overlay__button');
    expect(card?.hasAttribute('aria-modal')).toBe(false);
    expect(card?.getAttribute('aria-labelledby')).toBe('welcome-overlay-title');
    expect(card?.getAttribute('aria-describedby')).toBe('welcome-overlay-description');
    expect(document.activeElement).toBe(opener);

    action!.focus();
    overlay.refresh();
    const refreshedAction = container.querySelector<HTMLButtonElement>('.welcome-overlay__button');
    expect(document.activeElement).not.toBe(refreshedAction);

    container.querySelector<HTMLElement>('[role="region"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.getIsVisible()).toBe(false);
    expect(close).not.toBeNull();
    overlay.dispose();
  });
});
