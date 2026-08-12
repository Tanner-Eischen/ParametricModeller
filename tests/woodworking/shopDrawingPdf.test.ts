import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import {
  PDF_POINTS_PER_INCH,
  PdfLibraryLoadError,
  createShopDrawing,
  renderDrawingPdf,
  renderShopDrawingPdf,
} from '../../src/woodworking';

describe('shop drawing PDF renderer', () => {
  const body = createBoxBody({
    width: 24,
    depth: 12,
    height: 0.75,
    anchorMode: 'corner',
    origin: [0, 0, 0],
  }, 'panel');

  it('renders a parsed physical-size PDF with title and drawing content', async () => {
    const drawing = createShopDrawing(body, {
      title: 'Panel drawing',
      views: ['top'],
      includeHiddenLines: true,
    });
    const bytes = await renderDrawingPdf(drawing);

    expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain('%PDF-');
    const parsed = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe('Panel drawing');
    expect(parsed.getCreationDate()).toBeUndefined();
    expect(parsed.getModificationDate()).toBeUndefined();
    const page = parsed.getPage(0);
    expect(page.getWidth()).toBeCloseTo(
      drawing.page.width * PDF_POINTS_PER_INCH,
      8
    );
    expect(page.getHeight()).toBeCloseTo(
      drawing.page.height * PDF_POINTS_PER_INCH,
      8
    );
    expect(page.node.Contents()).toBeDefined();
  });

  it('emits deterministic bytes when timestamps are omitted', async () => {
    const drawing = createShopDrawing(body, {
      title: 'Deterministic panel',
      views: ['front', 'right'],
    });
    const first = await renderDrawingPdf(drawing);
    const second = await renderDrawingPdf(drawing);
    expect(second).toEqual(first);
  });

  it('supports the body-to-PDF convenience renderer and explicit metadata date', async () => {
    const metadataDate = new Date('2026-07-30T12:00:00.000Z');
    const bytes = await renderShopDrawingPdf(
      body,
      { title: 'Convenience drawing', views: ['front'] },
      { metadataDate }
    );
    const parsed = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(parsed.getCreationDate()).toEqual(metadataDate);
    expect(parsed.getModificationDate()).toEqual(metadataDate);
  });

  it('surfaces a lazy pdf-lib load failure without affecting other drawing outputs', async () => {
    const drawing = createShopDrawing(body, {
      title: 'Still available',
      views: ['top'],
    });
    await expect(renderDrawingPdf(drawing, {
      pdfLibLoader: () => Promise.reject(new Error('chunk unavailable')),
    })).rejects.toBeInstanceOf(PdfLibraryLoadError);

    expect(drawing.title).toBe('Still available');
    expect(drawing.entities.length).toBeGreaterThan(0);
  });
});

