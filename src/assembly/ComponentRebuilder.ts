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
import { generateId } from '../core/id';
import type { Body as BRepBody } from '../geometry';
import { createBody, addVertex, addEdge, addFace, addPlane } from '../geometry';
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

/**
 * Result of component-aware rebuild.
 */
export interface ComponentRebuildResult {
  ok: boolean;
  bodies: BRepBody[];
  componentBodies: Map<string, BRepBody[]>;  // componentId -> bodies
  instanceBodies: Map<string, BRepBody[]>;   // instanceId -> bodies
  error?: string;
}

/**
 * Create an instance body from a source body with transform applied.
 * Generates new IDs for all topology elements.
 */
export function createInstanceBody(
  sourceBody: BRepBody,
  instanceId: string,
  transform: number[]
): BRepBody {
  // Parse the 4x4 matrix
  const matrix = new THREE.Matrix4().fromArray(transform);

  // Create new body with instance-specific ID
  const instanceBodyId = `${sourceBody.id}_${instanceId}`;
  const instanceBody = createBody(instanceBodyId, sourceBody.name);

  // Map old IDs to new IDs
  const vertexIdMap = new Map<string, string>();
  const edgeIdMap = new Map<string, string>();

  // Transform and add vertices
  for (const [oldId, vertex] of sourceBody.vertices) {
    const newVertexId = generateId();
    vertexIdMap.set(oldId, newVertexId);

    const pos = new THREE.Vector3(...vertex.position);
    pos.applyMatrix4(matrix);

    const newVertex = createVertex([pos.x, pos.y, pos.z], newVertexId);
    addVertex(instanceBody, newVertex);
  }

  // Add edges with remapped vertex IDs
  for (const [_oldId, edge] of sourceBody.edges) {
    const newEdgeId = generateId();
    edgeIdMap.set(edge.id, newEdgeId);

    const v0 = vertexIdMap.get(edge.vertexIds[0]) ?? edge.vertexIds[0];
    const v1 = vertexIdMap.get(edge.vertexIds[1]) ?? edge.vertexIds[1];
    const newEdge = createEdge(v0!, v1!, newEdgeId);
    addEdge(instanceBody, newEdge);
  }

  // Add faces with remapped edge IDs
  for (const [_oldId, face] of sourceBody.faces) {
    const newFaceId = generateId();
    const newBoundaryEdgeIds = face.boundaryEdgeIds.map(eid => edgeIdMap.get(eid) ?? eid);

    const newFace = createFace(face.planeId, newBoundaryEdgeIds, newFaceId, face.name);
    addFace(instanceBody, newFace);
  }

  // Transform and add planes
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  for (const [planeId, plane] of sourceBody.planes) {
    const origin = new THREE.Vector3(...plane.origin);
    origin.applyMatrix4(matrix);

    const normal = new THREE.Vector3(...plane.normal);
    normal.applyMatrix3(normalMatrix).normalize();

    const uAxis = new THREE.Vector3(...plane.uAxis);
    uAxis.applyMatrix3(normalMatrix).normalize();

    const vAxis = new THREE.Vector3(...plane.vAxis);
    vAxis.applyMatrix3(normalMatrix).normalize();

    const newPlane = createPlane(
      [origin.x, origin.y, origin.z],
      [normal.x, normal.y, normal.z]
    );
    // Override uAxis and vAxis
    newPlane.uAxis = [uAxis.x, uAxis.y, uAxis.z];
    newPlane.vAxis = [vAxis.x, vAxis.y, vAxis.z];

    addPlane(instanceBody, newPlane, planeId);
  }

  return instanceBody;
}

/**
 * Rebuild the scene with component support.
 * Takes the output from the base rebuild engine and creates instance bodies.
 */
export function rebuildWithComponents(
  baseResult: RebuildResult,
  components: Component[],
  instances: ComponentInstance[]
): ComponentRebuildResult {
  if (!baseResult.ok) {
    return {
      ok: false,
      bodies: [],
      componentBodies: new Map(),
      instanceBodies: new Map(),
      error: baseResult.error,
    };
  }

  // Map features to components
  const featureToComponent = new Map<string, string>();
  for (const component of components) {
    for (const featureId of component.featureIds) {
      featureToComponent.set(featureId, component.id);
    }
  }

  // Map bodies to components based on which feature created them
  const componentBodies = new Map<string, BRepBody[]>();
  const nonComponentBodies: BRepBody[] = [];

  // For now, we'll use a simple heuristic: bodies are associated with components
  // based on the feature that created them
  // In a real implementation, we'd track this through the rebuild context

  // Initialize component body maps
  for (const component of components) {
    componentBodies.set(component.id, []);
  }

  // All base bodies are considered non-component bodies for now
  // (they'll be used as templates for instances)
  for (const body of baseResult.bodies) {
    nonComponentBodies.push(body);
  }

  // Create instance bodies
  const instanceBodies = new Map<string, BRepBody[]>();
  const allBodies: BRepBody[] = [];

  for (const instance of instances) {
    const component = components.find(c => c.id === instance.componentId);
    if (!component) {
      log.warn('Instance references non-existent component', {
        instanceId: instance.id,
        componentId: instance.componentId,
      });
      continue;
    }

    // Find bodies for this component
    const componentBodyList: BRepBody[] = [];

    // Get bodies created by features in this component
    for (const featureId of component.featureIds) {
      const body = baseResult.bodies.find(b => b.id.startsWith(featureId) || b.id === featureId);
      if (body) {
        componentBodyList.push(body);
      }
    }

    // If no bodies found via feature IDs, use all bodies as template
    // This is a simplification for v1
    if (componentBodyList.length === 0 && baseResult.bodies.length > 0) {
      // Use the first body as a template
      componentBodyList.push(baseResult.bodies[0]!);
    }

    // Create instance bodies
    const newInstanceBodies: BRepBody[] = [];
    for (const sourceBody of componentBodyList) {
      const instanceBody = createInstanceBody(sourceBody, instance.id, instance.transform);
      newInstanceBodies.push(instanceBody);
      allBodies.push(instanceBody);
    }

    instanceBodies.set(instance.id, newInstanceBodies);
  }

  // Add non-instanced bodies (features not in components)
  for (const body of nonComponentBodies) {
    // Check if this body is used by any instance
    const isUsedByInstance = Array.from(instances.values()).some(inst => {
      const comp = components.find(c => c.id === inst.componentId);
      return comp?.bodyIds.includes(body.id);
    });

    if (!isUsedByInstance) {
      allBodies.push(body);
    }
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
  };
}

/**
 * Interface for assembly data providers.
 */
export interface AssemblyDataProvider {
  getComponents(): Component[];
  getInstances(): ComponentInstance[];
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
        assemblyProvider.getInstances()
      );
    },
  };
}
