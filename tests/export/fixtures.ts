import { Matrix4 } from 'three';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import { buildPrism } from '../../src/features/extrude/PrismBuilder';
import { createWorldConstructionPlane, executePlanarBoolean, transformVertexPositions, type Body } from '../../src/geometry';

export const box = () => createBoxBody({ width: 2, depth: 3, height: 1, anchorMode: 'corner', origin: [0, 0, 0] }, 'box');
export function concave(): Body {
  return buildPrism({
    plane: createWorldConstructionPlane('xy'), distance: 2, flip: false,
    profile: { id: 'l', sketchId: 'sketch', entityIds: [], isValid: true, loop: [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]] },
  }, 'concave');
}
export function throughHole(): Body {
  const target = createBoxBody({ width: 4, depth: 4, height: 2, anchorMode: 'corner', origin: [0, 0, 0] }, 'through');
  const tool = createBoxBody({ width: 2, depth: 2, height: 4, anchorMode: 'corner', origin: [1, 1, -1] }, 'tool');
  const result = executePlanarBoolean({ target, tools: [tool], operation: 'difference', operationId: 'through-cut' });
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
  return result.bodies[0]!;
}
export const exportCases = [
  { name: 'box', build: box, volume: 6 },
  { name: 'concave prism', build: concave, volume: 10 },
  { name: 'through hole', build: throughHole, volume: 24 },
  { name: 'rotated solid', build: () => transformVertexPositions(box(), new Matrix4().makeRotationZ(Math.PI / 5), 'rotated'), volume: 6 },
];
