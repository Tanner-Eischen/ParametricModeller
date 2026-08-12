import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import { createPrismaticBody, type Body } from '../../src/geometry';
import {
  classifyOrthographicEdge,
  createShopDrawing,
  projectOrthographic,
  renderDrawingSvg,
  renderShopDrawingSvg,
} from '../../src/woodworking';

function reversedBody(body: Body): Body {
  return {
    ...body,
    vertices: new Map([...body.vertices].reverse()),
    edges: new Map([...body.edges].reverse()),
    faces: new Map([...body.faces].reverse()),
    planes: new Map([...body.planes].reverse()),
  };
}

describe('orthographic woodworking exports', () => {
  const body = createBoxBody({
    width: 2,
    depth: 3,
    height: 4,
    anchorMode: 'corner',
    origin: [10, -2, 5],
  }, 'cabinet');

  it('projects exact conventional front, top and right dimensions', () => {
    const front = projectOrthographic(body, 'front');
    const top = projectOrthographic(body, 'top');
    const right = projectOrthographic(body, 'right');

    expect(front.bounds).toEqual({
      min: { x: 10, y: 5 }, max: { x: 12, y: 9 }, width: 2, height: 4,
    });
    expect(top.bounds).toEqual({
      min: { x: 10, y: -2 }, max: { x: 12, y: 1 }, width: 2, height: 3,
    });
    expect(right.bounds).toEqual({
      min: { x: -2, y: 5 }, max: { x: 1, y: 9 }, width: 3, height: 4,
    });
    expect(front.edges).toHaveLength(4);
    expect(top.edges).toHaveLength(4);
    expect(right.edges).toHaveLength(4);
  });

  it('is deterministic across B-Rep map insertion order', () => {
    expect(projectOrthographic(reversedBody(body), 'front'))
      .toEqual(projectOrthographic(body, 'front'));
    expect(renderShopDrawingSvg(reversedBody(body), { title: 'Cabinet' }))
      .toBe(renderShopDrawingSvg(body, { title: 'Cabinet' }));
  });

  it('renders title block, units, scale and basic annotations in a standalone SVG', () => {
    const svg = renderShopDrawingSvg(body, {
      title: 'Base & Wall <Cabinet>',
      unit: 'mm',
      scale: 0.5,
    });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>Base &amp; Wall &lt;Cabinet&gt;</title>');
    expect(svg).toContain('data-view="front"');
    expect(svg).toContain('data-view="top"');
    expect(svg).toContain('data-view="right"');
    expect(svg).toContain('SCALE 1:2');
    expect(svg).toContain('UNITS MM');
    expect(svg).toContain('50.8 mm');
    expect(svg).toContain('101.6 mm');
    expect(svg).toContain('marker-start="url(#arrow)"');
  });

  it('fails closed on invalid scale and missing view geometry', () => {
    expect(() => renderShopDrawingSvg(body, { title: 'Bad', scale: 0 }))
      .toThrow('Drawing scale must be a finite positive number');
    expect(() => renderShopDrawingSvg(body, { title: 'Bad', views: [] }))
      .toThrow('Drawing views must be a non-empty set');
  });

  it('classifies rear convex edges as hidden and front edges as visible', () => {
    const front = [...body.edges.values()].find((edge) =>
      edge.faceIds.includes('-Y') && edge.faceIds.includes('-Z')
    )!;
    const rear = [...body.edges.values()].find((edge) =>
      edge.faceIds.includes('+Y') && edge.faceIds.includes('-Z')
    )!;

    expect(classifyOrthographicEdge(body, front.faceIds, 'front')).toBe('visible');
    expect(classifyOrthographicEdge(body, rear.faceIds, 'front')).toBe('hidden');
  });

  it('splits and hides only the portion of a farther edge occluded by a nearer body', () => {
    const farther = createBoxBody({
      width: 4,
      depth: 1,
      height: 2,
      anchorMode: 'corner',
      origin: [0, 1, 0],
    }, 'farther');
    const nearer = createBoxBody({
      width: 2,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [1, -2, 1.5],
    }, 'nearer');

    const projection = projectOrthographic([farther, nearer], 'front');
    const fartherTop = projection.edges.filter((edge) =>
      edge.sourceEdgeIds.some((id) => id === 'farther:-Y+Z')
      && edge.start.y === 2
      && edge.end.y === 2
    );

    expect(fartherTop).toEqual([
      {
        start: { x: 0, y: 2 },
        end: { x: 1, y: 2 },
        visibility: 'visible',
        sourceEdgeIds: ['farther:+Y+Z', 'farther:-Y+Z'],
      },
      {
        start: { x: 1, y: 2 },
        end: { x: 3, y: 2 },
        visibility: 'hidden',
        sourceEdgeIds: ['farther:+Y+Z', 'farther:-Y+Z'],
      },
      {
        start: { x: 3, y: 2 },
        end: { x: 4, y: 2 },
        visibility: 'visible',
        sourceEdgeIds: ['farther:+Y+Z', 'farther:-Y+Z'],
      },
    ]);
    expect(projectOrthographic([nearer, farther], 'front')).toEqual(projection);
  });

  it('does not occlude farther geometry visible through a face inner loop', () => {
    const slabResult = createPrismaticBody({
      id: 'slab-with-opening',
      operationId: 'slab-with-opening',
      frame: {
        origin: [0, 0, 0],
        uAxis: [1, 0, 0],
        vAxis: [0, 0, 1],
        normal: [0, -1, 0],
      },
      region: {
        outer: [[0, 0], [4, 0], [4, 4], [0, 4]],
        holes: [[[1, 1], [3, 1], [3, 3], [1, 3]]],
      },
      minDepth: 0,
      maxDepth: 1,
    });
    if (!slabResult.ok) throw new Error(slabResult.diagnostics[0]?.message);
    const farther = createBoxBody({
      width: 1,
      depth: 1,
      height: 1,
      anchorMode: 'corner',
      origin: [1.5, 1, 1.5],
    }, 'through-opening');

    const visibleThroughOpening = projectOrthographic([slabResult.body, farther], 'front')
      .edges
      .filter((edge) => edge.sourceEdgeIds.some((id) => id.startsWith('through-opening:')));

    expect(visibleThroughOpening).toHaveLength(4);
    expect(visibleThroughOpening.every((edge) => edge.visibility === 'visible')).toBe(true);
  });

  it('uses a renderer-independent physical page model while preserving SVG compatibility', () => {
    const drawing = createShopDrawing(body, {
      title: 'Cabinet',
      views: ['front'],
      includeDimensions: false,
      includeHiddenLines: true,
    });
    expect(drawing).toMatchObject({
      version: 1,
      coordinateUnit: 'in',
      scale: 1,
      views: [{ view: 'front' }],
    });
    expect(drawing.entities.some((entity) => entity.layer === 'VISIBLE')).toBe(true);
    expect(drawing.entities.some((entity) => entity.layer === 'DIMENSION')).toBe(false);

    const svg = renderDrawingSvg(drawing);
    expect(svg).toContain('version="1.1"');
    expect(svg).not.toContain('auto-start-reverse');
    expect(svg).toContain('data-view="front"');
    expect(svg).not.toContain('NaN');
  });
});
