import type { LengthUnit } from './Measurements';
import type { OrthographicView, Point2D } from './Orthographic';

export const DRAWING_DOCUMENT_VERSION = 1 as const;

export const DRAWING_LAYERS = [
  'VISIBLE',
  'HIDDEN',
  'DIMENSION',
  'ANNOTATION',
  'GRAIN',
] as const;

export type DrawingLayer = typeof DRAWING_LAYERS[number];
export type DrawingTextAnchor = 'start' | 'middle' | 'end';

export interface DrawingLineEntity {
  type: 'line';
  id: string;
  layer: DrawingLayer;
  view: OrthographicView | null;
  start: Point2D;
  end: Point2D;
  sourceIds: string[];
  startArrow: boolean;
  endArrow: boolean;
}

export interface DrawingTextEntity {
  type: 'text';
  id: string;
  layer: DrawingLayer;
  view: OrthographicView | null;
  position: Point2D;
  value: string;
  height: number;
  rotationDegrees: number;
  anchor: DrawingTextAnchor;
}

export type DrawingEntity = DrawingLineEntity | DrawingTextEntity;

export interface DrawingViewFrame {
  view: OrthographicView;
  origin: Point2D;
  width: number;
  height: number;
  geometryBounds: {
    min: Point2D;
    max: Point2D;
    width: number;
    height: number;
  };
}

/**
 * Renderer-independent physical page model. Coordinates and text heights are in
 * paper inches; scale records the model-to-paper ratio used by the builder.
 */
export interface DrawingDocument {
  version: typeof DRAWING_DOCUMENT_VERSION;
  title: string;
  modelUnit: LengthUnit;
  coordinateUnit: 'in';
  scale: number;
  page: {
    width: number;
    height: number;
  };
  views: DrawingViewFrame[];
  entities: DrawingEntity[];
}

export function validateDrawingDocument(document: DrawingDocument): void {
  if (document.version !== DRAWING_DOCUMENT_VERSION) {
    throw new Error(`Unsupported drawing document version: ${String(document.version)}`);
  }
  if (document.title.trim().length === 0) {
    throw new Error('Drawing title is required');
  }
  if (!finitePositive(document.scale)) {
    throw new Error('Drawing scale must be a finite positive number');
  }
  if (!finitePositive(document.page.width) || !finitePositive(document.page.height)) {
    throw new Error('Drawing page dimensions must be finite positive numbers');
  }
  const ids = new Set<string>();
  const viewNames = new Set<OrthographicView>();
  for (const frame of document.views) {
    if (viewNames.has(frame.view)) {
      throw new Error(`Drawing view must be unique: ${frame.view}`);
    }
    viewNames.add(frame.view);
    assertPoint(frame.origin, `${frame.view} view`);
    if (!finitePositive(frame.width) || !finitePositive(frame.height)) {
      throw new Error(`Drawing view ${frame.view} has invalid dimensions`);
    }
  }
  for (const entity of document.entities) {
    if (entity.id.trim().length === 0 || ids.has(entity.id)) {
      throw new Error(`Drawing entity id must be unique: ${entity.id}`);
    }
    ids.add(entity.id);
    if (entity.view !== null && !viewNames.has(entity.view)) {
      throw new Error(`Drawing entity ${entity.id} references missing view ${entity.view}`);
    }
    if (!DRAWING_LAYERS.includes(entity.layer)) {
      throw new Error(`Unsupported drawing layer: ${String(entity.layer)}`);
    }
    if (entity.type === 'line') {
      assertPoint(entity.start, entity.id);
      assertPoint(entity.end, entity.id);
    } else {
      assertPoint(entity.position, entity.id);
      if (!finitePositive(entity.height) || !Number.isFinite(entity.rotationDegrees)) {
        throw new Error(`Drawing text ${entity.id} has invalid text geometry`);
      }
    }
  }
}

export function sortDrawingEntities(
  entities: readonly DrawingEntity[]
): DrawingEntity[] {
  return [...entities].sort((left, right) => (
    compareText(left.layer, right.layer)
    || compareText(left.type, right.type)
    || compareText(left.id, right.id)
  ));
}

function assertPoint(point: Point2D, entityId: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`Drawing entity ${entityId} has a non-finite point`);
  }
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
