/** CLI: npx tsx tests/export/generateStepFixtures.mjs <output-directory> */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Box3, Matrix4, Vector3 } from 'three';
import { transformVertexPositions } from '../../src/geometry';
import { exportToSTEP } from '../../src/export';
import { box, exportCases } from './fixtures';

const output = process.argv[2];
if (!output) throw new Error('Supply an output directory for STEP reader fixtures');
mkdirSync(output, { recursive: true });
const cases = exportCases.map((item) => ({ name: item.name, bodies: [item.build()], volume: item.volume }));
cases.push({ name: 'multiple solids', bodies: [box(), transformVertexPositions(box(), new Matrix4().makeTranslation(8, 0, 0), 'other')], volume: 12 });
const manifest = cases.map((item) => {
  const filename = `${item.name.replaceAll(' ', '-')}.step`;
  writeFileSync(resolve(output, filename), exportToSTEP(item.bodies, { name: "O'Brien Ω" }));
  const bounds = new Box3().setFromPoints(item.bodies.flatMap((body) => [...body.vertices.values()].map((vertex) => new Vector3(...vertex.position).multiplyScalar(25.4))));
  return { filename, volume: item.volume * 25.4 ** 3, solids: item.bodies.length, bounds: [...bounds.min.toArray(), ...bounds.max.toArray()] };
});
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${cases.length} STEP fixtures to ${resolve(output)}`);
