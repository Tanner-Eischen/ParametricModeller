import type { Body } from '../geometry/Body';
import {
  DRAWING_DOCUMENT_VERSION,
  type DrawingDocument,
  type DrawingEntity,
  type DrawingLayer,
  type DrawingLineEntity,
  type DrawingTextAnchor,
  type DrawingTextEntity,
  type DrawingViewFrame,
} from './DrawingModel';
import { formatLength, type LengthUnit } from './Measurements';
import {
  projectOrthographic,
  type OrthographicProjection,
  type OrthographicView,
  type Point2D,
} from './Orthographic';

export interface ShopDrawingOptions {
  title: string;
  unit?: LengthUnit;
  /** Drawing scale as a positive ratio, e.g. 0.5 for 1:2. */
  scale?: number;
  views?: readonly OrthographicView[];
  dimensionPrecision?: number;
  includeDimensions?: boolean;
  includeHiddenLines?: boolean;
  grainMarks?: readonly ShopDrawingGrainMark[];
  annotationMarks?: readonly ShopDrawingAnnotationMark[];
}

export interface ShopDrawingGrainMark {
  id: string;
  view: OrthographicView;
  /** Points in the selected view's projected model coordinates. */
  start: Point2D;
  end: Point2D;
  label?: string;
}

export interface ShopDrawingAnnotationMark {
  id: string;
  view: OrthographicView;
  /** Normalized position within the selected view's geometry frame. */
  position: readonly [number, number];
  label: string;
}

const MINIMUM_PAGE_WIDTH = 520 / 96;
const MARGIN = 28 / 96;
const VIEW_HEADER = 24 / 96;
const DIMENSION_SPACE = 38 / 96;
const VIEW_GAP = 36 / 96;
const TITLE_BLOCK_HEIGHT = 68 / 96;
const MINIMUM_VIEW_WIDTH = 120 / 96;
const MINIMUM_VIEW_HEIGHT = 120 / 96;

/** Build a deterministic physical-page drawing without coupling it to any renderer. */
export function createShopDrawing(
  bodies: Body | readonly Body[],
  options: ShopDrawingOptions
): DrawingDocument {
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('Drawing scale must be a finite positive number');
  }
  if (options.title.trim().length === 0) {
    throw new Error('Drawing title is required');
  }
  const unit = options.unit ?? 'in';
  if (unit !== 'in' && unit !== 'mm') {
    throw new Error(`Unsupported drawing unit: ${String(unit)}`);
  }
  const precision = options.dimensionPrecision ?? (unit === 'mm' ? 1 : 3);
  validatePrecision(precision);
  const views = options.views ?? ['front', 'top', 'right'];
  if (
    views.length === 0
    || new Set(views).size !== views.length
    || !views.every((view) => view === 'front' || view === 'top' || view === 'right')
  ) {
    throw new Error('Drawing views must be a non-empty set');
  }
  const grainMarks = options.grainMarks ?? [];
  const grainIds = new Set<string>();
  for (const mark of grainMarks) {
    if (!views.includes(mark.view)) {
      throw new Error(`Grain mark ${mark.id} references an excluded view`);
    }
    if (
      mark.id.trim().length === 0
      || !finitePoint(mark.start)
      || !finitePoint(mark.end)
      || Math.hypot(mark.end.x - mark.start.x, mark.end.y - mark.start.y) === 0
      || grainIds.has(mark.id)
    ) {
      throw new Error(`Grain mark ${mark.id} is invalid`);
    }
    grainIds.add(mark.id);
  }
  const projections = views.map((view) => projectOrthographic(bodies, view));
  const viewWidths = projections.map((projection) =>
    Math.max(MINIMUM_VIEW_WIDTH, projection.bounds.width * scale + DIMENSION_SPACE * 2)
  );
  const pageWidth = Math.max(
    MINIMUM_PAGE_WIDTH,
    MARGIN * 2
      + viewWidths.reduce((sum, width) => sum + width, 0)
      + VIEW_GAP * (projections.length - 1)
  );
  const maximumViewHeight = Math.max(
    ...projections.map((projection) =>
      projection.bounds.height * scale + VIEW_HEADER + DIMENSION_SPACE * 2
    ),
    MINIMUM_VIEW_HEIGHT
  );
  const pageHeight = MARGIN * 2 + maximumViewHeight + TITLE_BLOCK_HEIGHT;
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) {
    throw new Error('Drawing scale produces non-finite output dimensions');
  }

  const entities: DrawingEntity[] = [];
  const frames: DrawingViewFrame[] = [];
  let cursorX = MARGIN;
  projections.forEach((projection, index) => {
    const result = buildView(
      projection,
      cursorX,
      MARGIN,
      viewWidths[index]!,
      maximumViewHeight,
      scale,
      unit,
      precision,
      options.includeDimensions ?? true,
      options.includeHiddenLines ?? false,
      grainMarks.filter((mark) => mark.view === projection.view)
    );
    frames.push(result.frame);
    entities.push(...result.entities);
    cursorX += viewWidths[index]! + VIEW_GAP;
  });

  for (const mark of [...(options.annotationMarks ?? [])].sort((left, right) =>
    compareText(left.id, right.id)
  )) {
    const frame = frames.find((candidate) => candidate.view === mark.view);
    if (!frame || !Number.isFinite(mark.position[0]) || !Number.isFinite(mark.position[1])) {
      throw new Error(`Drawing annotation ${mark.id} has an invalid view or position`);
    }
    entities.push(textEntity(
      `${mark.view}:annotation:${mark.id}`,
      'DIMENSION',
      mark.view,
      {
        x: frame.geometryBounds.min.x + mark.position[0] * frame.geometryBounds.width,
        y: frame.geometryBounds.min.y + mark.position[1] * frame.geometryBounds.height,
      },
      mark.label,
      11 / 96,
      'middle'
    ));
  }

  entities.push(...buildTitleBlock(
    options.title,
    unit,
    scale,
    pageWidth,
    pageHeight
  ));

  return {
    version: DRAWING_DOCUMENT_VERSION,
    title: options.title,
    modelUnit: unit,
    coordinateUnit: 'in',
    scale,
    page: { width: pageWidth, height: pageHeight },
    views: frames,
    entities,
  };
}

function buildView(
  projection: OrthographicProjection,
  x: number,
  y: number,
  allocatedWidth: number,
  allocatedHeight: number,
  scale: number,
  unit: LengthUnit,
  precision: number,
  includeDimensions: boolean,
  includeHiddenLines: boolean,
  grainMarks: readonly ShopDrawingGrainMark[]
): { frame: DrawingViewFrame; entities: DrawingEntity[] } {
  const geometryWidth = projection.bounds.width * scale;
  const geometryHeight = projection.bounds.height * scale;
  const originX = x + (allocatedWidth - geometryWidth) / 2;
  const originY = (
    y + VIEW_HEADER
    + (allocatedHeight - VIEW_HEADER - DIMENSION_SPACE - geometryHeight) / 2
  );
  const transform = (point: Point2D): Point2D => ({
    x: originX + (point.x - projection.bounds.min.x) * scale,
    y: originY + geometryHeight - (point.y - projection.bounds.min.y) * scale,
  });
  const entities: DrawingEntity[] = [
    textEntity(
      `${projection.view}:label`,
      'ANNOTATION',
      projection.view,
      { x: x + allocatedWidth / 2, y: y + 13 / 96 },
      projection.view.toUpperCase(),
      12 / 96,
      'middle'
    ),
  ];
  projection.edges.forEach((edge, index) => {
    if (edge.visibility === 'hidden' && !includeHiddenLines) {
      return;
    }
    entities.push(lineEntity(
      `${projection.view}:edge:${String(index).padStart(4, '0')}`,
      edge.visibility === 'hidden' ? 'HIDDEN' : 'VISIBLE',
      projection.view,
      transform(edge.start),
      transform(edge.end),
      edge.sourceEdgeIds
    ));
  });
  for (const mark of [...grainMarks].sort((left, right) => compareText(left.id, right.id))) {
    entities.push({
      ...lineEntity(
        `${projection.view}:grain:${mark.id}`,
        'GRAIN',
        projection.view,
        transform(mark.start),
        transform(mark.end),
        [mark.id]
      ),
      endArrow: true,
    });
    if (mark.label?.trim()) {
      const midpoint = {
        x: (mark.start.x + mark.end.x) / 2,
        y: (mark.start.y + mark.end.y) / 2,
      };
      entities.push(textEntity(
        `${projection.view}:grain:${mark.id}:label`,
        'GRAIN',
        projection.view,
        transform(midpoint),
        mark.label.trim(),
        10 / 96,
        'middle'
      ));
    }
  }

  const bottom = originY + geometryHeight;
  const right = originX + geometryWidth;
  if (includeDimensions) {
    const dimensionY = bottom + 22 / 96;
    const dimensionX = right + 22 / 96;
    entities.push(
      lineEntity(`${projection.view}:dimension:width-extension-left`, 'DIMENSION',
        projection.view, { x: originX, y: bottom + 4 / 96 },
        { x: originX, y: dimensionY + 5 / 96 }),
      lineEntity(`${projection.view}:dimension:width-extension-right`, 'DIMENSION',
        projection.view, { x: right, y: bottom + 4 / 96 },
        { x: right, y: dimensionY + 5 / 96 }),
      {
        ...lineEntity(`${projection.view}:dimension:width`, 'DIMENSION',
          projection.view, { x: originX, y: dimensionY }, { x: right, y: dimensionY }),
        startArrow: true,
        endArrow: true,
      },
      textEntity(`${projection.view}:dimension:width-label`, 'DIMENSION',
        projection.view, { x: (originX + right) / 2, y: dimensionY - 4 / 96 },
        formatLength(projection.bounds.width, unit, precision), 11 / 96, 'middle'),
      lineEntity(`${projection.view}:dimension:height-extension-top`, 'DIMENSION',
        projection.view, { x: right + 4 / 96, y: originY },
        { x: dimensionX + 5 / 96, y: originY }),
      lineEntity(`${projection.view}:dimension:height-extension-bottom`, 'DIMENSION',
        projection.view, { x: right + 4 / 96, y: bottom },
        { x: dimensionX + 5 / 96, y: bottom }),
      {
        ...lineEntity(`${projection.view}:dimension:height`, 'DIMENSION',
          projection.view, { x: dimensionX, y: originY }, { x: dimensionX, y: bottom }),
        startArrow: true,
        endArrow: true,
      },
      {
        ...textEntity(`${projection.view}:dimension:height-label`, 'DIMENSION',
          projection.view, { x: dimensionX + 5 / 96, y: (originY + bottom) / 2 },
          formatLength(projection.bounds.height, unit, precision), 11 / 96, 'middle'),
        rotationDegrees: 90,
      }
    );
  }

  return {
    frame: {
      view: projection.view,
      origin: { x, y },
      width: allocatedWidth,
      height: allocatedHeight,
      geometryBounds: {
        min: { x: originX, y: originY },
        max: { x: right, y: bottom },
        width: geometryWidth,
        height: geometryHeight,
      },
    },
    entities,
  };
}

function buildTitleBlock(
  title: string,
  unit: LengthUnit,
  scale: number,
  pageWidth: number,
  pageHeight: number
): DrawingEntity[] {
  const x1 = MARGIN;
  const x2 = pageWidth - MARGIN;
  const y1 = pageHeight - MARGIN - TITLE_BLOCK_HEIGHT;
  const y2 = y1 + TITLE_BLOCK_HEIGHT;
  const divider = pageWidth - 250 / 96;
  return [
    lineEntity('title-block:top', 'ANNOTATION', null, { x: x1, y: y1 }, { x: x2, y: y1 }),
    lineEntity('title-block:right', 'ANNOTATION', null, { x: x2, y: y1 }, { x: x2, y: y2 }),
    lineEntity('title-block:bottom', 'ANNOTATION', null, { x: x2, y: y2 }, { x: x1, y: y2 }),
    lineEntity('title-block:left', 'ANNOTATION', null, { x: x1, y: y2 }, { x: x1, y: y1 }),
    lineEntity('title-block:divider', 'ANNOTATION', null,
      { x: divider, y: y1 }, { x: divider, y: y2 }),
    textEntity('title-block:title', 'ANNOTATION', null,
      { x: MARGIN + 12 / 96, y: y1 + 29 / 96 }, title, 18 / 96, 'start'),
    textEntity('title-block:subtitle', 'ANNOTATION', null,
      { x: MARGIN + 12 / 96, y: y1 + 51 / 96 },
      'ORTHOGRAPHIC SHOP DRAWING', 11 / 96, 'start'),
    textEntity('title-block:scale', 'ANNOTATION', null,
      { x: pageWidth - 238 / 96, y: y1 + 25 / 96 },
      `SCALE ${formatScale(scale)}`, 11 / 96, 'start'),
    textEntity('title-block:units', 'ANNOTATION', null,
      { x: pageWidth - 238 / 96, y: y1 + 49 / 96 },
      `UNITS ${unit.toUpperCase()}`, 11 / 96, 'start'),
  ];
}

function lineEntity(
  id: string,
  layer: DrawingLayer,
  view: OrthographicView | null,
  start: Point2D,
  end: Point2D,
  sourceIds: readonly string[] = []
): DrawingLineEntity {
  return {
    type: 'line',
    id,
    layer,
    view,
    start,
    end,
    sourceIds: [...sourceIds],
    startArrow: false,
    endArrow: false,
  };
}

function textEntity(
  id: string,
  layer: DrawingLayer,
  view: OrthographicView | null,
  position: Point2D,
  value: string,
  height: number,
  anchor: DrawingTextAnchor
): DrawingTextEntity {
  return {
    type: 'text',
    id,
    layer,
    view,
    position,
    value,
    height,
    rotationDegrees: 0,
    anchor,
  };
}

function formatScale(scale: number): string {
  if (scale === 1) return '1:1';
  if (scale < 1) return `1:${number(1 / scale)}`;
  return `${number(scale)}:1`;
}

function validatePrecision(precision: number): void {
  if (!Number.isInteger(precision) || precision < 0 || precision > 9) {
    throw new Error('Precision must be an integer from 0 to 9');
  }
}

function number(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function finitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
