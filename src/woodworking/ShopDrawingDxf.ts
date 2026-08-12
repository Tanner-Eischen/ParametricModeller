import {
  DRAWING_LAYERS,
  sortDrawingEntities,
  validateDrawingDocument,
  type DrawingDocument,
  type DrawingLineEntity,
  type DrawingTextEntity,
} from './DrawingModel';

const CRLF = '\r\n';

/** Render a drawing document as deterministic 7-bit ASCII AutoCAD DXF R12. */
export function renderDrawingDxfR12(document: DrawingDocument): string {
  validateDrawingDocument(document);
  const pairs: Array<readonly [number, string | number]> = [];
  appendHeader(pairs, document);
  appendTables(pairs);
  pairs.push([0, 'SECTION'], [2, 'ENTITIES']);
  for (const entity of sortDrawingEntities(document.entities)) {
    if (entity.type === 'line') appendLine(pairs, document, entity);
    else appendText(pairs, document, entity);
  }
  pairs.push([0, 'ENDSEC'], [0, 'EOF']);
  return pairs.map(([code, value]) => `${code}${CRLF}${ascii(String(value))}${CRLF}`).join('');
}

function appendHeader(
  pairs: Array<readonly [number, string | number]>,
  document: DrawingDocument
): void {
  const factor = modelCoordinateFactor(document);
  pairs.push(
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$ACADVER'],
    [1, 'AC1009'],
    [9, '$LUNITS'],
    [70, 2],
    [9, '$LUPREC'],
    [70, 6],
    [9, '$INSUNITS'],
    [70, document.modelUnit === 'mm' ? 4 : 1],
    [9, '$MEASUREMENT'],
    [70, document.modelUnit === 'mm' ? 1 : 0],
    [9, '$EXTMIN'],
    [10, 0],
    [20, 0],
    [30, 0],
    [9, '$EXTMAX'],
    [10, number(document.page.width * factor)],
    [20, number(document.page.height * factor)],
    [30, 0],
    [0, 'ENDSEC']
  );
}

function appendTables(pairs: Array<readonly [number, string | number]>): void {
  pairs.push(
    [0, 'SECTION'],
    [2, 'TABLES'],
    [0, 'TABLE'],
    [2, 'LTYPE'],
    [70, 2],
    [0, 'LTYPE'],
    [2, 'CONTINUOUS'],
    [70, 0],
    [3, 'Solid line'],
    [72, 65],
    [73, 0],
    [40, 0],
    [0, 'LTYPE'],
    [2, 'HIDDEN'],
    [70, 0],
    [3, 'Hidden line'],
    [72, 65],
    [73, 2],
    [40, 0.125],
    [49, 0.075],
    [49, -0.05],
    [0, 'ENDTAB'],
    [0, 'TABLE'],
    [2, 'LAYER'],
    [70, DRAWING_LAYERS.length]
  );
  const colors: Record<(typeof DRAWING_LAYERS)[number], number> = {
    VISIBLE: 7,
    HIDDEN: 8,
    DIMENSION: 3,
    ANNOTATION: 7,
    GRAIN: 30,
  };
  for (const layer of DRAWING_LAYERS) {
    pairs.push(
      [0, 'LAYER'],
      [2, layer],
      [70, 0],
      [62, colors[layer]],
      [6, layer === 'HIDDEN' ? 'HIDDEN' : 'CONTINUOUS']
    );
  }
  pairs.push([0, 'ENDTAB'], [0, 'ENDSEC']);
}

function appendLine(
  pairs: Array<readonly [number, string | number]>,
  document: DrawingDocument,
  entity: DrawingLineEntity
): void {
  const factor = modelCoordinateFactor(document);
  const startY = (document.page.height - entity.start.y) * factor;
  const endY = (document.page.height - entity.end.y) * factor;
  pairs.push(
    [0, 'LINE'],
    [8, entity.layer],
    [10, number(entity.start.x * factor)],
    [20, number(startY)],
    [30, 0],
    [11, number(entity.end.x * factor)],
    [21, number(endY)],
    [31, 0]
  );
  if (entity.startArrow) {
    appendArrowhead(pairs, document, entity, 'start');
  }
  if (entity.endArrow) {
    appendArrowhead(pairs, document, entity, 'end');
  }
}

function appendText(
  pairs: Array<readonly [number, string | number]>,
  document: DrawingDocument,
  entity: DrawingTextEntity
): void {
  const factor = modelCoordinateFactor(document);
  const x = entity.position.x * factor;
  const y = (document.page.height - entity.position.y) * factor;
  const horizontalAlignment = entity.anchor === 'middle'
    ? 1
    : entity.anchor === 'end'
      ? 2
      : 0;
  pairs.push(
    [0, 'TEXT'],
    [8, entity.layer],
    [10, number(x)],
    [20, number(y)],
    [30, 0],
    [40, number(entity.height * factor)],
    [1, entity.value],
    [50, number(-entity.rotationDegrees)],
    [72, horizontalAlignment]
  );
  if (horizontalAlignment !== 0) {
    pairs.push(
      [11, number(x)],
      [21, number(y)],
      [31, 0]
    );
  }
}

function number(value: number): string {
  const rounded = Number(value.toFixed(6));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function appendArrowhead(
  pairs: Array<readonly [number, string | number]>,
  document: DrawingDocument,
  entity: DrawingLineEntity,
  endpoint: 'start' | 'end'
): void {
  const factor = modelCoordinateFactor(document);
  const tip = endpoint === 'start' ? entity.start : entity.end;
  const other = endpoint === 'start' ? entity.end : entity.start;
  const dx = other.x - tip.x;
  const dy = other.y - tip.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const size = Math.min(0.06, length / 4);
  const wing = size * 0.45;
  const base = {
    x: tip.x + ux * size,
    y: tip.y + uy * size,
  };
  const perpendicular = { x: -uy * wing, y: ux * wing };
  for (const sign of [-1, 1] as const) {
    const end = {
      x: base.x + perpendicular.x * sign,
      y: base.y + perpendicular.y * sign,
    };
    pairs.push(
      [0, 'LINE'],
      [8, entity.layer],
      [10, number(tip.x * factor)],
      [20, number((document.page.height - tip.y) * factor)],
      [30, 0],
      [11, number(end.x * factor)],
      [21, number((document.page.height - end.y) * factor)],
      [31, 0]
    );
  }
}

/**
 * Drawing entities are stored in paper inches. DXF entities are emitted in
 * model-space document units so a measured/printed 1:1 entity is physically
 * accurate and importing metric drawings does not reinterpret inches as mm.
 */
function modelCoordinateFactor(document: DrawingDocument): number {
  return (document.modelUnit === 'mm' ? 25.4 : 1) / document.scale;
}

function ascii(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?');
}
