// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Box3, BufferGeometry, Matrix4, Mesh, Vector3 } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { strFromU8, unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { transformVertexPositions, type Body } from '../../src/geometry';
import { exportBodiesToSTL, exportBodyToSTL, exportToMF3, exportToSTEP } from '../../src/export';
import { box, exportCases, throughHole } from './fixtures';

const scale = 25.4;
function signedVolume(geometry: BufferGeometry): number {
  const positions = geometry.getAttribute('position');
  const indices = geometry.getIndex();
  const count = indices?.count ?? positions.count;
  let volume = 0;
  for (let i = 0; i < count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((offset) => new Vector3().fromBufferAttribute(positions, indices?.getX(i + offset) ?? i + offset));
    volume += a!.dot(b!.cross(c!)) / 6;
  }
  return volume;
}
function expectBounds(geometry: BufferGeometry, bodies: Body[]): void {
  geometry.computeBoundingBox();
  const expected = new Box3().setFromPoints(bodies.flatMap((body) => [...body.vertices.values()].map(
    (vertex) => new Vector3(...vertex.position).multiplyScalar(scale)
  )));
  expect(geometry.boundingBox!.min.distanceTo(expected.min)).toBeLessThan(0.0001);
  expect(geometry.boundingBox!.max.distanceTo(expected.max)).toBeLessThan(0.0001);
}

describe('manufacturing export reader round trips', () => {
  for (const item of exportCases) {
    it(`reads STL ${item.name} with preserved bounds, volume and outward winding in mm`, () => {
      const body = item.build();
      const text = exportBodyToSTL(body);
      const geometry = new STLLoader().parse(text);
      expectBounds(geometry, [body]);
      expect(signedVolume(geometry) / scale ** 3).toBeCloseTo(item.volume, 5);
      for (const match of text.matchAll(/outer loop([\s\S]*?)endloop/g)) {
        expect(match[1]!.match(/vertex /g)).toHaveLength(3);
      }
      geometry.dispose();
    });
    it(`reads 3MF ${item.name} as a packaged millimeter solid`, () => {
      const body = item.build();
      const archive = exportToMF3([body], { name: 'A & <B> "board"' });
      const files = unzipSync(archive);
      expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
      const xml = new DOMParser().parseFromString(strFromU8(files['3D/3dmodel.model']!), 'application/xml');
      expect(xml.querySelector('parsererror')).toBeNull();
      expect(xml.documentElement.getAttribute('unit')).toBe('millimeter');
      expect(xml.querySelector('metadata')!.textContent).toBe('A & <B> "board"');
      expect(xml.querySelector('resources > object > mesh > vertices > vertex')).not.toBeNull();
      const group = new ThreeMFLoader().parse(archive.slice().buffer as ArrayBuffer);
      const meshes: Mesh[] = [];
      group.traverse((node) => { if (node instanceof Mesh) meshes.push(node); });
      expect(meshes).toHaveLength(1);
      const geometry = meshes[0]!.geometry;
      expectBounds(geometry, [body]);
      expect(signedVolume(geometry) / scale ** 3).toBeCloseTo(item.volume, 5);
      geometry.dispose();
    });
  }

  it('preserves multiple bodies in STL and separate 3MF build items', () => {
    const bodies = [box(), transformVertexPositions(box(), new Matrix4().makeTranslation(8, 0, 0), 'other')];
    const geometry = new STLLoader().parse(exportBodiesToSTL(bodies));
    expectBounds(geometry, bodies);
    expect(signedVolume(geometry) / scale ** 3).toBeCloseTo(12, 5);
    const archive = exportToMF3(bodies);
    const group = new ThreeMFLoader().parse(archive.slice().buffer as ArrayBuffer);
    const volumes: number[] = [];
    group.traverse((node) => { if (node instanceof Mesh) volumes.push(signedVolume(node.geometry)); });
    expect(volumes).toHaveLength(2);
    expect(volumes.reduce((sum, volume) => sum + volume, 0) / scale ** 3).toBeCloseTo(12, 5);
    expect(exportToMF3(bodies)).toEqual(archive);
  });

  it('preserves polygon holes, separate shells, mm units and escaped metadata in STEP', () => {
    const bodies = [throughHole(), box()];
    const text = exportToSTEP(bodies, { name: "O'Brien \\ board Ω", author: "D'Angelo", organization: 'Workshop' });
    expect(text).toContain("FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'))");
    expect(text).toContain("O''Brien \\\\ board \\X2\\03A9\\X0\\");
    expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
    expect(text.match(/=FACETED_BREP\(/g)).toHaveLength(2);
    expect(text.match(/=CLOSED_SHELL\(/g)).toHaveLength(2);
    expect(text).toContain("FACE_BOUND(''");
    const records = new Map([...text.matchAll(/^#(\d+)=(.*);$/gm)].map((match) => [match[1]!, match[2]!]));
    for (const record of records.values()) {
      for (const reference of record.matchAll(/#(\d+)/g)) expect(records.has(reference[1]!)).toBe(true);
    }
    expect(text).not.toMatch(/undefined|NaN/);
  });

  for (const item of [
    { name: 'missing plane', mutate: (body: Body) => { body.planes.clear(); } },
    { name: 'missing edge', mutate: (body: Body) => { body.edges.delete(body.edges.keys().next().value!); } },
    { name: 'missing face', mutate: (body: Body) => { body.faces.delete(body.faces.keys().next().value!); } },
    { name: 'non-finite coordinate', mutate: (body: Body) => { body.vertices.values().next().value!.position[0] = NaN; } },
    { name: 'degenerate body', mutate: (body: Body) => { for (const vertex of body.vertices.values()) vertex.position = [0, 0, 0]; } },
    { name: 'orphan vertex', mutate: (body: Body) => { body.vertices.set('orphan', { id: 'orphan', position: [100, 100, 100], edgeIds: [] }); } },
  ]) {
    it(`rejects ${item.name} instead of partially exporting`, () => {
      const body = box();
      item.mutate(body);
      expect(() => exportBodyToSTL(body)).toThrow();
      expect(() => exportToMF3([body])).toThrow();
      expect(() => exportToSTEP([body])).toThrow();
    });
  }
  it('rejects empty export selections', () => {
    expect(() => exportBodiesToSTL([])).toThrow('Select at least one solid');
    expect(() => exportToMF3([])).toThrow('Select at least one solid');
    expect(() => exportToSTEP([])).toThrow('Select at least one solid');
  });
  it('accepts Unicode names but rejects XML-invalid control characters and broken surrogates', () => {
    expect(() => exportToMF3([box()], { name: '木工 🪵\n\t\r' })).not.toThrow();
    for (const name of ['bad\u0000name', 'bad\ud800name', 'bad\uffffname']) {
      expect(() => exportToMF3([box()], { name })).toThrow('valid XML characters');
    }
  });
});
