import { expect, test } from '@playwright/test';

test('edge hover works', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#viewport canvas[data-engine]')).toBeVisible();
  await page.getByTestId('command-addBox').click();
  await page.keyboard.press('Control+R');
  await page.waitForTimeout(200);

  const selection = page.getByTestId('selection-context');
  await selection.getByTestId('selection-mode-edge').click();
  await expect.poll(() => page.evaluate(() => (window as any).app?.selectionMode)).toBe('edge');

  // Find an edge point
  const edgePoint = await page.evaluate(() => {
    const app = (window as any).app;
    const canvas = document.querySelector('#viewport canvas[data-engine]');
    const bounds = canvas?.getBoundingClientRect();
    if (!bounds) return null;
    for (let y = bounds.height * 0.1; y <= bounds.height * 0.9; y += 10) {
      for (let x = bounds.width * 0.1; x <= bounds.width * 0.9; x += 10) {
        const hit = app.picking.pickEdge(x, y, bounds.width, bounds.height, app.viewport.getCameraControls().camera, app.getPickableBodies());
        if (hit?.edgeId) return { x: bounds.left + x, y: bounds.top + y };
      }
    }
    return null;
  });

  if (!edgePoint) throw new Error('No edge point found');

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

  // Verify hover overlay appears
  await expect.poll(() => page.evaluate(() =>
    (window as any).app?.viewport?.getScene()?.children?.some((c: any) => c.userData?.edgeOverlayRole === 'hover')
  )).toBe(true);
});
