import { describe, expect, it } from 'vitest';
import type { DrawingDocument, DrawingEntity } from '../../src/woodworking';
import {
  DRAWING_DOCUMENT_VERSION,
  sortDrawingEntities,
  validateDrawingDocument,
} from '../../src/woodworking';

const drawingDocument = (): DrawingDocument => ({
  version: DRAWING_DOCUMENT_VERSION,
  title: 'Panel detail',
  modelUnit: 'in',
  coordinateUnit: 'in',
  scale: 1,
  page: { width: 11, height: 8.5 },
  views: [{
    view: 'front',
    origin: { x: 1, y: 1 },
    width: 8,
    height: 5,
    geometryBounds: { min: { x: 0, y: 0 }, max: { x: 4, y: 2 }, width: 4, height: 2 },
  }],
  entities: [{
    type: 'line',
    id: 'outline',
    layer: 'VISIBLE',
    view: 'front',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    sourceIds: ['edge-1'],
    startArrow: false,
    endArrow: false,
  }, {
    type: 'text',
    id: 'label',
    layer: 'ANNOTATION',
    view: null,
    position: { x: 1, y: 7 },
    value: 'Panel detail',
    height: 0.125,
    rotationDegrees: 0,
    anchor: 'start',
  }],
});

describe('drawing document validation', () => {
  it('accepts a complete document', () => {
    expect(() => validateDrawingDocument(drawingDocument())).not.toThrow();
  });

  it.each([
    ['version', (document: DrawingDocument) => { document.version = 2 as 1; }, 'version'],
    ['title', (document: DrawingDocument) => { document.title = '  '; }, 'title'],
    ['scale', (document: DrawingDocument) => { document.scale = 0; }, 'scale'],
    ['page width', (document: DrawingDocument) => { document.page.width = Number.NaN; }, 'page'],
    ['view width', (document: DrawingDocument) => { document.views[0]!.width = -1; }, 'invalid dimensions'],
  ])('rejects an invalid %s', (_name, mutate, message) => {
    const document = drawingDocument();
    mutate(document);
    expect(() => validateDrawingDocument(document)).toThrow(message);
  });

  it('rejects duplicate views', () => {
    const document = drawingDocument();
    document.views.push({ ...document.views[0]!, origin: { x: 2, y: 2 } });
    expect(() => validateDrawingDocument(document)).toThrow('must be unique');
  });

  it('rejects empty and duplicate entity ids', () => {
    const empty = drawingDocument();
    empty.entities[0]!.id = ' ';
    expect(() => validateDrawingDocument(empty)).toThrow('id must be unique');

    const duplicate = drawingDocument();
    duplicate.entities[1]!.id = duplicate.entities[0]!.id;
    expect(() => validateDrawingDocument(duplicate)).toThrow('id must be unique');
  });

  it('rejects references to absent views and unsupported layers', () => {
    const absentView = drawingDocument();
    absentView.entities[0]!.view = 'top';
    expect(() => validateDrawingDocument(absentView)).toThrow('references missing view');

    const badLayer = drawingDocument();
    badLayer.entities[0]!.layer = 'MODEL' as 'VISIBLE';
    expect(() => validateDrawingDocument(badLayer)).toThrow('Unsupported drawing layer');
  });

  it('rejects non-finite line, view, and text geometry', () => {
    const badViewOrigin = drawingDocument();
    badViewOrigin.views[0]!.origin.x = Number.POSITIVE_INFINITY;
    expect(() => validateDrawingDocument(badViewOrigin)).toThrow('non-finite point');

    const badLine = drawingDocument();
    if (badLine.entities[0]?.type === 'line') badLine.entities[0].end.y = Number.NaN;
    expect(() => validateDrawingDocument(badLine)).toThrow('non-finite point');

    const badTextPosition = drawingDocument();
    if (badTextPosition.entities[1]?.type === 'text') {
      badTextPosition.entities[1].position.y = Number.NaN;
    }
    expect(() => validateDrawingDocument(badTextPosition)).toThrow('non-finite point');

    const badTextHeight = drawingDocument();
    if (badTextHeight.entities[1]?.type === 'text') badTextHeight.entities[1].height = 0;
    expect(() => validateDrawingDocument(badTextHeight)).toThrow('invalid text geometry');

    const badTextRotation = drawingDocument();
    if (badTextRotation.entities[1]?.type === 'text') {
      badTextRotation.entities[1].rotationDegrees = Number.NaN;
    }
    expect(() => validateDrawingDocument(badTextRotation)).toThrow('invalid text geometry');
  });

  it('sorts entities deterministically without mutating the input', () => {
    const entities: DrawingEntity[] = [
      { ...drawingDocument().entities[0]!, id: 'z-line' } as DrawingEntity,
      { ...drawingDocument().entities[1]!, id: 'text' } as DrawingEntity,
      { ...drawingDocument().entities[0]!, id: 'a-line' } as DrawingEntity,
    ];
    const originalIds = entities.map((entity) => entity.id);
    expect(sortDrawingEntities(entities).map((entity) => entity.id))
      .toEqual(['text', 'a-line', 'z-line']);
    expect(entities.map((entity) => entity.id)).toEqual(originalIds);
  });
});
