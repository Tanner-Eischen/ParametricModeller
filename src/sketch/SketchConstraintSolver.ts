import { DEFAULT_TOLERANCE_POLICY } from '../geometry/TolerancePolicy';
import {
  cloneNormalizedSketch,
  getExternallyDrivenPointIds,
  validateNormalizedSketch,
  type NormalizedSketchGeometry,
  type SketchSegmentReference,
} from './NormalizedSketch';
import type { SketchRelation, SketchRelationIssue } from './SketchConstraints';
import type { Point2D } from './SketchTypes';

export type SketchSolveStatus =
  | 'under_constrained'
  | 'fully_constrained'
  | 'over_constrained'
  | 'inconsistent';

export type SketchSolveDiagnosticCode =
  | 'INVALID_GEOMETRY'
  | 'INVALID_RELATION'
  | 'INCONSISTENT_CONSTRAINTS'
  | 'REDUNDANT_CONSTRAINTS';

export interface SketchSolveDiagnostic {
  code: SketchSolveDiagnosticCode;
  message: string;
  relationIds: string[];
  entityIds: string[];
}

export interface SketchSolveOptions {
  tolerance?: number;
  maximumIterations?: number;
  finiteDifferenceStep?: number;
  damping?: number;
}

export interface SketchSolveResult {
  ok: boolean;
  status: SketchSolveStatus;
  geometry: NormalizedSketchGeometry;
  degreesOfFreedom: number;
  rank: number;
  equationCount: number;
  iterations: number;
  maximumResidual: number;
  diagnostics: SketchSolveDiagnostic[];
}

interface SolverContext {
  pointIndexById: Map<string, number>;
  externallyDrivenPointById: Map<string, Point2D>;
  segmentById: Map<string, SketchSegmentReference>;
}

interface EquationEvaluation {
  residuals: number[];
  relationIdByEquation: string[];
}

const DEFAULT_MAXIMUM_ITERATIONS = 80;
const DEFAULT_DAMPING = 1e-8;

/**
 * Deterministic damped least-squares sketch solver.
 *
 * Invalid, inconsistent, and redundantly over-constrained systems fail closed
 * and return the original geometry. Successful results include rank and DOF.
 */
export function solveSketchConstraints(
  geometry: NormalizedSketchGeometry,
  relations: readonly SketchRelation[],
  options: SketchSolveOptions = {}
): SketchSolveResult {
  const original = cloneNormalizedSketch(geometry);
  const tolerance = positiveOrDefault(options.tolerance, DEFAULT_TOLERANCE_POLICY.linear);
  const finiteDifferenceStep = positiveOrDefault(
    options.finiteDifferenceStep,
    Math.max(tolerance * 0.1, 1e-8)
  );
  const damping = positiveOrDefault(options.damping, DEFAULT_DAMPING);
  const maximumIterations = positiveIntegerOrDefault(
    options.maximumIterations,
    DEFAULT_MAXIMUM_ITERATIONS
  );
  const geometryIssues = validateNormalizedSketch(geometry, tolerance);
  if (geometryIssues.length > 0) {
    return failureResult(original, 'inconsistent', [{
      code: 'INVALID_GEOMETRY',
      message: geometryIssues.map((issue) => issue.message).join(' '),
      relationIds: [],
      entityIds: [...new Set(geometryIssues.flatMap((issue) => issue.entityIds))].sort(),
    }]);
  }

  const sortedRelations = [...relations]
    .filter((relation) => !relation.suppressed)
    .sort((a, b) => a.id.localeCompare(b.id));
  const relationIssues = validateSketchRelations(geometry, sortedRelations);
  if (relationIssues.length > 0) {
    return failureResult(original, 'inconsistent', relationIssues.map(relationIssueToDiagnostic));
  }

  const points = [...geometry.points].sort((a, b) => a.id.localeCompare(b.id));
  const externallyDrivenPointIds = new Set(getExternallyDrivenPointIds(geometry));
  const freePoints = points.filter((point) => !externallyDrivenPointIds.has(point.id));
  const context: SolverContext = {
    pointIndexById: new Map(freePoints.map((point, index) => [point.id, index])),
    externallyDrivenPointById: new Map(
      points
        .filter((point) => externallyDrivenPointIds.has(point.id))
        .map((point) => [point.id, [...point.position]] as [string, Point2D])
    ),
    segmentById: new Map(geometry.segments.map((segment) => [segment.id, segment])),
  };
  let values = freePoints.flatMap((point) => point.position);
  let iterations = 0;
  let evaluation = evaluateRelations(values, sortedRelations, context, tolerance);

  while (maximumAbsolute(evaluation.residuals) > tolerance && iterations < maximumIterations) {
    const jacobian = numericalJacobian(
      values,
      evaluation.residuals,
      sortedRelations,
      context,
      tolerance,
      finiteDifferenceStep
    );
    const delta = solveDampedNormalEquations(jacobian, evaluation.residuals, damping);
    if (!delta) {
      break;
    }
    values = values.map((value, index) => value + delta[index]!);
    evaluation = evaluateRelations(values, sortedRelations, context, tolerance);
    iterations += 1;
  }

  const finalJacobian = numericalJacobian(
    values,
    evaluation.residuals,
    sortedRelations,
    context,
    tolerance,
    finiteDifferenceStep
  );
  const rank = matrixRank(finalJacobian, Math.max(tolerance, 1e-8));
  const equationCount = evaluation.residuals.length;
  const degreesOfFreedom = Math.max(0, values.length - rank);
  const maximumResidual = maximumAbsolute(evaluation.residuals);

  if (maximumResidual > tolerance) {
    const offendingRelationIds = relationIdsAboveTolerance(evaluation, tolerance);
    return {
      ...failureResult(original, 'inconsistent', [{
        code: 'INCONSISTENT_CONSTRAINTS',
        message: 'Constraints cannot be satisfied together; remove or change the highlighted relations.',
        relationIds: offendingRelationIds,
        entityIds: [],
      }]),
      rank,
      equationCount,
      degreesOfFreedom,
      iterations,
      maximumResidual,
    };
  }

  if (equationCount > rank) {
    return {
      ...failureResult(original, 'over_constrained', [{
        code: 'REDUNDANT_CONSTRAINTS',
        message: 'The sketch contains redundant constraints; remove one of the highlighted relations.',
        relationIds: sortedRelations.map((relation) => relation.id),
        entityIds: [],
      }]),
      rank,
      equationCount,
      degreesOfFreedom,
      iterations,
      maximumResidual,
    };
  }

  const solvedGeometry = cloneNormalizedSketch(geometry);
  const solvedPointById = new Map<string, Point2D>();
  for (const [index, point] of freePoints.entries()) {
    solvedPointById.set(point.id, [values[index * 2]!, values[index * 2 + 1]!]);
  }
  solvedGeometry.points = solvedGeometry.points.map((point) => ({
    ...point,
    position: solvedPointById.get(point.id) ?? [...point.position],
  }));
  return {
    ok: true,
    status: degreesOfFreedom === 0 ? 'fully_constrained' : 'under_constrained',
    geometry: solvedGeometry,
    degreesOfFreedom,
    rank,
    equationCount,
    iterations,
    maximumResidual,
    diagnostics: [],
  };
}

export function validateSketchRelations(
  geometry: NormalizedSketchGeometry,
  relations: readonly SketchRelation[]
): SketchRelationIssue[] {
  const pointIds = new Set(geometry.points.map((point) => point.id));
  const segmentIds = new Set(geometry.segments.map((segment) => segment.id));
  const relationIds = new Set<string>();
  const issues: SketchRelationIssue[] = [];

  for (const relation of [...relations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (relationIds.has(relation.id)) {
      issues.push({
        code: 'DUPLICATE_RELATION_ID',
        message: 'Constraint and dimension IDs must be unique.',
        relationIds: [relation.id],
        entityIds: [],
      });
    }
    relationIds.add(relation.id);

    if (relation.type === 'horizontal' || relation.type === 'vertical') {
      requireSegments(relation.id, [relation.segmentId], segmentIds, issues);
    } else if (
      relation.type === 'parallel'
      || relation.type === 'perpendicular'
      || relation.type === 'equal'
    ) {
      requireSegments(relation.id, [relation.segmentAId, relation.segmentBId], segmentIds, issues);
      if (relation.segmentAId === relation.segmentBId) {
        issues.push({
          code: 'SELF_REFERENCE',
          message: 'A two-segment constraint must reference two different segments.',
          relationIds: [relation.id],
          entityIds: [relation.segmentAId],
        });
      }
    } else if (relation.type === 'fixed') {
      requirePoints(relation.id, [relation.pointId], pointIds, issues);
      if (!Number.isFinite(relation.position[0]) || !Number.isFinite(relation.position[1])) {
        issues.push({
          code: 'INVALID_FIXED_POSITION',
          message: 'Fixed point coordinates must be finite.',
          relationIds: [relation.id],
          entityIds: [relation.pointId],
        });
      }
    } else {
      requirePoints(relation.id, [relation.pointAId, relation.pointBId], pointIds, issues);
      if (relation.pointAId === relation.pointBId) {
        issues.push({
          code: 'SELF_REFERENCE',
          message: 'A point relation must reference two different points.',
          relationIds: [relation.id],
          entityIds: [relation.pointAId],
        });
      }
      if (relation.type === 'distance' && (!Number.isFinite(relation.value) || relation.value <= 0)) {
        issues.push({
          code: 'INVALID_DISTANCE',
          message: 'Driving distance dimensions must be finite and greater than zero.',
          relationIds: [relation.id],
          entityIds: [relation.pointAId, relation.pointBId].sort(),
        });
      }
    }
  }

  return issues.sort((a, b) =>
    a.code.localeCompare(b.code) || a.relationIds.join('|').localeCompare(b.relationIds.join('|'))
  );
}

function evaluateRelations(
  values: readonly number[],
  relations: readonly SketchRelation[],
  context: SolverContext,
  tolerance: number
): EquationEvaluation {
  const residuals: number[] = [];
  const relationIdByEquation: string[] = [];
  const add = (relationId: string, ...valuesToAdd: number[]): void => {
    residuals.push(...valuesToAdd);
    relationIdByEquation.push(...valuesToAdd.map(() => relationId));
  };

  for (const relation of relations) {
    if (relation.type === 'coincident') {
      const a = pointValue(values, context, relation.pointAId);
      const b = pointValue(values, context, relation.pointBId);
      add(relation.id, a[0] - b[0], a[1] - b[1]);
    } else if (relation.type === 'horizontal') {
      const [start, end] = segmentValues(values, context, relation.segmentId);
      add(relation.id, end[1] - start[1]);
    } else if (relation.type === 'vertical') {
      const [start, end] = segmentValues(values, context, relation.segmentId);
      add(relation.id, end[0] - start[0]);
    } else if (relation.type === 'fixed') {
      const point = pointValue(values, context, relation.pointId);
      add(relation.id, point[0] - relation.position[0], point[1] - relation.position[1]);
    } else if (relation.type === 'distance') {
      const a = pointValue(values, context, relation.pointAId);
      const b = pointValue(values, context, relation.pointBId);
      add(relation.id, pointDistance(a, b) - relation.value);
    } else {
      const [aStart, aEnd] = segmentValues(values, context, relation.segmentAId);
      const [bStart, bEnd] = segmentValues(values, context, relation.segmentBId);
      const aVector = subtract(aEnd, aStart);
      const bVector = subtract(bEnd, bStart);
      const aLength = Math.max(pointLength(aVector), tolerance);
      const bLength = Math.max(pointLength(bVector), tolerance);
      if (relation.type === 'parallel') {
        add(relation.id, cross(aVector, bVector) / (aLength * bLength));
      } else if (relation.type === 'perpendicular') {
        add(relation.id, dot(aVector, bVector) / (aLength * bLength));
      } else {
        add(relation.id, aLength - bLength);
      }
    }
  }

  return { residuals, relationIdByEquation };
}

function numericalJacobian(
  values: readonly number[],
  baseResiduals: readonly number[],
  relations: readonly SketchRelation[],
  context: SolverContext,
  tolerance: number,
  step: number
): number[][] {
  const jacobian = baseResiduals.map(() => Array.from({ length: values.length }, () => 0));
  for (let column = 0; column < values.length; column++) {
    const perturbed = [...values];
    perturbed[column] = perturbed[column]! + step;
    const residuals = evaluateRelations(perturbed, relations, context, tolerance).residuals;
    for (let row = 0; row < baseResiduals.length; row++) {
      jacobian[row]![column] = (residuals[row]! - baseResiduals[row]!) / step;
    }
  }
  return jacobian;
}

function solveDampedNormalEquations(
  jacobian: readonly number[][],
  residuals: readonly number[],
  damping: number
): number[] | null {
  const columnCount = jacobian[0]?.length ?? 0;
  if (columnCount === 0) {
    return [];
  }
  const matrix = Array.from({ length: columnCount }, () =>
    Array.from({ length: columnCount }, () => 0)
  );
  const rightHandSide = Array.from({ length: columnCount }, () => 0);
  for (let row = 0; row < jacobian.length; row++) {
    for (let left = 0; left < columnCount; left++) {
      rightHandSide[left] = rightHandSide[left]! - jacobian[row]![left]! * residuals[row]!;
      for (let right = 0; right < columnCount; right++) {
        matrix[left]![right] = matrix[left]![right]!
          + jacobian[row]![left]! * jacobian[row]![right]!;
      }
    }
  }
  for (let index = 0; index < columnCount; index++) {
    matrix[index]![index] = matrix[index]![index]! + damping;
  }
  return gaussianSolve(matrix, rightHandSide);
}

function gaussianSolve(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < size; column++) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivotRow]![column]!)) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow]![column]!) < Number.EPSILON) {
      return null;
    }
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow]!, augmented[column]!];
    const pivot = augmented[column]![column]!;
    for (let index = column; index <= size; index++) {
      augmented[column]![index] = augmented[column]![index]! / pivot;
    }
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let index = column; index <= size; index++) {
        augmented[row]![index] = augmented[row]![index]! - factor * augmented[column]![index]!;
      }
    }
  }
  return augmented.map((row) => row[size]!);
}

function matrixRank(matrix: readonly number[][], tolerance: number): number {
  if (matrix.length === 0) return 0;
  const reduced = matrix.map((row) => [...row]);
  const rowCount = reduced.length;
  const columnCount = reduced[0]?.length ?? 0;
  let rank = 0;
  for (let column = 0; column < columnCount && rank < rowCount; column++) {
    let pivotRow = rank;
    for (let row = rank + 1; row < rowCount; row++) {
      if (Math.abs(reduced[row]![column]!) > Math.abs(reduced[pivotRow]![column]!)) {
        pivotRow = row;
      }
    }
    if (Math.abs(reduced[pivotRow]![column]!) <= tolerance) continue;
    [reduced[rank], reduced[pivotRow]] = [reduced[pivotRow]!, reduced[rank]!];
    const pivot = reduced[rank]![column]!;
    for (let index = column; index < columnCount; index++) {
      reduced[rank]![index] = reduced[rank]![index]! / pivot;
    }
    for (let row = 0; row < rowCount; row++) {
      if (row === rank) continue;
      const factor = reduced[row]![column]!;
      for (let index = column; index < columnCount; index++) {
        reduced[row]![index] = reduced[row]![index]! - factor * reduced[rank]![index]!;
      }
    }
    rank += 1;
  }
  return rank;
}

function requirePoints(
  relationId: string,
  requiredIds: string[],
  availableIds: Set<string>,
  issues: SketchRelationIssue[]
): void {
  const missingIds = requiredIds.filter((id) => !availableIds.has(id)).sort();
  if (missingIds.length > 0) {
    issues.push({
      code: 'MISSING_POINT',
      message: 'Constraint references a sketch point that does not exist.',
      relationIds: [relationId],
      entityIds: missingIds,
    });
  }
}

function requireSegments(
  relationId: string,
  requiredIds: string[],
  availableIds: Set<string>,
  issues: SketchRelationIssue[]
): void {
  const missingIds = requiredIds.filter((id) => !availableIds.has(id)).sort();
  if (missingIds.length > 0) {
    issues.push({
      code: 'MISSING_SEGMENT',
      message: 'Constraint references a sketch segment that does not exist.',
      relationIds: [relationId],
      entityIds: missingIds,
    });
  }
}

function relationIssueToDiagnostic(issue: SketchRelationIssue): SketchSolveDiagnostic {
  return {
    code: 'INVALID_RELATION',
    message: issue.message,
    relationIds: [...issue.relationIds],
    entityIds: [...issue.entityIds],
  };
}

function failureResult(
  geometry: NormalizedSketchGeometry,
  status: 'over_constrained' | 'inconsistent',
  diagnostics: SketchSolveDiagnostic[]
): SketchSolveResult {
  return {
    ok: false,
    status,
    geometry,
    degreesOfFreedom: geometry.points.length * 2,
    rank: 0,
    equationCount: 0,
    iterations: 0,
    maximumResidual: 0,
    diagnostics,
  };
}

function pointValue(
  values: readonly number[],
  context: SolverContext,
  pointId: string
): Point2D {
  const external = context.externallyDrivenPointById.get(pointId);
  if (external) return external;
  const index = context.pointIndexById.get(pointId)! * 2;
  return [values[index]!, values[index + 1]!];
}

function segmentValues(
  values: readonly number[],
  context: SolverContext,
  segmentId: string
): [Point2D, Point2D] {
  const segment = context.segmentById.get(segmentId)!;
  return [
    pointValue(values, context, segment.startPointId),
    pointValue(values, context, segment.endPointId),
  ];
}

function relationIdsAboveTolerance(
  evaluation: EquationEvaluation,
  tolerance: number
): string[] {
  const ids = evaluation.residuals.flatMap((residual, index) =>
    Math.abs(residual) > tolerance ? [evaluation.relationIdByEquation[index]!] : []
  );
  return [...new Set(ids)].sort();
}

function maximumAbsolute(values: readonly number[]): number {
  return values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
}

function subtract(left: Point2D, right: Point2D): Point2D {
  return [left[0] - right[0], left[1] - right[1]];
}

function pointDistance(left: Point2D, right: Point2D): number {
  return pointLength(subtract(left, right));
}

function pointLength(point: Point2D): number {
  return Math.hypot(point[0], point[1]);
}

function cross(left: Point2D, right: Point2D): number {
  return left[0] * right[1] - left[1] * right[0];
}

function dot(left: Point2D, right: Point2D): number {
  return left[0] * right[0] + left[1] * right[1];
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
