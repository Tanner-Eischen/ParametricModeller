/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecentFilesPanel } from '../../src/ui/RecentFilesPanel';

describe('RecentFilesPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an empty-state hint when no files are available', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const panel = new RecentFilesPanel({ container });

    expect(container.textContent).toContain('Recent files');
    expect(container.textContent).toContain('No recent files yet');

    panel.dispose();
  });

  it('renders clickable recent files and notifies listeners', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onOpenRecent = vi.fn();
    const panel = new RecentFilesPanel({
      container,
      onOpenRecent,
      recentFiles: [
        {
          path: 'C:\\Users\\tanne\\projects\\Modelling\\scene.json',
          name: 'scene.json',
          lastOpened: '2026-03-24T10:15:00.000Z',
        },
      ],
    });

    const item = container.querySelector<HTMLButtonElement>('.recent-files-panel__item');
    expect(item).not.toBeNull();
    item?.click();

    expect(onOpenRecent).toHaveBeenCalledTimes(1);
    expect(onOpenRecent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'scene.json' })
    );

    panel.dispose();
  });
});
