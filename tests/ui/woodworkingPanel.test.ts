/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WoodworkingPanel,
  createDefaultWoodworkingMetadata,
} from '../../src/ui/WoodworkingPanel';

describe('WoodworkingPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows exact selected-body measurements and enables exports', () => {
    const container = document.createElement('div');
    const panel = new WoodworkingPanel({
      container,
      onMetadataChange: vi.fn(),
      onExportCutList: vi.fn(),
      onExportDrawing: vi.fn(),
      onExportDrawingPdf: vi.fn(),
      onExportDrawingDxf: vi.fn(),
    });
    panel.refresh({
      bodyId: 'body-1',
      bodyName: 'Side panel',
      metadata: createDefaultWoodworkingMetadata(),
      measurement: { length: '30', width: '12', thickness: '0.75', units: 'in' },
      canExport: true,
    });

    expect(container.textContent).toContain('Measure: Side panel');
    expect(container.textContent).toContain('30 in');
    expect(container.textContent).toContain('0.75 in');
    expect(container.querySelectorAll('button:disabled')).toHaveLength(0);
  });

  it('emits a complete serializable board metadata update', () => {
    const container = document.createElement('div');
    const onMetadataChange = vi.fn();
    const panel = new WoodworkingPanel({
      container,
      onMetadataChange,
      onExportCutList: vi.fn(),
      onExportDrawing: vi.fn(),
      onExportDrawingPdf: vi.fn(),
      onExportDrawingDxf: vi.fn(),
    });
    panel.refresh({
      bodyId: 'body-1',
      bodyName: 'Rail',
      metadata: createDefaultWoodworkingMetadata(),
      measurement: { length: '20', width: '2', thickness: '0.75', units: 'in' },
      canExport: true,
    });

    const material = container.querySelector<HTMLInputElement>('input[placeholder="e.g. White oak"]');
    if (!material) throw new Error('Expected material field');
    material.value = 'Cherry';
    const include = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!include) throw new Error('Expected cut-list checkbox');
    include.checked = true;
    material.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onMetadataChange).toHaveBeenCalledWith('body-1', expect.objectContaining({
      material: 'Cherry',
      thicknessAxis: 'z',
      grainAxis: 'x',
      isBoard: true,
    }));
  });

  it('keeps metadata and exports disabled without a selected body', () => {
    const container = document.createElement('div');
    new WoodworkingPanel({
      container,
      onMetadataChange: vi.fn(),
      onExportCutList: vi.fn(),
      onExportDrawing: vi.fn(),
      onExportDrawingPdf: vi.fn(),
      onExportDrawingDxf: vi.fn(),
    });

    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(container.querySelectorAll('button:disabled')).toHaveLength(4);
  });
});
