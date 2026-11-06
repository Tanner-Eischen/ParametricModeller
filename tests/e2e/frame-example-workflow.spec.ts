import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** This acceptance path uses visible controls and real files, never window.app. */
async function invoke(page: Page, id: string): Promise<void> {
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const option = palette.locator(`[data-command-id="${id}"]`);
  await expect(option).toBeVisible();
  await expect(option).toBeEnabled();
  await option.click();
  await expect(palette).toBeHidden();
}

async function downloadScene(page: Page, destination: string): Promise<string> {
  const pending = page.waitForEvent('download');
  await invoke(page, 'downloadSceneJson');
  const download = await pending;
  await download.saveAs(destination);
  expect(await download.failure()).toBeNull();
  return readFile(destination, 'utf8');
}

async function importScene(page: Page, path: string): Promise<void> {
  const pending = page.waitForEvent('filechooser');
  await invoke(page, 'importSceneJson');
  await (await pending).setFiles(path);
}

interface SceneIdentity {
  features: Array<{ id: string; type: string; parameters: Record<string, unknown> }>;
  componentInstances: Array<{ id: string; transform: unknown }>;
  bodyMetadata: Record<string, { label: string; partNumber?: string }>;
}

function identity(json: string) {
  const scene = JSON.parse(json) as SceneIdentity;
  return {
    features: scene.features.map(({ id, type, parameters }) => ({ id, type, parameters })),
    instances: scene.componentInstances,
    metadata: scene.bodyMetadata,
  };
}

test('frame example edits, pointer history, portable files and manufacturing export', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Frame example', exact: true }).click();

  const summary = page.getByTestId('frame-example-summary');
  const length = page.getByRole('spinbutton', { name: 'Frame board length (in)', exact: true });
  const apply = page.getByRole('button', { name: 'Apply frame length', exact: true });
  const undo = page.getByTestId('command-undo');
  const redo = page.getByTestId('command-redo');
  await expect(summary).toHaveText('4 physical boards; outer dimensions 24 × 18 × 0.75 in');
  await expect(length).toHaveValue('18');
  await expect(undo).toBeDisabled();

  await length.fill('20');
  await apply.click();
  await expect(summary).toHaveText('4 physical boards; outer dimensions 26 × 20 × 0.75 in');
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(length).toHaveValue('18');
  await expect(summary).toContainText('24 × 18 × 0.75 in');
  await expect(page.locator('#status-left')).toContainText('Undo: Resize frame example');
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(length).toHaveValue('20');
  await expect(summary).toContainText('26 × 20 × 0.75 in');

  await length.fill('6');
  await apply.click();
  await expect(page.getByRole('alert')).toContainText('greater than 6 inches');
  await expect(summary).toContainText('26 × 20 × 0.75 in');
  // A rejected edit must not add an extra history step.
  await undo.click();
  await expect(summary).toContainText('24 × 18 × 0.75 in');
  await redo.click();
  await expect(length).toHaveValue('20');

  const scenePath = testInfo.outputPath('edited-frame.scene.json');
  const saved = identity(await downloadScene(page, scenePath));
  expect(saved.features).toHaveLength(1);
  expect(saved.features[0]).toMatchObject({
    id: 'portfolio-frame-board', type: 'box', parameters: { width: 20, depth: 3, height: 0.75 },
  });
  expect(saved.instances.map(instance => instance.id).sort()).toEqual([
    'portfolio-frame-bottom', 'portfolio-frame-left', 'portfolio-frame-right', 'portfolio-frame-top',
  ]);

  await invoke(page, 'newDocument');
  await expect(length).toBeHidden();
  await importScene(page, scenePath);
  await expect(summary).toContainText('26 × 20 × 0.75 in');
  await expect(length).toHaveValue('20');
  expect(identity(await downloadScene(page, testInfo.outputPath('reopened-frame.scene.json')))).toEqual(saved);

  // Import itself must seed recovery. No additional edit or debounce wait is
  // needed before restarting the editor and choosing the imported recent file.
  await page.reload();
  await page.getByRole('button', { name: 'Recent files', exact: true }).click();
  await page.getByRole('button', { name: /White oak square-butt frame.*edited-frame\.scene\.json/ }).click();
  await expect(summary).toContainText('26 × 20 × 0.75 in');
  await expect(page.locator('#status-left')).toContainText('latest autosaved snapshot');

  await invoke(page, 'exportCutList');
  const cutList = page.getByRole('dialog', { name: 'White oak square-butt frame cut list', exact: true });
  await expect(cutList).toBeVisible();
  for (const id of ['bottom', 'left', 'right', 'top']) {
    await expect(cutList).toContainText(`portfolio-frame-${id}`);
  }
  const csvPending = page.waitForEvent('download');
  await cutList.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csvPath = testInfo.outputPath('edited-frame-cut-list.csv');
  await (await csvPending).saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  const rows = csv.trim().split(/\r?\n/);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatch(/^Part names,Quantity,Material,/);
  expect(rows[1]).toMatch(/^Bottom board; Left board; Right board; Top board,4,White oak,,,20,3,0\.75,20\.5,3\.25,0\.875,in,/);

  const malformedPath = testInfo.outputPath('malformed.scene.json');
  await writeFile(malformedPath, '{"version":');
  await importScene(page, malformedPath);
  await expect(page.locator('#status-left')).toContainText('Open failed:');
  await expect(summary).toContainText('26 × 20 × 0.75 in');
  expect(identity(await downloadScene(page, testInfo.outputPath('after-rejected-import.scene.json')))).toEqual(saved);
  expect(errors).toEqual([]);
});
