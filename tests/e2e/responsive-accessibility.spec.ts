import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { COMMAND_DEFINITIONS } from '../../src/ui/CommandCatalog';
import { WORKSPACE_PREFERENCES_STORAGE_KEY } from '../../src/ui/WorkspacePreferencesStore';

test.describe.configure({ mode: 'serial' });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, leftOverlay: false, rightOverlay: false },
  { name: 'compact desktop', width: 960, height: 720, leftOverlay: false, rightOverlay: true },
  { name: 'tablet', width: 768, height: 1024, leftOverlay: false, rightOverlay: true },
  { name: 'phone', width: 390, height: 844, leftOverlay: true, rightOverlay: true },
] as const;

async function openFreshWorkspace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // window.name survives reloads, allowing persistence tests to reload without
    // their setup hook erasing the preferences they just wrote.
    if (window.name !== 'responsive-e2e-initialized') {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.name = 'responsive-e2e-initialized';
    }
  });
  await page.goto('/');
  await expect(page.locator('#viewport canvas[data-engine]')).toBeVisible();
}

async function expectCollapsedSidebars(page: Page): Promise<void> {
  await expect(page.locator('#panel-left')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('#panel-right')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.getByTestId('left-sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('right-sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
}

async function expandSidebar(page: Page, side: 'left' | 'right'): Promise<void> {
  const panel = page.locator(`#panel-${side}`);
  if ((await panel.getAttribute('data-collapsed')) === 'true') {
    await page.getByTestId(`${side}-sidebar-toggle`).click();
  }
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
}

test.beforeEach(async ({ page }) => {
  await openFreshWorkspace(page);
});

test('first run is quiet, non-modal, and collapsed by default', async ({ page }) => {
  await expectCollapsedSidebars(page);

  const quickStart = page.getByRole('region', { name: 'Start a design' });
  await expect(quickStart).toBeVisible();
  await expect(quickStart).toContainText('Choose one starting point.');
  await expect(quickStart.getByRole('button', { name: 'Board', exact: true })).toBeVisible();
  await expect(quickStart.getByRole('button', { name: 'Sketch', exact: true })).toBeVisible();
  await expect(quickStart.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /start|quick/i })).toHaveCount(0);

  const sectionToggles = page.locator('.panel-section__toggle');
  await expect(sectionToggles).not.toHaveCount(0);
  for (const toggle of await sectionToggles.all()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }

  const primaryCommands = page.locator('.command-toolbar__button');
  await expect(primaryCommands).toHaveCount(8);
  await expect(page.getByRole('toolbar', { name: 'Modeling commands' })).toBeAttached();

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  );
});

test('sidebar, section, and quick-start preferences survive reload', async ({ page }) => {
  await expectCollapsedSidebars(page);
  await expandSidebar(page, 'left');

  const selectionToggle = page.getByRole('button', { name: 'Selection', exact: true });
  await expect(selectionToggle).toHaveAttribute('aria-expanded', 'false');
  await selectionToggle.click();
  await expect(selectionToggle).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Dismiss quick start' }).click();
  await expect(page.locator('.welcome-overlay')).toBeHidden();

  const persisted = await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as {
      preferences: {
        sidebars: { left: { collapsed: boolean } };
        expandedSections: Record<string, boolean>;
        quickStartDismissed: boolean;
      };
    } : null;
  }, WORKSPACE_PREFERENCES_STORAGE_KEY);
  expect(persisted?.preferences.sidebars.left.collapsed).toBe(false);
  expect(persisted?.preferences.expandedSections.Selection).toBe(true);
  expect(persisted?.preferences.quickStartDismissed).toBe(true);

  await page.reload();
  await expect(page.locator('#panel-left')).toHaveAttribute('data-collapsed', 'false');
  await expect(page.getByRole('button', { name: 'Selection', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await expect(page.locator('.welcome-overlay')).toBeHidden();

  await page.getByTestId('left-sidebar-toggle').click();
  await expect(page.locator('#panel-left')).toHaveAttribute('data-collapsed', 'true');
  await page.reload();
  await expect(page.locator('#panel-left')).toHaveAttribute('data-collapsed', 'true');
});

test('corrupt workspace preferences fail safely to quiet defaults', async ({ page }) => {
  await page.evaluate((storageKey) => {
    window.localStorage.setItem(storageKey, '{this is not valid json');
  }, WORKSPACE_PREFERENCES_STORAGE_KEY);
  await page.reload();

  await expectCollapsedSidebars(page);
  await expect(page.getByRole('region', { name: 'Start a design' })).toBeVisible();
  for (const toggle of await page.locator('.panel-section__toggle').all()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.locator('#viewport canvas[data-engine]')).toBeVisible();
});

test('all commands remain reachable and disabled commands explain prerequisites', async ({ page }) => {
  const toolbar = page.getByRole('toolbar', { name: 'Modeling commands' });
  const enabledRovingTargets = toolbar.locator('button:not(:disabled)[tabindex="0"]');
  await expect(enabledRovingTargets).toHaveCount(1);
  const initialRovingTarget = enabledRovingTargets.first();
  const initialRovingId = await initialRovingTarget.getAttribute('data-testid');
  await initialRovingTarget.focus();
  await page.keyboard.press('ArrowRight');
  const nextRovingTarget = toolbar.locator('button:not(:disabled)[tabindex="0"]');
  await expect(nextRovingTarget).toHaveCount(1);
  expect(await nextRovingTarget.getAttribute('data-testid')).not.toBe(initialRovingId);
  await expect(nextRovingTarget).toBeFocused();

  const extrude = page.getByTestId('command-addExtrude');
  await expect(extrude).toBeDisabled();
  await expect(extrude).toHaveAttribute(
    'data-disabled-reason',
    'Select one sketch with a valid closed region.'
  );

  const commandsButton = page.getByTestId('command-openCommandPalette');
  await commandsButton.focus();
  await commandsButton.click();

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await expect(palette.locator('[data-command-id]')).toHaveCount(COMMAND_DEFINITIONS.length - 1);

  const search = palette.getByRole('combobox');
  await search.fill('push pull');
  const pushPull = palette.locator('[data-command-id="enterPushPull"]');
  await expect(pushPull).toHaveAttribute('aria-disabled', 'true');
  await expect(pushPull).toContainText('Select one planar face.');

  await search.press('Escape');
  await expect(palette).toBeHidden();
  await expect(commandsButton).toBeFocused();
});

test('active tools replace properties without exposing implementation details', async ({ page }) => {
  await page.getByRole('region', { name: 'Start a design' })
    .getByRole('button', { name: 'Sketch', exact: true })
    .click();
  await expandSidebar(page, 'right');

  const activeToolToggle = page.getByRole('button', { name: 'Active tool', exact: true });
  const propertiesToggle = page.getByRole('button', { name: 'Properties', exact: true });
  await expect(activeToolToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(propertiesToggle).toHaveAttribute('aria-expanded', 'false');

  const activeTool = page.getByTestId('panel-section-active-tool');
  const visibleText = await activeTool.innerText();
  expect(visibleText).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  );
  expect(visibleText).not.toContain('{"');
  expect(visibleText).not.toMatch(/\b(Plane Ref|Geometry|Relations)\b/);
  await expect(activeTool.getByLabel('Numeric input')).toBeVisible();
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}x${viewport.height} keeps the viewport dominant`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.reload();
    await expectCollapsedSidebars(page);

    const workspace = page.locator('#workspace');
    const modelViewport = page.locator('#viewport');
    const workspaceBox = await workspace.boundingBox();
    const viewportBox = await modelViewport.boundingBox();
    expect(workspaceBox).not.toBeNull();
    expect(viewportBox).not.toBeNull();
    expect(viewportBox!.height).toBeGreaterThan(workspaceBox!.height * 0.9);
    expect(viewportBox!.width).toBeGreaterThan(workspaceBox!.width * 0.6);

    const layout = await page.evaluate(() => {
      const left = window.getComputedStyle(document.querySelector('#panel-left')!);
      const right = window.getComputedStyle(document.querySelector('#panel-right')!);
      const toolbar = window.getComputedStyle(document.querySelector('#toolbar')!);
      return {
        leftPosition: left.position,
        rightPosition: right.position,
        toolbarPosition: toolbar.position,
      };
    });
    expect(layout.leftPosition === 'absolute').toBe(viewport.leftOverlay);
    expect(layout.rightPosition === 'absolute').toBe(viewport.rightOverlay);
    expect(layout.toolbarPosition === 'absolute').toBe(viewport.width < 768);

    if (viewport.width < 768) {
      const touchTargets = [
        page.getByTestId('left-sidebar-toggle'),
        page.getByTestId('right-sidebar-toggle'),
        ...await page.locator('#toolbar button:visible').all(),
        ...await page.getByTestId('selection-context').locator('button:visible').all(),
      ];
      for (const targetLocator of touchTargets) {
        const target = await targetLocator.boundingBox();
        expect(target?.width).toBeGreaterThanOrEqual(44);
        expect(target?.height).toBeGreaterThanOrEqual(44);
      }

      const selectionBounds = await page.getByTestId('selection-context').boundingBox();
      const viewCubeBounds = await page.getByRole('group', { name: 'Named camera views' }).boundingBox();
      expect(selectionBounds).not.toBeNull();
      expect(viewCubeBounds).not.toBeNull();
      expect(selectionBounds!.x + selectionBounds!.width).toBeLessThanOrEqual(viewCubeBounds!.x);
    }
  });
}

test('Escape closes a narrow-screen drawer and restores its toggle focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const toggle = page.getByTestId('left-sidebar-toggle');

  await toggle.click();
  await expect(page.locator('#panel-left')).toHaveAttribute('data-collapsed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-left')).toHaveAttribute('data-collapsed', 'true');
  await expect(toggle).toBeFocused();
});

test('core workspace controls expose keyboard and screen-reader semantics', async ({ page }) => {
  const modelViewport = page.getByRole('main', { name: /3d|model|viewport/i });
  await expect(modelViewport).toHaveAttribute('id', 'viewport');
  await expect(modelViewport).toHaveAttribute('aria-label', /3d|model|viewport/i);
  await expect(modelViewport).toHaveAttribute('tabindex', '0');

  await expect(page.locator('#status-left')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#status-center')).toHaveAttribute('aria-label', 'Selection status');

  const unnamedVisibleControls = await page.evaluate(() => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && bounds.width > 0
        && bounds.height > 0;
    };
    return Array.from(document.querySelectorAll<HTMLElement>('button, input, select, textarea'))
      .filter(isVisible)
      .filter((element) => {
        const explicit = element.getAttribute('aria-label')?.trim()
          || element.getAttribute('aria-labelledby')?.trim()
          || element.getAttribute('title')?.trim();
        const text = element.textContent?.trim();
        const labels = element instanceof HTMLInputElement
          || element instanceof HTMLSelectElement
          || element instanceof HTMLTextAreaElement
          ? Array.from(element.labels ?? []).some((label) => Boolean(label.textContent?.trim()))
          : false;
        return !explicit && !text && !labels;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
  });
  expect(unnamedVisibleControls).toEqual([]);
});

test('first-run workspace has no automated accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .include('#app')
    .analyze();
  const summary = results.violations
    .map((violation) => {
      const targets = violation.nodes.flatMap((node) => node.target).join(', ');
      return `${violation.id} (${violation.impact ?? 'unknown'}): ${targets}`;
    })
    .join('\n');
  expect(results.violations, summary).toEqual([]);
});
