import { expect, test, type Download, type Page } from '@playwright/test';
import {
  BROWSER_REFERENCE_BUDGET,
  BROWSER_REFERENCE_WORKLOAD,
  REFERENCE_FEATURE_COUNT,
} from '../../src/performance/ReferenceBenchmark';

// Every modeler page owns a WebGL render loop. Running many copies of this
// single workflow suite concurrently can starve Chromium during context close.
test.describe.configure({ mode: 'serial' });

const PRIMARY_TOOLBAR_COMMANDS = new Set([
  'undo',
  'redo',
  'addBox',
  'addSketch',
  'addExtrude',
  'addExtrudeCut',
  'addWoodJoint',
  'openCommandPalette',
]);

const command = (page: Page, id: string) => {
  const locator = page.getByTestId(`command-${id}`);
  if (!PRIMARY_TOOLBAR_COMMANDS.has(id)) {
    // Preserve the workflow suite's concise command syntax while exercising
    // commands moved from the quiet toolbar through their real palette route.
    Object.defineProperty(locator, 'click', {
      configurable: true,
      value: () => invokeCommand(page, id),
    });
  }
  return locator;
};
const feature = (page: Page, type: string) =>
  page.getByTestId('model-browser').locator(`[data-feature-type="${type}"]`);

async function runCommand(page: Page, id: string): Promise<void> {
  // Click the toolbar button only when it is actually visible. A command folded into a
  // collapsed group is present in the DOM (count > 0) but not actionable; routing it
  // through the palette is the fallback that the old count-based check never reached.
  const toolbarButton = page.getByTestId(`command-${id}`);
  if ((await toolbarButton.count()) > 0) {
    const visible = await toolbarButton.first().isVisible().catch(() => false);
    if (visible) {
      await toolbarButton.first().click();
      return;
    }
  }

  // The openCommandPalette toolbar button is folded into a chrome group on a compact
  // toolbar, so open the palette via its Ctrl+K keyboard shortcut (see the palette test).
  await page.keyboard.press('Control+K');
  const palette = page.getByTestId('command-palette');
  const option = palette.locator(`[data-command-id="${id}"]`);
  await expect(option, `Command ${id} should be reachable from the command palette`).toBeVisible();
  await expect(option, `Command ${id} should be available for this workflow`).toBeEnabled();
  await option.click();
}

async function invokeCommand(page: Page, id: string): Promise<void> {
  await runCommand(page, id);
}

async function expectCommandAvailability(
  page: Page,
  id: string,
  enabled: boolean
): Promise<void> {
  const toolbarButton = page.getByTestId(`command-${id}`);
  if ((await toolbarButton.count()) > 0) {
    const visible = await toolbarButton.first().isVisible().catch(() => false);
    if (visible) {
      if (enabled) await expect(toolbarButton).toBeEnabled();
      else await expect(toolbarButton).toBeDisabled();
      return;
    }
  }

  await page.keyboard.press('Control+K');
  const palette = page.getByTestId('command-palette');
  const option = palette.locator(`[data-command-id="${id}"]`);
  await expect(option).toBeVisible();
  if (enabled) await expect(option).toBeEnabled();
  else await expect(option).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
}

async function expandSection(page: Page, title: string): Promise<void> {
  const toggle = page.getByRole('button', { name: title, exact: true });
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

async function expectLatestSketchSegmentCount(page: Page, expected: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const app = (window as Window & { app?: {
      features: Array<{
        type: string;
        parameters: { geometry?: { segments?: unknown[] } };
      }>;
    } }).app!;
    const sketch = [...app.features].reverse().find((candidate) => candidate.type === 'sketch');
    return sketch?.parameters.geometry?.segments?.length ?? 0;
  })).toBe(expected);
}

async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Download stream was unavailable');
  return await new Promise<string>((resolve, reject) => {
    let content = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      content += chunk;
    });
    stream.on('end', () => resolve(content));
    stream.on('error', reject);
  });
}

async function openCleanModeler(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // E2E drives tools via toolbar button clicks, so the toolbar must be
    // expanded with all groups unfolded (the app defaults to a compact, folded
    // toolbar where individual command buttons are not visible/clickable).
    window.localStorage.setItem('modelling.commandToolbarCollapsed', 'expanded');
    window.localStorage.setItem('modelling.commandToolbarCollapsedGroups', '[]');
  });
  await page.goto('/');
  await expect(page.locator('#viewport canvas[data-engine]')).toBeVisible();
  await expect(page.locator('#panel-left')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('#panel-right')).toHaveAttribute('data-collapsed', 'true');
  for (const side of ['right', 'left'] as const) {
    const panel = page.locator(`#panel-${side}`);
    if ((await panel.getAttribute('data-collapsed')) === 'true') {
      await page.getByTestId(`${side}-sidebar-toggle`).click();
    }
    await expect(panel).toHaveAttribute('data-collapsed', 'false');
  }
  await expect(page.getByTestId('panel-section-model-browser')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Model browser', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(page.getByTestId('model-browser')).toBeHidden();

  const dismissQuickStart = page.getByRole('button', { name: 'Dismiss quick start' });
  if (await dismissQuickStart.isVisible()) {
    await dismissQuickStart.click();
  }
}

async function findVisibleFacePoint(
  page: Page,
  desiredFaceId?: string | string[]
): Promise<{ x: number; y: number }> {
  return page.evaluate((requestedFaceId) => {
    const requestedFaceIds = Array.isArray(requestedFaceId)
      ? requestedFaceId
      : requestedFaceId ? [requestedFaceId] : [];
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas[data-engine]');
    const app = (window as Window & { app?: {
      picking: {
        pickFace(
          x: number,
          y: number,
          width: number,
          height: number,
          camera: unknown,
          objects: unknown[]
        ): { faceId: string | null };
      };
      sceneObjects: Map<string, unknown>;
      viewport: { getCameraControls(): { camera: unknown } };
    } }).app!;
    if (!canvas) throw new Error('Viewport canvas was unavailable');
    const bounds = canvas.getBoundingClientRect();
    const objects = Array.from(app.sceneObjects.values());
    const visibleFaceIds = new Set<string>();
    for (let y = bounds.height * 0.2; y <= bounds.height * 0.8; y += 12) {
      for (let x = bounds.width * 0.2; x <= bounds.width * 0.8; x += 12) {
        const clientX = bounds.left + x;
        const clientY = bounds.top + y;
        const hit = app.picking.pickFace(
          x,
          y,
          bounds.width,
          bounds.height,
          app.viewport.getCameraControls().camera,
          objects
        );
        if (hit.faceId) {
          visibleFaceIds.add(hit.faceId);
          if (requestedFaceIds.length === 0 || requestedFaceIds.includes(hit.faceId)) {
            return { x: clientX, y: clientY };
          }
        }
      }
    }
    throw new Error(`No requested model face could be picked; visible faces: ${[...visibleFaceIds].join(', ')}`);
  }, desiredFaceId);
}

async function findVisibleBodyPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas[data-engine]');
    const app = (window as Window & { app?: {
      picking: {
        pick(
          x: number,
          y: number,
          width: number,
          height: number,
          camera: unknown,
          objects: unknown[]
        ): { objectId: string | null };
      };
      sceneObjects: Map<string, unknown>;
      viewport: { getCameraControls(): { camera: unknown } };
    } }).app!;
    if (!canvas) throw new Error('Viewport canvas was unavailable');
    const bounds = canvas.getBoundingClientRect();
    const objects = Array.from(app.sceneObjects.values());
    for (let y = bounds.height * 0.1; y <= bounds.height * 0.9; y += 8) {
      for (let x = bounds.width * 0.1; x <= bounds.width * 0.9; x += 8) {
        const clientX = bounds.left + x;
        const clientY = bounds.top + y;
        if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
        const hit = app.picking.pick(
          x,
          y,
          bounds.width,
          bounds.height,
          app.viewport.getCameraControls().camera,
          objects
        );
        if (hit.objectId) return { x: clientX, y: clientY };
      }
    }
    throw new Error('No visible model body could be picked');
  });
}

async function findVisibleEdgePoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas[data-engine]');
    const app = (window as Window & { app?: {
      picking: {
        pickEdge(
          x: number,
          y: number,
          width: number,
          height: number,
          camera: unknown,
          bodies: Map<string, unknown>
        ): { edgeId?: string } | null;
      };
      getPickableBodies(): Map<string, unknown>;
      viewport: { getCameraControls(): { camera: unknown } };
    } }).app!;
    if (!canvas) throw new Error('Viewport canvas was unavailable');
    const bounds = canvas.getBoundingClientRect();
    for (let y = bounds.height * 0.1; y <= bounds.height * 0.9; y += 6) {
      for (let x = bounds.width * 0.1; x <= bounds.width * 0.9; x += 6) {
        const clientX = bounds.left + x;
        const clientY = bounds.top + y;
        const hit = app.picking.pickEdge(
          x,
          y,
          bounds.width,
          bounds.height,
          app.viewport.getCameraControls().camera,
          app.getPickableBodies(),
        );
        if (hit?.edgeId) return { x: clientX, y: clientY };
      }
    }
    throw new Error('No visible model edge could be picked');
  });
}

async function findVertexMarkerPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    interface ProjectableVector {
      x: number;
      y: number;
      clone(): ProjectableVector;
      project(camera: unknown): ProjectableVector;
    }
    interface Marker {
      position: ProjectableVector;
    }
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas[data-engine]');
    const app = (window as Window & { app?: {
      viewport: {
        getCameraControls(): { camera: unknown };
        getScene(): { getObjectByName(name: string): { visible: boolean; children: Marker[] } | undefined };
      };
    } }).app!;
    if (!canvas) throw new Error('Viewport canvas was unavailable');
    const bounds = canvas.getBoundingClientRect();
    const group = app.viewport.getScene().getObjectByName('vertex-selection-overlay');
    if (!group?.visible) throw new Error('Vertex markers were not visible');
    const camera = app.viewport.getCameraControls().camera;
    for (const marker of group.children) {
      const point = marker.position.clone().project(camera);
      const x = bounds.left + (point.x + 1) * bounds.width / 2;
      const y = bounds.top + (1 - point.y) * bounds.height / 2;
      if (document.elementFromPoint(x, y) === canvas) return { x, y };
    }
    throw new Error('No unobscured vertex marker was available');
  });
}

async function findEmptyViewportPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas[data-engine]');
    const app = (window as Window & { app?: {
      picking: {
        pickFace(
          x: number,
          y: number,
          width: number,
          height: number,
          camera: unknown,
          objects: unknown[]
        ): { faceId?: string };
        pickEdge(
          x: number,
          y: number,
          width: number,
          height: number,
          camera: unknown,
          bodies: Map<string, unknown>
        ): { edgeId?: string } | null;
        pickVertex(
          x: number,
          y: number,
          width: number,
          height: number,
          camera: unknown,
          bodies: Map<string, unknown>
        ): { vertexId?: string } | null;
      };
      getPickableBodies(): Map<string, unknown>;
      sceneObjects: Map<string, unknown>;
      viewport: { getCameraControls(): { camera: unknown } };
    } }).app!;
    if (!canvas) throw new Error('Viewport canvas was unavailable');
    const bounds = canvas.getBoundingClientRect();
    const objects = Array.from(app.sceneObjects.values());
    const bodies = app.getPickableBodies();
    for (let y = 20; y < bounds.height - 20; y += 30) {
      for (let x = 20; x < bounds.width - 20; x += 30) {
        const clientX = bounds.left + x;
        const clientY = bounds.top + y;
        if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
        const face = app.picking.pickFace(
          x,
          y,
          bounds.width,
          bounds.height,
          app.viewport.getCameraControls().camera,
          objects,
        );
        const edge = app.picking.pickEdge(
          x,
          y,
          bounds.width,
          bounds.height,
          app.viewport.getCameraControls().camera,
          bodies,
        );
        const vertex = app.picking.pickVertex(
          x,
          y,
          bounds.width,
          bounds.height,
          app.viewport.getCameraControls().camera,
          bodies,
        );
        if (!face.faceId && !edge?.edgeId && !vertex?.vertexId) return { x: clientX, y: clientY };
      }
    }
    throw new Error('No empty viewport point was available');
  });
}

async function dragTranslationTriad(page: Page, distance = 90): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const segment = await page.evaluate((dragDistance) => {
    interface ProjectableVector {
      x: number;
      y: number;
      clone(): ProjectableVector;
      project(camera: unknown): ProjectableVector;
    }
    interface ArrowHandle {
      position: ProjectableVector;
      getWorldPosition(target: ProjectableVector): ProjectableVector;
      cone: { getWorldPosition(target: ProjectableVector): ProjectableVector };
    }
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport canvas[data-engine]');
    const app = (window as Window & { app?: {
      translationTriadGizmo: { arrows: ArrowHandle[] };
      viewport: { getCameraControls(): { camera: unknown } };
    } }).app!;
    const arrow = app.translationTriadGizmo.arrows[0];
    if (!canvas || !arrow) throw new Error('Translation triad handle was unavailable');
    const bounds = canvas.getBoundingClientRect();
    const camera = app.viewport.getCameraControls().camera;
    const origin = arrow.getWorldPosition(arrow.position.clone()).project(camera);
    const cone = arrow.cone.getWorldPosition(arrow.position.clone()).project(camera);
    const toClient = (point: ProjectableVector) => ({
      x: bounds.left + (point.x + 1) * bounds.width / 2,
      y: bounds.top + (1 - point.y) * bounds.height / 2,
    });
    const originClient = toClient(origin);
    const coneClient = toClient(cone);
    const start = {
      x: originClient.x + (coneClient.x - originClient.x) * 0.65,
      y: originClient.y + (coneClient.y - originClient.y) * 0.65,
    };
    if (document.elementFromPoint(start.x, start.y) !== canvas) {
      throw new Error('Translation triad handle is obscured by another viewport control');
    }
    const axisX = start.x - originClient.x;
    const axisY = start.y - originClient.y;
    const length = Math.hypot(axisX, axisY);
    if (length < 1) throw new Error('Translation triad axis is not screen-visible');
    return {
      start,
      end: {
        x: start.x + axisX / length * dragDistance,
        y: start.y + axisY / length * dragDistance,
      },
    };
  }, distance);
  await page.mouse.move(segment.start.x, segment.start.y);
  await page.mouse.down();
  await page.mouse.move(segment.end.x, segment.end.y, { steps: 30 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await openCleanModeler(page);
});

test('starts calm and collapses both sidebar rails', async ({ page }) => {
  // Every visible sidebar section starts collapsed. The five always-hidden
  // contextual sections (Diagnostics/Woodworking/Sketch/Recent/Assembly)
  // are removed from the DOM (display:none) so their toggles are not queryable;
  // assert collapse only over the toggles that actually render.
  const sectionToggles = page.locator('.panel-section__toggle');
  await expect(sectionToggles).not.toHaveCount(0);
  for (const toggle of await sectionToggles.all()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }

  await page.getByTestId('left-sidebar-toggle').click();
  await page.getByTestId('right-sidebar-toggle').click();
  await expect(page.locator('#panel-left')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.locator('#panel-right')).toHaveAttribute('data-collapsed', 'true');

  await page.getByTestId('left-sidebar-toggle').click();
  await page.getByTestId('right-sidebar-toggle').click();
  await expandSection(page, 'Selection');
  await expect(
    page.getByTestId('panel-section-selection').getByRole('button', { name: 'Body', exact: true }),
  ).toBeVisible();
});

test('creates a box from the toolbar', async ({ page }) => {
  await command(page, 'addBox').click();

  await expect(feature(page, 'box')).toHaveCount(1);
  await expect(feature(page, 'box')).toContainText('Box 1');
  await expect(page.locator('#status-left')).toContainText('Added Box 1');
  await expect(command(page, 'undo')).toBeEnabled();
});

test('runs Quick Start actions without viewport controls capturing the click', async ({ page }) => {
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  const newBox = page.getByRole('button', { name: 'Board', exact: true });
  await expect(newBox).toBeVisible();
  await newBox.click();

  await expect(feature(page, 'box')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Start a design' })).toBeHidden();
  await expect(page.locator('#status-left')).toContainText('Added Box 1');

  // Quick Start initially selects the created feature. Clear it so this click
  // proves the rendered body can be resolved through the normal pointer route.
  await page.keyboard.press('Escape');
  await expect(page.locator('#status-center')).toHaveText('');
  await command(page, 'fitView').click();
  const bodyPoint = await findVisibleBodyPoint(page);
  await page.mouse.click(bodyPoint.x, bodyPoint.y);
  await expect(page.locator('#status-center')).toContainText('Box 1 | Body selected');
  await expect(page.getByTestId('selection-context').getByTestId('selection-name')).toHaveText('Box 1');
});

test('selects and manipulates a body directly with both sidebars collapsed', async ({ page }) => {
  await command(page, 'addBox').click();
  for (const side of ['left', 'right'] as const) {
    const panel = page.locator(`#panel-${side}`);
    if ((await panel.getAttribute('data-collapsed')) !== 'true') {
      await page.getByTestId(`${side}-sidebar-toggle`).click();
    }
    await expect(panel).toHaveAttribute('data-collapsed', 'true');
  }

  await page.keyboard.press('Escape');
  const selection = page.getByTestId('selection-context');
  await expect(selection).toBeVisible();
  await expect(selection.getByTestId('selection-mode-body')).toHaveAttribute('aria-pressed', 'true');
  await expect(selection.getByTestId('selection-hint')).toContainText('click a body');

  const bodyPoint = await findVisibleBodyPoint(page);
  const emptyPoint = await findEmptyViewportPoint(page);
  await page.mouse.move(bodyPoint.x, bodyPoint.y);
  await expect.poll(() => page.evaluate(() => {
    const object = Array.from((window as Window & { app?: {
      sceneObjects: Map<string, { userData: Record<string, unknown> }>;
    } }).app!.sceneObjects.values())[0];
    return object?.userData.interactionState ?? null;
  })).toBe('hovered');

  await page.mouse.click(bodyPoint.x, bodyPoint.y);
  await expect(selection.getByTestId('selection-kind')).toHaveText('Body');
  await expect(selection.getByTestId('selection-name')).toHaveText('Box 1');
  await expect(selection.getByTestId('selection-detail')).toContainText('Bounds X');
  for (const action of ['move', 'edit', 'copy', 'rotate']) {
    await expect(selection.getByTestId(`selection-action-${action}`)).toBeVisible();
  }
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await expect.poll(() => page.evaluate(() => {
    const object = Array.from((window as Window & { app?: {
      sceneObjects: Map<string, { userData: Record<string, unknown> }>;
    } }).app!.sceneObjects.values())[0];
    return object?.userData.interactionState ?? null;
  })).toBe('selected');

  await selection.getByTestId('selection-action-edit').click();
  await expect(page.locator('#panel-right')).toHaveAttribute('data-collapsed', 'false');
  const properties = page.getByTestId('panel-section-properties');
  await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  for (const label of ['Width (X)', 'Depth (Y)', 'Height (Z)', 'X', 'Y', 'Z']) {
    await expect(properties.getByLabel(label, { exact: true })).toBeVisible();
  }
  await properties.getByLabel('Width (X)', { exact: true }).fill('2 in');
  await properties.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(selection.getByTestId('selection-detail')).toContainText('World size 2 in');
  await expect(selection.getByTestId('selection-name')).toHaveText('Box 1');

  const baselineDocument = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot(),
  ));
  const beforeMove = await page.evaluate(() => (
    window as Window & { app?: { getInteractionDiagnostics(): Record<string, number | string> } }
  ).app!.getInteractionDiagnostics());
  await selection.getByTestId('selection-action-move').click();
  const task = page.getByTestId('context-task-panel');
  await expect(task.getByRole('heading', { name: 'Move Body', exact: true })).toBeVisible();
  await expect(task.getByLabel('X displacement', { exact: true })).toBeVisible();
  await expect(task.getByLabel('Y displacement', { exact: true })).toBeVisible();
  await expect(task.getByLabel('Z displacement', { exact: true })).toBeVisible();
  await task.getByLabel('X displacement', { exact: true }).fill('2 in');

  const afterPreview = await page.evaluate(() => (
    window as Window & { app?: { getInteractionDiagnostics(): Record<string, number | string> } }
  ).app!.getInteractionDiagnostics());
  expect(afterPreview.rebuilds).toBe(beforeMove.rebuilds);
  expect(afterPreview.remeshedBodies).toBe(beforeMove.remeshedBodies);

  await page.keyboard.press('Escape');
  const afterCancel = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot(),
  ));
  expect(afterCancel).toBe(baselineDocument);
  await expect(selection.getByTestId('selection-name')).toHaveText('Box 1');

  await selection.getByTestId('selection-action-move').click();
  await task.getByLabel('X displacement', { exact: true }).fill('2 in');
  await page.keyboard.press('Enter');
  await expect(feature(page, 'moveCopy')).toHaveCount(1);
  const committed = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      rebuiltBodies: Array<{ vertices: Map<string, { position: [number, number, number] }> }>;
      getInteractionDiagnostics(): Record<string, number | string>;
    } }).app!;
    const xs = [...app.rebuiltBodies[0]!.vertices.values()].map((vertex) => vertex.position[0]);
    return { minX: Math.min(...xs), diagnostics: app.getInteractionDiagnostics() };
  });
  expect(committed.minX).toBeCloseTo(2, 6);
  expect(Number(committed.diagnostics.rebuilds)).toBe(Number(beforeMove.rebuilds) + 1);
  await expect(selection.getByTestId('selection-kind')).toHaveText('Body');
});

test('face, edge, and vertex modes provide hover and persistent selection feedback', async ({ page }) => {
  await command(page, 'addBox').click();
  await command(page, 'fitView').click();
  const selection = page.getByTestId('selection-context');
  const emptyPoint = await findEmptyViewportPoint(page);

  await selection.getByTestId('selection-mode-face').click();
  const facePoint = await findVisibleFacePoint(page);
  await page.mouse.move(facePoint.x, facePoint.y);
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { app?: { viewport: { getScene(): { children: Array<{
      userData: Record<string, unknown>;
      children?: Array<{ userData: Record<string, unknown> }>;
    }> } } } }).app!.viewport.getScene().children.some((child) =>
      child.userData.faceOverlayRole === 'hover' &&
      child.children?.some((part) => part.userData.faceOverlayPart === 'fill')
    ) ?? false
  )).toBe(true);
  await page.mouse.click(facePoint.x, facePoint.y);
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { app?: { viewport: { getScene(): { children: Array<{ userData: Record<string, unknown> }> } } } })
      .app!.viewport.getScene().children.some((child) => child.userData.faceOverlayRole === 'selection')
  )).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    interface RenderChild {
      isMesh?: boolean;
      material?: { color?: { getHex(): number } };
    }
    const group = Array.from((window as Window & { app?: { sceneObjects: Map<string, { children: RenderChild[] }> } })
      .app!.sceneObjects.values())[0];
    return group?.children.find((child) => child.isMesh)?.material?.color?.getHex() ?? null;
  })).toBe(0x4a9eff);
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => {
    const children = (window as Window & { app?: { viewport: { getScene(): { children: Array<{ userData: Record<string, unknown> }> } } } })
      .app!.viewport.getScene().children;
    return {
      hover: children.some((child) => child.userData.faceOverlayRole === 'hover'),
      selected: children.some((child) => child.userData.faceOverlayRole === 'selection'),
    };
  })).toEqual({ hover: false, selected: true });

  await expect(selection.getByTestId('selection-kind')).toHaveText('Planar face');
  await expect(selection.getByTestId('selection-name')).toContainText('Box 1');
  await expect(selection.getByTestId('selection-action-push-pull')).toBeVisible();
  await expect(selection.getByTestId('selection-action-sketch')).toBeVisible();

  await selection.getByTestId('selection-mode-edge').click();
  const edgePoint = await findVisibleEdgePoint(page);
  // Manually dispatch pointermove event (page.mouse.move doesn't trigger pointer events)
  await page.evaluate((point) => {
    const event = new PointerEvent('pointermove', {
      clientX: point.x,
      clientY: point.y,
      buttons: 0,
      pointerId: 1,
      bubbles: true,
    });
    document.querySelector('#viewport canvas[data-engine]')?.dispatchEvent(event);
  }, edgePoint);
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { app?: { viewport: { getScene(): { children: Array<{ userData: Record<string, unknown> }> } } } })
      .app!.viewport.getScene().children.some((child) => child.userData.edgeOverlayRole === 'hover')
  )).toBe(true);
  // Manually dispatch pointerdown and pointerup for click
  await page.evaluate((point) => {
    const down = new PointerEvent('pointerdown', {
      clientX: point.x,
      clientY: point.y,
      buttons: 1,
      pointerId: 1,
      bubbles: true,
    });
    const up = new PointerEvent('pointerup', {
      clientX: point.x,
      clientY: point.y,
      buttons: 0,
      pointerId: 1,
      bubbles: true,
    });
    document.querySelector('#viewport canvas[data-engine]')?.dispatchEvent(down);
    document.querySelector('#viewport canvas[data-engine]')?.dispatchEvent(up);
  }, edgePoint);
  await page.waitForTimeout(100);
  await expect(page.locator('#status-left')).toContainText('edge selected');
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { app?: { viewport: { getScene(): { children: Array<{ userData: Record<string, unknown> }> } } } })
      .app!.viewport.getScene().children.some((child) => child.userData.edgeOverlayRole === 'selection')
  )).toBe(true);
  // Manually dispatch pointermove event to clear hover
  await page.evaluate((point) => {
    const event = new PointerEvent('pointermove', {
      clientX: point.x,
      clientY: point.y,
      buttons: 0,
      pointerId: 1,
      bubbles: true,
    });
    document.querySelector('#viewport canvas[data-engine]')?.dispatchEvent(event);
  }, emptyPoint);
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => {
    const children = (window as Window & { app?: { viewport: { getScene(): { children: Array<{ userData: Record<string, unknown> }> } } } })
      .app!.viewport.getScene().children;
    return {
      hover: children.some((child) => child.userData.edgeOverlayRole === 'hover'),
      selected: children.some((child) => child.userData.edgeOverlayRole === 'selection'),
    };
  })).toEqual({ hover: false, selected: true });

  await expect(selection.getByTestId('selection-kind')).toHaveText('Edge');
  await expect(selection.getByTestId('selection-detail')).toContainText('Length');
  await expect(selection.getByTestId('selection-action-rotate-edge')).toBeVisible();

  await selection.getByTestId('selection-mode-vertex').click();
  await expect.poll(() => page.evaluate(() => {
    const group = (window as Window & { app?: { viewport: { getScene(): { getObjectByName(name: string): { visible: boolean; children: unknown[] } | undefined } } } })
      .app!.viewport.getScene().getObjectByName('vertex-selection-overlay');
    return { visible: group?.visible ?? false, count: group?.children.length ?? 0 };
  })).toEqual({ visible: true, count: 8 });
  const vertexPoint = await findVertexMarkerPoint(page);
  // Manually dispatch pointermove event
  await page.evaluate((point) => {
    const event = new PointerEvent('pointermove', {
      clientX: point.x,
      clientY: point.y,
      buttons: 0,
      pointerId: 1,
      bubbles: true,
    });
    document.querySelector('#viewport canvas[data-engine]')?.dispatchEvent(event);
  }, vertexPoint);
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => {
    const group = (window as Window & { app?: { viewport: { getScene(): { getObjectByName(name: string): { children: Array<{ userData: Record<string, unknown> }> } | undefined } } } })
      .app!.viewport.getScene().getObjectByName('vertex-selection-overlay');
    return group?.children.some((child) => child.userData.selectionState === 'hovered') ?? false;
  })).toBe(true);
  // Manually dispatch pointerdown and pointerup for click
  await page.evaluate((point) => {
    const down = new PointerEvent('pointerdown', {
      clientX: point.x,
      clientY: point.y,
      buttons: 1,
      pointerId: 1,
      bubbles: true,
    });
    const up = new PointerEvent('pointerup', {
      clientX: point.x,
      clientY: point.y,
      buttons: 0,
      pointerId: 1,
      bubbles: true,
    });
    document.querySelector('#viewport canvas[data-engine]')?.dispatchEvent(down);
    document.querySelector('#viewport canvas[data-engine]')?.dispatchEvent(up);
  }, vertexPoint);
  await page.waitForTimeout(100);
  await expect(page.locator('#status-left')).toContainText('vertex selected');
  await expect(feature(page, 'moveVertex')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const group = (window as Window & { app?: { viewport: { getScene(): { getObjectByName(name: string): { children: Array<{ userData: Record<string, unknown> }> } | undefined } } } })
      .app!.viewport.getScene().getObjectByName('vertex-selection-overlay');
    return group?.children.some((child) => child.userData.selectionState === 'selected') ?? false;
  })).toBe(true);

  await expect(selection.getByTestId('selection-kind')).toHaveText('Vertex');
  await expect(selection.getByTestId('selection-detail')).toContainText('X');
  await expect(selection.getByTestId('selection-action-move-vertex')).toBeVisible();

  await selection.getByTestId('selection-mode-body').click();
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as Window & { app?: { viewport: { getScene(): {
      children: Array<{ userData: Record<string, unknown> }>;
      getObjectByName(name: string): { visible: boolean; children: unknown[] } | undefined;
    } } } }).app!.viewport.getScene();
    const vertices = scene.getObjectByName('vertex-selection-overlay');
    return {
      verticesVisible: vertices?.visible ?? false,
      vertexCount: vertices?.children.length ?? 0,
      faceOverlays: scene.children.filter((child) => child.userData.faceOverlayRole).length,
      edgeOverlays: scene.children.filter((child) => child.userData.edgeOverlayRole).length,
    };
  })).toEqual({ verticesVisible: false, vertexCount: 0, faceOverlays: 0, edgeOverlays: 0 });
});

test('starts Push/Pull from the selected face without asking for the face again', async ({ page }) => {
  await command(page, 'addBox').click();
  const selection = page.getByTestId('selection-context');
  await selection.getByTestId('selection-mode-face').click();
  const facePoint = await findVisibleFacePoint(page);
  await page.mouse.click(facePoint.x, facePoint.y);
  await expect(selection.getByTestId('selection-kind')).toHaveText('Planar face');

  const baselineDocument = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot(),
  ));
  await selection.getByTestId('selection-action-push-pull').click();
  const task = page.getByTestId('context-task-panel');
  await expect(task.getByRole('heading', { name: 'Push/Pull', exact: true })).toBeVisible();
  await expect(task.getByLabel('Distance', { exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { app?: { pushPullGizmo: { isActive(): boolean } | null } }
  ).app!.pushPullGizmo?.isActive() ?? false)).toBe(true);

  await page.keyboard.press('Escape');
  const restoredDocument = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot(),
  ));
  expect(restoredDocument).toBe(baselineDocument);
  await expect(selection.getByTestId('selection-kind')).toHaveText('Planar face');
  await expect(selection.getByTestId('selection-action-push-pull')).toBeVisible();
});

test('exposes labeled properties and live application status', async ({ page }) => {
  await command(page, 'addBox').click();
  const status = page.locator('#status-left');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('aria-atomic', 'true');

  await expandSection(page, 'Properties');
  const controls = page.getByTestId('panel-section-properties').locator('input, select');
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    const id = await control.getAttribute('id');
    expect(id).toBeTruthy();
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
  }

  await expandSection(page, 'Diagnostics');
  await expect(page.getByRole('region', { name: 'Model diagnostics' })).toBeVisible();
});

test('draws a rectangle sketch and extrudes it', async ({ page }) => {
  await command(page, 'addSketch').click();

  const canvas = page.getByTestId('sketch-canvas');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();

  if (!bounds) {
    throw new Error('Sketch canvas has no drawable bounds');
  }

  const start = {
    clientX: bounds.x + bounds.width / 2 - 80,
    clientY: bounds.y + bounds.height / 2 - 60,
  };
  const end = {
    clientX: bounds.x + bounds.width / 2 + 80,
    clientY: bounds.y + bounds.height / 2 + 60,
  };
  await page.mouse.move(start.clientX, start.clientY);
  await page.mouse.down();
  await page.mouse.move(end.clientX, end.clientY, { steps: 5 });
  await page.mouse.up();

  await expandSection(page, 'Properties');
  await expectLatestSketchSegmentCount(page, 4);
  await page.getByRole('button', { name: 'Exit sketch', exact: true }).click();
  await expect(canvas).toBeHidden();
  await expect(command(page, 'addExtrude')).toBeEnabled();
  await command(page, 'addExtrude').click();
  await expect(page.locator('#status-left')).toContainText('Previewing Extrude 2');
  const activeTool = page.getByTestId('panel-section-active-tool');
  await expect(
    activeTool.getByRole('button', { name: 'Active tool', exact: true })
  ).toHaveAttribute('aria-expanded', 'true');
  const extentLimit = activeTool.locator('select:has(option[value="UpToFace"])');
  await extentLimit.selectOption('UpToFace');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status-left')).toContainText('Up To Face requires');
  await expect(command(page, 'addExtrude')).toHaveAttribute('aria-pressed', 'true');
  await extentLimit.selectOption('Distance');
  await page.keyboard.press('Enter');

  await expect(feature(page, 'sketch')).toHaveCount(1);
  await expect(feature(page, 'extrude')).toHaveCount(1);
  await expect(feature(page, 'extrude')).toContainText('Extrude 2');
  await expect(page.locator('#status-left')).toContainText('Added Extrude 2');
});

test('starts an empty face sketch and uses it for an explicitly targeted cut', async ({ page }) => {
  await command(page, 'addBox').click();
  await expandSection(page, 'Properties');
  const properties = page.getByTestId('panel-section-properties');
  await properties.getByLabel('Width (X)').fill('20');
  await properties.getByLabel('Depth (Y)').fill('20');
  await properties.getByRole('button', { name: 'Apply', exact: true }).click();
  await command(page, 'fitView').click();

  await command(page, 'addFaceSketch').click();
  const facePoint = await findVisibleFacePoint(page);
  await page.mouse.click(facePoint.x, facePoint.y);
  // Keep this state assertion close to the gesture so failures distinguish
  // picking from sketch-editor activation.
  const facePickState = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      faceSelectionMode: boolean;
      selectionMode: string;
      selectedFace: unknown;
      features: Array<{ type: string }>;
    } }).app!;
    return {
      faceSelectionMode: app.faceSelectionMode,
      selectionMode: app.selectionMode,
      selectedFace: app.selectedFace,
      sketchCount: app.features.filter((item) => item.type === 'sketch').length,
    };
  });
  expect(facePickState).toEqual({
    faceSelectionMode: false,
    selectionMode: 'body',
    selectedFace: null,
    sketchCount: 1,
  });

  const sketchCanvas = page.getByTestId('sketch-canvas');
  await expect(sketchCanvas).toBeVisible();
  await expect(feature(page, 'sketch')).toHaveCount(1);
  await expandSection(page, 'Sketch');
  await expectLatestSketchSegmentCount(page, 0);

  const sketchBounds = await sketchCanvas.boundingBox();
  if (!sketchBounds) throw new Error('Face sketch canvas has no drawable bounds');
  await page.mouse.move(sketchBounds.x + sketchBounds.width / 2 - 45, sketchBounds.y + sketchBounds.height / 2 - 35);
  await page.mouse.down();
  await page.mouse.move(sketchBounds.x + sketchBounds.width / 2 + 45, sketchBounds.y + sketchBounds.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await expectLatestSketchSegmentCount(page, 4);

  await page.getByRole('button', { name: 'Exit sketch', exact: true }).click();
  await expect(command(page, 'addExtrudeCut')).toBeEnabled();
  await command(page, 'addExtrudeCut').click();
  await expect(feature(page, 'extrudeCut')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#status-left')).toContainText('Added Cut');
});

test('requires an explicit face and previews Miter Cut split or trim results', async ({ page }) => {
  await command(page, 'addBox').click();
  await expect(feature(page, 'box')).toHaveCount(1);

  // A selected/latest body is intentionally insufficient: this workflow owns
  // an exact face reference and must never guess a body from rebuild order.
  await expectCommandAvailability(page, 'addMiterCut', false);
  expect(await page.evaluate(() => {
    const app = (window as Window & {
      app?: { rebuiltBodies: unknown[]; selectedFace: unknown };
    }).app!;
    return { bodyCount: app.rebuiltBodies.length, selectedFace: app.selectedFace };
  })).toEqual({ bodyCount: 1, selectedFace: null });

  const selectVisibleFace = async (): Promise<{ bodyId: string; faceId: string }> => {
    await expandSection(page, 'Selection');
    const selectionPanel = page.getByTestId('panel-section-selection');
    const faceMode = selectionPanel.getByRole('button', { name: 'Face', exact: true });
    if ((await faceMode.getAttribute('aria-pressed')) !== 'true') await faceMode.click();
    const point = await findVisibleFacePoint(page);
    await page.mouse.click(point.x, point.y);
    await expectCommandAvailability(page, 'addMiterCut', true);
    return page.evaluate(() => {
      const selectedFace = (window as Window & {
        app?: { selectedFace: { bodyId: string; faceId: string } | null };
      }).app!.selectedFace;
      if (!selectedFace) throw new Error('Expected a selected planar face');
      return { ...selectedFace };
    });
  };

  const selectedFace = await selectVisibleFace();
  const baseline = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  await command(page, 'addMiterCut').click();

  const task = page.getByTestId('context-task-panel');
  await expect(task.getByRole('heading', { name: 'Miter Cut', exact: true })).toBeVisible();
  await expect(task.locator('[data-field-id]')).toHaveCount(5);
  await expect(task.getByLabel('Cut type')).toHaveValue('single');
  await expect(task.getByLabel('Result')).toHaveValue('split');
  await expect(task.getByLabel('Angle', { exact: true })).toHaveValue('45');
  await expect(task.getByLabel('Inset')).toHaveValue('0');
  await expect(task.getByLabel('Angle across')).toHaveValue('u');
  await expect(page.getByRole('button', { name: 'Properties', exact: true }))
    .toHaveAttribute('aria-expanded', 'false');

  const splitPreview = await page.evaluate(() => {
    const app = (window as Window & {
      app?: {
        rebuiltBodies: Array<{ id: string }>;
        features: Array<{
          type: string;
          parameters: {
            sourceBodyRef?: { bodyId: string; featureId: string };
            faceRef?: { bodyId: string; faceId: string; featureId: string };
            resultMode?: string;
          };
        }>;
      };
    }).app!;
    const miter = app.features.find((item) => item.type === 'miterCut');
    return {
      bodyCount: app.rebuiltBodies.length,
      bodyIds: app.rebuiltBodies.map((body) => body.id),
      sourceBodyRef: miter?.parameters.sourceBodyRef,
      faceRef: miter?.parameters.faceRef,
      resultMode: miter?.parameters.resultMode,
    };
  });
  expect(splitPreview).toMatchObject({
    bodyCount: 2,
    sourceBodyRef: { bodyId: selectedFace.bodyId },
    faceRef: selectedFace,
    resultMode: 'split',
  });
  expect(splitPreview.bodyIds).toContain(selectedFace.bodyId);
  await task.getByLabel('Angle', { exact: true }).press('Escape');
  await expect(feature(page, 'miterCut')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { app?: { rebuiltBodies: unknown[] } }
  ).app!.rebuiltBodies.length)).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ))).toBe(baseline);

  await selectVisibleFace();
  await command(page, 'addMiterCut').click();
  await page.getByTestId('context-task-panel').getByLabel('Angle', { exact: true }).press('Enter');
  await expect(feature(page, 'miterCut')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { app?: { rebuiltBodies: unknown[] } }
  ).app!.rebuiltBodies.length)).toBe(2);

  await command(page, 'undo').click();
  await expect(feature(page, 'miterCut')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { app?: { rebuiltBodies: unknown[] } }
  ).app!.rebuiltBodies.length)).toBe(1);

  await selectVisibleFace();
  await command(page, 'addMiterCut').click();
  const trimTask = page.getByTestId('context-task-panel');
  await trimTask.getByLabel('Angle', { exact: true }).fill('0');
  await expect(trimTask.getByTestId('context-task-commit')).toBeDisabled();
  await trimTask.getByLabel('Result').selectOption('trim');
  await expect(trimTask.getByTestId('context-task-commit')).toBeDisabled();
  await trimTask.getByLabel('Angle', { exact: true }).press('Enter');
  await trimTask.getByLabel('Angle', { exact: true }).fill('45');
  await expect(trimTask.getByTestId('context-task-commit')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => {
    const app = (window as Window & {
      app?: { rebuiltBodies: unknown[]; features: Array<{ type: string; parameters: { resultMode?: string } }> };
    }).app!;
    return {
      bodyCount: app.rebuiltBodies.length,
      resultMode: app.features.find((item) => item.type === 'miterCut')?.parameters.resultMode,
    };
  })).toEqual({ bodyCount: 1, resultMode: 'trim' });
  await trimTask.getByLabel('Inset').fill('1/8');
  await trimTask.getByLabel('Inset').press('Enter');

  await expect(feature(page, 'miterCut')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const app = (window as Window & {
      app?: { rebuiltBodies: unknown[]; features: Array<{ type: string; parameters: { inset?: number; resultMode?: string } }> };
    }).app!;
    const miter = app.features.find((item) => item.type === 'miterCut');
    return {
      bodyCount: app.rebuiltBodies.length,
      inset: miter?.parameters.inset,
      resultMode: miter?.parameters.resultMode,
    };
  })).toEqual({ bodyCount: 1, inset: 0.125, resultMode: 'trim' });
});

test('previews and commits an exact two-plane three-way miter end', async ({ page }) => {
  await command(page, 'addBox').click();
  await expect(feature(page, 'box')).toHaveCount(1);
  await expandSection(page, 'Properties');
  const boxProperties = page.getByTestId('panel-section-properties');
  await boxProperties.getByLabel('Width (X)').fill('4');
  await boxProperties.getByRole('button', { name: 'Apply', exact: true }).click();
  await command(page, 'fitView').click();
  await page.getByRole('button', { name: 'Right view' }).click();

  const selectVisibleFace = async (): Promise<void> => {
    await expandSection(page, 'Selection');
    const selectionPanel = page.getByTestId('panel-section-selection');
    const faceMode = selectionPanel.getByRole('button', { name: 'Face', exact: true });
    if ((await faceMode.getAttribute('aria-pressed')) !== 'true') await faceMode.click();
    const point = await findVisibleFacePoint(page);
    await page.mouse.click(point.x, point.y);
    await expectCommandAvailability(page, 'addMiterCut', true);
    expect(await page.evaluate(() => (
      window as Window & { app?: { selectedFace: { faceId: string } | null } }
    ).app!.selectedFace?.faceId)).toMatch(/^[+-]X$/);
  };
  const documentSnapshot = () => page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  const geometrySignature = () => page.evaluate(() => {
    const bodies = (window as Window & {
      app?: { rebuiltBodies: Array<{ id: string; vertices: Map<string, { position: number[] }> }> };
    }).app!.rebuiltBodies;
    return bodies.map((body) => ({
      id: body.id,
      vertices: Array.from(body.vertices.values())
        .map((vertex) => vertex.position.map((value) => Number(value.toFixed(8))))
        .sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second))),
    }));
  });

  await selectVisibleFace();
  const baseline = await documentSnapshot();
  await command(page, 'addMiterCut').click();
  let task = page.getByTestId('context-task-panel');
  await task.getByLabel('Angle', { exact: true }).fill('0');
  await expect(task.getByTestId('context-task-commit')).toBeDisabled();
  await task.getByLabel('Cut type').selectOption('threeWay');

  await expect(task.locator('[data-field-id]')).toHaveCount(5);
  await expect(task.getByTestId('context-task-commit')).toBeEnabled();
  await expect(task.getByLabel('Result')).toHaveValue('split');
  await expect(task.getByLabel('Joint corner')).toHaveValue('corner0');
  await expect(task.getByText('45\u00b0 + 45\u00b0', { exact: true })).toBeVisible();
  await expect(task.getByLabel('Angle', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window as Window & { app?: { rebuiltBodies: unknown[] } }
  ).app!.rebuiltBodies.length)).toBe(3);

  const firstCorner = await geometrySignature();
  await task.getByLabel('Joint corner').selectOption('corner2');
  await expect.poll(async () => JSON.stringify(await geometrySignature()))
    .not.toBe(JSON.stringify(firstCorner));
  await task.getByLabel('Result').selectOption('trim');
  await expect.poll(() => page.evaluate(() => (
    window as Window & { app?: { rebuiltBodies: unknown[] } }
  ).app!.rebuiltBodies.length)).toBe(1);
  await task.getByLabel('Joint corner').press('Escape');

  await expect(feature(page, 'miterCut')).toHaveCount(0);
  expect(await documentSnapshot()).toBe(baseline);

  await selectVisibleFace();
  await command(page, 'addMiterCut').click();
  task = page.getByTestId('context-task-panel');
  await task.getByLabel('Cut type').selectOption('threeWay');
  await task.getByLabel('Joint corner').selectOption('corner2');
  await task.getByLabel('Result').selectOption('trim');
  await task.getByLabel('Joint corner').press('Enter');

  await expect(feature(page, 'miterCut')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const app = (window as Window & {
      app?: {
        rebuiltBodies: unknown[];
        features: Array<{ type: string; parameters: Record<string, unknown> }>;
      };
    }).app!;
    const miter = app.features.find((item) => item.type === 'miterCut');
    return {
      bodyCount: app.rebuiltBodies.length,
      cutStyle: miter?.parameters.cutStyle,
      threeWayCorner: miter?.parameters.threeWayCorner,
      threeWayVertexId: miter?.parameters.threeWayVertexId,
      resultMode: miter?.parameters.resultMode,
    };
  })).toEqual({
    bodyCount: 1,
    cutStyle: 'threeWay',
    threeWayCorner: 'corner2',
    threeWayVertexId: expect.any(String),
    resultMode: 'trim',
  });

  await command(page, 'undo').click();
  await expect(feature(page, 'miterCut')).toHaveCount(0);
  expect(await documentSnapshot()).toBe(baseline);
});

test('commits and cancels rectangle previews without leaking document edits', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  const drawRectangle = async (offset: number) => {
    await page.mouse.move(bounds.x + bounds.width / 2 - 70 + offset, bounds.y + bounds.height / 2 - 50);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 70 + offset, bounds.y + bounds.height / 2 + 50, { steps: 4 });
    await page.mouse.up();
  };

  await drawRectangle(0);
  await expect(page.locator('#status-left')).toContainText('Rectangle preview');
  await page.keyboard.press('Escape');
  await expectLatestSketchSegmentCount(page, 0);

  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drawRectangle(10);
  await page.keyboard.press('Enter');
  await expectLatestSketchSegmentCount(page, 4);
  await expect(page.locator('#status-left')).toContainText('Draw Rectangle committed');
});

test('switching sketch tools cannot resurrect the superseded preview', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  await page.mouse.move(bounds.x + bounds.width / 2 - 60, bounds.y + bounds.height / 2 - 45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 45, { steps: 4 });
  await page.mouse.up();
  await expectLatestSketchSegmentCount(page, 4);

  await page.getByRole('button', { name: 'Polygon', exact: true }).click();
  await page.keyboard.press('Escape');
  await expectLatestSketchSegmentCount(page, 0);
});

test('reload preserves sketch IDs and allocates the next collision-free edit namespace', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  await page.mouse.move(bounds.x + bounds.width / 2 - 50, bounds.y + bounds.height / 2 - 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Exit sketch', exact: true }).click();

  const before = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      features: Array<{ id: string; type: string; parameters: { geometry?: { points: Array<{ id: string }>; segments: Array<{ id: string }> } } }>;
      buildDocumentSnapshot(): unknown;
      loadDocument(document: unknown, options: Record<string, unknown>): void;
    } }).app!;
    const sketch = app.features.find((feature) => feature.type === 'sketch')!;
    const ids = [
      ...(sketch.parameters.geometry?.points.map((point) => point.id) ?? []),
      ...(sketch.parameters.geometry?.segments.map((segment) => segment.id) ?? []),
    ];
    const persisted = JSON.parse(JSON.stringify(app.buildDocumentSnapshot())) as unknown;
    app.loadDocument(persisted, { seedHistory: true, recordRecent: false });
    return { sketchId: sketch.id, ids };
  });

  const dismissQuickStart = page.getByRole('button', { name: 'Dismiss quick start' });
  if (await dismissQuickStart.isVisible()) await dismissQuickStart.click();
  await feature(page, 'sketch').locator('[data-role="name"]').click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const reloadedBounds = await canvas.boundingBox();
  if (!reloadedBounds) throw new Error('Reloaded sketch canvas has no drawable bounds');
  await page.mouse.click(
    reloadedBounds.x + reloadedBounds.width / 2 - 80,
    reloadedBounds.y + reloadedBounds.height / 2 + 80
  );
  await page.mouse.click(
    reloadedBounds.x + reloadedBounds.width / 2 + 80,
    reloadedBounds.y + reloadedBounds.height / 2 + 80
  );
  await page.keyboard.press('Enter');

  const afterIds = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      features: Array<{ type: string; parameters: { geometry?: { points: Array<{ id: string }>; segments: Array<{ id: string }> } } }>;
    } }).app!;
    const sketch = app.features.find((candidate) => candidate.type === 'sketch')!;
    return [
      ...(sketch.parameters.geometry?.points.map((point) => point.id) ?? []),
      ...(sketch.parameters.geometry?.segments.map((segment) => segment.id) ?? []),
    ];
  });
  expect(afterIds).toEqual(expect.arrayContaining(before.ids));
  expect(new Set(afterIds).size).toBe(afterIds.length);
  expect(afterIds.some((id) => id.startsWith(`${before.sketchId}:edit:2:`))).toBe(true);
});

test('undo cancels an active sketch preview before navigating history', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  const draw = async (offset: number) => {
    await page.mouse.move(bounds.x + bounds.width / 2 - 55 + offset, bounds.y + bounds.height / 2 - 40);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 55 + offset, bounds.y + bounds.height / 2 + 40, { steps: 4 });
    await page.mouse.up();
  };
  await draw(-25);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await draw(45);

  await command(page, 'undo').click();
  await feature(page, 'sketch').locator('[data-role="name"]').click();
  await expectLatestSketchSegmentCount(page, 0);
  await page.getByRole('button', { name: 'Exit sketch', exact: true }).click();
  await command(page, 'redo').click();
  await feature(page, 'sketch').locator('[data-role="name"]').click();
  await expectLatestSketchSegmentCount(page, 4);
});

test('creates a regular polygon with the configured side count', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  await page.getByRole('button', { name: 'Polygon', exact: true }).click();
  const sides = page.getByTestId('polygon-sides');
  await sides.fill('5');
  await sides.press('Tab');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.click(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2);
  await expect(page.locator('#status-left')).toContainText('regular polygon preview');
  await page.keyboard.press('Enter');

  await expectLatestSketchSegmentCount(page, 5);
});

test('creates a center rectangle as one closed editable profile', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  await page.getByRole('button', { name: 'Center rectangle', exact: true }).click();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.click(bounds.x + bounds.width / 2 + 75, bounds.y + bounds.height / 2 + 45);
  await expect(page.locator('#status-left')).toContainText(/center rectangle preview/i);
  await page.keyboard.press('Enter');

  await expectLatestSketchSegmentCount(page, 4);
});

test('explains an open sketch profile inline', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.mouse.click(bounds.x + bounds.width / 2 - 60, bounds.y + bounds.height / 2);
  await page.mouse.click(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2);

  await expect(page.locator('[data-diagnostic-code="OPEN_ENDPOINT"]').first()).toBeVisible();
  await expect(page.getByText(/endpoint is open/i).first()).toBeVisible();
});

test('submits a fractional metric driving dimension', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');
  const left = bounds.x + bounds.width / 2 - 80;
  const right = bounds.x + bounds.width / 2 + 80;
  const top = bounds.y + bounds.height / 2 - 60;
  const bottom = bounds.y + bounds.height / 2 + 60;

  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Enter');

  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  // Dimension is reference-driven. Project the authoritative segment midpoint
  // back through the live sketch camera so the gesture remains exact at every
  // viewport size and projection.
  const segmentPoints = await page.evaluate(() => {
    interface PointRecord {
      id: string;
      position: [number, number];
    }
    interface SegmentRecord {
      startPointId: string;
      endPointId: string;
    }
    interface SketchOverlayAccess {
      canvas: HTMLCanvasElement;
      normalizedContext: {
        geometry: {
          points: PointRecord[];
          segments: SegmentRecord[];
        };
      };
      projectPoint(point: [number, number]): { x: number; y: number } | null;
    }
    const overlay = (window as Window & {
      app?: { sketchOverlay: SketchOverlayAccess };
    }).app!.sketchOverlay;
    const points = new Map(overlay.normalizedContext.geometry.points.map((point) => [
      point.id,
      point.position,
    ]));
    const rect = overlay.canvas.getBoundingClientRect();
    return overlay.normalizedContext.geometry.segments.flatMap((segment) => {
      const start = points.get(segment.startPointId);
      const end = points.get(segment.endPointId);
      if (!start || !end) return [];
      return [0.25, 0.4, 0.6, 0.75].flatMap((parameter) => {
        const projected = overlay.projectPoint([
          start[0] + (end[0] - start[0]) * parameter,
          start[1] + (end[1] - start[1]) * parameter,
        ]);
        if (!projected) return [];
        return [{ x: rect.left + projected.x, y: rect.top + projected.y }];
      });
    });
  });
  const form = page.getByTestId('sketch-numeric-form');
  const numericInput = form.getByTestId('sketch-numeric-input');
  for (const point of segmentPoints) {
    await page.mouse.click(point.x, point.y);
    if (await numericInput.isEnabled()) break;
  }
  const dimensionSelection = await page.evaluate(() => {
    const draft = (window as Window & {
      app?: {
        sketchToolDraft: {
          selectedPointIds: string[];
          selectedSegmentIds: string[];
        } | null;
      };
    }).app!.sketchToolDraft;
    return {
      pointIds: draft?.selectedPointIds ?? [],
      segmentIds: draft?.selectedSegmentIds ?? [],
    };
  });
  expect(
    dimensionSelection.segmentIds.length === 1 && dimensionSelection.pointIds.length === 0,
    `Expected one exact segment selection, received ${JSON.stringify(dimensionSelection)}`
  ).toBe(true);
  await expect(numericInput).toBeEnabled();
  await numericInput.fill('25.4/2 mm');
  await form.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#status-left')).toContainText('Driving distance');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status-left')).toContainText('Add Driving Dimension committed');
});

test('previews and commits an exact body copy', async ({ page }) => {
  await command(page, 'addBox').click();
  await expectCommandAvailability(page, 'addDuplicate', true);
  await command(page, 'addDuplicate').click();
  await expect(page.locator('#status-left')).toContainText('Previewing Copy 2');
  await page.keyboard.press('Enter');

  await expect(feature(page, 'box')).toHaveCount(1);
  await expect(feature(page, 'moveCopy')).toHaveCount(1);
  await expect(feature(page, 'moveCopy')).toContainText('Copy 2');
  await expect(page.locator('#status-left')).toContainText('Added Copy 2');
});

test('Escape cancels a copy preview without creating a feature', async ({ page }) => {
  await command(page, 'addBox').click();
  const before = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  await command(page, 'addDuplicate').click();
  await expect(feature(page, 'moveCopy')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(feature(page, 'moveCopy')).toHaveCount(0);
  await expect(page.locator('#status-left')).toContainText('document unchanged');
  const after = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  expect(after).toBe(before);
});

test('transform previews avoid rebuilds and follow projection camera switches', async ({ page }) => {
  await command(page, 'addBox').click();
  const baselineDocument = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  const before = await page.evaluate(() => (
    window as Window & { app?: { getInteractionDiagnostics(): Record<string, number | string> } }
  ).app!.getInteractionDiagnostics());

  await command(page, 'addDuplicate').click();
  await dragTranslationTriad(page);
  const afterPreviews = await page.evaluate(() => (
    window as Window & { app?: { getInteractionDiagnostics(): Record<string, number | string> } }
  ).app!.getInteractionDiagnostics());
  expect(afterPreviews.rebuilds).toBe(before.rebuilds);
  expect(afterPreviews.remeshedBodies).toBe(before.remeshedBodies);
  expect(Number(afterPreviews.transformPreviewUpdates)).toBeGreaterThan(
    Number(before.transformPreviewUpdates) + 10
  );

  await command(page, 'toggleProjection').click();
  const afterProjection = await page.evaluate(() => (
    window as Window & { app?: { getInteractionDiagnostics(): Record<string, number | string> } }
  ).app!.getInteractionDiagnostics());
  expect(afterProjection.projection).not.toBe(before.projection);
  expect(afterProjection.activeCameraUuid).not.toBe(before.activeCameraUuid);
  await dragTranslationTriad(page, 60);
  const afterSecondDrag = await page.evaluate(() => (
    window as Window & { app?: { getInteractionDiagnostics(): Record<string, number | string> } }
  ).app!.getInteractionDiagnostics());
  expect(afterSecondDrag.rebuilds).toBe(before.rebuilds);
  expect(afterSecondDrag.remeshedBodies).toBe(before.remeshedBodies);
  expect(Number(afterSecondDrag.transformPreviewUpdates)).toBeGreaterThan(
    Number(afterPreviews.transformPreviewUpdates)
  );

  await page.keyboard.press('Escape');
  const restoredDocument = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  expect(restoredDocument).toBe(baselineDocument);
});

test('Enter commits the exact displacement from the Duplicate Body task', async ({ page }) => {
  await command(page, 'addBox').click();
  await command(page, 'addDuplicate').click();
  await page.locator('#context-task-field-move-copy-x').fill('2 in');
  await page.keyboard.press('Enter');

  const placement = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      features: Array<{
        type: string;
        parameters: { mode?: string; translation?: [number, number, number] };
      }>;
    } }).app!;
    const params = app.features.find((candidate) => candidate.type === 'moveCopy')?.parameters;
    return params ? { mode: params.mode, translation: params.translation } : null;
  });
  expect(placement).toEqual({ mode: 'copy', translation: [2, 0, 0] });
  await expect(page.locator('#status-left')).toContainText('Added Copy 2');
});

test('orbit dragging changes only the camera and never selects or edits', async ({ page }) => {
  await command(page, 'addBox').click();
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      buildDocumentSnapshot(): unknown;
      selection: { selectedIds: Set<string> };
      viewport: { getCameraControls(): { camera: { position: { toArray(): number[] } } } };
    } }).app!;
    return {
      document: JSON.stringify(app.buildDocumentSnapshot()),
      selectionCount: app.selection.selectedIds.size,
      camera: app.viewport.getCameraControls().camera.position.toArray(),
    };
  });
  expect(before.selectionCount).toBe(0);

  const viewport = page.locator('#viewport canvas[data-engine]');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('Viewport canvas has no interactive bounds');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 55, { steps: 8 });
  await page.mouse.up({ button: 'left' });

  const after = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      buildDocumentSnapshot(): unknown;
      selection: { selectedIds: Set<string> };
      viewport: { getCameraControls(): { camera: { position: { toArray(): number[] } } } };
    } }).app!;
    return {
      document: JSON.stringify(app.buildDocumentSnapshot()),
      selectionCount: app.selection.selectedIds.size,
      camera: app.viewport.getCameraControls().camera.position.toArray(),
    };
  });
  expect(after.document).toBe(before.document);
  expect(after.selectionCount).toBe(0);
  expect(after.camera).not.toEqual(before.camera);
});

test('transform commands require an explicit body and honor preview cancel or commit', async ({ page }) => {
  await command(page, 'addBox').click();
  await page.keyboard.press('Escape');
  for (const commandId of ['addLinearPattern', 'addMirror', 'addDuplicate', 'addRotate', 'createComponent']) {
    await expectCommandAvailability(page, commandId, false);
  }

  const selectBox = async () => {
    await feature(page, 'box').locator('[data-role="name"]').click();
  };

  await selectBox();
  await command(page, 'addLinearPattern').click();
  await expect(feature(page, 'linearPattern')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(feature(page, 'linearPattern')).toHaveCount(0);

  await selectBox();
  await command(page, 'addLinearPattern').click();
  await expandSection(page, 'Properties');
  const patternProperties = page.getByTestId('panel-section-properties');
  await patternProperties.getByLabel('Count').fill('4');
  await patternProperties.getByLabel('Spacing').fill('2');
  await patternProperties.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.keyboard.press('Enter');
  await expect(feature(page, 'linearPattern')).toHaveCount(1);
  const patternResult = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      buildDocumentSnapshot(): {
        features: Array<{ type: string; parameters: { count?: number; spacing?: number } }>;
        bodies: unknown[];
      };
    } }).app!;
    const snapshot = app.buildDocumentSnapshot();
    const pattern = snapshot.features.find((item) => item.type === 'linearPattern');
    return { count: pattern?.parameters.count, spacing: pattern?.parameters.spacing, bodies: snapshot.bodies.length };
  });
  expect(patternResult).toEqual({ count: 4, spacing: 2, bodies: 4 });

  await selectBox();
  await command(page, 'addMirror').click();
  await expect(feature(page, 'mirror')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(feature(page, 'mirror')).toHaveCount(0);

  await selectBox();
  await command(page, 'addMirror').click();
  await page.keyboard.press('Enter');
  await expect(feature(page, 'mirror')).toHaveCount(1);

  await selectBox();
  const beforeRotate = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  await command(page, 'addRotate').click();
  await expect(page.locator('#status-left')).toContainText('Previewing Rotate');
  await expect(feature(page, 'rotateBody')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(feature(page, 'rotateBody')).toHaveCount(0);
  const afterRotateCancel = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  expect(afterRotateCancel).toBe(beforeRotate);

  await selectBox();
  await command(page, 'addRotate').click();
  await page.keyboard.press('Enter');
  await expect(feature(page, 'rotateBody')).toHaveCount(1);
});

test('undoes and redoes a feature creation', async ({ page }) => {
  await command(page, 'addBox').click();
  await expect(feature(page, 'box')).toHaveCount(1);

  await command(page, 'undo').click();
  await expect(feature(page, 'box')).toHaveCount(0);
  await expect(page.locator('#status-left')).toContainText('Undo:');
  await expect(command(page, 'redo')).toBeEnabled();

  await command(page, 'redo').click();
  await expect(feature(page, 'box')).toHaveCount(1);
  await expect(page.locator('#status-left')).toContainText('Redo: Add Box');
});

test('undo and redo round-trip selection mode with the document', async ({ page }) => {
  await command(page, 'addBox').click();
  const selection = page.getByTestId('selection-context');
  await selection.getByTestId('selection-mode-vertex').click();
  await command(page, 'addDuplicate').click();
  await page.keyboard.press('Enter');
  await expect(selection.getByTestId('selection-mode-vertex')).toHaveAttribute('aria-pressed', 'true');

  await command(page, 'undo').click();
  await expect(selection.getByTestId('selection-mode-body')).toHaveAttribute('aria-pressed', 'true');
  await command(page, 'redo').click();
  await expect(selection.getByTestId('selection-mode-vertex')).toHaveAttribute('aria-pressed', 'true');
});

test('legacy body-only deletion creates a dirty undoable history entry', async ({ page }) => {
  await command(page, 'addBox').click();
  const result = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      buildDocumentSnapshot(): { bodies: Array<{ id: string }>; features: unknown[] };
      loadDocument(document: unknown, options: Record<string, unknown>): void;
      deleteSelected(): void;
      selection: { selectedIds: Set<string>; activeId: string | null };
      undoRedo: { canUndo(): boolean; isDirty(): boolean };
      documentManager: { getDocument(): { bodies: unknown[] } };
    } }).app!;
    const legacy = JSON.parse(JSON.stringify(app.buildDocumentSnapshot())) as {
      bodies: Array<{ id: string }>;
      features: unknown[];
    };
    legacy.features = [];
    app.loadDocument(legacy, { seedHistory: true, recordRecent: false });
    const bodyId = legacy.bodies[0]!.id;
    app.selection = { selectedIds: new Set([bodyId]), activeId: bodyId };
    app.deleteSelected();
    return {
      bodyCount: app.documentManager.getDocument().bodies.length,
      canUndo: app.undoRedo.canUndo(),
      isDirty: app.undoRedo.isDirty(),
    };
  });

  expect(result).toEqual({ bodyCount: 0, canUndo: true, isDirty: true });
  await command(page, 'undo').click();
  const restoredBodies = await page.evaluate(() => {
    const app = (window as Window & { app?: { documentManager: { getDocument(): { bodies: unknown[] } } } }).app!;
    return app.documentManager.getDocument().bodies.length;
  });
  expect(restoredBodies).toBe(1);
});

test('autosave recovery remains dirty until explicitly saved', async ({ page }) => {
  await command(page, 'addBox').click();
  const dirty = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      buildDocumentSnapshot(): unknown;
      newDocument(): void;
      openRecentFile(entry: { path: string; name: string; lastOpened: string }): void;
      autosaveManager: { saveNow(document: unknown, context: { filePath: string; reason: string }): unknown };
      undoRedo: { isDirty(): boolean };
    } }).app!;
    const path = 'C:\\Models\\Recovered.json';
    const snapshot = app.buildDocumentSnapshot();
    app.autosaveManager.saveNow(snapshot, { filePath: path, reason: 'test-recovery' });
    app.newDocument();
    app.openRecentFile({ path, name: 'Recovered', lastOpened: new Date(0).toISOString() });
    return app.undoRedo.isDirty();
  });

  expect(dirty).toBe(true);
});

test('instance transform is an exclusive Escape-cancelable session', async ({ page }) => {
  await command(page, 'addBox').click();
  await command(page, 'createComponent').click();
  await command(page, 'addInstance').click();
  await expandSection(page, 'Assembly');

  const instance = page.locator('[data-instance-id]').first();
  await expect(instance).toBeVisible();
  await instance.click();
  await expect(page.locator('#status-left')).toContainText('drag to preview');
  await page.keyboard.press('Escape');
  await expect(page.locator('#status-left')).toContainText('document unchanged');
  await expect(page.locator('[data-instance-id]')).toHaveCount(1);
});

test('opens and dismisses the command help', async ({ page }) => {
  await command(page, 'toggleHelp').click();

  const help = page.locator('#keyboard-shortcuts-overlay');
  await expect(help).toBeVisible();
  await expect(help.getByRole('heading', { name: 'Commands and shortcuts' })).toBeVisible();
  await expect(help).toContainText('Sketch workflow');

  await help.click({ position: { x: 5, y: 5 } });
  await expect(help).toBeHidden();
});

test('routes Push/Pull through the universal Enter and Escape contract', async ({ page }) => {
  await command(page, 'addBox').click();
  await expect(feature(page, 'box')).toHaveCount(1);
  const baseline = await page.evaluate(() => {
    const app = (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!;
    return JSON.stringify(app.buildDocumentSnapshot());
  });

  await page.keyboard.press('p');
  await expect(page.locator('#status-left')).toContainText('Push/Pull mode');

  await page.keyboard.press('Enter');
  await expect(page.locator('#status-left')).toContainText('Select a face and enter or drag');
  await expect(feature(page, 'offsetFace')).toHaveCount(0);

  const facePoint = await findVisibleFacePoint(page);
  await page.mouse.click(facePoint.x, facePoint.y);
  const commit = page.getByTestId('context-task-commit');
  await expect(commit).toBeDisabled();
  const distance = page.getByTestId('context-task-panel').getByLabel('Distance');
  await distance.fill('0');
  await expect(page.getByTestId('context-task-panel').getByRole('alert'))
    .toContainText('Distance must be non-zero');
  await expect(commit).toBeDisabled();
  await distance.fill('-0.25');
  await expect(commit).toBeEnabled();
  await expect.poll(() => page.evaluate(() => {
    const app = (window as Window & {
      app?: {
        pushPullPreviewObject: { userData: { isPushPullPreview?: boolean } } | null;
        selectedFace: { bodyId: string } | null;
        sceneObjects: Map<string, { visible: boolean }>;
      };
    }).app!;
    return {
      preview: app.pushPullPreviewObject?.userData.isPushPullPreview === true,
      sourceVisible: app.selectedFace
        ? app.sceneObjects.get(app.selectedFace.bodyId)?.visible ?? null
        : null,
    };
  })).toEqual({ preview: true, sourceVisible: false });
  await page.keyboard.press('Escape');
  await expect(page.locator('#status-left')).toContainText('document unchanged');
  await expect(feature(page, 'box')).toHaveCount(1);
  await expect(feature(page, 'offsetFace')).toHaveCount(0);
  await expect(page.getByTestId('context-task-panel').getByRole('heading', { name: 'Push/Pull', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const app = (window as Window & {
      app?: {
        buildDocumentSnapshot(): unknown;
        selectionMode: string;
        pushPullPreviewObject: unknown;
      };
    }).app!;
    return {
      document: JSON.stringify(app.buildDocumentSnapshot()),
      selectionMode: app.selectionMode,
      previewCleared: app.pushPullPreviewObject === null,
    };
  })).toEqual({ document: baseline, selectionMode: 'body', previewCleared: true });
});

test('shows only signed Distance for Push/Pull and commits in both directions', async ({ page }) => {
  await command(page, 'addBox').click();
  await command(page, 'enterPushPull').click();
  let facePoint = await findVisibleFacePoint(page);
  await page.mouse.click(facePoint.x, facePoint.y);

  const task = page.getByTestId('context-task-panel');
  await expect(task.getByRole('heading', { name: 'Push/Pull' })).toBeVisible();
  await expect(task.locator('[data-field-id]')).toHaveCount(1);
  await expect(task.locator('[data-field-id="push-pull-distance"]')).toBeVisible();
  await expect(task).not.toContainText('Width');
  await expect(task).not.toContainText('Depth');
  await expect(task).not.toContainText('Height');
  await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  );

  const distance = task.getByLabel('Distance');
  await distance.fill('-0.25');
  await expect(feature(page, 'offsetFace')).toHaveCount(0);
  await distance.press('Enter');
  await expect(feature(page, 'offsetFace')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const app = (window as Window & {
      app?: { toolSessions: { activeSession: { kind: string } | null }; pushPullMode: boolean };
    }).app!;
    return { active: app.toolSessions.activeSession?.kind ?? null, pushPullMode: app.pushPullMode };
  })).toEqual({ active: null, pushPullMode: false });
  await expect(task.getByRole('heading', { name: 'Push/Pull', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const app = (window as Window & { app?: { features: Array<{ type: string; parameters: { distance?: number } }> } }).app!;
    return [...app.features].reverse().find((item) => item.type === 'offsetFace')?.parameters.distance;
  })).toBe(-0.25);
  expect(await page.evaluate(() => {
    const app = (window as Window & {
      app?: { rebuiltBodies: Array<{ vertices: Map<string, { position: [number, number, number] }> }> };
    }).app!;
    const points = [...app.rebuiltBodies[0]!.vertices.values()].map((vertex) => vertex.position);
    return [0, 1, 2].map((axis) => {
      const values = points.map((point) => point[axis]!);
      return Math.max(...values) - Math.min(...values);
    }).sort((left, right) => left - right);
  })).toEqual([0.75, 1, 1]);

  expect(await page.evaluate(() => {
    const app = (window as Window & {
      app?: { undoRedo: { getState(): { history: Array<{ label: string }> } } };
    }).app!;
    return app.undoRedo.getState().history.map((entry) => entry.label);
  })).toEqual(expect.arrayContaining(['Add Box', 'Push/Pull']));
  await command(page, 'undo').click();
  await expect(feature(page, 'offsetFace')).toHaveCount(0);
  await expect(feature(page, 'box')).toHaveCount(1);
  await command(page, 'redo').click();
  await expect(feature(page, 'offsetFace')).toHaveCount(1);
  await command(page, 'undo').click();
  await expect(feature(page, 'offsetFace')).toHaveCount(0);
  await expect(feature(page, 'box')).toHaveCount(1);
  await command(page, 'enterPushPull').click();
  facePoint = await findVisibleFacePoint(page);
  await page.mouse.click(facePoint.x, facePoint.y);
  await page.getByTestId('context-task-panel').getByLabel('Distance').fill('10 mm');
  await page.getByTestId('context-task-panel').getByLabel('Distance').press('Enter');
  await expect(feature(page, 'offsetFace')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const app = (window as Window & { app?: { features: Array<{ type: string; parameters: { distance?: number } }> } }).app!;
    return [...app.features].reverse().find((item) => item.type === 'offsetFace')?.parameters.distance;
  })).toBeCloseTo(10 / 25.4);
  expect(await page.evaluate(() => {
    const app = (window as Window & {
      app?: { rebuiltBodies: Array<{ vertices: Map<string, { position: [number, number, number] }> }> };
    }).app!;
    const points = [...app.rebuiltBodies[0]!.vertices.values()].map((vertex) => vertex.position);
    return [0, 1, 2].map((axis) => {
      const values = points.map((point) => point[axis]!);
      return Math.max(...values) - Math.min(...values);
    }).sort((left, right) => left - right);
  })).toEqual([1, 1, 1 + 10 / 25.4]);
});

test('runs common commands from the searchable command palette', async ({ page }) => {
  await page.keyboard.press('Control+K');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();

  await palette.getByRole('combobox').fill('box primitive');
  await expect(palette.locator('[data-command-id="addBox"]')).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(palette).toBeHidden();
  await expect(feature(page, 'box')).toContainText('Box 1');
});

test('keeps staged placement and mate commands discoverable with truthful availability', async ({
  page,
}) => {
  await page.keyboard.press('Control+K');
  const palette = page.getByTestId('command-palette');
  const search = palette.getByRole('combobox');

  for (const [query, id] of [
    ['point to point', 'placePointToPoint'],
    ['align faces', 'alignFaces'],
    ['rotate about edge', 'rotateAboutEdge'],
    ['mate faces', 'createMate'],
  ] as const) {
    await search.fill(query);
    await expect(palette.locator(`[data-command-id="${id}"]`)).toBeVisible();
  }

  await search.fill('rotate about edge');
  await expect(palette.locator('[data-command-id="rotateAboutEdge"]'))
    .toContainText('Select one or more bodies, then choose an exact edge axis.');
  await search.fill('mate faces');
  await expect(palette.locator('[data-command-id="createMate"]'))
    .toContainText('Create at least two component instances, then select one face on each.');
  await page.keyboard.press('Escape');

  const beforePlacement = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  await invokeCommand(page, 'placePointToPoint');
  const task = page.getByTestId('context-task-panel');
  await expect(task).toHaveAccessibleName('Point-to-point Placement task controls');
  await expect(task).toContainText('Source Selection');
  await page.keyboard.press('Escape');
  await expect(page.locator('#status-left')).toContainText('document unchanged');

  await invokeCommand(page, 'alignFaces');
  await expect(task).toHaveAccessibleName('Align Faces task controls');
  await expect(task).toContainText('Source Selection');
  await page.keyboard.press('Escape');

  const afterPlacement = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  expect(afterPlacement).toBe(beforePlacement);

  await command(page, 'addBox').click();
  await expectCommandAvailability(page, 'rotateAboutEdge', true);
  await invokeCommand(page, 'rotateAboutEdge');
  await expect(task).toHaveAccessibleName('Rotate about Edge task controls');
  await expect(task).toContainText('Select the exact edge that defines the rotation axis.');
  await expect(task.getByRole('button', { name: 'Rotate', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
});

test('stages exact measurements in the inspector and Escape preserves the document', async ({ page }) => {
  await command(page, 'addBox').click();
  const before = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));

  await invokeCommand(page, 'measureSelection');
  const task = page.getByTestId('context-task-panel');
  await expect(task).toHaveAccessibleName('Measurement task controls');
  await expect(task).toContainText('Exact B-Rep result ready');
  await expect(task.getByLabel('Length')).not.toBeEmpty();
  await expect(task.getByLabel('Width')).not.toBeEmpty();
  await expect(task.getByLabel('Thickness')).not.toBeEmpty();
  await expect(task.getByRole('button', { name: 'Pin to drawing' })).toBeEnabled();

  await task.getByLabel('Measurement').selectOption('vertexToVertex');
  await expect(task).toContainText('0 reference(s) selected');
  await expect(task).toContainText('Select the first vertex.');
  await expect(task.getByRole('button', { name: 'Pin to drawing' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(task).toBeHidden();
  await expect(page.locator('#status-left')).toContainText('Measurement canceled - document unchanged');
  const after = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  expect(after).toBe(before);
});

test('exposes advanced saw, chamfer, and three-way miter controls without committing', async ({
  page,
}) => {
  await command(page, 'addBox').click();
  const before = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));

  await command(page, 'addWoodJoint').click();
  const task = page.getByTestId('context-task-panel');
  const jointType = task.getByLabel('Joint type');

  await jointType.selectOption('sawCut');
  await expect(task).toHaveAccessibleName('Saw Cut task controls');
  await expect(task.getByLabel('Saw angle')).toBeVisible();
  await expect(task.getByLabel('Offset')).toBeVisible();
  await expect(task.getByLabel('Kerf')).toBeVisible();
  await expect(task.getByLabel('Keep')).toHaveValue('both');
  await expect(task.getByLabel('Keep').locator('option')).toHaveText([
    'Both pieces',
    'Datum side',
    'Opposite side',
  ]);

  await task.getByLabel('Joint type').selectOption('chamfer');
  await expect(task).toHaveAccessibleName('Chamfer task controls');
  await expect(task.getByLabel('Definition')).toHaveValue('distance');
  await expect(task.getByLabel('Distance')).toBeVisible();
  await expect(task.getByLabel('Additional edges')).toHaveText('1 edge selected');
  await task.getByLabel('Definition').selectOption('distanceAngle');
  await expect(task.getByLabel('Angle')).toBeVisible();
  const reselectEdges = task.getByRole('button', { name: 'Reselect chamfer edges' });
  await expect(reselectEdges).toBeVisible();
  await reselectEdges.click();
  await expect(page.locator('#status-left')).toContainText('Reselect the chamfer edge.');

  await task.getByLabel('Joint type').selectOption('threeWayMiter');
  await expect(task).toHaveAccessibleName('Three-way Miter task controls');
  for (const member of ['A', 'B', 'C']) {
    await expect(task.getByLabel(`Member ${member} angle`)).toBeVisible();
  }
  await expect(task.getByLabel('Closure tolerance')).toBeVisible();
  await expect(task.getByLabel('Keep')).toHaveValue('trim');
  await expect(task.getByLabel('Exploded preview distance')).toBeVisible();
  await expect(task).toContainText('Select 3 exact member faces');
  await expect(task.getByRole('button', { name: 'Create joint' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(task).toBeHidden();
  await expect(page.locator('#status-left')).toContainText('document unchanged');
  const after = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } }).app!.buildDocumentSnapshot()
  ));
  expect(after).toBe(before);
});

test('uses named views directly from the viewport cube', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await command(page, 'addBox').click();
  const top = page.getByRole('button', { name: 'Top view' });
  await top.click();
  expect(pageErrors).toEqual([]);
  await expect(top).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status-left')).toContainText('Top view');

  const isometric = page.getByRole('button', { name: 'Isometric view' });
  await isometric.click();
  await expect(isometric).toHaveAttribute('aria-pressed', 'true');
});

test('keeps world reference axes camera-relative through projection and zoom changes', async ({ page }) => {
  const readAxes = () => page.evaluate(() => {
    const app = (window as Window & {
      app?: {
        viewport: {
          getAxes(): { getCurrentExtent(): number };
          getCameraControls(): {
            camera: { far: number; zoom?: number; updateProjectionMatrix(): void };
            getProjection(): 'perspective' | 'orthographic';
          };
        };
      };
    }).app!;
    const controls = app.viewport.getCameraControls();
    return {
      extent: app.viewport.getAxes().getCurrentExtent(),
      far: controls.camera.far,
      projection: controls.getProjection(),
    };
  });

  await expect.poll(readAxes).toMatchObject({ projection: 'perspective' });
  const perspective = await readAxes();
  expect(perspective.extent).toBeGreaterThan(perspective.far);

  await page.evaluate(() => {
    const app = (window as Window & {
      app?: { viewport: { getCameraControls(): { camera: { zoom: number; updateProjectionMatrix(): void } } } };
    }).app!;
    const camera = app.viewport.getCameraControls().camera;
    camera.zoom = 0.001;
    camera.updateProjectionMatrix();
  });
  await expect.poll(async () => (await readAxes()).extent)
    .toBeGreaterThan(perspective.extent * 10);

  await command(page, 'toggleProjection').click();
  await page.evaluate(() => {
    const app = (window as Window & {
      app?: { viewport: { getCameraControls(): { camera: { zoom: number; updateProjectionMatrix(): void } } } };
    }).app!;
    const camera = app.viewport.getCameraControls().camera;
    camera.zoom = 0.0005;
    camera.updateProjectionMatrix();
  });
  await expect.poll(readAxes).toMatchObject({ projection: 'orthographic' });
  const orthographic = await readAxes();
  expect(orthographic.extent).toBeGreaterThan(orthographic.far);
  expect(Number.isFinite(orthographic.extent)).toBe(true);
});

test('manages history and body state from the model browser', async ({ page }) => {
  await command(page, 'addBox').click();
  await command(page, 'addDuplicate').click();
  await page.keyboard.press('Enter');
  await expandSection(page, 'Model browser');

  const browser = page.getByTestId('model-browser');
  const boxRow = feature(page, 'box');
  await boxRow.locator('[data-action="dependencies"]').click();
  await expect(page.getByTestId('context-task-panel')).toContainText('Used by');
  await expect(page.getByTestId('context-task-panel')).toContainText('Copy 2');

  await boxRow.locator('[data-action="rollback"]').click();
  await browser.locator('[data-action="confirm-rollback"]').click();
  await expect(feature(page, 'moveCopy').locator('[data-action="suppress"]')).toHaveAttribute(
    'title',
    'Resume'
  );
  await command(page, 'undo').click();
  await expect(feature(page, 'moveCopy').locator('[data-action="suppress"]')).toHaveAttribute(
    'title',
    'Suppress'
  );

  await boxRow.locator('[data-action="rename"]').click();
  const rename = boxRow.getByRole('textbox');
  await rename.fill('Base Panel');
  await rename.press('Enter');
  await expect(feature(page, 'box')).toContainText('Base Panel');

  const bodyRow = browser.locator('[data-node-kind="body"]').first();
  await bodyRow.locator('[data-action="visibility"]').click();
  await expect(bodyRow.locator('[data-action="visibility"]')).toHaveAttribute('title', 'Show');
  await bodyRow.locator('[data-action="lock"]').click();
  await expect(bodyRow.locator('[data-action="lock"]')).toHaveAttribute('title', 'Unlock');

  await command(page, 'createComponent').click();
  const componentRow = browser.locator('[data-node-kind="component"]').first();
  await expect(componentRow).toBeVisible();
  await componentRow.locator('[data-action="visibility"]').click();
  await expect(componentRow.locator('[data-action="visibility"]')).toHaveAttribute('title', 'Show');
  await componentRow.locator('[data-action="lock"]').click();
  await expect(componentRow.locator('[data-action="lock"]')).toHaveAttribute('title', 'Unlock');
});

test('applies sticky task-panel numeric input before committing a sketch tool', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  await page.mouse.move(bounds.x + bounds.width / 2 - 70, bounds.y + bounds.height / 2 - 50);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 70,
    bounds.y + bounds.height / 2 + 50,
    { steps: 4 }
  );
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  // Pick the middle of the top segment. Clicking its endpoint would intentionally
  // start the valid two-point dimension workflow and keep numeric input disabled
  // until the second endpoint is selected.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 50);

  const taskInput = page.getByTestId('context-task-panel').getByRole('textbox', {
    name: 'Numeric input',
  });
  await expect(taskInput).toBeEnabled();
  await taskInput.fill('25.4/2 mm');
  await taskInput.press('Enter');
  await expect(page.locator('#status-left')).toContainText('Add Driving Dimension committed');
});

test('retains body presentation through suppress and resume', async ({ page }) => {
  await command(page, 'addBox').click();
  await expandSection(page, 'Model browser');
  await expandSection(page, 'Properties');
  const browser = page.getByTestId('model-browser');
  let bodyRow = browser.locator('[data-node-kind="body"]').first();
  await feature(page, 'box').locator('[data-role="name"]').click();
  await expect(page.getByText('Select a feature to edit', { exact: true })).toBeHidden();
  await bodyRow.locator('[data-action="rename"]').click();
  await bodyRow.getByRole('textbox').fill('Panel Body');
  await bodyRow.getByRole('textbox').press('Enter');
  await bodyRow.locator('[data-action="visibility"]').click();
  await bodyRow.locator('[data-action="lock"]').click();
  await expect(page.getByText('Select a feature to edit', { exact: true })).toBeVisible();

  await feature(page, 'box').locator('[data-action="suppress"]').click();
  await expect(browser.locator('[data-node-kind="body"]')).toHaveCount(0);
  await page.evaluate(() => {
    const app = (window as Window & { app?: {
      buildDocumentSnapshot(): unknown;
      loadDocument(document: unknown, options: Record<string, unknown>): void;
    } }).app!;
    const persisted = JSON.parse(JSON.stringify(app.buildDocumentSnapshot())) as unknown;
    app.loadDocument(persisted, { seedHistory: true, recordRecent: false });
  });
  await feature(page, 'box').locator('[data-action="suppress"]').click();

  bodyRow = browser.locator('[data-node-kind="body"]').first();
  await expect(bodyRow).toContainText('Panel Body');
  await expect(bodyRow.locator('[data-action="visibility"]')).toHaveAttribute('title', 'Show');
  await expect(bodyRow.locator('[data-action="lock"]')).toHaveAttribute('title', 'Unlock');
  await feature(page, 'box').locator('[data-role="name"]').click();
  await expect(page.locator('#status-left')).toContainText('locked through one of its output bodies');
  await expect(page.getByText('Select a feature to edit', { exact: true })).toBeVisible();
});

test('applies an active feature numeric field before Enter commits', async ({ page }) => {
  await command(page, 'addSketch').click();
  const canvas = page.getByTestId('sketch-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Sketch canvas has no drawable bounds');

  await page.mouse.move(bounds.x + bounds.width / 2 - 60, bounds.y + bounds.height / 2 - 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 40, {
    steps: 4,
  });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Exit sketch', exact: true }).click();
  await command(page, 'addExtrude').click();

  const distance = page.getByTestId('context-task-panel').getByRole('spinbutton', {
    name: 'Distance',
  });
  await distance.fill('37');
  await distance.press('Enter');

  await expect(page.locator('#status-left')).toContainText('Added Extrude 2');
  await expect(feature(page, 'extrude')).toHaveCount(1);
  const committedDistance = await page.evaluate(() => {
    const snapshot = (window as Window & { app?: { buildDocumentSnapshot(): unknown } })
      .app!.buildDocumentSnapshot() as {
        features: Array<{ type: string; parameters: { distance?: number } }>;
      };
    return snapshot.features.find((item) => item.type === 'extrude')?.parameters.distance;
  });
  expect(committedDistance).toBe(37);
});

test('uses model-browser component selection for Add Instance', async ({ page }) => {
  await command(page, 'addBox').click();
  await command(page, 'createComponent').click();
  await expectCommandAvailability(page, 'addInstance', true);
  await expandSection(page, 'Model browser');
  await command(page, 'addBox').click();
  await expectCommandAvailability(page, 'addInstance', false);
  await command(page, 'createComponent').click();

  const components = page.getByTestId('model-browser').locator('[data-node-kind="component"]');
  await components.first().locator('[data-role="name"]').click();
  await command(page, 'addInstance').click();

  const selectedCorrectly = await page.evaluate(() => {
    const app = (window as Window & { app?: {
      components: Array<{ id: string }>;
      componentInstances: Array<{ componentId: string }>;
    } }).app!;
    return app.componentInstances[0]?.componentId === app.components[0]?.id;
  });
  expect(selectedCorrectly).toBe(true);
});

test('tags boards and exports stable woodworking outputs', async ({ page }) => {
  await command(page, 'addBox').click();
  await expandSection(page, 'Woodworking');
  const woodworking = page.getByTestId('woodworking-panel');
  await expect(woodworking).toContainText('Measure: Box');
  await expect(woodworking).toContainText('Length');

  await woodworking.getByLabel('Include in cut list').check();
  await woodworking.getByLabel('Label').fill('Side, Panel');
  await woodworking.getByLabel('Label').press('Tab');
  await woodworking.getByLabel('Material').fill('White oak');
  await woodworking.getByLabel('Material').press('Tab');
  await expect(page.locator('#status-left')).toContainText('added to the cut list as White oak');

  await command(page, 'addDuplicate').click();
  await page.keyboard.press('Enter');
  await expect(feature(page, 'moveCopy')).toHaveCount(1);

  await command(page, 'exportCutList').click();
  const cutListPreview = page.getByRole('dialog', { name: 'Untitled cut list' });
  await expect(cutListPreview).toBeVisible();
  await expect(cutListPreview.getByText('Cut-list preview with editable stock allowances'))
    .toBeVisible();
  await expect(cutListPreview.getByRole('columnheader')).toHaveCount(15);
  await expect(cutListPreview.getByRole('columnheader', { name: 'Finished L' })).toBeVisible();
  await expect(cutListPreview.getByRole('columnheader', { name: 'Cut L' })).toBeVisible();

  const lengthAllowance = cutListPreview.getByLabel('Part group length allowance in in');
  await lengthAllowance.fill('-1');
  await expect(lengthAllowance).toHaveAttribute('aria-invalid', 'true');
  await expect(cutListPreview.locator('[role="alert"]:not([hidden])'))
    .toContainText('Allowance must be non-negative.');
  await expect(cutListPreview.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  await expect(page.getByTestId('cut-list-preview-issues')).toContainText('Export blocked');

  await lengthAllowance.fill('1/8');
  await expect(lengthAllowance).toHaveAttribute('aria-invalid', 'false');
  await expect(cutListPreview.getByRole('button', { name: 'Export CSV' })).toBeEnabled();

  const csvDownloadPromise = page.waitForEvent('download');
  await cutListPreview.getByRole('button', { name: 'Export CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  const csv = await readDownload(csvDownload);
  expect(csv).toContain('Part names,Quantity,Material,Grade,Stock code');
  expect(csv).toContain('2,White oak');
  expect(csv).toContain('"Side, Panel; Side, Panel"');
  expect(csv).toContain('1.125');

  const svgDownloadPromise = page.waitForEvent('download');
  await command(page, 'exportDrawing').click();
  const svgDownload = await svgDownloadPromise;
  const svg = await readDownload(svgDownload);
  expect(svg).toContain('ORTHOGRAPHIC SHOP DRAWING');
  expect(svg).toContain('FRONT');
  expect(svg).toContain('TOP');
  expect(svg).toContain('RIGHT');
  expect(svg).toContain('UNITS IN');
});

test('meets the Phase 6 200-feature browser application budget', async ({ page }) => {
  const result = await page.evaluate(async (featureCount) => {
    interface BenchmarkBody {
      id: string;
    }
    interface CacheStats {
      lookups: number;
      hits: number;
      misses: number;
      hitRate: number;
    }
    const app = (window as Window & { app?: {
      buildDocumentSnapshot(): Record<string, unknown>;
      loadDocument(document: Record<string, unknown>, options: Record<string, unknown>): void;
      rebuiltBodies: BenchmarkBody[];
      meshCache: {
        resetStats(): void;
        getOrCreateMesh(body: BenchmarkBody): unknown;
        getStats(): CacheStats;
      };
      picking: {
        pickVertex(
          x: number,
          y: number,
          width: number,
          height: number,
          camera: unknown,
          bodies: Map<string, { body: BenchmarkBody; featureId: string }>,
          tolerance: number
        ): unknown;
      };
      viewport: {
        getDomElement(): HTMLCanvasElement;
        getCameraControls(): { camera: unknown };
      };
    } }).app!;
    const document = app.buildDocumentSnapshot();
    const features = Array.from({ length: featureCount }, (_, index) => ({
      id: `browser_perf_box_${String(index).padStart(3, '0')}`,
      type: 'box',
      name: `Performance Box ${index + 1}`,
      parameters: {
        width: 1,
        depth: 2,
        height: 0.75,
        anchorMode: 'corner',
        origin: [(index % 20) * 1.5, Math.floor(index / 20) * 2.5, 0],
      },
      refsIn: [],
      refsOut: [],
      suppressed: false,
    }));
    app.meshCache.resetStats();
    const startedAt = performance.now();
    app.loadDocument({ ...document, bodies: [], features }, {
      seedHistory: true,
      recordRecent: false,
    });
    const rebuildAndLoadMs = performance.now() - startedAt;

    // Request the same rebuilt bodies again. These are real application cache
    // lookups and must reuse the meshes produced by loadDocument.
    for (const body of app.rebuiltBodies) app.meshCache.getOrCreateMesh(body);
    const cache = app.meshCache.getStats();

    const canvas = app.viewport.getDomElement();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bodyEntries = new Map(app.rebuiltBodies.map((body) => [
      body.id,
      { body, featureId: body.id.replace(/_body$/, '') },
    ]));
    const pickingTimes: number[] = [];
    let pickingHits = 0;
    for (let index = 0; index < 20; index += 1) {
      const pickStartedAt = performance.now();
      const pick = app.picking.pickVertex(
        width / 2,
        height / 2,
        width,
        height,
        app.viewport.getCameraControls().camera,
        bodyEntries,
        Math.max(width, height)
      );
      pickingTimes.push(performance.now() - pickStartedAt);
      if (pick) pickingHits += 1;
    }

    // Separate steady-state frame responsiveness from the one-time load and
    // picking workload above. Warm-up frames let Chromium finish queued paint
    // and GC work; all 60 measured frames still remain subject to the budget.
    await new Promise<void>((resolve) => {
      let remaining = 30;
      const warm = (): void => {
        remaining -= 1;
        if (remaining === 0) resolve();
        else requestAnimationFrame(warm);
      };
      requestAnimationFrame(warm);
    });

    const frameTimes: number[] = [];
    await new Promise<void>((resolve) => {
      let previous = performance.now();
      const sample = (now: number): void => {
        frameTimes.push(now - previous);
        previous = now;
        if (frameTimes.length >= 60) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return {
      rebuildAndLoadMs,
      cache,
      picking: {
        queries: pickingTimes.length,
        hits: pickingHits,
        averageMs: pickingTimes.reduce((sum, value) => sum + value, 0) / pickingTimes.length,
        maximumMs: Math.max(...pickingTimes),
      },
      averageFrameMs: frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length,
      maximumFrameMs: Math.max(...frameTimes),
    };
  }, REFERENCE_FEATURE_COUNT);

  await test.info().attach('phase-6-performance-report.json', {
    body: JSON.stringify({ workload: BROWSER_REFERENCE_WORKLOAD, ...result }, null, 2),
    contentType: 'application/json',
  });
  await expect(feature(page, 'box')).toHaveCount(REFERENCE_FEATURE_COUNT);
  expect(result.rebuildAndLoadMs).toBeLessThan(BROWSER_REFERENCE_BUDGET.maxRebuildAndLoadMs);
  expect(result.cache).toEqual({
    lookups: REFERENCE_FEATURE_COUNT * 2,
    hits: REFERENCE_FEATURE_COUNT,
    misses: REFERENCE_FEATURE_COUNT,
    hitRate: BROWSER_REFERENCE_BUDGET.minCacheHitRate,
  });
  expect(result.picking.queries).toBe(20);
  expect(result.picking.hits).toBe(20);
  expect(result.picking.averageMs).toBeLessThan(BROWSER_REFERENCE_BUDGET.maxAveragePickingMs);
  expect(result.picking.maximumMs).toBeLessThan(BROWSER_REFERENCE_BUDGET.maxSinglePickingMs);
  expect(result.averageFrameMs).toBeLessThan(BROWSER_REFERENCE_BUDGET.maxAverageFrameMs);
  expect(result.maximumFrameMs).toBeLessThan(BROWSER_REFERENCE_BUDGET.maxSingleFrameMs);
});
