import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import { createWorldConstructionPlane } from '../../src/geometry/ConstructionPlane';
import { performCut } from '../../src/geometry/CutBuilder';
import { combineBodies, translateBody } from '../../src/geometry/TransformUtils';
import type { Body } from '../../src/geometry/Body';
import type { Profile2D } from '../../src/sketch/SketchTypes';

function topologySnapshot(body: Body): string {
  return JSON.stringify({
    vertices: [...body.vertices.keys()].sort(),
    edges: [...body.edges.keys()].sort(),
    faces: [...body.faces.keys()].sort(),
    planes: [...body.planes.keys()].sort(),
  });
}

describe('rebuild topology determinism', () => {
  it('allocates identical topology for ten transformed copies', () => {
    const source = createBoxBody({
      width: 2,
      depth: 2,
      height: 2,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'source');
    const runs = Array.from({ length: 10 }, () =>
      topologySnapshot(translateBody(source, [3, 0, 0], 'copy'))
    );
    expect(new Set(runs).size).toBe(1);
  });

  it('allocates identical topology for ten body joins', () => {
    const left = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [0, 0, 0],
    }, 'left');
    const right = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [1, 0, 0],
    }, 'right');
    const runs = Array.from({ length: 10 }, () =>
      topologySnapshot(combineBodies([left, right], 'joined'))
    );
    expect(new Set(runs).size).toBe(1);
  });

  it('allocates identical topology for ten identical cuts', () => {
    const profile: Profile2D = {
      id: 'profile',
      sketchId: 'sketch',
      loop: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]],
      entityIds: ['rectangle'],
      isValid: true,
    };
    const runs = Array.from({ length: 10 }, () => {
      const body = createBoxBody({
        width: 1,
        depth: 1,
        height: 1,
        anchorMode: 'corner',
        origin: [0, 0, 0],
      }, 'cut-target');
      return topologySnapshot(performCut(
        body,
        createWorldConstructionPlane('xy'),
        profile,
        0.5,
        false,
        'cut-feature'
      )!);
    });
    expect(new Set(runs).size).toBe(1);
  });
});
