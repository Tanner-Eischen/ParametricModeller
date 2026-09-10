import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

interface JointDatumIds {
  firstBodyId: string;
  firstFaceId: string;
  secondBodyId: string;
  secondFaceId: string;
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
  for (const side of ['right', 'left'] as const) {
    const panel = page.locator(`#panel-${side}`);
    if ((await panel.getAttribute('data-collapsed')) === 'true') {
      await page.getByTestId(`${side}-sidebar-toggle`).click();
    }
    await expect(panel).toHaveAttribute('data-collapsed', 'false');
  }
  const dismiss = page.getByRole('button', { name: 'Dismiss quick start' });
  if (await dismiss.isVisible()) await dismiss.click();
}

async function expandSection(page: Page, title: string): Promise<void> {
  const toggle = page.getByRole('button', { name: title, exact: true });
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

async function invokePaletteCommand(page: Page, commandId: string): Promise<void> {
  await page.getByTestId('command-openCommandPalette').click();
  const option = page.getByTestId('command-palette').locator(
    `[data-command-id="${commandId}"]`
  );
  await expect(option).toBeEnabled();
  await option.click();
}

async function setupOverlappingBoards(page: Page): Promise<JointDatumIds> {
  await page.getByTestId('command-addBox').click();
  await page.getByTestId('command-addBox').click();
  await expandSection(page, 'Properties');
  const properties = page.getByTestId('panel-section-properties');
  await properties.getByLabel('X', { exact: true }).fill('0.5');
  await properties.getByRole('button', { name: 'Apply', exact: true }).click();
  await invokePaletteCommand(page, 'fitView');
  await page.getByRole('button', { name: 'Top view', exact: true }).click();

  const ids = await page.evaluate(() => {
    interface Plane {
      normal: [number, number, number];
    }
    interface Face {
      planeId: string;
    }
    interface Body {
      id: string;
      faces: Map<string, Face>;
      planes: Map<string, Plane>;
    }
    interface Feature {
      type: string;
      refsOut: string[];
    }
    const app = (window as Window & { app?: {
      features: Feature[];
      rebuiltBodies: Body[];
    } }).app!;
    const boxFeatures = app.features.filter((feature) => feature.type === 'box');
    const bodies = boxFeatures.map((feature) =>
      app.rebuiltBodies.find((body) => body.id === feature.refsOut[0])
    );
    if (!bodies[0] || !bodies[1]) throw new Error('Expected two rebuilt box bodies');
    const topFace = (body: Body) => {
      const entry = [...body.faces].find(([, face]) => {
        const normal = body.planes.get(face.planeId)?.normal;
        return normal && normal[2] > 0.99;
      });
      if (!entry) throw new Error(`No +Z face found for ${body.id}`);
      return entry[0];
    };
    return {
      firstBodyId: bodies[0].id,
      firstFaceId: topFace(bodies[0]),
      secondBodyId: bodies[1].id,
      secondFaceId: topFace(bodies[1]),
    };
  });
  expect(ids.firstBodyId).not.toBe(ids.secondBodyId);
  expect(`${ids.firstBodyId}/${ids.firstFaceId}`).not.toBe(
    `${ids.secondBodyId}/${ids.secondFaceId}`
  );
  return ids;
}

async function findExactFacePoint(
  page: Page,
  bodyId: string,
  faceId: string
): Promise<{ x: number; y: number }> {
  return page.evaluate(({ requestedBodyId, requestedFaceId }) => {
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
        ): { bodyId?: string; faceId?: string };
      };
      meshCache: {
        getFaceIdFromBody(bodyId: string, faceHash: number): string | null;
      };
      sceneObjects: Map<string, unknown>;
      viewport: { getCameraControls(): { camera: unknown } };
    } }).app!;
    if (!canvas) throw new Error('Viewport canvas was unavailable');
    const bounds = canvas.getBoundingClientRect();
    const objects = [...app.sceneObjects.values()];
    for (let y = bounds.height * 0.12; y <= bounds.height * 0.88; y += 4) {
      for (let x = bounds.width * 0.12; x <= bounds.width * 0.88; x += 4) {
        const hit = app.picking.pickFace(
          x,
          y,
          bounds.width,
          bounds.height,
          app.viewport.getCameraControls().camera,
          objects
        );
        if (!hit.bodyId || hit.faceId === undefined) continue;
        const stableFaceId = app.meshCache.getFaceIdFromBody(
          hit.bodyId,
          Number(hit.faceId)
        );
        if (hit.bodyId === requestedBodyId && stableFaceId === requestedFaceId) {
          return { x: bounds.left + x, y: bounds.top + y };
        }
      }
    }
    throw new Error(`Exact face ${requestedBodyId}/${requestedFaceId} was not screen-pickable`);
  }, { requestedBodyId: bodyId, requestedFaceId: faceId });
}

async function stageDadoJoint(
  page: Page,
  ids: JointDatumIds
): Promise<void> {
  await page.getByTestId('command-addWoodJoint').click();
  const task = page.getByTestId('context-task-panel');
  const jointType = task.getByLabel('Joint type');
  await expect(jointType).toBeVisible();
  await jointType.selectOption('dado');

  const firstPoint = await findExactFacePoint(page, ids.firstBodyId, ids.firstFaceId);
  await page.mouse.click(firstPoint.x, firstPoint.y);
  await expect(task.getByLabel('Member A end datum')).toContainText('Member A');
  await expect(task.getByRole('status').filter({ hasText: 'Select member 2' })).toBeVisible();

  // Re-picking the first member is explicitly rejected rather than silently
  // accepting the same body as both halves of a paired joint.
  await page.mouse.click(firstPoint.x, firstPoint.y);
  await expect(page.locator('#status-left')).toContainText('different member body');
  await expect(task.getByLabel('Member A end datum')).toBeVisible();
  await expect(task.getByLabel('Member B end datum')).toHaveCount(0);

  const secondPoint = await findExactFacePoint(page, ids.secondBodyId, ids.secondFaceId);
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await expect(task.getByLabel('Member B end datum')).toContainText('Member B');
  await expect(page.locator('#status-left')).toContainText('Previewing Dado');
}

test.beforeEach(async ({ page }) => {
  await openCleanModeler(page);
});

test('Wood Joint explains availability until stock exists', async ({ page }) => {
  const joint = page.getByTestId('command-addWoodJoint');
  await expect(joint).toBeDisabled();
  await expect(joint).toHaveAttribute(
    'data-disabled-reason',
    'Create at least one body, then choose a joint type and exact datum.'
  );

  await page.getByTestId('command-addBox').click();
  await expect(joint).toBeEnabled();

  await page.getByTestId('command-addBox').click();
  await expect(joint).toBeEnabled();
});

test('captures exact distinct member faces and Escape restores byte-equivalent state', async ({
  page,
}) => {
  const ids = await setupOverlappingBoards(page);
  const before = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } })
      .app!.buildDocumentSnapshot()
  ));

  await stageDadoJoint(page, ids);
  const captured = await page.evaluate(() => {
    const draft = (window as Window & { app?: {
      woodJointDraft: {
        members: Array<{
          bodyRef: { bodyId: string };
          datumRef: { kind: string; faceId?: string };
        }>;
      } | null;
    } }).app!.woodJointDraft;
    return draft?.members.map((member) => ({
      bodyId: member.bodyRef.bodyId,
      kind: member.datumRef.kind,
      faceId: member.datumRef.faceId,
    })) ?? [];
  });
  expect(captured).toEqual([
    { bodyId: ids.firstBodyId, kind: 'face', faceId: ids.firstFaceId },
    { bodyId: ids.secondBodyId, kind: 'face', faceId: ids.secondFaceId },
  ]);

  await expect(
    page.getByTestId('model-browser').locator('[data-feature-type="woodJoint"]')
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(
    page.getByTestId('model-browser').locator('[data-feature-type="woodJoint"]')
  ).toHaveCount(0);
  const after = await page.evaluate(() => JSON.stringify(
    (window as Window & { app?: { buildDocumentSnapshot(): unknown } })
      .app!.buildDocumentSnapshot()
  ));
  expect(after).toBe(before);
  await expect(page.locator('#status-left')).toContainText('document unchanged');
});

test('commits a valid paired Dado as one feature and one undo step', async ({ page }) => {
  const ids = await setupOverlappingBoards(page);
  await stageDadoJoint(page, ids);
  await page.keyboard.press('Enter');

  const jointFeature = page.getByTestId('model-browser').locator(
    '[data-feature-type="woodJoint"]'
  );
  await expect(jointFeature).toHaveCount(1);
  await expect(jointFeature).toContainText('Dado');
  await expect(page.locator('#status-left')).toContainText('Added Dado');

  await page.getByTestId('command-undo').click();
  await expect(jointFeature).toHaveCount(0);
  await expect(
    page.getByTestId('model-browser').locator('[data-feature-type="box"]')
  ).toHaveCount(2);

  await page.getByTestId('command-redo').click();
  await expect(jointFeature).toHaveCount(1);
});
