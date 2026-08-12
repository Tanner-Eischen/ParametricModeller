import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import type { Body } from '../geometry/Body';
import {
  sortDrawingEntities,
  validateDrawingDocument,
  type DrawingDocument,
  type DrawingLayer,
  type DrawingLineEntity,
  type DrawingTextEntity,
} from './DrawingModel';
import { createShopDrawing, type ShopDrawingOptions } from './ShopDrawing';

export const PDF_POINTS_PER_INCH = 72;

export type PdfLibModule = typeof import('pdf-lib');
export type PdfLibLoader = () => Promise<PdfLibModule>;

export interface DrawingPdfRenderOptions {
  /**
   * Optional deterministic metadata date. Timestamps are omitted when absent.
   */
  metadataDate?: Date;
  /** Dependency injection seam for tests and hosts that load pdf-lib themselves. */
  pdfLibLoader?: PdfLibLoader;
}

export class PdfLibraryLoadError extends Error {
  constructor(cause: unknown) {
    super('Unable to load the PDF renderer.', { cause });
    this.name = 'PdfLibraryLoadError';
  }
}

interface PdfLayerStyle {
  color: RGB;
  thickness: number;
  dashArray?: number[];
}

/** Render a physical-inch drawing document to deterministic PDF bytes. */
export async function renderDrawingPdf(
  drawing: DrawingDocument,
  options: DrawingPdfRenderOptions = {}
): Promise<Uint8Array> {
  validateDrawingDocument(drawing);
  const pdfLib = await loadPdfLib(options.pdfLibLoader);
  const pdf = await pdfLib.PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(toPdfText(drawing.title));
  pdf.setCreator('Parametric Solid Modeler');
  pdf.setProducer('Parametric Solid Modeler');
  if (options.metadataDate !== undefined) {
    if (Number.isNaN(options.metadataDate.getTime())) {
      throw new Error('PDF metadataDate must be a valid date.');
    }
    pdf.setCreationDate(options.metadataDate);
    pdf.setModificationDate(options.metadataDate);
  }

  const pageWidth = drawing.page.width * PDF_POINTS_PER_INCH;
  const pageHeight = drawing.page.height * PDF_POINTS_PER_INCH;
  const page = pdf.addPage([pageWidth, pageHeight]);
  const font = await pdf.embedFont(pdfLib.StandardFonts.Helvetica);

  for (const entity of sortDrawingEntities(drawing.entities)) {
    if (entity.type === 'line') {
      drawLineEntity(pdfLib, page, pageHeight, entity);
    } else {
      drawTextEntity(pdfLib, page, pageHeight, font, entity);
    }
  }

  return pdf.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

/** Build the shared drawing model and render it as a PDF. */
export async function renderShopDrawingPdf(
  bodies: Body | readonly Body[],
  drawingOptions: ShopDrawingOptions,
  renderOptions: DrawingPdfRenderOptions = {}
): Promise<Uint8Array> {
  return renderDrawingPdf(createShopDrawing(bodies, drawingOptions), renderOptions);
}

async function loadPdfLib(loader: PdfLibLoader | undefined): Promise<PdfLibModule> {
  try {
    return await (loader ?? (() => import('pdf-lib')))();
  } catch (error) {
    throw new PdfLibraryLoadError(error);
  }
}

function drawLineEntity(
  pdfLib: PdfLibModule,
  page: PDFPage,
  pageHeight: number,
  entity: DrawingLineEntity
): void {
  const style = layerStyle(pdfLib, entity.layer);
  const start = toPdfPoint(entity.start, pageHeight);
  const end = toPdfPoint(entity.end, pageHeight);
  page.drawLine({
    start,
    end,
    thickness: style.thickness,
    color: style.color,
    ...(style.dashArray ? { dashArray: style.dashArray } : {}),
  });
  if (entity.startArrow) {
    drawArrowhead(page, style, start, end);
  }
  if (entity.endArrow) {
    drawArrowhead(page, style, end, start);
  }
}

function drawArrowhead(
  page: PDFPage,
  style: PdfLayerStyle,
  tip: { x: number; y: number },
  other: { x: number; y: number }
): void {
  const dx = other.x - tip.x;
  const dy = other.y - tip.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const size = Math.min(4.32, length / 4);
  const wing = size * 0.45;
  const base = {
    x: tip.x + ux * size,
    y: tip.y + uy * size,
  };
  const perpendicular = { x: -uy * wing, y: ux * wing };
  for (const sign of [-1, 1] as const) {
    page.drawLine({
      start: tip,
      end: {
        x: base.x + perpendicular.x * sign,
        y: base.y + perpendicular.y * sign,
      },
      thickness: style.thickness,
      color: style.color,
    });
  }
}

function drawTextEntity(
  pdfLib: PdfLibModule,
  page: PDFPage,
  pageHeight: number,
  font: PDFFont,
  entity: DrawingTextEntity
): void {
  const value = toPdfText(entity.value);
  const size = entity.height * PDF_POINTS_PER_INCH;
  const point = toPdfPoint(entity.position, pageHeight);
  const width = font.widthOfTextAtSize(value, size);
  const x = entity.anchor === 'middle'
    ? point.x - width / 2
    : entity.anchor === 'end'
      ? point.x - width
      : point.x;
  const style = layerStyle(pdfLib, entity.layer);
  page.drawText(value, {
    x,
    y: point.y,
    size,
    font,
    color: style.color,
    rotate: pdfLib.degrees(-entity.rotationDegrees),
  });
}

function toPdfPoint(
  point: { x: number; y: number },
  pageHeight: number
): { x: number; y: number } {
  return {
    x: point.x * PDF_POINTS_PER_INCH,
    y: pageHeight - point.y * PDF_POINTS_PER_INCH,
  };
}

function layerStyle(pdfLib: PdfLibModule, layer: DrawingLayer): PdfLayerStyle {
  switch (layer) {
    case 'VISIBLE':
      return { color: pdfLib.rgb(0.07, 0.07, 0.07), thickness: 1.05 };
    case 'HIDDEN':
      return {
        color: pdfLib.rgb(0.45, 0.45, 0.45),
        thickness: 0.6,
        dashArray: [4.5, 3],
      };
    case 'DIMENSION':
      return { color: pdfLib.rgb(0.32, 0.32, 0.32), thickness: 0.55 };
    case 'ANNOTATION':
      return { color: pdfLib.rgb(0.07, 0.07, 0.07), thickness: 0.75 };
    case 'GRAIN':
      return { color: pdfLib.rgb(0.6, 0.36, 0.15), thickness: 0.75 };
  }
}

function toPdfText(value: string): string {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e ? character : '?';
  }).join('');
}
