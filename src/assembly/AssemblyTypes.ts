/**
 * Assembly Types - Milestone 06: Assembly-lite
 *
 * Types for components, instances, and constraints.
 * Components are reusable groups of features.
 * Instances place components with transforms.
 * Constraints position instances relative to each other.
 */

import { generateId } from '../core/id';

/**
 * Component = reusable definition of features and their bodies.
 * Groups features together so they can be instanced.
 */
export interface Component {
  id: string;
  name: string;
  featureIds: string[];      // Features belonging to this component
  bodyIds: string[];         // Bodies produced (populated during rebuild)
}

/**
 * ComponentInstance = places a component with a transform.
 * Each instance has its own transform and can be constrained.
 */
export interface ComponentInstance {
  id: string;
  componentId: string;
  name: string;
  transform: number[];       // 4x4 matrix (column-major)
  lockedAxes: LockedAxes;    // Axes locked by constraints
  grounded: boolean;         // If true, instance cannot move
}

/**
 * Axes locked by constraints.
 * Used to detect conflicts when adding constraints.
 */
export interface LockedAxes {
  translateX: boolean;
  translateY: boolean;
  translateZ: boolean;
  rotateX: boolean;
  rotateY: boolean;
  rotateZ: boolean;
}

/**
 * Reference to a face on a component instance.
 * Used in constraints to specify which face to mate.
 */
export interface InstanceFaceRef {
  instanceId: string;
  faceId: string;
  bodyId: string;
}

/**
 * MateConstraint = positions instances relative to each other.
 * Flush: faces are coplanar (normals anti-parallel).
 * Offset: faces are parallel with a specified distance.
 */
export interface MateConstraint {
  id: string;
  name: string;
  type: 'flush' | 'offset';
  refA: InstanceFaceRef;     // Face on instance A
  refB: InstanceFaceRef;     // Face on instance B
  offset: number;            // Distance (0 for flush)
  satisfied: boolean;        // Whether constraint is currently satisfied
  errorMessage?: string;     // Error if constraint cannot be solved
  suppressed: boolean;       // Whether this constraint is disabled
}

/**
 * Document extension for assembly data.
 */
export interface AssemblyData {
  components: Component[];
  instances: ComponentInstance[];
  constraints: MateConstraint[];
  activeComponentId: string | null;  // For edit-in-place
}

/**
 * Create a default locked axes state (all unlocked).
 */
export function createDefaultLockedAxes(): LockedAxes {
  return {
    translateX: false,
    translateY: false,
    translateZ: false,
    rotateX: false,
    rotateY: false,
    rotateZ: false,
  };
}

/**
 * Create an identity transform matrix (4x4, column-major).
 */
export function createIdentityTransform(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Create a translation transform matrix.
 */
export function createTranslationTransform(tx: number, ty: number, tz: number): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    tx, ty, tz, 1,
  ];
}

/**
 * Create a new component.
 */
export function createComponent(
  name: string,
  featureIds: string[] = [],
  bodyIds: string[] = []
): Component {
  return {
    id: generateId(),
    name,
    featureIds,
    bodyIds,
  };
}

/**
 * Create a new component instance.
 */
export function createComponentInstance(
  componentId: string,
  name: string,
  transform?: number[]
): ComponentInstance {
  return {
    id: generateId(),
    componentId,
    name,
    transform: transform ?? createIdentityTransform(),
    lockedAxes: createDefaultLockedAxes(),
    grounded: false,
  };
}

/**
 * Create a new mate constraint.
 */
export function createMateConstraint(
  type: 'flush' | 'offset',
  refA: InstanceFaceRef,
  refB: InstanceFaceRef,
  offset: number = 0,
  name?: string
): MateConstraint {
  return {
    id: generateId(),
    name: name ?? `${type.charAt(0).toUpperCase() + type.slice(1)} Mate`,
    type,
    refA,
    refB,
    offset,
    satisfied: false,
    suppressed: false,
  };
}

/**
 * Create an instance face reference.
 */
export function createInstanceFaceRef(
  instanceId: string,
  faceId: string,
  bodyId: string
): InstanceFaceRef {
  return {
    instanceId,
    faceId,
    bodyId,
  };
}

/**
 * Create default assembly data.
 */
export function createDefaultAssemblyData(): AssemblyData {
  return {
    components: [],
    instances: [],
    constraints: [],
    activeComponentId: null,
  };
}

/**
 * Check if two locked axes conflict.
 * Returns true if the same axis is locked in both.
 */
export function lockedAxesConflict(a: LockedAxes, b: LockedAxes): boolean {
  return (
    (a.translateX && b.translateX) ||
    (a.translateY && b.translateY) ||
    (a.translateZ && b.translateZ) ||
    (a.rotateX && b.rotateX) ||
    (a.rotateY && b.rotateY) ||
    (a.rotateZ && b.rotateZ)
  );
}

/**
 * Merge two locked axes (union of locked axes).
 */
export function mergeLockedAxes(a: LockedAxes, b: LockedAxes): LockedAxes {
  return {
    translateX: a.translateX || b.translateX,
    translateY: a.translateY || b.translateY,
    translateZ: a.translateZ || b.translateZ,
    rotateX: a.rotateX || b.rotateX,
    rotateY: a.rotateY || b.rotateY,
    rotateZ: a.rotateZ || b.rotateZ,
  };
}
