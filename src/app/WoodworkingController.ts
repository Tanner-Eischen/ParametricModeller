import * as THREE from 'three';
import type { BodyWoodworkingMetadata, Document } from '../types';
import type { FeatureRecord } from '../features/FeatureRecord';
import type { ComponentInstance } from '../assembly/AssemblyTypes';
import type { Body as BRepBody } from '../geometry/Body';
import { getConstructionPlaneFromRef } from '../geometry/ConstructionPlane';
import type { PlaneRef } from '../sketch/SketchTypes';
import { createRebuildContext } from '../features/RebuildContext';
import { solvePlacementMatrix, type Placement } from '../features/placement/PlacementSolver';
import {
  getCircularPatternInstanceTransforms,
  type CircularPatternParams,
} from '../features/pattern/CircularPatternFeature';

export interface WoodworkingControllerDeps {
  getDocument: () => Document;
  getFeatureByBodyId: (bodyId: string) => FeatureRecord | null;
  getFeatureById: (featureId: string) => FeatureRecord | null;
  getInstanceForBody: (bodyId: string) => ComponentInstance | null;
  getInstanceSourceId: (bodyId: string) => string | undefined;
  /** Exact component revision, when its source precedes the final body owner. */
  getInstanceSourceFeatureId?: (bodyId: string) => string | undefined;
  getBodiesByFeature: () => ReadonlyMap<string, BRepBody[]>;
  getRebuiltBodies: () => BRepBody[];
}

interface SourceRef { featureId?: string; bodyId?: string }

interface InheritanceParameters {
  sourceBodyRef?: SourceRef;
  bodyRef?: SourceRef;
  targetBodyRef?: SourceRef;
  bodyRefs?: SourceRef[];
  members?: Array<{ bodyRef?: SourceRef }>;
  sourceFeatureId?: string;
  rotationDegrees?: [number, number, number];
  planeRef?: PlaneRef;
  placement?: Placement;
}

/** Resolve manufacturing identity and orientation from exact feature history. */
export class WoodworkingController {
  constructor(private readonly d: WoodworkingControllerDeps) {}

  getUnit(): 'in' | 'mm' {
    return this.d.getDocument().config.units === 'mm' ? 'mm' : 'in';
  }

  formatLengthInput(valueInches: number): string {
    const displayed = this.getUnit() === 'mm' ? valueInches * 25.4 : valueInches;
    return String(Number(displayed.toFixed(6)));
  }

  resolveWoodworkingMetadata(
    bodyId: string,
    featureId = this.d.getFeatureByBodyId(bodyId)?.id,
    visited = new Set<string>()
  ): BodyWoodworkingMetadata | null {
    const visitKey = `${featureId ?? 'instance'}:${bodyId}`;
    if (visited.has(visitKey)) return null;
    visited.add(visitKey);
    const direct = this.d.getDocument().bodyMetadata?.[bodyId];
    const instance = this.d.getInstanceForBody(bodyId);
    const instanceSourceId = instance ? this.d.getInstanceSourceId(bodyId) : undefined;
    const instanceSourceOwner = instanceSourceId
      ? this.d.getInstanceSourceFeatureId?.(bodyId) ?? this.d.getFeatureByBodyId(instanceSourceId)?.id
      : undefined;
    if (direct && (!direct.sourceFeatureId || direct.sourceFeatureId === featureId
      || (instanceSourceOwner !== undefined && direct.sourceFeatureId === instanceSourceOwner))) {
      // Per-instance authoring stores world axes, not source-local axes.
      return structuredClone(direct);
    }

    if (instance) {
      if (!instanceSourceId) return null;
      const inherited = this.resolveWoodworkingMetadata(instanceSourceId, instanceSourceOwner, visited);
      return inherited ? transformAxes(inherited, new THREE.Matrix4().fromArray(instance.transform)) : null;
    }

    const feature = featureId ? this.d.getFeatureById(featureId) : this.d.getFeatureByBodyId(bodyId);
    if (!feature) return null;
    const parameters = feature.parameters as InheritanceParameters;
    const candidateRefs = [
      parameters.sourceBodyRef,
      parameters.bodyRef,
      ...(parameters.members?.map((member) => member.bodyRef) ?? []),
      ...(parameters.bodyRefs ?? []),
    ].filter((reference): reference is SourceRef => reference !== undefined);
    let sourceRef = candidateRefs.find((reference) => reference.bodyId === bodyId);
    if (!sourceRef && feature.type === 'transformBodies') {
      const outputIndex = this.getOutputIndex(feature, bodyId);
      sourceRef = outputIndex >= 0 ? parameters.bodyRefs?.[outputIndex] : undefined;
    }
    if (!sourceRef && ['bodyBoolean', 'woodJoint', 'joinBodies'].includes(feature.type)) {
      sourceRef = parameters.targetBodyRef ?? candidateRefs[0];
    }
    sourceRef ??= parameters.sourceBodyRef;
    sourceRef ??= parameters.targetBodyRef;
    const sourceFeatureId = sourceRef?.featureId ?? parameters.sourceFeatureId;
    // Legacy single-source patterns rebuild the first body of that exact
    // source feature, even if a later feature has replaced it in the scene.
    const sourceBodyId = sourceRef?.bodyId ?? (sourceFeatureId
      ? this.d.getBodiesByFeature().get(sourceFeatureId)?.[0]?.id
      : undefined);
    if (!sourceBodyId) return null;
    const inherited = this.resolveWoodworkingMetadata(sourceBodyId, sourceFeatureId, visited);
    if (!inherited) return null;

    if (feature.type === 'rotateBody' && parameters.rotationDegrees) {
      const [x, y, z] = parameters.rotationDegrees.map(THREE.MathUtils.degToRad) as [number, number, number];
      return transformAxes(inherited, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ')));
    }
    if (feature.type === 'transformBodies' && parameters.placement) {
      const context = createRebuildContext();
      context.bodiesByFeature = new Map(this.d.getBodiesByFeature());
      context.allBodies = this.d.getRebuiltBodies();
      const solved = solvePlacementMatrix(parameters.placement, context, feature.id);
      return solved.ok ? transformAxes(inherited, solved.matrix) : null;
    }
    if (feature.type === 'circularPattern') {
      const occurrence = getCircularPatternInstanceTransforms(
        feature.parameters as unknown as CircularPatternParams
      )[this.getOutputIndex(feature, bodyId)];
      return occurrence ? transformAxes(inherited, occurrence.transform) : null;
    }
    if (feature.type === 'mirror' && parameters.planeRef) {
      const plane = getConstructionPlaneFromRef(
        parameters.planeRef,
        this.d.getRebuiltBodies(),
        this.d.getBodiesByFeature()
      );
      if (!plane) return null;
      const normal = new THREE.Vector3(...plane.normal).normalize();
      const reflect = (axis: readonly [number, number, number]): [number, number, number] => {
        const vector = new THREE.Vector3(...axis);
        return vector.addScaledVector(normal, -2 * vector.dot(normal)).normalize().toArray();
      };
      return { ...inherited, grainAxis: reflect(inherited.grainAxis), thicknessAxis: reflect(inherited.thicknessAxis) };
    }
    return inherited;
  }

  private getOutputIndex(feature: FeatureRecord, bodyId: string): number {
    const bodies = this.d.getBodiesByFeature().get(feature.id);
    return bodies ? bodies.findIndex((body) => body.id === bodyId) : feature.refsOut.indexOf(bodyId);
  }
}

function transformAxes(metadata: BodyWoodworkingMetadata, matrix: THREE.Matrix4): BodyWoodworkingMetadata {
  const transform = (axis: readonly [number, number, number]): [number, number, number] =>
    new THREE.Vector3(...axis).transformDirection(matrix).toArray();
  return {
    ...metadata,
    grainAxis: transform(metadata.grainAxis),
    thicknessAxis: transform(metadata.thicknessAxis),
  };
}
