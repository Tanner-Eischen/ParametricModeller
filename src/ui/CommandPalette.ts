import { createModuleLogger } from '../core/logger';
import {
  COMMAND_DEFINITIONS,
  type AppCommandDefinition,
  type AppCommandId,
  type CommandAvailability,
} from './CommandCatalog';

const log = createModuleLogger('CommandPalette');

export interface CommandPaletteAction {
  id: AppCommandId;
  onTrigger: () => void;
  isDisabled?: () => boolean;
  getAvailability?: () => CommandAvailability;
}

export interface CommandPaletteOptions {
  container?: HTMLElement;
  actions: CommandPaletteAction[];
  definitions?: readonly AppCommandDefinition[];
  onClose?: () => void;
}

interface RankedCommand {
  definition: AppCommandDefinition;
  score: number;
  sourceIndex: number;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function scoreCommand(definition: AppCommandDefinition, query: string): number | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;

  const label = normalize(definition.label);
  const id = normalize(definition.id);
  const description = normalize(definition.description);
  const group = normalize(definition.toolbarGroup);
  const shortcut = normalize(definition.shortcut ?? '');
  const words = normalizedQuery.split(' ').filter(Boolean);
  const searchable = `${label} ${id} ${description} ${group} ${shortcut}`;
  if (!words.every((word) => searchable.includes(word))) return null;

  let score = 0;
  if (label === normalizedQuery) score += 1_000;
  if (id === normalizedQuery) score += 950;
  if (label.startsWith(normalizedQuery)) score += 700;
  if (id.startsWith(normalizedQuery)) score += 650;
  if (label.split(' ').some((word) => word.startsWith(normalizedQuery))) score += 500;
  if (label.includes(normalizedQuery)) score += 400;
  if (description.includes(normalizedQuery)) score += 150;
  if (group === normalizedQuery) score += 100;
  if (shortcut === normalizedQuery) score += 75;

  for (const word of words) {
    if (label.split(' ').some((candidate) => candidate.startsWith(word))) score += 40;
    else if (id.includes(word)) score += 25;
    else if (description.includes(word)) score += 10;
  }
  return score;
}

/** Returns matching commands in deterministic relevance order. */
export function rankCommandDefinitions(
  definitions: readonly AppCommandDefinition[],
  query: string
): AppCommandDefinition[] {
  return definitions
    .map((definition, sourceIndex): RankedCommand | null => {
      const score = scoreCommand(definition, query);
      return score === null ? null : { definition, score, sourceIndex };
    })
    .filter((entry): entry is RankedCommand => entry !== null)
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .map((entry) => entry.definition);
}

export class CommandPalette {
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private previousFocus: HTMLElement | null = null;
  private readonly definitions: readonly AppCommandDefinition[];
  private readonly actions = new Map<AppCommandId, CommandPaletteAction>();
  private readonly onClose: (() => void) | undefined;
  private matches: AppCommandDefinition[] = [];
  private selectedIndex = 0;

  constructor(options: CommandPaletteOptions) {
    this.definitions = options.definitions ?? COMMAND_DEFINITIONS;
    this.onClose = options.onClose;
    for (const action of options.actions) this.actions.set(action.id, action);
    if (options.container) this.attachTo(options.container);
  }

  attachTo(container: HTMLElement): void {
    this.container = container;
  }

  open(initialQuery = ''): void {
    if (!this.container || this.root) return;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root = document.createElement('div');
    this.root.className = 'command-palette';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Command palette');
    this.root.dataset.testid = 'command-palette';
    this.root.addEventListener('keydown', (event) => this.handleDialogKeyDown(event));

    const surface = document.createElement('div');
    surface.className = 'command-palette__surface';
    surface.addEventListener('click', (event) => event.stopPropagation());
    this.root.addEventListener('click', () => this.close());

    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.className = 'command-palette__input';
    this.input.placeholder = 'Search commands';
    this.input.autocomplete = 'off';
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-controls', 'command-palette-results');
    this.input.setAttribute('aria-expanded', 'true');
    this.input.value = initialQuery;
    this.input.addEventListener('input', () => {
      this.selectedIndex = 0;
      this.renderResults();
    });
    this.input.addEventListener('keydown', (event) => this.handleKeyDown(event));
    surface.appendChild(this.input);

    const results = document.createElement('div');
    results.id = 'command-palette-results';
    results.className = 'command-palette__results';
    results.setAttribute('role', 'listbox');
    surface.appendChild(results);
    this.root.appendChild(surface);
    this.container.appendChild(this.root);
    this.renderResults();
    this.input.focus();
    log.debug('Command palette opened');
  }

  close(): void {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.input = null;
    const focusTarget = this.previousFocus;
    this.previousFocus = null;
    if (focusTarget?.isConnected) focusTarget.focus();
    this.onClose?.();
    log.debug('Command palette closed');
  }

  toggle(): void {
    if (this.root) this.close();
    else this.open();
  }

  isOpen(): boolean {
    return this.root !== null;
  }

  refresh(): void {
    if (this.root) this.renderResults();
  }

  dispose(): void {
    this.close();
    this.container = null;
    this.actions.clear();
  }

  private renderResults(): void {
    if (!this.root || !this.input) return;
    const results = this.root.querySelector<HTMLElement>('#command-palette-results');
    if (!results) return;
    results.replaceChildren();
    this.matches = rankCommandDefinitions(
      this.definitions.filter((definition) => this.actions.has(definition.id)),
      this.input.value
    );
    if (this.matches.length === 0) {
      this.selectedIndex = 0;
      this.input.removeAttribute('aria-activedescendant');
      const empty = document.createElement('div');
      empty.className = 'command-palette__empty';
      empty.setAttribute('role', 'status');
      empty.textContent = 'No matching commands';
      results.appendChild(empty);
      return;
    }

    this.selectedIndex = Math.min(this.selectedIndex, this.matches.length - 1);
    this.matches.forEach((definition, index) => {
      const action = this.actions.get(definition.id);
      if (!action) return;
      const availability = action.getAvailability?.();
      const disabled = availability ? !availability.enabled : (action.isDisabled?.() ?? false);
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `command-palette-${definition.id}`;
      option.className = 'command-palette__option';
      option.dataset.commandId = definition.id;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === this.selectedIndex));
      option.setAttribute('aria-disabled', String(disabled));
      option.disabled = disabled;

      const label = document.createElement('span');
      label.className = 'command-palette__option-label';
      label.textContent = definition.label;
      option.appendChild(label);
      const description = document.createElement('span');
      description.className = 'command-palette__option-description';
      description.textContent = disabled && availability?.reason
        ? availability.reason
        : definition.description;
      if (availability?.reason) option.title = availability.reason;
      option.appendChild(description);
      if (definition.shortcut) {
        const shortcut = document.createElement('kbd');
        shortcut.className = 'command-palette__option-shortcut';
        shortcut.textContent = definition.shortcut;
        option.appendChild(shortcut);
      }
      option.addEventListener('pointermove', () => {
        if (this.selectedIndex === index) return;
        this.selectedIndex = index;
        this.updateSelection();
      });
      option.addEventListener('click', () => this.execute(index));
      results.appendChild(option);
    });
    this.updateSelection();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (this.matches.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (event.key === 'ArrowDown') this.selectedIndex = (this.selectedIndex + 1) % this.matches.length;
      else if (event.key === 'ArrowUp') this.selectedIndex = (this.selectedIndex - 1 + this.matches.length) % this.matches.length;
      else if (event.key === 'Home') this.selectedIndex = 0;
      else this.selectedIndex = this.matches.length - 1;
      this.updateSelection();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.execute(this.selectedIndex);
    }
  }

  private handleDialogKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key !== 'Tab' || !this.root) return;
    const focusable = Array.from(
      this.root.querySelectorAll<HTMLElement>('input, button:not(:disabled), [tabindex]:not([tabindex="-1"])')
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private updateSelection(): void {
    if (!this.root || !this.input) return;
    const options = this.root.querySelectorAll<HTMLElement>('[role="option"]');
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === this.selectedIndex)));
    const selected = this.matches[this.selectedIndex];
    if (selected) {
      const id = `command-palette-${selected.id}`;
      this.input.setAttribute('aria-activedescendant', id);
      const option = this.root.querySelector<HTMLElement>(`#${id}`);
      option?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private execute(index: number): void {
    const definition = this.matches[index];
    if (!definition) return;
    const action = this.actions.get(definition.id);
    if (!action || action.isDisabled?.()) return;
    action.onTrigger();
    this.close();
  }
}
