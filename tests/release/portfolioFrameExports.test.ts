import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createFrameExportArtifacts,
  pdfDrawingText,
} from '../../scripts/export-portfolio-frame';
import {
  createPortfolioFrameDocument,
  editPortfolioFrameLength,
} from '../../src/examples/portfolioFrame';
import type { DrawingDocument } from '../../src/woodworking/DrawingModel';

type Artifacts = Awaited<ReturnType<typeof createFrameExportArtifacts>>;

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if (character === '\n' && !quoted) {
      row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '';
    } else value += character;
  }
  expect(quoted).toBe(false);
  expect(value).toBe('');
  return rows;
}

function dxfEntities(text: string) {
  const lines = text.trimEnd().split(/\r?\n/);
  const entities: Array<{ type: string; fields: Map<number, string> }> = [];
  let current = { type: '', fields: new Map<number, string>() };
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]), value = lines[i + 1]!;
    if (code === 0) { current = { type: value, fields: new Map() }; entities.push(current); }
    else current.fields.set(code, value);
  }
  return entities;
}

describe('real portfolio frame manufacturing exports', () => {
  const examples = new Map<number, Artifacts>();
  beforeAll(async () => {
    const document = createPortfolioFrameDocument(18);
    examples.set(18, await createFrameExportArtifacts(document, 18));
    examples.set(20, await createFrameExportArtifacts(editPortfolioFrameLength(document, 20), 20));
  });

  it.each([18, 20])('exports independently checked dimensions and stock for %i inch boards', length => {
    const result = examples.get(length)!;
    expect(result.evidence.observed.physical_parts).toBe(4);
    expect(result.evidence.observed.outer_inches).toEqual([length + 6, length, 0.75]);
    expect(result.evidence.observed.opening_inches).toEqual([length, length - 6]);
    expect(result.evidence.observed.volume_cubic_inches).toBeCloseTo(length === 18 ? 162 : 180, 8);
    expect(result.evidence.observed.individual_surface_square_inches).toBeCloseTo(length === 18 ? 558 : 618, 8);
    expect(result.evidence.observed.cut_list.rows).toHaveLength(1);
    expect(result.evidence.observed.cut_list.rows[0]!.quantity).toBe(4);
    for (const [file, factor, unit] of [['cut-list.csv', 1, 'in'], ['cut-list-mm.csv', 25.4, 'mm']] as const) {
      const rows = csvRows(result.files.get(file) as string);
      expect(rows).toHaveLength(2);
      const row = Object.fromEntries(rows[0]!.map((header, index) => [header, rows[1]![index]]));
      expect(row.Quantity).toBe('4');
      expect(row.Material).toBe('White oak');
      expect(row.Unit).toBe(unit);
      expect(Number(row['Board feet'])).toBe(Number(((length + 0.5) * 3.25 * 0.875 * 4 / 144).toFixed(3)));
      for (const [header, expected] of Object.entries({
        'Finished length': length * factor, 'Finished width': 3 * factor,
        'Finished thickness': 0.75 * factor, 'Stock length': (length + 0.5) * factor,
        'Stock width': 3.25 * factor, 'Stock thickness': 0.875 * factor,
      })) expect(Number(row[header])).toBeCloseTo(expected, 8);
    }
    const saved = JSON.parse(result.files.get('frame.json') as string);
    expect(saved.features).toHaveLength(1);
    expect(saved.features[0].parameters.width).toBe(length);
    expect(saved.componentInstances).toHaveLength(4);
    expect(result.evidence.persistence.reopened_geometry_and_ids_match).toBe(true);
  });

  it.each([18, 20])('exports actual SVG/PDF/DXF values with physical units for %i inches', async length => {
    const result = examples.get(length)!;
    for (const unit of ['in', 'mm'] as const) {
      const drawing = JSON.parse(result.files.get(`drawing-${unit}.json`) as string) as DrawingDocument;
      expect(drawing.entities.filter(entity => entity.layer === 'GRAIN' && entity.type === 'line')).toHaveLength(4);
      const svg = result.files.get(`drawing-${unit}.svg`) as string;
      const dxf = result.files.get(`drawing-${unit}.dxf`) as string;
      const pdf = result.files.get(`drawing-${unit}.pdf`) as Uint8Array;
      const parsed = await PDFDocument.load(pdf, { updateMetadata: false });
      expect(parsed.getPageCount()).toBe(1);
      expect(parsed.getPage(0).getWidth()).toBeCloseTo(drawing.page.width * 72, 8);
      expect(parsed.getPage(0).getHeight()).toBeCloseTo(drawing.page.height * 72, 8);
      expect(parsed.getCreationDate()?.toISOString()).toBe('2026-10-26T00:00:00.000Z');
      const factor = unit === 'mm' ? 25.4 : 1;
      const label = `${Number(((length + 6) * factor).toFixed(3))} ${unit}`;
      expect(await pdfDrawingText(pdf)).toContain(label);
      expect(svg).toContain(`>${label}</text>`);
      const svgPage = /width="([\d.]+)" height="([\d.]+)"/.exec(svg)!;
      expect(Number(svgPage[1])).toBeCloseTo(drawing.page.width * 96, 5);
      expect(Number(svgPage[2])).toBeCloseTo(drawing.page.height * 96, 5);
      expect(dxf).toContain(`9\r\n$INSUNITS\r\n70\r\n${unit === 'mm' ? 4 : 1}\r\n`);
      const entities = dxfEntities(dxf);
      expect(entities.some(entity => entity.type === 'TEXT' && entity.fields.get(1) === label)).toBe(true);
      const dimensionLengths = entities.filter(entity => entity.type === 'LINE' && entity.fields.get(8) === 'DIMENSION')
        .map(entity => Math.hypot(Number(entity.fields.get(11)) - Number(entity.fields.get(10)),
          Number(entity.fields.get(21)) - Number(entity.fields.get(20))));
      expect(dimensionLengths.some(value => Math.abs(value - (length + 6) * factor) < 1e-5)).toBe(true);
      const finished = unit === 'mm' ? `${length === 18 ? 457.2 : 508} x 76.2 x 19.05 mm` : `${length} x 3 x 0.75 in`;
      expect(await pdfDrawingText(pdf)).toContain(finished);
      expect(svg).toContain(finished);
    }
  });

  it('produces byte-identical exports on an unchanged deterministic sample', async () => {
    const repeated = await createFrameExportArtifacts(createPortfolioFrameDocument(18), 18);
    for (const [name, bytes] of examples.get(18)!.files) expect(repeated.files.get(name)).toEqual(bytes);
  });

  it('rejects corrupted history before any manufacturing export is produced', async () => {
    const document = createPortfolioFrameDocument(18);
    document.features[0]!.parameters.width = Number.NaN;
    await expect(createFrameExportArtifacts(document, 18)).rejects.toThrow(/finite|length/i);
  });

  it('rejects unsupported curved feature history instead of exporting the valid prefix', async () => {
    const document = createPortfolioFrameDocument(18);
    document.features.push({ ...structuredClone(document.features[0]!), id: 'unsupported-revolve', type: 'revolve' });
    await expect(createFrameExportArtifacts(document, 18)).rejects.toThrow(/rebuild failed/i);
  });
});
