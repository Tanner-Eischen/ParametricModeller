import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WoodworkingController } from '../../src/app/WoodworkingController';
import { createDefaultDocument, type BodyWoodworkingMetadata, type Document } from '../../src/types';
import type { Body } from '../../src/geometry/Body';
import type { Matrix4Tuple } from '../../src/geometry/CoordinateFrame3D';
import type { FeatureRecord } from '../../src/features/FeatureRecord';
import { createRebuildEngine, type RebuildResult } from '../../src/features/RebuildEngine';
import { createBoxFeature, rebuildBox } from '../../src/features/primitives/BoxFeature';
import { createTransformBodiesFeature, rebuildTransformBodies } from '../../src/features/placement/TransformBodiesFeature';
import type { Placement } from '../../src/features/placement/PlacementSolver';
import { createMirrorFeature, rebuildMirror } from '../../src/features/pattern/MirrorFeature';
import { createCircularPatternFeature, rebuildCircularPattern } from '../../src/features/pattern/CircularPatternFeature';
import { createRotateBodyFeature, rebuildRotateBody } from '../../src/features/transform/RotateBodyFeature';
import { createMoveCopyFeature, rebuildMoveCopy } from '../../src/features/transform/MoveCopyFeature';
import { createComponentInstance, type ComponentInstance } from '../../src/assembly/AssemblyTypes';
import { createInstanceBody } from '../../src/assembly/ComponentRebuilder';
import { measureOrientedBoard } from '../../src/woodworking/Measurements';
import { serialize, deserialize } from '../../src/persistence/serializer';

function fixture() {
  let document = createDefaultDocument('Boards');
  let features: FeatureRecord[] = [];
  let result: Extract<RebuildResult, { ok: true }>;
  const instances = new Map<string, { instance: ComponentInstance; sourceId: string; featureId: string }>();
  const engine = createRebuildEngine();
  engine.registerHandler('box', rebuildBox);
  engine.registerHandler('transformBodies', rebuildTransformBodies);
  engine.registerHandler('mirror', rebuildMirror);
  engine.registerHandler('circularPattern', rebuildCircularPattern);
  engine.registerHandler('rotateBody', rebuildRotateBody);
  engine.registerHandler('moveCopy', rebuildMoveCopy);
  const rebuild = () => {
    const rebuilt = engine.rebuild(features);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    result = rebuilt;
    for (const feature of features) feature.refsOut = result.outputsByFeature.get(feature.id) ?? [];
  };
  const controller = new WoodworkingController({
    getDocument: () => document,
    getFeatureByBodyId: (id) => [...features].reverse().find((feature) => feature.refsOut.includes(id)) ?? null,
    getFeatureById: (id) => features.find((feature) => feature.id === id) ?? null,
    getInstanceForBody: (id) => instances.get(id)?.instance ?? null,
    getInstanceSourceId: (id) => instances.get(id)?.sourceId,
    getInstanceSourceFeatureId: (id) => instances.get(id)?.featureId,
    getBodiesByFeature: () => result.bodiesByFeature,
    getRebuiltBodies: () => result.bodies,
  });
  const add = (feature: FeatureRecord): Body[] => {
    features.push(feature);
    rebuild();
    return result.bodiesByFeature.get(feature.id)!;
  };
  const box = createBoxFeature({ width: 10, depth: 2, height: 1, origin: [0, 0, 0] });
  box.id = 'board';
  const source = add(box)[0]!;
  const metadata: BodyWoodworkingMetadata = {
    sourceFeatureId: box.id,
    isBoard: true,
    label: 'Oak rail',
    material: { id: 'oak', species: 'Oak' },
    grainAxis: [1, 0, 0],
    thicknessAxis: [0, 0, 1],
    stockAllowance: { length: 0.5 },
  };
  document.bodyMetadata = { [source.id]: structuredClone(metadata) };
  return {
    controller, box, source, metadata, add, instances,
    get result() { return result; },
    get document() { return document; },
    setDisplayedBodies(bodies: Body[]) { result = { ...result, bodies }; },
    roundTrip() {
      document.features = features as unknown as Document['features'];
      const encoded = serialize(document);
      if (!encoded.ok) throw new Error(encoded.error);
      const decoded = deserialize(encoded.json);
      if (!decoded.ok) throw new Error(decoded.error);
      document = decoded.document;
      features = document.features;
      rebuild();
    },
  };
}

function expectBoardDimensions(controller: WoodworkingController, body: Body): BodyWoodworkingMetadata {
  const metadata = controller.resolveWoodworkingMetadata(body.id);
  expect(metadata).not.toBeNull();
  const dimensions = measureOrientedBoard(body, metadata!);
  expect(dimensions.length).toBeCloseTo(10, 6);
  expect(dimensions.width).toBeCloseTo(2, 6);
  expect(dimensions.thickness).toBeCloseTo(1, 6);
  expect(metadata!.material.species).toBe('Oak');
  expect(metadata!.stockAllowance?.length).toBe(0.5);
  return metadata!;
}

function faceId(body: Body, name: string): string {
  return [...body.faces.values()].find((face) => face.name === name)!.id;
}

describe('WoodworkingController rigid placement inheritance', () => {
  const placements: Array<[string, (body: Body) => Placement]> = [
    ['free rotation', () => ({ type: 'Free', translation: [5, 7, 1], rotationDegrees: [23, 37, 52], pivot: [1, 2, 3] })],
    ['fixed matrix', () => ({ type: 'FixedMatrix', matrix: new THREE.Matrix4().makeRotationY(Math.PI / 3).toArray() as Matrix4Tuple })],
    ['point to point', (body) => ({ type: 'PointToPoint', source: { kind: 'vertex', featureId: 'board', bodyId: body.id, vertexId: [...body.vertices.keys()][0]! }, target: { kind: 'vertex', featureId: 'board', bodyId: body.id, vertexId: [...body.vertices.keys()][6]! } })],
    ['axis angle', (body) => ({ type: 'AxisAngle', axis: { kind: 'edge', featureId: 'board', bodyId: body.id, edgeId: [...body.edges.keys()][0]! }, angleDegrees: 41 })],
    ['face alignment', (body) => ({ type: 'Align', source: { kind: 'face', featureId: 'board', bodyId: body.id, faceId: faceId(body, '+Z') }, target: { kind: 'face', featureId: 'board', bodyId: body.id, faceId: faceId(body, '+X') }, quarterTurns: 1, opposed: true })],
  ];
  it.each(placements)('preserves board dimensions through %s', (_name, makePlacement) => {
    const f = fixture();
    const transform = createTransformBodiesFeature(
      [{ featureId: f.box.id, bodyId: f.source.id }], makePlacement(f.source), 'copy'
    );
    expectBoardDimensions(f.controller, f.add(transform)[0]!);
  });

  it('accumulates a move/copy chain from exact snapshots after the source is replaced', () => {
    const f = fixture();
    const move = createTransformBodiesFeature([{ featureId: f.box.id, bodyId: f.source.id }], {
      type: 'Free', translation: [0, 0, 3], rotationDegrees: [0, 37, 0],
    });
    const moved = f.add(move)[0]!;
    const copy = createTransformBodiesFeature([{ featureId: move.id, bodyId: moved.id }], {
      type: 'AxisAngle', axis: { kind: 'edge', featureId: f.box.id, bodyId: f.source.id, edgeId: [...f.source.edges.keys()][0]! }, angleDegrees: 29,
    }, 'copy');
    const copied = f.add(copy)[0]!;
    expectBoardDimensions(f.controller, moved);
    expectBoardDimensions(f.controller, copied);
    expect(f.document.bodyMetadata?.[f.source.id]).toEqual(f.metadata);
  });

  it('preserves legacy Rotate and Move/Copy metadata through their feature chain', () => {
    const f = fixture();
    const rotate = createRotateBodyFeature({ featureId: f.box.id, bodyId: f.source.id }, [13, 29, 41]);
    const rotated = f.add(rotate)[0]!;
    const copy = createMoveCopyFeature({ featureId: rotate.id, bodyId: rotated.id }, [7, 5, 3], 'copy');
    expectBoardDimensions(f.controller, f.add(copy)[0]!);
  });

  it('pairs multiple copy outputs with their own authored source metadata', () => {
    const f = fixture();
    const second = createBoxFeature({ width: 10, depth: 2, height: 1, origin: [20, 0, 0] });
    const other = f.add(second)[0]!;
    f.document.bodyMetadata![other.id] = { ...structuredClone(f.metadata), sourceFeatureId: second.id, label: 'Other board' };
    const copy = createTransformBodiesFeature([
      { featureId: second.id, bodyId: other.id },
      { featureId: f.box.id, bodyId: f.source.id },
    ], { type: 'Free', translation: [0, 0, 0], rotationDegrees: [0, 0, 90] }, 'copy');
    const outputs = f.add(copy);
    expect(expectBoardDimensions(f.controller, outputs[0]!).label).toBe('Other board');
    expect(expectBoardDimensions(f.controller, outputs[1]!).label).toBe('Oak rail');
  });

  it('follows replaced document, feature and body maps after serialization', () => {
    const f = fixture();
    const copy = createTransformBodiesFeature([{ featureId: f.box.id, bodyId: f.source.id }], {
      type: 'Free', translation: [3, 4, 5], rotationDegrees: [0, 0, 90],
    }, 'copy');
    const output = f.add(copy)[0]!;
    const before = expectBoardDimensions(f.controller, output);
    f.roundTrip();
    expect(expectBoardDimensions(f.controller, f.result.bodiesByFeature.get(copy.id)![0]!)).toEqual(before);
    f.document.config.units = 'mm';
    expect(f.controller.getUnit()).toBe('mm');
    expect(f.controller.formatLengthInput(1)).toBe('25.4');
  });

  it('reflects axes through an exact historical face plane after source replacement', () => {
    const f = fixture();
    const move = createTransformBodiesFeature([{ featureId: f.box.id, bodyId: f.source.id }], {
      type: 'Free', translation: [0, 0, 0], rotationDegrees: [0, 0, 45],
    });
    f.add(move);
    const mirror = createMirrorFeature({ featureId: f.box.id, bodyId: f.source.id }, {
      type: 'face', id: 'mirror-plane', featureId: f.box.id, bodyId: f.source.id, faceId: faceId(f.source, '+X'),
    });
    const metadata = expectBoardDimensions(f.controller, f.add(mirror)[0]!);
    expect(metadata.grainAxis).toEqual([-1, 0, 0]);
  });

  it('uses each circular occurrence transform even when the source is no longer displayed', () => {
    const f = fixture();
    const pattern = createCircularPatternFeature({ sourceFeatureId: f.box.id, count: 4, angle: 360, axis: 'Z' });
    const outputs = f.add(pattern);
    f.setDisplayedBodies(outputs);
    for (const output of outputs) expectBoardDimensions(f.controller, output);
    const axes = outputs.map((body) => f.controller.resolveWoodworkingMetadata(body.id)!.grainAxis);
    expect(axes[0]![1]).toBeCloseTo(1);
    expect(axes[1]![0]).toBeCloseTo(-1);
    expect(axes[2]![1]).toBeCloseTo(-1);
  });

  it('uses an instance component source revision instead of a later owner of the same body ID', () => {
    const f = fixture();
    const move = createTransformBodiesFeature([{ featureId: f.box.id, bodyId: f.source.id }], {
      type: 'Free', translation: [0, 0, 0], rotationDegrees: [0, 0, 45],
    });
    f.add(move);
    const instance = createComponentInstance('component', 'Placed', new THREE.Matrix4().makeRotationY(Math.PI / 3).toArray());
    const body = createInstanceBody(f.source, instance.id, instance.transform);
    f.instances.set(body.id, { instance, sourceId: f.source.id, featureId: f.box.id });
    expectBoardDimensions(f.controller, body);
  });

  it('keeps per-instance authored world axes at the exact component source revision', () => {
    const f = fixture();
    f.add(createTransformBodiesFeature([{ featureId: f.box.id, bodyId: f.source.id }], {
      type: 'Free', translation: [0, 0, 0], rotationDegrees: [0, 0, 45],
    }));
    const matrix = new THREE.Matrix4().makeRotationY(Math.PI / 3);
    const instance = createComponentInstance('component', 'Placed', matrix.toArray());
    const body = createInstanceBody(f.source, instance.id, instance.transform);
    f.instances.set(body.id, { instance, sourceId: f.source.id, featureId: f.box.id });
    const authored: BodyWoodworkingMetadata = {
      ...structuredClone(f.metadata),
      label: 'Authored instance',
      grainAxis: new THREE.Vector3(1, 0, 0).transformDirection(matrix).toArray(),
      thicknessAxis: new THREE.Vector3(0, 0, 1).transformDirection(matrix).toArray(),
    };
    f.document.bodyMetadata![body.id] = authored;
    const resolved = expectBoardDimensions(f.controller, body);
    expect(resolved).toEqual(authored);
    expect(resolved).not.toBe(authored);
  });

  it('does not apply metadata authored at a later revision to an earlier snapshot', () => {
    const f = fixture();
    const move = createTransformBodiesFeature([{ featureId: f.box.id, bodyId: f.source.id }], {
      type: 'Free', translation: [0, 0, 0], rotationDegrees: [0, 0, 90],
    });
    const moved = f.add(move)[0]!;
    f.document.bodyMetadata![moved.id] = { ...structuredClone(f.metadata), sourceFeatureId: move.id, grainAxis: [0, 1, 0] };
    expectBoardDimensions(f.controller, moved);
    expect(f.controller.resolveWoodworkingMetadata(f.source.id, f.box.id)).toBeNull();
    const returned = f.controller.resolveWoodworkingMetadata(moved.id)!;
    returned.material.species = 'Mutated';
    expect(f.document.bodyMetadata![moved.id]!.material.species).toBe('Oak');
  });
});
