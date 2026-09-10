/**
 * Woodworking controller - handles woodworking metadata inheritance.
 * Extracted from App.ts for modularity.
 *
 * Pattern: injected deps (getters for reads, setters/actions for writes),
 * self-contained behavior, no App state ownership.
 */

import * as THREE from 'three';
import type { BodyWoodworkingMetadata, Document } from '../types';
import type { FeatureRecord } from '../features';
import type { ComponentInstance } from '../assembly';
import type { Body as BRepBody } from '../geometry';

export interface WoodworkingControllerDeps {
  // Reads
  getDocument: () => Document;
  getFeatureByBodyId: (bodyId: string) => FeatureRecord | null;
  getFeatureById: (featureId: string) => FeatureRecord | null;
  getInstanceForBody: (bodyId: string) => ComponentInstance | null;
  instanceBodySourceIds: Map<string, string>;
  rebuiltBodies: BRepBody[];

  // Writes / actions
  setBodyMetadata: (bodyId: string, metadata: BodyWoodworkingMetadata) => void;
  refreshUiChrome: () => void;
}

/** Deep-clone metadata to avoid mutation of shared objects. */
function cloneMetadata<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export class WoodworkingController {
  private readonly d: WoodworkingControllerDeps;

  constructor(deps: WoodworkingControllerDeps) {
    this.d = deps;
  }

  /** Get current unit preference from document config. */
  getUnit(): 'in' | 'mm' {
    return this.d.getDocument().config.units === 'mm' ? 'mm' : 'in';
  }

  /** Format inch-based model value in active document unit. */
  formatLengthInput(valueInches: number): string {
    const unit = this.getUnit();
    const displayed = unit === 'mm' ? valueInches * 25.4 : valueInches;
    return String(Number(displayed.toFixed(6)));
  }

  /** Resolve woodworking metadata with inheritance through instance hierarchies. */
  resolveWoodworkingMetadata(
    bodyId: string,
    featureId = this.d.getFeatureByBodyId(bodyId)?.id,
    visited = new Set<string>()
  ): BodyWoodworkingMetadata | null {
    const visitKey = `${featureId ?? 'instance'}:${bodyId}`;
    if (visited.has(visitKey)) return null;
    visited.add(visitKey);

    const direct = this.d.getDocument().bodyMetadata?.[bodyId];
    if (direct && (!direct.sourceFeatureId || direct.sourceFeatureId === featureId)) {
      return cloneMetadata(direct);
    }

    const instance = this.d.getInstanceForBody(bodyId);
    if (instance) {
      const sourceId = this.d.instanceBodySourceIds.get(bodyId);
      if (sourceId) {
        const inherited = this.resolveWoodworkingMetadata(sourceId, this.d.getFeatureByBodyId(sourceId)?.id, visited);
        return inherited ? this.transformAxes(inherited, new THREE.Matrix4().fromArray(instance.transform)) : null;
      }
    }

    const feature = featureId ? this.d.getFeatureById(featureId) : this.d.getFeatureByBodyId(bodyId);
    if (!feature) return direct ? cloneMetadata(direct) : null;

    const parameters = feature.parameters as Record<string, unknown>;
    const candidateRefs = this.collectSourceRefs(parameters);

    // Find direct reference to this body
    let sourceRef = candidateRefs.find((reference) => reference.bodyId === bodyId);

    // Boolean/join features inherit from target member
    if (!sourceRef && (feature.type === 'bodyBoolean' || feature.type === 'woodJoint' || feature.type === 'joinBodies')) {
      sourceRef = (parameters as { targetBodyRef?: { bodyId?: string } }).targetBodyRef ?? candidateRefs[0];
    }

    // Fallback to source/target refs for features that produce new body IDs
    sourceRef ??= (parameters as { sourceBodyRef?: { bodyId?: string } }).sourceBodyRef;
    sourceRef ??= (parameters as { targetBodyRef?: { bodyId?: string } }).targetBodyRef;

    const sourceFeatureId = sourceRef?.featureId ?? (parameters as { sourceFeatureId?: string }).sourceFeatureId;
    const sourceBodyId = sourceRef?.bodyId ?? (
      sourceFeatureId
        ? this.d.getFeatureById(sourceFeatureId)?.refsOut.find((id) => this.d.rebuiltBodies.some((b) => b.id === id))
        : undefined
    );

    if (!sourceBodyId) return direct ? cloneMetadata(direct) : null;
    const inherited = this.resolveWoodworkingMetadata(sourceBodyId, sourceFeatureId, visited);
    if (!inherited) return null;

    // Apply transform based on feature type
    if (feature.type === 'rotateBody') {
      const rotationDegrees = (parameters as { rotationDegrees?: [number, number, number] }).rotationDegrees;
      if (rotationDegrees) {
        const [x, y, z] = rotationDegrees.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number];
        return this.transformAxes(inherited, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ')));
      }
    }

    // Note: mirror feature axis transformation requires full PlaneRef structure
    // and is handled in App.ts where the rebuild context has access to face geometry
    return inherited;
  }

  private collectSourceRefs(
    parameters: Record<string, unknown>
  ): Array<{ featureId?: string; bodyId?: string }> {
    const refs = [
      (parameters as { sourceBodyRef?: { bodyId?: string } }).sourceBodyRef,
      (parameters as { bodyRef?: { bodyId?: string } }).bodyRef,
    ];
    const members = (parameters as { members?: Array<{ bodyRef?: { bodyId?: string } }> }).members ?? [];
    const memberRefs = members.map((m) => m.bodyRef).filter((r): r is { bodyId?: string } => r !== undefined);
    const bodyRefs = (parameters as { bodyRefs?: Array<{ bodyId?: string }> }).bodyRefs ?? [];
    return [...refs, ...memberRefs, ...bodyRefs].filter((r): r is { bodyId?: string } => r !== undefined);
  }

  private transformAxes(
    metadata: BodyWoodworkingMetadata,
    matrix: THREE.Matrix4
  ): BodyWoodworkingMetadata {
    const transform = (axis: readonly [number, number, number]): [number, number, number] => {
      const direction = new THREE.Vector3(...axis).transformDirection(matrix).normalize();
      return [direction.x, direction.y, direction.z];
    };
    return {
      ...metadata,
      grainAxis: transform(metadata.grainAxis),
      thicknessAxis: transform(metadata.thicknessAxis),
    };
  }
}
