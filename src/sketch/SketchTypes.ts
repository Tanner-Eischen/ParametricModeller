import { generateId } from '../core/id';

/**
 * Reference to a plane for sketching.
 * Can be a world plane (XY, XZ, YZ) or a face of an existing body.
 */
export interface PlaneRef {
  /** Unique identifier for this reference */
  id: string;
  /** Type of plane reference */
  type: 'world' | 'face';
  /** World plane type (only if type === 'world') */
  worldPlane?: 'xy' | 'xz' | 'yz';
  /** Offset from world plane origin */
  offset?: number;
  /** Face ID (only if type === 'face') */
  faceId?: string;
  /** Body ID containing the face (only if type === 'face') */
  bodyId?: string;
  /** Feature that produced the referenced body (new face references only) */
  featureId?: string;
  /** Stable world-space sketch origin for newly attached face sketches */
  origin?: [number, number, number];
}

/**
 * 2D point in sketch coordinates.
 */
export type Point2D = [number, number];

/**
 * Base interface for all sketch entities.
 */
export interface SketchEntityBase {
  /** Unique identifier for this entity */
  id: string;
  /** Entity type discriminator */
  type: string;
}

/**
 * Rectangle sketch entity.
 * Defined by origin corner, width, height, and rotation.
 */
export interface RectangleEntity extends SketchEntityBase {
  type: 'rectangle';
  /** Origin corner (bottom-left in unrotated state) */
  origin: Point2D;
  /** Width along local X axis */
  width: number;
  /** Height along local Y axis */
  height: number;
  /** Rotation around origin in radians */
  rotation: number;
}

/**
 * Line segment sketch entity.
 */
export interface LineEntity extends SketchEntityBase {
  type: 'line';
  /** Start point */
  start: Point2D;
  /** End point */
  end: Point2D;
}

/**
 * Union type of all sketch entities.
 * For v1 (Milestone 02), we only support rectangles.
 */
export type SketchEntity = RectangleEntity | LineEntity;

/**
 * Dimension constraint on a sketch entity.
 */
export interface SketchDimension {
  /** Unique identifier */
  id: string;
  /** Type of dimension */
  type: 'width' | 'height' | 'distance' | 'angle';
  /** Entity ID this dimension applies to */
  entityId: string;
  /** Dimension value */
  value: number;
  /** Optional name for display */
  name?: string;
}

/**
 * A sketch containing 2D entities on a plane.
 */
export interface Sketch {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Reference to the plane this sketch is on */
  planeRef: PlaneRef;
  /** All entities in the sketch */
  entities: SketchEntity[];
  /** Dimension constraints */
  dimensions: SketchDimension[];
}

/**
 * A 2D profile (closed loop) extracted from sketch entities.
 * Used for extrude operations.
 */
export interface Profile2D {
  /** Unique identifier */
  id: string;
  /** Sketch ID this profile came from */
  sketchId: string;
  /** 2D points forming a closed loop (CCW winding) */
  loop: Point2D[];
  /** Entity IDs that form this profile */
  entityIds: string[];
  /** Whether the profile is valid (closed and non-self-intersecting) */
  isValid: boolean;
}

// Factory functions

/**
 * Create a world plane reference.
 */
export function createWorldPlaneRef(
  worldPlane: 'xy' | 'xz' | 'yz',
  offset = 0
): PlaneRef {
  return {
    id: generateId(),
    type: 'world',
    worldPlane,
    offset,
  };
}

/**
 * Create a face plane reference.
 */
export function createFacePlaneRef(
  faceId: string,
  bodyId: string,
  featureId?: string,
  origin?: [number, number, number]
): PlaneRef {
  return {
    id: generateId(),
    type: 'face',
    faceId,
    bodyId,
    ...(featureId ? { featureId } : {}),
    ...(origin ? { origin: [...origin] } : {}),
  };
}

/**
 * Create a rectangle entity.
 */
export function createRectangleEntity(
  origin: Point2D,
  width: number,
  height: number,
  rotation = 0,
  id?: string
): RectangleEntity {
  return {
    id: id ?? generateId(),
    type: 'rectangle',
    origin,
    width,
    height,
    rotation,
  };
}

/**
 * Create a line entity.
 */
export function createLineEntity(
  start: Point2D,
  end: Point2D,
  id?: string
): LineEntity {
  return {
    id: id ?? generateId(),
    type: 'line',
    start,
    end,
  };
}

/**
 * Create a sketch dimension.
 */
export function createSketchDimension(
  type: SketchDimension['type'],
  entityId: string,
  value: number,
  name?: string
): SketchDimension {
  const dim: SketchDimension = {
    id: generateId(),
    type,
    entityId,
    value,
  };
  if (name !== undefined) {
    dim.name = name;
  }
  return dim;
}

/**
 * Create an empty sketch.
 */
export function createSketch(
  planeRef: PlaneRef,
  name = 'Sketch',
  id?: string
): Sketch {
  return {
    id: id ?? generateId(),
    name,
    planeRef,
    entities: [],
    dimensions: [],
  };
}

/**
 * Add an entity to a sketch.
 */
export function addEntityToSketch(
  sketch: Sketch,
  entity: SketchEntity
): Sketch {
  return {
    ...sketch,
    entities: [...sketch.entities, entity],
  };
}

/**
 * Add a dimension to a sketch.
 */
export function addDimensionToSketch(
  sketch: Sketch,
  dimension: SketchDimension
): Sketch {
  return {
    ...sketch,
    dimensions: [...sketch.dimensions, dimension],
  };
}

/**
 * Update an entity in a sketch.
 */
export function updateEntityInSketch(
  sketch: Sketch,
  entityId: string,
  updates: Partial<SketchEntity>
): Sketch {
  return {
    ...sketch,
    entities: sketch.entities.map((e): SketchEntity => {
      if (e.id === entityId) {
        // Merge updates while preserving the original type
        const updated = { ...e, ...updates } as SketchEntity;
        return updated;
      }
      return e;
    }),
  };
}

/**
 * Get an entity by ID.
 */
export function getEntityById(
  sketch: Sketch,
  entityId: string
): SketchEntity | undefined {
  return sketch.entities.find((e) => e.id === entityId);
}

/**
 * Get all rectangle entities from a sketch.
 */
export function getRectangles(sketch: Sketch): RectangleEntity[] {
  return sketch.entities.filter(
    (e): e is RectangleEntity => e.type === 'rectangle'
  );
}

/**
 * Validate a rectangle entity.
 */
export function validateRectangle(rect: RectangleEntity): string[] {
  const errors: string[] = [];

  if (rect.width <= 0) {
    errors.push('Width must be greater than 0');
  }

  if (rect.height <= 0) {
    errors.push('Height must be greater than 0');
  }

  if (!isFinite(rect.rotation)) {
    errors.push('Rotation must be a finite number');
  }

  return errors;
}

/**
 * Get the four corners of a rectangle.
 * Returns points in CCW order starting from origin.
 */
export function getRectangleCorners(rect: RectangleEntity): Point2D[] {
  const { origin, width, height, rotation } = rect;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Local corners relative to origin
  const localCorners: Point2D[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];

  // Transform to world coordinates
  return localCorners.map(([lx, ly]) => [
    origin[0] + lx * cos - ly * sin,
    origin[1] + lx * sin + ly * cos,
  ]);
}

/**
 * Serialize a plane reference to JSON.
 */
export function serializePlaneRef(ref: PlaneRef): object {
  return { ...ref };
}

/**
 * Deserialize a plane reference from JSON.
 */
export function deserializePlaneRef(data: PlaneRef): PlaneRef {
  return { ...data };
}

/**
 * Serialize a sketch entity to JSON.
 */
export function serializeSketchEntity(entity: SketchEntity): object {
  return { ...entity };
}

/**
 * Deserialize a sketch entity from JSON.
 */
export function deserializeSketchEntity(data: SketchEntity): SketchEntity {
  return { ...data } as SketchEntity;
}

/**
 * Serialize a sketch to JSON.
 */
export function serializeSketch(sketch: Sketch): object {
  return {
    id: sketch.id,
    name: sketch.name,
    planeRef: serializePlaneRef(sketch.planeRef),
    entities: sketch.entities.map(serializeSketchEntity),
    dimensions: sketch.dimensions,
  };
}

/**
 * Deserialize a sketch from JSON.
 */
export function deserializeSketch(data: {
  id: string;
  name: string;
  planeRef: PlaneRef;
  entities: SketchEntity[];
  dimensions: SketchDimension[];
}): Sketch {
  return {
    id: data.id,
    name: data.name,
    planeRef: deserializePlaneRef(data.planeRef),
    entities: data.entities.map(deserializeSketchEntity),
    dimensions: data.dimensions,
  };
}
