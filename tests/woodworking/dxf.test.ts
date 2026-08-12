import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import {
  createShopDrawing,
  renderDrawingDxfR12,
  type DrawingDocument,
} from '../../src/woodworking';

describe('ASCII DXF R12 shop drawing renderer', () => {
  const body = createBoxBody({
    width: 24,
    depth: 12,
    height: 0.75,
    anchorMode: 'corner',
    origin: [0, 0, 0],
  }, 'panel');

  it('emits deterministic R12 entities and the required manufacturing layers', () => {
    const drawing = createShopDrawing(body, {
      title: 'Café Panel',
      views: ['top'],
      includeHiddenLines: true,
    });
    drawing.entities.push({
      type: 'line',
      id: 'grain:panel',
      layer: 'GRAIN',
      view: 'top',
      start: { x: 1, y: 1 },
      end: { x: 2, y: 1 },
      sourceIds: ['panel'],
      startArrow: false,
      endArrow: true,
    });

    const dxf = renderDrawingDxfR12(drawing);
    expect(dxf).toContain('0\r\nSECTION\r\n2\r\nHEADER\r\n');
    expect(dxf).toContain('9\r\n$ACADVER\r\n1\r\nAC1009\r\n');
    for (const layer of ['VISIBLE', 'HIDDEN', 'DIMENSION', 'ANNOTATION', 'GRAIN']) {
      expect(dxf).toContain(`2\r\n${layer}\r\n`);
    }
    expect(dxf).toContain('0\r\nLINE\r\n8\r\nGRAIN\r\n');
    expect(dxf).toContain('0\r\nTEXT\r\n');
    expect(dxf.endsWith('0\r\nEOF\r\n')).toBe(true);
    expect([...dxf].every((character) => character === '\r'
      || character === '\n'
      || (character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) <= 0x7e))).toBe(true);
    expect(dxf).toContain('Caf? Panel');
  });

  it('is independent of drawing entity insertion order', () => {
    const drawing = createShopDrawing(body, { title: 'Panel', views: ['front', 'right'] });
    const reversed: DrawingDocument = {
      ...drawing,
      entities: [...drawing.entities].reverse(),
    };
    expect(renderDrawingDxfR12(reversed)).toBe(renderDrawingDxfR12(drawing));
  });

  it('emits model-space coordinates in the selected document unit', () => {
    const drawing: DrawingDocument = {
      version: 1,
      title: 'Metric scale check',
      modelUnit: 'mm',
      coordinateUnit: 'in',
      scale: 0.5,
      page: { width: 10, height: 10 },
      views: [],
      entities: [{
        type: 'line',
        id: 'scale-line',
        layer: 'VISIBLE',
        view: null,
        start: { x: 1, y: 1 },
        end: { x: 2, y: 1 },
        sourceIds: [],
        startArrow: false,
        endArrow: false,
      }],
    };

    const dxf = renderDrawingDxfR12(drawing);
    expect(dxf).toContain('9\r\n$INSUNITS\r\n70\r\n4\r\n');
    expect(dxf).toContain('10\r\n50.8\r\n');
    expect(dxf).toContain('11\r\n101.6\r\n');
  });
});
