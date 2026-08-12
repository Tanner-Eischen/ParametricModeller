/**
 * Component Rebuilder - Milestone 06: Assembly-lite
 *
 * Handles rebuilding with component support:
 * - Rebuilds features once per component
 * - Clones bodies for each instance
 * - Applies instance transforms
 */

import * as THREE from 'three';
import { createModuleLogger } from '../core/logger';
import { error, type Diagnostic } from '../features/Diagnostics';
import type { Body as BRepBody } from '../geometry';
import {
  createBody,
  addVertex,
  addEdge,
  addFace,
  addPlane,
  createTopologyIdAllocator,
} from '../geometry';
import { createVertex } from '../geometry/Vertex';
import { createEdge } from '../geometry/Edge';
import { createFace } from '../geometry/Face';
import { createPlane } from '../geometry/Plane';
import type {
  Component,
  ComponentInstance,
} from './AssemblyTypes';
import type { FeatureRecord } from '../features/FeatureRecord';
import type { RebuildResult, RebuildEngine } from '../features/RebuildEngine';

const log = createModuleLogger('ComponentRebuilder');

export const ComponentRebuildErrorCodes = {
  DUPLICATE_COMPONENT_ID: 'DUPLICATE_COMPONENT_ID',
  DUPLICATE_INSTANCE_ID: 'DUPLICATE_INSTANCE_ID',
  COMPONENT_NOT_FOUND: 'COMPONENT_NOT_FOUND',
  COMPONENT_SOURCE_BODIES_MISSING: 'COMPONENT_SOURCE_BODIES_MISSING',
  SOURCE_BODY_NOT_FOUND: 'SOURCE_BODY_NOT_FOUND',
  SOURCE_BODY_OWNERSHIP_CONFLICT: 'SOURCE_BODY_OWNERSHIP_CONFLICT',
  INVALID_INSTANCE_TRANSFORM: 'INVALID_INSTANCE_TRANSFORM',
  INVALID_SOURCE_TOPOLOGY: 'INVALID_SOURCE_TOPOLOGY',
} as const;

/**
 * Optional exact ownership supplied by an integration that already tracks
 * component source body IDs. IDs are resolved only within the exact snapshots
 * emitted by the component's feature IDs. Component.bodyIds is a persisted
 * compatibility cache only.
 */
export type ComponentSourceBodyOwnership = ReadonlyMap<string, readonly string[]>;

/** Source-to-instance topology maps for one cloned body. */
export interface InstanceBodyTopologyLineage {
  instanceId: string;
  sourceBodyId: string;
  instanceBodyId: string;
  bodyIds: ReadonlyMap<string, string>;
  planeIds: ReadonlyMap<string, string>;
  faceIds: ReadonlyMap<string, string>;
  edgeIds: ReadonlyMap<string, string>;
  vertexIds: ReadonlyMap<string, string>;
}

/**
 * Result of component-aware rebuild.
 */
export interface ComponentRebuildResult {
  ok: boolean;
  bodies: BRepBody[];
  componentBodies: Map<string, BRepBody[]>;  // componentId -> bodies
  instanceBodies: Map<string, BRepBody[]>;   // instanceId -> bodies
  /** Generated instance body ID -> the exact source body ID it was cloned from. */
  instanceBodySourceIds: Map<string, string>;
  /** Component ID -> exact source body IDs used during this rebuild. */
  componentSourceBodyIds: Map<string, string[]>;
  /** Generated instance body ID -> complete source-to-instance topology lineage. */
  topologyLineageByInstanceBodyId: Map<string, InstanceBodyTopologyLineage>;
  /** Generated topology ID -> source topology ID, for direct reverse lookup. */
  sourceIdByInstanceTopologyId: Map<string, string>;
  diagnostics: Diagnostic[];
  error?: string;
}

export interface InstanceBodyCloneResult {
  body: BRepBody;
  lineage: InstanceBodyTopologyLineage;
}

/**
 * Create an instance body from a source body with transform applied.
 * Generates deterministic, instance-scoped IDs for all topology elements.
 */
export function createInstanceBody(
  sourceBody: BRepBody,
  instanceId: string,
  transform: number[]
): BRepBody {
  return createInstanceBodyWithLineage(sourceBody, instanceId, transform).body;
}

/**
 * Create an instance body and return the complete topology lineage.
 */
export function createInstanceBodyWithLineage(
  sourceBody: BRepBody,
  instanceId: string,
  transform: number[]
): InstanceBodyCloneResult {
  assertValidTransform(transform);
  assertValidSourceTopology(sourceBody);

  const matrix = new THREE.Matrix4().fromArray(transform);

  const topology = createTopologyIdAllocator(
    `assembly-instance:${instanceId}:source-body:${sourceBody.id}`
  );

  // Create a deterministic body ID that cannot alias another source/instance pair.
  const instanceBodyId = topology.body(sourceBody.id);
  const instanceBody = createBody(instanceBodyId, sourceBody.name);

  // Map old IDs to new IDs
  const vertexIdMap = new Map<string, string>();
  const edgeIdMap = new Map<string, string>();
  const planeIdMap = new Map<string, string>();
  const faceIdMap = new Map<string, string>();

  for (const planeId of sourceBody.planes.keys()) {
    planeIdMap.set(planeId, topology.plane(planeId));
  }

  // Transform and add vertices
  for (const [oldId, vertex] of sourceBody.vertices) {
    const newVertexId = topology.vertex(oldId);
    vertexIdMap.set(oldId, newVertexId);

    const pos = new THREE.Vector3(...vertex.position);
    pos.applyMatrix4(matrix);

    const newVertex = createVertex([pos.x, pos.y, pos.z], newVertexId);
    addVertex(instanceBody, newVertex);
  }

  // Add edges with remapped vertex IDs
  for (const [oldId, edge] of sourceBody.edges) {
    const newEdgeId = topology.edge(oldId);
    edgeIdMap.set(oldId, newEdgeId);

    const v0 = vertexIdMap.get(edge.vertexIds[0])!;
    const v1 = vertexIdMap.get(edge.vertexIds[1])!;
    const newEdge = createEdge(v0, v1, newEdgeId);
    addEdge(instanceBody, newEdge);
  }

  // Transform and add planes
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const directionMatrix = new THREE.Matrix3().setFromMatrix4(matrix);
  for (const [planeId, plane] of sourceBody.planes) {
    const origin = new THREE.Vector3(...plane.origin);
    origin.applyMatrix4(matrix);

    const normal = new THREE.Vector3(...plane.normal);
    normal.applyMatrix3(normalMatrix).normalize();

    const uAxis = new THREE.Vector3(...plane.uAxis);
    uAxis.applyMatrix3(directionMatrix).normalize();

    const vAxis = new THREE.Vector3(...plane.vAxis);
    vAxis.applyMatrix3(directionMatrix).normalize();

    const newPlane = createPlane(
      [origin.x, origin.y, origin.z],
      [normal.x, normal.y, normal.z]
    );
    // Override uAxis and vAxis
    newPlane.uAxis = [uAxis.x, uAxis.y, uAxis.z];
    newPlane.vAxis = [vAxis.x, vAxis.y, vAxis.z];

    addPlane(instanceBody, newPlane, planeIdMap.get(planeId)!);
  }

  // Add faces last so addFace can rebuild all edge adjacency, including holes.
  for (const [oldId, face] of sourceBody.faces) {
    const newFaceId = topology.face(oldId);
    faceIdMap.set(oldId, newFaceId);
    const newBoundaryEdgeIds = face.boundaryEdgeIds.map(
      (edgeId) => edgeIdMap.get(edgeId)!
    );
    const newInnerBoundaryEdgeIds = face.innerBoundaryEdgeIds?.map((loop) =>
      loop.map((edgeId) => edgeIdMap.get(edgeId)!)
    );
    const newPlaneId = planeIdMap.get(face.planeId)!;

    addFace(instanceBody, {
      ...createFace(newPlaneId, newBoundaryEdgeIds, newFaceId, face.name),
      ...(newInnerBoundaryEdgeIds
        ? { innerBoundaryEdgeIds: newInnerBoundaryEdgeIds }
        : {}),
    });
  }

  return {
    body: instanceBody,
    lineage: {
      instanceId,
      sourceBodyId: sourceBody.id,
      instanceBodyId,
      bodyIds: new Map([[sourceBody.id, instanceBodyId]]),
      planeIds: planeIdMap,
      faceIds: faceIdMap,
      edgeIds: edgeIdMap,
      vertexIds: vertexIdMap,
    },
  };
}

/**
 * Rebuild the scene with component support.
 * Takes the output from the base rebuild engine and creates instance bodies.
 */
export function rebuildWithComponents(
  baseResult: RebuildResult,
  components: Component[],
  instances: ComponentInstance[],
  sourceBodyOwnership?: ComponentSourceBodyOwnership
): ComponentRebuildResult {
  if (!baseResult.ok) {
    return {
      ok: false,
      bodies: [],
      componentBodies: new Map(),
      instanceBodies: new Map(),
      instanceBodySourceIds: new Map(),
      componentSourceBodyIds: new Map(),
      topologyLineageByInstanceBodyId: new Map(),
      sourceIdByInstanceTopologyId: new Map(),
      diagnostics: [...baseResult.diagnostics],
      error: baseResult.error,
    };
  }

  const diagnostics: Diagnostic[] = [...baseResult.diagnostics];
  const componentById = new Map<string, Component>();
  const instanceIds = new Set<string>();
  const componentBodies = new Map<string, BRepBody[]>();
  const componentSourceBodyIds = new Map<string, string[]>();
  const sourceBodyOwner = new Map<string, string>();

  for (const component of components) {
    if (componentById.has(component.id)) {
      diagnostics.push(error(
        ComponentRebuildErrorCodes.DUPLICATE_COMPONENT_ID,
        `Component ID ${component.id} is duplicated`,
        undefined,
        component.id
      ));
      continue;
    }
    componentById.set(component.id, component);
    componentBodies.set(component.id, []);

    // Process the component's persisted feature order and let a later selected
    // feature replace an earlier snapshot with the same stable body ID. This
    // preserves history semantics without ever consulting final scene geometry.
    const exactBodyById = new Map<string, BRepBody>();
    for (const featureId of component.featureIds) {
      for (const body of baseResult.bodiesByFeature.get(featureId) ?? []) {
        exactBodyById.set(body.id, body);
      }
    }

    const explicitBodyIds = sourceBodyOwnership?.get(component.id);
    const exactBodies = explicitBodyIds
      ? Array.from(new Set(explicitBodyIds)).flatMap((bodyId) => {
        const body = exactBodyById.get(bodyId);
        if (body) return [body];
        diagnostics.push(error(
          ComponentRebuildErrorCodes.SOURCE_BODY_NOT_FOUND,
          `Component ${component.id} references source body ${bodyId}, but none of its features emitted that exact body`,
          undefined,
          bodyId
        ));
        return [];
      })
      : [...exactBodyById.values()];
    const exactBodyIds = exactBodies.map((body) => body.id);

    componentSourceBodyIds.set(component.id, exactBodyIds);
    componentBodies.set(component.id, exactBodies);

    for (const bodyId of exactBodyIds) {
      const existingOwner = sourceBodyOwner.get(bodyId);
      if (existingOwner && existingOwner !== component.id) {
        diagnostics.push(error(
          ComponentRebuildErrorCodes.SOURCE_BODY_OWNERSHIP_CONFLICT,
          `Source body ${bodyId} is owned by both ${existingOwner} and ${component.id}`,
          undefined,
          bodyId
        ));
      } else {
        sourceBodyOwner.set(bodyId, component.id);
      }
    }
  }

  for (const instance of instances) {
    if (instanceIds.has(instance.id)) {
      diagnostics.push(error(
        ComponentRebuildErrorCodes.DUPLICATE_INSTANCE_ID,
        `Instance ID ${instance.id} is duplicated`,
        undefined,
        instance.id
      ));
      continue;
    }
    instanceIds.add(instance.id);

    if (!componentById.has(instance.componentId)) {
      diagnostics.push(error(
        ComponentRebuildErrorCodes.COMPONENT_NOT_FOUND,
        `Instance ${instance.id} references missing component ${instance.componentId}`,
        undefined,
        instance.id
      ));
    }

    const sourceBodies = componentBodies.get(instance.componentId) ?? [];
    if (sourceBodies.length === 0) {
      diagnostics.push(error(
        ComponentRebuildErrorCodes.COMPONENT_SOURCE_BODIES_MISSING,
        `Instance ${instance.id} component ${instance.componentId} has no exact source body outputs`,
        undefined,
        instance.id
      ));
    }

    try {
      assertValidTransform(instance.transform);
    } catch (caught) {
      diagnostics.push(error(
        ComponentRebuildErrorCodes.INVALID_INSTANCE_TRANSFORM,
        caught instanceof Error ? caught.message : String(caught),
        undefined,
        instance.id
      ));
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return createFailedResult(diagnostics);
  }

  // Build into temporary collections. Nothing is published if one clone fails.
  const instanceBodies = new Map<string, BRepBody[]>();
  const instanceBodySourceIds = new Map<string, string>();
  const topologyLineageByInstanceBodyId = new Map<string, InstanceBodyTopologyLineage>();
  const sourceIdByInstanceTopologyId = new Map<string, string>();
  const instancedComponentIds = new Set(instances.map((instance) => instance.componentId));
  const allBodies = baseResult.bodies.filter((body) => {
    const owner = sourceBodyOwner.get(body.id);
    return !owner || !instancedComponentIds.has(owner);
  });

  for (const instance of instances) {
    const componentBodyList = componentBodies.get(instance.componentId)!;
    const newInstanceBodies: BRepBody[] = [];
    for (const sourceBody of componentBodyList) {
      try {
        const clone = createInstanceBodyWithLineage(
          sourceBody,
          instance.id,
          instance.transform
        );
        newInstanceBodies.push(clone.body);
        instanceBodySourceIds.set(clone.body.id, sourceBody.id);
        topologyLineageByInstanceBodyId.set(clone.body.id, clone.lineage);
        addReverseLineage(sourceIdByInstanceTopologyId, clone.lineage);
        allBodies.push(clone.body);
      } catch (caught) {
        diagnostics.push(error(
          ComponentRebuildErrorCodes.INVALID_SOURCE_TOPOLOGY,
          caught instanceof Error ? caught.message : String(caught),
          undefined,
          sourceBody.id
        ));
      }
    }

    instanceBodies.set(instance.id, newInstanceBodies);
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return createFailedResult(diagnostics);
  }

  log.info('Component rebuild complete', {
    totalBodies: allBodies.length,
    componentCount: components.length,
    instanceCount: instances.length,
  });

  return {
    ok: true,
    bodies: allBodies,
    componentBodies,
    instanceBodies,
    instanceBodySourceIds,
    componentSourceBodyIds,
    topologyLineageByInstanceBodyId,
    sourceIdByInstanceTopologyId,
    diagnostics,
  };
}

function createFailedResult(diagnostics: Diagnostic[]): ComponentRebuildResult {
  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  return {
    ok: false,
    bodies: [],
    componentBodies: new Map(),
    instanceBodies: new Map(),
    instanceBodySourceIds: new Map(),
    componentSourceBodyIds: new Map(),
    topologyLineageByInstanceBodyId: new Map(),
    sourceIdByInstanceTopologyId: new Map(),
    diagnostics,
    ...(firstError ? { error: firstError.message } : {}),
  };
}

function addReverseLineage(
  target: Map<string, string>,
  lineage: InstanceBodyTopologyLineage
): void {
  for (const [sourceId, instanceTopologyId] of [
    ...lineage.bodyIds,
    ...lineage.planeIds,
    ...lineage.faceIds,
    ...lineage.edgeIds,
    ...lineage.vertexIds,
  ]) {
    target.set(instanceTopologyId, sourceId);
  }
}

function assertValidTransform(transform: number[]): void {
  if (transform.length !== 16 || transform.some((value) => !Number.isFinite(value))) {
    throw new Error('Instance transform must contain 16 finite numbers');
  }
  if (
    Math.abs(transform[3]!) > 1e-9
    || Math.abs(transform[7]!) > 1e-9
    || Math.abs(transform[11]!) > 1e-9
    || Math.abs(transform[15]! - 1) > 1e-9
  ) {
    throw new Error('Instance transform must be an affine 4x4 matrix');
  }
  const determinant = new THREE.Matrix4().fromArray(transform).determinant();
  const xAxis = new THREE.Vector3(transform[0]!, transform[1]!, transform[2]!);
  const yAxis = new THREE.Vector3(transform[4]!, transform[5]!, transform[6]!);
  const zAxis = new THREE.Vector3(transform[8]!, transform[9]!, transform[10]!);
  if (
    Math.abs(xAxis.length() - 1) > 1e-9
    || Math.abs(yAxis.length() - 1) > 1e-9
    || Math.abs(zAxis.length() - 1) > 1e-9
    || Math.abs(xAxis.dot(yAxis)) > 1e-9
    || Math.abs(xAxis.dot(zAxis)) > 1e-9
    || Math.abs(yAxis.dot(zAxis)) > 1e-9
    || Math.abs(determinant - 1) > 1e-9
  ) {
    throw new Error('Instance transform must be a rigid translation/rotation matrix');
  }
}

function assertValidSourceTopology(body: BRepBody): void {
  for (const [vertexId, vertex] of body.vertices) {
    if (
      vertex.id !== vertexId
      || vertex.position.some((coordinate) => !Number.isFinite(coordinate))
    ) {
      throw new Error(`Source body ${body.id} has invalid vertex ${vertexId}`);
    }
  }
  for (const [edgeId, edge] of body.edges) {
    if (edge.id !== edgeId) {
      throw new Error(`Source body ${body.id} has mismatched edge ID ${edgeId}`);
    }
    for (const vertexId of edge.vertexIds) {
      if (!body.vertices.has(vertexId)) {
        throw new Error(
          `Source body ${body.id} edge ${edgeId} references missing vertex ${vertexId}`
        );
      }
    }
  }
  for (const [planeId, plane] of body.planes) {
    const coordinates = [
      ...plane.origin,
      ...plane.normal,
      ...plane.uAxis,
      ...plane.vAxis,
    ];
    const normalLength = new THREE.Vector3(...plane.normal).lengthSq();
    if (
      coordinates.some((coordinate) => !Number.isFinite(coordinate))
      || normalLength < 1e-18
    ) {
      throw new Error(`Source body ${body.id} has invalid plane ${planeId}`);
    }
  }
  for (const [faceId, face] of body.faces) {
    if (face.id !== faceId) {
      throw new Error(`Source body ${body.id} has mismatched face ID ${faceId}`);
    }
    if (!body.planes.has(face.planeId)) {
      throw new Error(
        `Source body ${body.id} face ${faceId} references missing plane ${face.planeId}`
      );
    }
    for (const edgeId of [
      ...face.boundaryEdgeIds,
      ...(face.innerBoundaryEdgeIds?.flat() ?? []),
    ]) {
      if (!body.edges.has(edgeId)) {
        throw new Error(
          `Source body ${body.id} face ${faceId} references missing edge ${edgeId}`
        );
      }
    }
  }
}

/**
 * Interface for assembly data providers.
 */
export interface AssemblyDataProvider {
  getComponents(): Component[];
  getInstances(): ComponentInstance[];
  getSourceBodyOwnership?(): ComponentSourceBodyOwnership;
}

/**
 * Create a component-aware rebuild wrapper.
 */
export function createComponentAwareRebuild(
  baseEngine: RebuildEngine,
  assemblyProvider: AssemblyDataProvider
): {
  rebuild: (features: FeatureRecord[]) => ComponentRebuildResult;
} {
  return {
    rebuild(features: FeatureRecord[]): ComponentRebuildResult {
      const baseResult = baseEngine.rebuild(features);
      return rebuildWithComponents(
        baseResult,
        assemblyProvider.getComponents(),
        assemblyProvider.getInstances(),
        assemblyProvider.getSourceBodyOwnership?.()
      );
    },
  };
}
