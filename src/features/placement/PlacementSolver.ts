import * as THREE from 'three';
import type {
  Matrix4Tuple,
  Vector3Tuple,
} from '../../geometry/CoordinateFrame3D';
import {
  coordinateFrameToMatrix,
  coordinateFrameFromMatrix,
  createCoordinateFrameFromZAxis,
} from '../../geometry/CoordinateFrame3D';
import type { Diagnostic } from '../Diagnostics';
import { error } from '../Diagnostics';
import type { RebuildContext } from '../RebuildContext';
import type {
  EdgePlacementRef,
  FacePlacementRef,
  PlacementPointRef,
  PlacementReference,
} from './PlacementReferences';
import {
  resolvePlacementFrame,
  resolvePlacementPoint,
} from './PlacementReferences';

export interface PointToPointPlacement {
  type: 'PointToPoint';
  source: PlacementPointRef;
  target: PlacementPointRef;
  /** Applied in world coordinates after coinciding source with target. */
  offset?: Vector3Tuple;
}

export interface AlignPlacement {
  type: 'Align';
  source: FacePlacementRef;
  target: FacePlacementRef;
  /** Signed distance along the target face normal. */
  gap?: number;
  /** Integer quarter turns around the aligned source face normal. */
  quarterTurns?: number;
  /** Align source and target normals anti-parallel instead of parallel. */
  opposed?: boolean;
}

export interface AxisAnglePlacement {
  type: 'AxisAngle';
  axis: EdgePlacementRef;
  angleDegrees: number;
}

export interface FreePlacement {
  type: 'Free';
  translation: Vector3Tuple;
  rotationDegrees: Vector3Tuple;
  /** Fixed world-space pivot; defaults to the world origin. */
  pivot?: Vector3Tuple;
}

export interface FixedMatrixPlacement {
  type: 'FixedMatrix';
  /** Column-major Three.js matrix elements. Must represent a rigid transform. */
  matrix: Matrix4Tuple;
}

export type Placement =
  | PointToPointPlacement
  | AlignPlacement
  | AxisAnglePlacement
  | FreePlacement
  | FixedMatrixPlacement;

export type PlacementSolveResult =
  | { ok: true; matrix: THREE.Matrix4 }
  | { ok: false; diagnostics: Diagnostic[] };

export function validatePlacementDefinition(placement: unknown): Diagnostic[] {
  if (!isRecord(placement) || typeof placement.type !== 'string') {
    return [error(
      'INVALID_PLACEMENT_TYPE',
      'Placement must be PointToPoint, Align, AxisAngle, Free, or FixedMatrix.'
    )];
  }

  switch (placement.type) {
    case 'PointToPoint':
      return [
        ...validateReference(placement.source, ['body', 'vertex', 'edgePoint', 'faceCenter'], 'source'),
        ...validateReference(placement.target, ['body', 'vertex', 'edgePoint', 'faceCenter'], 'target'),
        ...(placement.offset === undefined || isFiniteVectorValue(placement.offset)
          ? []
          : [error('INVALID_POINT_OFFSET', 'Point-to-point offset must contain three finite values.')]),
      ];
    case 'Align':
      return [
        ...validateReference(placement.source, ['face'], 'source face'),
        ...validateReference(placement.target, ['face'], 'target face'),
        ...(placement.gap === undefined || (
          typeof placement.gap === 'number' && Number.isFinite(placement.gap)
        )
          ? []
          : [error('INVALID_ALIGN_GAP', 'Align gap must be a finite signed distance.')]),
        ...(placement.quarterTurns === undefined || (
          typeof placement.quarterTurns === 'number' && Number.isInteger(placement.quarterTurns)
        )
          ? []
          : [error(
              'INVALID_ALIGN_QUARTER_TURNS',
              'Align quarter turns must be an integer.'
            )]),
        ...(placement.opposed === undefined || typeof placement.opposed === 'boolean'
          ? []
          : [error('INVALID_ALIGN_OPPOSED', 'Align opposed must be a boolean.')]),
      ];
    case 'AxisAngle':
      return [
        ...validateReference(placement.axis, ['edge'], 'rotation axis'),
        ...(typeof placement.angleDegrees === 'number' && Number.isFinite(placement.angleDegrees)
          ? []
          : [error(
              'INVALID_AXIS_ANGLE',
              'Axis-angle rotation must use a finite angle in degrees.'
            )]),
      ];
    case 'Free':
      return [
        ...(isFiniteVectorValue(placement.translation)
          ? []
          : [error(
              'INVALID_FREE_TRANSLATION',
              'Free placement translation must contain three finite values.'
            )]),
        ...(isFiniteVectorValue(placement.rotationDegrees)
          ? []
          : [error(
              'INVALID_FREE_ROTATION',
              'Free placement rotation must contain three finite degree values.'
            )]),
        ...(placement.pivot === undefined || isFiniteVectorValue(placement.pivot)
          ? []
          : [error(
              'INVALID_FREE_PIVOT',
              'Free placement pivot must contain three finite values.'
            )]),
      ];
    case 'FixedMatrix':
      return Array.isArray(placement.matrix)
        && placement.matrix.length === 16
        && placement.matrix.every((value) =>
          typeof value === 'number' && Number.isFinite(value)
        )
        ? []
        : [error(
            'INVALID_FIXED_MATRIX',
            'Fixed placement matrix must contain 16 finite values.'
          )];
    default:
      return [error(
        'INVALID_PLACEMENT_TYPE',
        `Unsupported placement type "${placement.type}".`
      )];
  }
}

export function createPointToPointPlacement(
  source: PlacementPointRef,
  target: PlacementPointRef,
  offset: Vector3Tuple = [0, 0, 0]
): PointToPointPlacement {
  return { type: 'PointToPoint', source, target, offset: [...offset] };
}

export function createAlignPlacement(
  source: FacePlacementRef,
  target: FacePlacementRef,
  gap = 0,
  quarterTurns = 0,
  opposed = false
): AlignPlacement {
  return { type: 'Align', source, target, gap, quarterTurns, opposed };
}

export function createAxisAnglePlacement(
  axis: EdgePlacementRef,
  angleDegrees: number
): AxisAnglePlacement {
  return { type: 'AxisAngle', axis, angleDegrees };
}

export function createFreePlacement(
  translation: Vector3Tuple = [0, 0, 0],
  rotationDegrees: Vector3Tuple = [0, 0, 0],
  pivot: Vector3Tuple = [0, 0, 0]
): FreePlacement {
  return {
    type: 'Free',
    translation: [...translation],
    rotationDegrees: [...rotationDegrees],
    pivot: [...pivot],
  };
}

export function createFixedMatrixPlacement(
  matrix: THREE.Matrix4 | Matrix4Tuple
): FixedMatrixPlacement {
  return {
    type: 'FixedMatrix',
    matrix: (matrix instanceof THREE.Matrix4 ? matrix.toArray() : [...matrix]) as Matrix4Tuple,
  };
}

export function getPlacementReferences(placement: Placement): PlacementReference[] {
  switch (placement.type) {
    case 'PointToPoint':
      return [placement.source, placement.target];
    case 'Align':
      return [placement.source, placement.target];
    case 'AxisAngle':
      return [placement.axis];
    case 'Free':
    case 'FixedMatrix':
      return [];
  }
}

export function solvePlacementMatrix(
  placement: Placement,
  context: Pick<RebuildContext, 'bodiesByFeature'>,
  ownerFeatureId?: string
): PlacementSolveResult {
  const definitionDiagnostics = validatePlacementDefinition(placement);
  if (definitionDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: definitionDiagnostics.map((diagnostic) => ({
        ...diagnostic,
        ...(ownerFeatureId === undefined ? {} : { featureId: ownerFeatureId }),
      })),
    };
  }

  switch (placement.type) {
    case 'PointToPoint':
      return solvePointToPoint(placement, context, ownerFeatureId);
    case 'Align':
      return solveAlign(placement, context, ownerFeatureId);
    case 'AxisAngle':
      return solveAxisAngle(placement, context, ownerFeatureId);
    case 'Free':
      return solveFree(placement, ownerFeatureId);
    case 'FixedMatrix':
      return solveFixedMatrix(placement, ownerFeatureId);
  }
}

/** Alias for consumers that use placement-solver terminology. */
export const solvePlacement = solvePlacementMatrix;

function solvePointToPoint(
  placement: PointToPointPlacement,
  context: Pick<RebuildContext, 'bodiesByFeature'>,
  ownerFeatureId?: string
): PlacementSolveResult {
  const source = resolvePlacementPoint(context, placement.source, ownerFeatureId);
  if (!source.ok) return { ok: false, diagnostics: [source.diagnostic] };
  const target = resolvePlacementPoint(context, placement.target, ownerFeatureId);
  if (!target.ok) return { ok: false, diagnostics: [target.diagnostic] };
  const offset = placement.offset ?? [0, 0, 0];
  if (!isFiniteVector(offset)) {
    return invalidPlacement(
      'INVALID_POINT_OFFSET',
      'Point-to-point offset must contain three finite values.',
      ownerFeatureId
    );
  }

  return {
    ok: true,
    matrix: new THREE.Matrix4().makeTranslation(
      target.value[0] + offset[0] - source.value[0],
      target.value[1] + offset[1] - source.value[1],
      target.value[2] + offset[2] - source.value[2]
    ),
  };
}

function solveAlign(
  placement: AlignPlacement,
  context: Pick<RebuildContext, 'bodiesByFeature'>,
  ownerFeatureId?: string
): PlacementSolveResult {
  const source = resolvePlacementFrame(context, placement.source, ownerFeatureId);
  if (!source.ok) return { ok: false, diagnostics: [source.diagnostic] };
  const target = resolvePlacementFrame(context, placement.target, ownerFeatureId);
  if (!target.ok) return { ok: false, diagnostics: [target.diagnostic] };

  const gap = placement.gap ?? 0;
  const quarterTurns = placement.quarterTurns ?? 0;
  if (!Number.isFinite(gap)) {
    return invalidPlacement(
      'INVALID_ALIGN_GAP',
      'Align gap must be a finite signed distance.',
      ownerFeatureId
    );
  }
  if (!Number.isInteger(quarterTurns)) {
    return invalidPlacement(
      'INVALID_ALIGN_QUARTER_TURNS',
      'Align quarter turns must be an integer.',
      ownerFeatureId
    );
  }

  const targetNormal = new THREE.Vector3(...target.value.zAxis);
  const desiredNormal = placement.opposed
    ? targetNormal.clone().negate()
    : targetNormal.clone();
  const desiredX = new THREE.Vector3(...target.value.xAxis)
    .applyAxisAngle(desiredNormal, quarterTurns * Math.PI / 2)
    .normalize();
  const desiredOrigin = new THREE.Vector3(...target.value.origin)
    .addScaledVector(targetNormal, gap);
  const destination = createCoordinateFrameFromZAxis(
    desiredOrigin.toArray() as Vector3Tuple,
    desiredNormal.toArray() as Vector3Tuple,
    desiredX.toArray() as Vector3Tuple
  );

  const matrix = coordinateFrameToMatrix(destination)
    .multiply(coordinateFrameToMatrix(source.value).invert());
  return { ok: true, matrix };
}

function solveAxisAngle(
  placement: AxisAnglePlacement,
  context: Pick<RebuildContext, 'bodiesByFeature'>,
  ownerFeatureId?: string
): PlacementSolveResult {
  if (!Number.isFinite(placement.angleDegrees)) {
    return invalidPlacement(
      'INVALID_AXIS_ANGLE',
      'Axis-angle rotation must use a finite angle in degrees.',
      ownerFeatureId
    );
  }
  const axisFrame = resolvePlacementFrame(context, placement.axis, ownerFeatureId);
  if (!axisFrame.ok) {
    return { ok: false, diagnostics: [axisFrame.diagnostic] };
  }

  const pivot = new THREE.Vector3(...axisFrame.value.origin);
  const axis = new THREE.Vector3(...axisFrame.value.xAxis);
  const rotation = new THREE.Matrix4().makeRotationAxis(
    axis,
    THREE.MathUtils.degToRad(placement.angleDegrees)
  );
  const matrix = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  return { ok: true, matrix };
}

function solveFree(
  placement: FreePlacement,
  ownerFeatureId?: string
): PlacementSolveResult {
  const pivot = placement.pivot ?? [0, 0, 0];
  if (
    !isFiniteVector(placement.translation)
    || !isFiniteVector(placement.rotationDegrees)
    || !isFiniteVector(pivot)
  ) {
    return invalidPlacement(
      'INVALID_FREE_PLACEMENT',
      'Free placement translation, rotation, and pivot must contain finite values.',
      ownerFeatureId
    );
  }

  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    ...placement.rotationDegrees.map(THREE.MathUtils.degToRad) as Vector3Tuple,
    'XYZ'
  ));
  const matrix = new THREE.Matrix4()
    .makeTranslation(...placement.translation)
    .multiply(new THREE.Matrix4().makeTranslation(...pivot))
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
  return { ok: true, matrix };
}

function solveFixedMatrix(
  placement: FixedMatrixPlacement,
  ownerFeatureId?: string
): PlacementSolveResult {
  if (placement.matrix.length !== 16 || !placement.matrix.every(Number.isFinite)) {
    return invalidPlacement(
      'INVALID_FIXED_MATRIX',
      'Fixed placement matrix must contain 16 finite values.',
      ownerFeatureId
    );
  }
  const matrix = new THREE.Matrix4().fromArray(placement.matrix);
  try {
    coordinateFrameFromMatrix(matrix);
  } catch {
    return invalidPlacement(
      'NON_RIGID_FIXED_MATRIX',
      'Fixed placement matrix must be a rigid, right-handed transform without scale or shear.',
      ownerFeatureId
    );
  }
  return { ok: true, matrix };
}

function isFiniteVector(value: Vector3Tuple): boolean {
  return value.length === 3 && value.every(Number.isFinite);
}

function isFiniteVectorValue(value: unknown): value is Vector3Tuple {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) =>
      typeof component === 'number' && Number.isFinite(component)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateReference(
  value: unknown,
  allowedKinds: PlacementReference['kind'][],
  label: string
): Diagnostic[] {
  if (
    !isRecord(value)
    || typeof value.kind !== 'string'
    || !allowedKinds.includes(value.kind as PlacementReference['kind'])
  ) {
    return [error(
      'INVALID_PLACEMENT_REF',
      `Placement ${label} must be a ${allowedKinds.join(' or ')} reference.`
    )];
  }
  const diagnostics: Diagnostic[] = [];
  if (typeof value.featureId !== 'string' || value.featureId.length === 0) {
    diagnostics.push(error(
      'INVALID_PLACEMENT_REF',
      `Placement ${label} requires a featureId.`
    ));
  }
  if (typeof value.bodyId !== 'string' || value.bodyId.length === 0) {
    diagnostics.push(error(
      'INVALID_PLACEMENT_REF',
      `Placement ${label} requires a bodyId.`
    ));
  }
  if (
    (value.kind === 'face' || value.kind === 'faceCenter')
    && (typeof value.faceId !== 'string' || value.faceId.length === 0)
  ) {
    diagnostics.push(error(
      'INVALID_PLACEMENT_REF',
      `Placement ${label} requires a faceId.`
    ));
  }
  if (
    (value.kind === 'edge' || value.kind === 'edgePoint')
    && (typeof value.edgeId !== 'string' || value.edgeId.length === 0)
  ) {
    diagnostics.push(error(
      'INVALID_PLACEMENT_REF',
      `Placement ${label} requires an edgeId.`
    ));
  }
  if (
    value.kind === 'vertex'
    && (typeof value.vertexId !== 'string' || value.vertexId.length === 0)
  ) {
    diagnostics.push(error(
      'INVALID_PLACEMENT_REF',
      `Placement ${label} requires a vertexId.`
    ));
  }
  if (
    value.kind === 'edgePoint'
    && (
      typeof value.parameter !== 'number'
      || !Number.isFinite(value.parameter)
      || value.parameter < 0
      || value.parameter > 1
    )
  ) {
    diagnostics.push(error(
      'INVALID_PLACEMENT_EDGE_PARAMETER',
      `Placement ${label} edge parameter must be between 0 and 1.`
    ));
  }
  return diagnostics;
}

function invalidPlacement(
  code: string,
  message: string,
  ownerFeatureId?: string
): PlacementSolveResult {
  return {
    ok: false,
    diagnostics: [error(code, message, ownerFeatureId)],
  };
}
