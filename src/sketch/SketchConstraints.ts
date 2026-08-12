import type { Point2D } from './SketchTypes';

interface SketchConstraintBase {
  id: string;
  suppressed?: boolean;
}

export interface CoincidentConstraint extends SketchConstraintBase {
  type: 'coincident';
  pointAId: string;
  pointBId: string;
}

export interface HorizontalConstraint extends SketchConstraintBase {
  type: 'horizontal';
  segmentId: string;
}

export interface VerticalConstraint extends SketchConstraintBase {
  type: 'vertical';
  segmentId: string;
}

export interface ParallelConstraint extends SketchConstraintBase {
  type: 'parallel';
  segmentAId: string;
  segmentBId: string;
}

export interface PerpendicularConstraint extends SketchConstraintBase {
  type: 'perpendicular';
  segmentAId: string;
  segmentBId: string;
}

export interface EqualConstraint extends SketchConstraintBase {
  type: 'equal';
  segmentAId: string;
  segmentBId: string;
}

export interface FixedConstraint extends SketchConstraintBase {
  type: 'fixed';
  pointId: string;
  position: Point2D;
}

export type SketchConstraint =
  | CoincidentConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | ParallelConstraint
  | PerpendicularConstraint
  | EqualConstraint
  | FixedConstraint;

export interface DrivingDistanceDimension extends SketchConstraintBase {
  type: 'distance';
  pointAId: string;
  pointBId: string;
  value: number;
  name?: string;
}

export type SketchRelation = SketchConstraint | DrivingDistanceDimension;

export type SketchRelationIssueCode =
  | 'DUPLICATE_RELATION_ID'
  | 'MISSING_POINT'
  | 'MISSING_SEGMENT'
  | 'INVALID_DISTANCE'
  | 'INVALID_FIXED_POSITION'
  | 'SELF_REFERENCE';

export interface SketchRelationIssue {
  code: SketchRelationIssueCode;
  message: string;
  relationIds: string[];
  entityIds: string[];
}
