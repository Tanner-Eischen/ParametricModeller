import { describe, expect, it } from 'vitest';
import {
  ComponentRebuildErrorCodes,
  createInstanceBody,
  createInstanceBodyWithLineage,
  rebuildWithComponents,
} from '../../src/assembly/ComponentRebuilder';
import {
  addEdge,
  addFace,
  addPlane,
  addVertex,
  createBody,
  createTopologyIdAllocator,
  type Body,
} from '../../src/geometry';
import { createEdge } from '../../src/geometry/Edge';
import { createFace } from '../../src/geometry/Face';
import { createPlane } from '../../src/geometry/Plane';
import { createVertex } from '../../src/geometry/Vertex';

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function createSourceBody(bodyId: string): Body {
  const body = createBody(bodyId, `Source ${bodyId}`);
  addVertex(body, createVertex([0, 0, 0], 'vertex:0'));
  addVertex(body, createVertex([2, 0, 0], 'vertex:1'));
  addVertex(body, createVertex([0, 2, 0], 'vertex:2'));
  addEdge(body, createEdge('vertex:0', 'vertex:1', 'edge:0'));
  addEdge(body, createEdge('vertex:1', 'vertex:2', 'edge:1'));
  addEdge(body, createEdge('vertex:2', 'vertex:0', 'edge:2'));
  addPlane(body, createPlane([0, 0, 0], [0, 0, 1]), 'plane:top');
  addFace(body, createFace(
    'plane:top',
    ['edge:0', 'edge:1', 'edge:2'],
    'face:top',
    '+Z'
  ));
  return body;
}

function serializeTopology(body: Body): string {
  return JSON.stringify({
    id: body.id,
    vertices: [...body.vertices.entries()],
    edges: [...body.edges.entries()],
    faces: [...body.faces.entries()],
    planes: [...body.planes.entries()],
  });
}

function allTopologyIds(body: Body): Set<string> {
  return new Set([
    body.id,
    ...body.vertices.keys(),
    ...body.edges.keys(),
    ...body.faces.keys(),
    ...body.planes.keys(),
  ]);
}

describe('ComponentRebuilder deterministic instance topology', () => {
  it('produces byte-identical geometry and topology IDs across ten rebuilds', () => {
    const source = createSourceBody('source:body');
    const transform = [...IDENTITY];
    transform[12] = 5;
    transform[13] = -3;

    const snapshots = Array.from({ length: 10 }, () =>
      serializeTopology(createInstanceBody(source, 'instance:one', transform))
    );

    expect(new Set(snapshots).size).toBe(1);
  });

  it('preserves deterministic source mapping and remaps face plane references', () => {
    const source = createSourceBody('source:body');
    const instanceId = 'instance:one';
    const instance = createInstanceBody(source, instanceId, IDENTITY);
    const ids = createTopologyIdAllocator(
      `assembly-instance:${instanceId}:source-body:${source.id}`
    );

    expect(instance.id).toBe(ids.body(source.id));
    expect([...instance.vertices.keys()]).toEqual([
      ids.vertex('vertex:0'),
      ids.vertex('vertex:1'),
      ids.vertex('vertex:2'),
    ]);
    expect([...instance.edges.keys()]).toEqual([
      ids.edge('edge:0'),
      ids.edge('edge:1'),
      ids.edge('edge:2'),
    ]);
    const face = instance.faces.get(ids.face('face:top'))!;
    expect(face.boundaryEdgeIds).toEqual([
      ids.edge('edge:0'),
      ids.edge('edge:1'),
      ids.edge('edge:2'),
    ]);
    expect(face.planeId).toBe(ids.plane('plane:top'));
    expect(instance.planes.has(face.planeId)).toBe(true);
  });

  it('clones inner boundary loops and exposes complete reversible lineage', () => {
    const source = createSourceBody('source:with-hole');
    addVertex(source, createVertex([0.5, 0.5, 0], 'hole:v0'));
    addVertex(source, createVertex([1, 0.5, 0], 'hole:v1'));
    addVertex(source, createVertex([0.5, 1, 0], 'hole:v2'));
    addEdge(source, createEdge('hole:v0', 'hole:v1', 'hole:e0'));
    addEdge(source, createEdge('hole:v1', 'hole:v2', 'hole:e1'));
    addEdge(source, createEdge('hole:v2', 'hole:v0', 'hole:e2'));
    source.faces.get('face:top')!.innerBoundaryEdgeIds = [
      ['hole:e0', 'hole:e1', 'hole:e2'],
    ];

    const { body, lineage } = createInstanceBodyWithLineage(
      source,
      'instance:hole',
      IDENTITY
    );
    const clonedFaceId = lineage.faceIds.get('face:top')!;
    const clonedHoleEdges = ['hole:e0', 'hole:e1', 'hole:e2'].map(
      (edgeId) => lineage.edgeIds.get(edgeId)!
    );

    expect(body.faces.get(clonedFaceId)?.innerBoundaryEdgeIds).toEqual([
      clonedHoleEdges,
    ]);
    for (const edgeId of clonedHoleEdges) {
      expect(body.edges.get(edgeId)?.faceIds).toContain(clonedFaceId);
    }
    expect(lineage.bodyIds.get(source.id)).toBe(body.id);
    expect(lineage.vertexIds.size).toBe(source.vertices.size);
    expect(lineage.edgeIds.size).toBe(source.edges.size);
    expect(lineage.faceIds.size).toBe(source.faces.size);
    expect(lineage.planeIds.size).toBe(source.planes.size);
  });

  it('does not collide across instances or source bodies with identical local topology IDs', () => {
    const sourceA = createSourceBody('source:A');
    const sourceB = createSourceBody('source:B');
    const bodies = [
      createInstanceBody(sourceA, 'instance:one', IDENTITY),
      createInstanceBody(sourceA, 'instance:two', IDENTITY),
      createInstanceBody(sourceB, 'instance:one', IDENTITY),
    ];

    const seen = new Set<string>();
    for (const body of bodies) {
      for (const id of allTopologyIds(body)) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it('maps each generated body to its source without relying on component body ordering', () => {
    const sourceA = createSourceBody('feature:A:body');
    const sourceB = createSourceBody('feature:B:body');
    const instanceId = 'instance:multi-body';
    const generatedAId = createInstanceBody(sourceA, instanceId, IDENTITY).id;
    const generatedBId = createInstanceBody(sourceB, instanceId, IDENTITY).id;
    const sortedGeneratedIds = [generatedAId, generatedBId].sort((left, right) =>
      left.localeCompare(right)
    );

    // Deliberately make component.bodyIds disagree with sorted generated-body order.
    // The old App mapping paired these arrays by index and inherited the wrong metadata.
    const mismatchedBodyIds = sortedGeneratedIds[0] === generatedAId
      ? [sourceB.id, sourceA.id]
      : [sourceA.id, sourceB.id];
    const result = rebuildWithComponents(
      {
        ok: true,
        bodies: [sourceA, sourceB],
        diagnostics: [],
        outputsByFeature: new Map([
          ['feature:A', [sourceA.id]],
          ['feature:B', [sourceB.id]],
        ]),
        bodiesByFeature: new Map([
          ['feature:A', [sourceA]],
          ['feature:B', [sourceB]],
        ]),
        featureByBodyId: new Map([
          [sourceA.id, 'feature:A'],
          [sourceB.id, 'feature:B'],
        ]),
      },
      [{
        id: 'component:multi-body',
        name: 'Multi-body component',
        featureIds: ['feature:A', 'feature:B'],
        bodyIds: mismatchedBodyIds,
      }],
      [{
        id: instanceId,
        componentId: 'component:multi-body',
        name: 'Multi-body instance',
        transform: IDENTITY,
        lockedAxes: {
          translateX: false,
          translateY: false,
          translateZ: false,
          rotateX: false,
          rotateY: false,
          rotateZ: false,
        },
        grounded: false,
      }]
    );

    expect(result.ok).toBe(true);
    expect(result.instanceBodySourceIds.get(generatedAId)).toBe(sourceA.id);
    expect(result.instanceBodySourceIds.get(generatedBId)).toBe(sourceB.id);
    expect(sortedGeneratedIds.map((id) => result.instanceBodySourceIds.get(id))).not.toEqual(
      mismatchedBodyIds
    );
    expect(result.componentSourceBodyIds.get('component:multi-body')).toEqual([
      sourceA.id,
      sourceB.id,
    ]);
    expect(result.sourceIdByInstanceTopologyId.get(generatedAId)).toBe(sourceA.id);
    expect(result.topologyLineageByInstanceBodyId.get(generatedBId)?.sourceBodyId).toBe(
      sourceB.id
    );
  });

  it('treats bodyIds as cache-only and fails closed without exact feature outputs', () => {
    const source = createSourceBody('cached:body');
    const result = rebuildWithComponents(
      {
        ok: true,
        bodies: [source],
        diagnostics: [],
        outputsByFeature: new Map(),
        bodiesByFeature: new Map(),
        featureByBodyId: new Map(),
      },
      [{
        id: 'component:cached',
        name: 'Cached component',
        featureIds: ['feature:missing-output'],
        bodyIds: [source.id],
      }],
      [{
        id: 'instance:cached',
        componentId: 'component:cached',
        name: 'Cached instance',
        transform: IDENTITY,
        lockedAxes: {
          translateX: false,
          translateY: false,
          translateZ: false,
          rotateX: false,
          rotateY: false,
          rotateZ: false,
        },
        grounded: false,
      }]
    );

    expect(result.ok).toBe(false);
    expect(result.bodies).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: ComponentRebuildErrorCodes.COMPONENT_SOURCE_BODIES_MISSING,
    }));
  });

  it('accepts an explicit exact ownership map and reports missing sources transactionally', () => {
    const source = createSourceBody('explicit:body');
    const component = {
      id: 'component:explicit',
      name: 'Explicit component',
      featureIds: ['feature:explicit'],
      bodyIds: [],
    };
    const instance = {
      id: 'instance:explicit',
      componentId: component.id,
      name: 'Explicit instance',
      transform: IDENTITY,
      lockedAxes: {
        translateX: false,
        translateY: false,
        translateZ: false,
        rotateX: false,
        rotateY: false,
        rotateZ: false,
      },
      grounded: false,
    };
    const baseResult = {
      ok: true as const,
      bodies: [source],
      diagnostics: [],
      outputsByFeature: new Map([['feature:explicit', [source.id]]]),
      bodiesByFeature: new Map([['feature:explicit', [source]]]),
      featureByBodyId: new Map([[source.id, 'feature:explicit']]),
    };

    const success = rebuildWithComponents(
      baseResult,
      [component],
      [instance],
      new Map([[component.id, [source.id]]])
    );
    expect(success.ok).toBe(true);
    expect(success.instanceBodies.get(instance.id)).toHaveLength(1);

    const failure = rebuildWithComponents(
      baseResult,
      [component],
      [instance],
      new Map([[component.id, ['missing:body']]])
    );
    expect(failure.ok).toBe(false);
    expect(failure.instanceBodies.size).toBe(0);
    expect(failure.diagnostics).toContainEqual(expect.objectContaining({
      code: ComponentRebuildErrorCodes.SOURCE_BODY_NOT_FOUND,
    }));
  });

  it('uses an earlier feature snapshot when a downstream edit preserves the body ID', () => {
    const boxSnapshot = createSourceBody('shared:body');
    const cutResult = createSourceBody('shared:body');
    cutResult.vertices.get('vertex:1')!.position = [1, 0, 0];

    const result = rebuildWithComponents(
      {
        ok: true,
        bodies: [cutResult],
        diagnostics: [],
        outputsByFeature: new Map([
          ['feature:box', [boxSnapshot.id]],
          ['feature:cut', [cutResult.id]],
        ]),
        bodiesByFeature: new Map([
          ['feature:box', [boxSnapshot]],
          ['feature:cut', [cutResult]],
        ]),
        featureByBodyId: new Map([[cutResult.id, 'feature:cut']]),
      },
      [{
        id: 'component:box-only',
        name: 'Uncut box',
        featureIds: ['feature:box'],
        bodyIds: [boxSnapshot.id],
      }],
      [{
        id: 'instance:box-only',
        componentId: 'component:box-only',
        name: 'Uncut instance',
        transform: IDENTITY,
        lockedAxes: {
          translateX: false,
          translateY: false,
          translateZ: false,
          rotateX: false,
          rotateY: false,
          rotateZ: false,
        },
        grounded: false,
      }]
    );

    expect(result.ok).toBe(true);
    expect(result.componentBodies.get('component:box-only')?.[0]).toBe(boxSnapshot);
    const instance = result.instanceBodies.get('instance:box-only')?.[0];
    const lineage = result.topologyLineageByInstanceBodyId.get(instance!.id)!;
    expect(instance?.vertices.get(lineage.vertexIds.get('vertex:1')!)?.position).toEqual([
      2, 0, 0,
    ]);
  });
});
