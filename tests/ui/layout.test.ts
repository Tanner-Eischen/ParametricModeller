// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from '../../src/ui/Layout';

function createLayout(options: ConstructorParameters<typeof Layout>[1] = {}): {
  container: HTMLElement;
  layout: Layout;
} {
  const container = document.createElement('div');
  container.innerHTML = `
    <header id="toolbar"></header>
    <div id="workspace">
      <aside id="panel-left"><div data-testid="left-content">Browser</div></aside>
      <main id="viewport"></main>
      <aside id="panel-right"><div data-testid="right-content">Tasks</div></aside>
    </div>
    <footer id="status-bar"></footer>
  `;
  document.body.appendChild(container);
  return { container, layout: new Layout(container, options) };
}

describe('Layout sidebars', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts with both sidebars expanded and accessible controls', () => {
    const { container, layout } = createLayout();
    const left = container.querySelector<HTMLElement>('#panel-left');
    const right = container.querySelector<HTMLElement>('#panel-right');
    const leftToggle = container.querySelector<HTMLButtonElement>('[data-testid="left-sidebar-toggle"]');
    const rightToggle = container.querySelector<HTMLButtonElement>('[data-testid="right-sidebar-toggle"]');

    expect(layout.isSidebarCollapsed('left')).toBe(false);
    expect(layout.isSidebarCollapsed('right')).toBe(false);
    expect(left?.style.width).toBe('250px');
    expect(right?.style.width).toBe('300px');
    expect(leftToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(leftToggle?.getAttribute('aria-controls')).toBe('panel-left');
    expect(leftToggle?.getAttribute('aria-label')).toBe('Collapse model browser');
    expect(rightToggle?.getAttribute('aria-label')).toBe('Collapse task panel');
  });

  it('toggles each sidebar to a compact rail and restores its configured width', () => {
    const { container, layout } = createLayout({
      panelWidth: 264,
      taskPanelWidth: 320,
      collapsedPanelWidth: 40,
    });
    const left = container.querySelector<HTMLElement>('#panel-left');
    const right = container.querySelector<HTMLElement>('#panel-right');
    const leftToggle = container.querySelector<HTMLButtonElement>('[data-testid="left-sidebar-toggle"]');

    leftToggle?.click();
    layout.collapseSidebar('right');

    expect(left?.dataset.collapsed).toBe('true');
    expect(right?.dataset.collapsed).toBe('true');
    expect(left?.style.width).toBe('40px');
    expect(right?.style.width).toBe('40px');
    expect(leftToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(leftToggle?.getAttribute('aria-label')).toBe('Expand model browser');

    layout.expandSidebar('left');
    layout.toggleSidebar('right');

    expect(left?.style.width).toBe('264px');
    expect(right?.style.width).toBe('320px');
    expect(layout.isSidebarCollapsed('left')).toBe(false);
    expect(layout.isSidebarCollapsed('right')).toBe(false);
  });

  it('notifies viewport consumers after a sidebar changes state', () => {
    const { container, layout } = createLayout();
    const viewport = container.querySelector<HTMLElement>('#viewport');
    const onLayoutResize = vi.fn();
    const onWindowResize = vi.fn();
    viewport?.addEventListener('layout:resize', onLayoutResize);
    window.addEventListener('resize', onWindowResize, { once: true });

    layout.collapseSidebar('left');

    expect(onLayoutResize).toHaveBeenCalledOnce();
    expect(onWindowResize).toHaveBeenCalledOnce();
  });

  it('keeps a changed expanded width while the sidebar is collapsed', () => {
    const { container, layout } = createLayout({ collapsedPanelWidth: 38 });
    const left = container.querySelector<HTMLElement>('#panel-left');

    layout.collapseSidebar('left');
    layout.setPanelWidth(280);
    expect(left?.style.width).toBe('38px');

    layout.expandSidebar('left');
    expect(left?.style.width).toBe('280px');
  });
});
