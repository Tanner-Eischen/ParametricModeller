/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseDocumentDisposition } from '../../src/ui/DocumentTransitionDialog';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
      this.querySelector<HTMLButtonElement>('[autofocus]')?.focus();
    }),
  });
});
afterEach(() => {
  document.body.innerHTML = '';
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  vi.restoreAllMocks();
});
function open() {
  const opener = document.createElement('button'); opener.textContent = 'New document';
  document.body.append(opener); opener.focus();
  const result = chooseDocumentDisposition('Chair', 'New');
  const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
  return { opener, result, dialog };
}
function button(dialog: HTMLDialogElement, text: string) {
  const match = [...dialog.querySelectorAll('button')].find(candidate => candidate.textContent === text);
  if (!match) throw new Error(`Missing button ${text}`);
  return match;
}

describe('document disposition dialog', () => {
  it('opens a labeled modal with Cancel as its safe focused default', async () => {
    const { dialog, opener, result } = open();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe('Unsaved changes');
    expect(dialog.textContent).toContain('Chair');
    expect(document.activeElement).toBe(button(dialog, 'Cancel'));
    button(dialog, 'Cancel').click();
    expect(await result).toBe('cancel');
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it.each([['Save', 'save'], ['Discard changes', 'discard']] as const)('resolves %s explicitly and restores focus', async (label, expected) => {
    const { dialog, opener, result } = open();
    button(dialog, label).click();
    expect(await result).toBe(expected);
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('treats the native Escape cancel event as cancellation and prevents its default', async () => {
    const { dialog, opener, result } = open();
    // Browsers turn Escape on an open modal into this cancel event.
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(await result).toBe('cancel');
    expect(document.activeElement).toBe(opener);
    expect(dialog.isConnected).toBe(false);
  });

  it('treats external dialog closure as cancellation', async () => {
    const { dialog, opener, result } = open();
    dialog.dispatchEvent(new Event('close'));
    expect(await result).toBe('cancel');
    expect(document.activeElement).toBe(opener);
    expect(dialog.isConnected).toBe(false);
  });

  it('does not propagate modeling shortcut or Escape keydown events behind the modal', async () => {
    const onKeydown = vi.fn(); document.addEventListener('keydown', onKeydown);
    try {
      const { dialog, result } = open();
      for (const key of ['b', 'Enter', 'Escape']) {
        button(dialog, 'Cancel').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
      expect(onKeydown).not.toHaveBeenCalled();
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      expect(await result).toBe('cancel');
    } finally { document.removeEventListener('keydown', onKeydown); }
  });

  it('settles once even when stale click and close handlers fire afterward', async () => {
    const { dialog, result } = open();
    const save = button(dialog, 'Save');
    save.click();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    button(dialog, 'Discard changes').click();
    dialog.dispatchEvent(new Event('close'));
    expect(await result).toBe('save');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('safely cancels if its original focus target was removed', async () => {
    const { dialog, opener, result } = open(); opener.remove();
    expect(() => button(dialog, 'Cancel').click()).not.toThrow();
    expect(await result).toBe('cancel');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('renders document names as text, not markup', async () => {
    const result = chooseDocumentDisposition('<img src=x onerror=alert(1)>', 'Open');
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.querySelector('img')).toBeNull();
    expect(dialog.textContent).toContain('<img src=x onerror=alert(1)>');
    button(dialog, 'Cancel').click(); await result;
  });
});
