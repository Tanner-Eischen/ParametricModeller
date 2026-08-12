/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandToolbar, type CommandToolbarAction } from '../../src/ui/CommandToolbar';

describe('CommandToolbar', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('renders in compact mode by default with icon tooltips', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const actions: CommandToolbarAction[] = [
      { id: 'addBox', onTrigger: vi.fn() },
      { id: 'toggleHelp', onTrigger: vi.fn() },
    ];

    const toolbar = new CommandToolbar({ container, actions });
    const root = container.querySelector<HTMLElement>('.command-toolbar');
    const button = container.querySelector<HTMLButtonElement>('.command-toolbar__button');

    expect(root?.dataset.collapsed).toBe('true');
    expect(button?.dataset.tooltip).toContain('Box');
    expect(button?.getAttribute('aria-label')).toContain('Add a box primitive');

    toolbar.dispose();
  });

  it('toggles between compact and expanded layouts', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const toolbar = new CommandToolbar({
      container,
      actions: [{ id: 'addBox', onTrigger: vi.fn() }],
    });

    const toggle = container.querySelector<HTMLButtonElement>('.command-toolbar__toggle');
    expect(toggle).not.toBeNull();
    toggle?.click();

    const root = container.querySelector<HTMLElement>('.command-toolbar');
    expect(root?.dataset.collapsed).toBe('false');
    expect(window.localStorage.getItem('modelling.commandToolbarCollapsed')).toBe('expanded');

    toolbar.dispose();
  });

  it('keeps one enabled command in the roving tab order after availability refresh', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const toolbar = new CommandToolbar({
      container,
      actions: [
        {
          id: 'undo',
          onTrigger: vi.fn(),
          getAvailability: () => ({ enabled: false, reason: 'Nothing to undo.' }),
        },
        { id: 'addBox', onTrigger: vi.fn(), getAvailability: () => ({ enabled: true }) },
      ],
    });

    const undo = container.querySelector<HTMLButtonElement>('[data-testid="command-undo"]');
    const box = container.querySelector<HTMLButtonElement>('[data-testid="command-addBox"]');
    expect(undo?.disabled).toBe(true);
    expect(undo?.tabIndex).toBe(-1);
    expect(undo?.getAttribute('aria-label')).toContain('Nothing to undo.');
    expect(box?.disabled).toBe(false);
    expect(box?.tabIndex).toBe(0);

    toolbar.dispose();
  });
});
