/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import { buildCutListDocument } from '../../src/woodworking/CutList';
import type { ManufacturingOperation } from '../../src/woodworking/ManufacturingOperation';
import {
  CutListPreviewPanel,
  buildCutListPreviewModel,
} from '../../src/ui/CutListPreviewPanel';

function documentModel() {
  return buildCutListDocument([{
    body: createBoxBody({
      width: 24, depth: 12, height: 0.75, anchorMode: 'corner', origin: [0, 0, 0],
    }, 'side-a'),
    name: 'Cabinet side',
    metadata: {
      material: { id: 'oak', species: 'White oak', grade: 'FAS' },
      grainAxis: [1, 0, 0],
      thicknessAxis: [0, 0, 1],
      stockAllowance: { length: 0.5, width: 0.25, thickness: 0 },
      notes: 'Match grain',
    },
  }], { title: 'Cabinet', unit: 'in' });
}

const operation: ManufacturingOperation = {
  id: 'operation-1',
  featureId: 'joint-1',
  memberBodyId: 'side-a',
  kind: 'dado',
  process: 'router',
  sequence: 0,
  datumRef: { kind: 'face', featureId: 'box-feature', bodyId: 'side-a', faceId: '+Z' },
  removal: { shape: 'rectangularPrism', width: 0.75, depth: 0.375 },
  sideClearance: 0,
  endClearance: 0,
};

describe('CutListPreviewPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('builds a deterministic preview with finished/cut sizes and operation summaries', () => {
    const options = {
      operations: [operation],
      partNumbersByBodyId: { 'side-a': 'C-101' },
    };
    const first = buildCutListPreviewModel(documentModel(), options);
    const second = buildCutListPreviewModel(documentModel(), options);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      canExport: true,
      rows: [{
        quantity: 1,
        material: 'White oak',
        grade: 'FAS',
        partNumbers: ['C-101'],
        finishedDimensions: { length: 24, width: 12, thickness: 0.75 },
        allowances: { length: 0.5, width: 0.25, thickness: 0 },
        cutDimensions: { length: 24.5, width: 12.25, thickness: 0.75 },
        operationSummary: 'Dado (Router) ×1',
        notes: ['Match grain'],
      }],
    });
  });

  it('uses CAD numeric input, blocks invalid export, and emits valid allowance changes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const trigger = document.createElement('button');
    document.body.prepend(trigger);
    trigger.focus();
    const onAllowanceChange = vi.fn();
    const onExport = vi.fn();
    const onClose = vi.fn();
    const panel = new CutListPreviewPanel({
      container,
      document: documentModel(),
      operations: [operation],
      partNumbersByBodyId: { 'side-a': 'C-101' },
      onAllowanceChange,
      onExport,
      onClose,
    });
    panel.open();

    const root = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(root.hidden).toBe(false);
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.querySelectorAll('th[scope="col"]')).toHaveLength(15);
    expect(root.textContent).toContain('C-101');
    expect(root.textContent).toContain('Dado (Router) ×1');
    const length = root.querySelector<HTMLInputElement>('input[aria-label*="length allowance"]')!;
    const exportButton = root.querySelector<HTMLButtonElement>('[data-testid="cut-list-preview-export"]')!;

    length.value = '-1/8 in';
    length.dispatchEvent(new Event('input', { bubbles: true }));
    expect(length.getAttribute('aria-invalid')).toBe('true');
    expect(exportButton.disabled).toBe(true);
    exportButton.click();
    expect(onExport).not.toHaveBeenCalled();

    length.value = '1/4 in';
    length.dispatchEvent(new Event('input', { bubbles: true }));
    expect(length.getAttribute('aria-invalid')).toBe('false');
    expect(exportButton.disabled).toBe(false);
    expect(onAllowanceChange).toHaveBeenCalledWith(expect.any(String), {
      length: 0.25, width: 0.25, thickness: 0,
    });
    expect(root.querySelector('[data-cut-dimension="length"]')?.textContent).toBe('24.25 in');
    exportButton.click();
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ canExport: true }));

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
