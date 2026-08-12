/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppCommandDefinition } from '../../src/ui/CommandCatalog';
import {
  CommandPalette,
  rankCommandDefinitions,
  type CommandPaletteAction,
} from '../../src/ui/CommandPalette';

const definitions: AppCommandDefinition[] = [
  {
    id: 'addBox', icon: 'B', label: 'Box', description: 'Add a box primitive',
    shortcut: 'B', toolbarGroup: 'Create', shortcutCategory: 'Features',
  },
  {
    id: 'addExtrude', icon: 'E', label: 'Extrude', description: 'Extrude the latest sketch',
    shortcut: 'E', toolbarGroup: 'Create', shortcutCategory: 'Features',
  },
  {
    id: 'fitView', icon: 'F', label: 'Fit View', description: 'Zoom to visible model geometry',
    toolbarGroup: 'View',
  },
];

describe('rankCommandDefinitions', () => {
  it('ranks exact labels, prefixes, descriptions, and multi-word matches deterministically', () => {
    expect(rankCommandDefinitions(definitions, 'extrude')[0]?.id).toBe('addExtrude');
    expect(rankCommandDefinitions(definitions, 'fit')[0]?.id).toBe('fitView');
    expect(rankCommandDefinitions(definitions, 'visible geometry').map((item) => item.id)).toEqual(['fitView']);
    expect(rankCommandDefinitions(definitions, '').map((item) => item.id)).toEqual([
      'addBox', 'addExtrude', 'fitView',
    ]);
  });
});

describe('CommandPalette', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup(actions?: CommandPaletteAction[]): {
    palette: CommandPalette;
    input: HTMLInputElement;
    calls: Record<string, ReturnType<typeof vi.fn>>;
  } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const calls = { box: vi.fn(), extrude: vi.fn(), fit: vi.fn() };
    const palette = new CommandPalette({
      container,
      definitions,
      actions: actions ?? [
        { id: 'addBox', onTrigger: calls.box },
        { id: 'addExtrude', onTrigger: calls.extrude },
        { id: 'fitView', onTrigger: calls.fit },
      ],
    });
    palette.open();
    const input = container.querySelector<HTMLInputElement>('.command-palette__input');
    if (!input) throw new Error('Expected palette input');
    return { palette, input, calls };
  }

  it('opens an accessible modal, filters as the user types, and executes by pointer', () => {
    const { palette, input, calls } = setup();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(input);

    input.value = 'extr';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Extrude');
    options[0]?.click();

    expect(calls.extrude).toHaveBeenCalledOnce();
    expect(palette.isOpen()).toBe(false);
  });

  it('keyboard-navigates, announces the active option, and executes with Enter', () => {
    const { palette, input, calls } = setup();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.getAttribute('aria-activedescendant')).toBe('command-palette-addExtrude');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls.extrude).toHaveBeenCalledOnce();
    expect(palette.isOpen()).toBe(false);
  });

  it('does not execute disabled commands and Escape closes while restoring focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const trigger = vi.fn();
    const { palette, input } = setup([
      { id: 'addBox', onTrigger: trigger, isDisabled: () => true },
    ]);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(trigger).not.toHaveBeenCalled();
    expect(palette.isOpen()).toBe(true);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(palette.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('renders an empty result state without executing anything', () => {
    const { palette, input, calls } = setup();
    input.value = 'not a real command';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.command-palette__empty')?.textContent).toBe('No matching commands');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls.box).not.toHaveBeenCalled();
    expect(palette.isOpen()).toBe(true);
  });

  it('traps focus inside the modal and accepts Escape from a result', () => {
    const { palette } = setup();
    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const last = options[options.length - 1];
    const input = document.querySelector<HTMLInputElement>('.command-palette__input');
    last?.focus();
    last?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
    options[0]?.focus();
    options[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(palette.isOpen()).toBe(false);
  });
});
