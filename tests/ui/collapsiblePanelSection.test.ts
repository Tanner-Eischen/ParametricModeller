/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CollapsiblePanelSection } from '../../src/ui/CollapsiblePanelSection';

describe('CollapsiblePanelSection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts collapsed and exposes an accessible disclosure control', () => {
    const parent = document.createElement('aside');
    document.body.appendChild(parent);
    const section = new CollapsiblePanelSection(parent, 'Properties');
    const toggle = parent.querySelector<HTMLButtonElement>('.panel-section__toggle');

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-controls')).toBe(section.content.id);
    expect(section.content.hidden).toBe(true);
  });

  it('expands and collapses without removing its content', () => {
    const parent = document.createElement('aside');
    const section = new CollapsiblePanelSection(parent, 'Sketch');
    const child = document.createElement('button');
    child.textContent = 'Rectangle';
    section.content.appendChild(child);
    const toggle = parent.querySelector<HTMLButtonElement>('.panel-section__toggle')!;

    toggle.click();
    expect(section.isExpanded()).toBe(true);
    expect(section.content.hidden).toBe(false);
    expect(section.content.contains(child)).toBe(true);

    toggle.click();
    expect(section.isExpanded()).toBe(false);
    expect(section.content.hidden).toBe(true);
  });
});
