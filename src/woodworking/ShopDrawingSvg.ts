import type { Body } from '../geometry/Body';
import {
  sortDrawingEntities,
  validateDrawingDocument,
  type DrawingDocument,
  type DrawingEntity,
  type DrawingLineEntity,
  type DrawingTextEntity,
} from './DrawingModel';
import { createShopDrawing, type ShopDrawingOptions } from './ShopDrawing';

export type ShopDrawingSvgOptions = ShopDrawingOptions;

const PIXELS_PER_INCH = 96;

/** Render a renderer-independent drawing document as standalone SVG 1.1 markup. */
export function renderDrawingSvg(document: DrawingDocument): string {
  validateDrawingDocument(document);
  const width = document.page.width * PIXELS_PER_INCH;
  const height = document.page.height * PIXELS_PER_INCH;
  const viewMarkup = document.views.map((frame) => {
    const entities = sortDrawingEntities(
      document.entities.filter((entity) => entity.view === frame.view)
    );
    return [
      `<g data-view="${frame.view}">`,
      ...entities.map(renderEntity),
      `</g>`,
    ].join('\n');
  });
  const pageEntities = sortDrawingEntities(
    document.entities.filter((entity) => entity.view === null)
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}">`,
    `<title>${escapeXml(document.title)}</title>`,
    `<style>text{font-family:Arial,sans-serif;font-size:11px;fill:#111;stroke:none}line.outline{fill:none;stroke:#111;stroke-width:1.4;vector-effect:non-scaling-stroke}line.hidden{fill:none;stroke:#777;stroke-width:.8;stroke-dasharray:6 4;vector-effect:non-scaling-stroke}line.dimension{fill:none;stroke:#555;stroke-width:.75}line.annotation{fill:none;stroke:#111;stroke-width:1}line.grain{fill:none;stroke:#9a5d25;stroke-width:1}text.dimension,text.annotation{fill:#111;stroke:none}text.grain{fill:#9a5d25;stroke:none}.view-label{font-size:12px;font-weight:bold;letter-spacing:1px}.drawing-title{font-size:18px;font-weight:bold}</style>`,
    `<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M6,0 L0,3 L6,6 z" fill="#555"/></marker><marker id="arrow-end" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#555"/></marker></defs>`,
    ...viewMarkup,
    ...pageEntities.map(renderEntity),
    `</svg>`,
  ].join('\n');
}

/** Compatibility wrapper retained for the existing UI and callers. */
export function renderShopDrawingSvg(
  bodies: Body | readonly Body[],
  options: ShopDrawingSvgOptions
): string {
  return renderDrawingSvg(createShopDrawing(bodies, options));
}

function renderEntity(entity: DrawingEntity): string {
  return entity.type === 'line' ? renderLine(entity) : renderText(entity);
}

function renderLine(entity: DrawingLineEntity): string {
  const markerStart = entity.startArrow ? ` marker-start="url(#arrow)"` : '';
  const markerEnd = entity.endArrow ? ` marker-end="url(#arrow-end)"` : '';
  return (
    `<line id="${escapeXml(entity.id)}" class="${layerClass(entity)}"`
    + ` x1="${number(entity.start.x * PIXELS_PER_INCH)}"`
    + ` y1="${number(entity.start.y * PIXELS_PER_INCH)}"`
    + ` x2="${number(entity.end.x * PIXELS_PER_INCH)}"`
    + ` y2="${number(entity.end.y * PIXELS_PER_INCH)}"`
    + `${markerStart}${markerEnd}/>`
  );
}

function renderText(entity: DrawingTextEntity): string {
  const x = entity.position.x * PIXELS_PER_INCH;
  const y = entity.position.y * PIXELS_PER_INCH;
  const rotation = entity.rotationDegrees === 0
    ? ''
    : ` transform="rotate(${number(entity.rotationDegrees)} ${number(x)} ${number(y)})"`;
  const extraClass = entity.id.endsWith(':label')
    ? ' view-label'
    : entity.id === 'title-block:title'
      ? ' drawing-title'
      : '';
  return (
    `<text id="${escapeXml(entity.id)}" class="${layerClass(entity)}${extraClass}"`
    + ` x="${number(x)}" y="${number(y)}"`
    + ` font-size="${number(entity.height * PIXELS_PER_INCH)}px"`
    + ` text-anchor="${entity.anchor}"${rotation}>${escapeXml(entity.value)}</text>`
  );
}

function layerClass(entity: DrawingEntity): string {
  switch (entity.layer) {
    case 'VISIBLE': return 'outline';
    case 'HIDDEN': return 'hidden';
    case 'DIMENSION': return 'dimension';
    case 'ANNOTATION': return 'annotation';
    case 'GRAIN': return 'grain';
  }
}

function number(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function escapeXml(value: string): string {
  const xmlSafe = [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)
      ? '\uFFFD'
      : character;
  }).join('');
  return xmlSafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
