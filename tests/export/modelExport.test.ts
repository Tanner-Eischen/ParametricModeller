import { describe, expect, it } from 'vitest';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { createModelExport, type ModelExportFormat } from '../../src/app/ModelExport';
import { box } from './fixtures';

describe('model export download preparation', () => {
  it('creates an ASCII STL file with millimeter coordinates', async () => {
    const file = await createModelExport('stl', [box()], 'Shelf');
    expect(file.filename).toBe('Shelf.stl');
    expect(file.mimeType).toBe('model/stl');
    expect(typeof file.data).toBe('string');
    const geometry = new STLLoader().parse(file.data as string);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([0, 0, 0]);
    for (const [index, size] of [50.8, 76.2, 25.4].entries()) {
      expect(geometry.boundingBox!.max.toArray()[index]).toBeCloseTo(size, 4);
    }
    expect(geometry.getAttribute('position').count).toBe(36);
    geometry.dispose();
  });

  it('creates a STEP file with explicit physical units and original name metadata', async () => {
    const file = await createModelExport('step', [box()], 'Shelf: A/B');
    expect(file.filename).toBe('Shelf_ A_B.step');
    expect(file.mimeType).toBe('model/step');
    expect(file.data).toContain("FILE_NAME('Shelf: A/B'");
    expect(file.data).toContain('SI_UNIT(.MILLI.,.METRE.)');
    expect(file.data).toContain('FACETED_BREP(');
  });

  it('creates a binary 3MF archive, not XML with a renamed extension', async () => {
    const file = await createModelExport('3mf', [box()], 'Shelf');
    expect(file.filename).toBe('Shelf.3mf');
    expect(file.mimeType).toBe('model/3mf');
    expect(file.data).toBeInstanceOf(Uint8Array);
    const bytes = file.data as Uint8Array;
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const files = unzipSync(bytes);
    expect(files['_rels/.rels']).toBeDefined();
    expect(strFromU8(files['3D/3dmodel.model']!)).toContain('unit="millimeter"');
  });

  it('sanitizes download filenames and supplies an empty-name fallback', async () => {
    const named = await createModelExport('stl', [box()], ' <Shelf>: "A"/B\\C|?*\u0000 ');
    expect(named.filename).toBe('_Shelf__ _A__B_C____.stl');
    expect((await createModelExport('3mf', [box()], '   ')).filename).toBe('Model.3mf');
  });

  for (const format of ['stl', 'step', '3mf'] as ModelExportFormat[]) {
    it(`rejects empty or incomplete ${format} output before creating a downloadable file`, async () => {
      await expect(createModelExport(format, [], 'Empty')).rejects.toThrow('Select at least one solid');
      const invalid = box();
      invalid.faces.delete(invalid.faces.keys().next().value!);
      await expect(createModelExport(format, [invalid], 'Invalid')).rejects.toThrow('Cannot export');
    });
  }
});
