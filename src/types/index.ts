export interface AppConfig {
  units: 'inch' | 'mm';
  gridSpacing: { major: number; minor: number };
  snapEnabled: boolean;
}

export interface Document {
  version: string;
  metadata: DocumentMetadata;
  config: AppConfig;
  bodies: Body[];
  features: Feature[];
  // Assembly data (Milestone 06)
  components: Component[];
  componentInstances: ComponentInstance[];
  constraints: MateConstraint[];
  activeComponentId: string | null;
  /** Stable browser metadata retained while a deterministic body is inactive. */
  bodyPresentations?: Record<string, BodyPresentation>;
  /** Stable woodworking tags retained through rebuild, suppression, and duplication. */
  bodyMetadata?: Record<string, BodyWoodworkingMetadata>;
  /** Reusable renderer-independent drawing definitions. */
  drawingDefinitions?: ShopDrawingDefinition[];
  manufacturingDefaults?: {
    units: 'in' | 'mm';
    stockAllowance: StockAllowance;
  };
}

export interface StockAllowance {
  length: number;
  width: number;
  thickness: number;
}

export type DrawingScope =
  | { type: 'document' }
  | { type: 'bodies'; bodyIds: string[] }
  | { type: 'component'; componentId: string };

export interface DrawingReference {
  bodyId: string;
  topologyId: string;
  kind: 'vertex' | 'edge' | 'face';
}

export interface DrawingDimension {
  id: string;
  kind: 'linear' | 'horizontal' | 'vertical' | 'angular' | 'diameter';
  references: DrawingReference[];
  view: 'front' | 'top' | 'right';
  position: readonly [number, number];
  prefix?: string;
  suffix?: string;
}

export interface DrawingNote {
  id: string;
  text: string;
  view?: 'front' | 'top' | 'right';
  position: readonly [number, number];
  featureId?: string;
}

export interface ShopDrawingDefinition {
  id: string;
  name: string;
  scope: DrawingScope;
  views: Array<'front' | 'top' | 'right'>;
  sheet: {
    width: number;
    height: number;
    orientation: 'portrait' | 'landscape';
  };
  scale: 'fit' | number;
  unit: 'in' | 'mm';
  precision: number;
  showHiddenLines: boolean;
  dimensions: DrawingDimension[];
  notes: DrawingNote[];
}

export interface BodyWoodworkingMetadata {
  /** Feature that owned the body orientation when these axes were authored. */
  sourceFeatureId?: string;
  isBoard: boolean;
  label: string;
  material: {
    id: string;
    species: string;
    grade?: string;
    stockCode?: string;
    densityKgM3?: number;
  };
  grainAxis: readonly [number, number, number];
  thicknessAxis: readonly [number, number, number];
  grainPattern?: 'straight' | 'rift' | 'quarter' | 'flat' | 'end' | 'mixed';
  partNumber?: string;
  notes?: string;
  stockAllowance?: Partial<StockAllowance>;
  bodyFrame?: {
    origin: readonly [number, number, number];
    xAxis: readonly [number, number, number];
    yAxis: readonly [number, number, number];
    zAxis: readonly [number, number, number];
    provenance?: {
      kind: 'derived' | 'authored';
      source: string;
      sourceFeatureId?: string;
    };
  };
}

export interface BodyPresentation {
  name: string;
  visible: boolean;
  locked: boolean;
}

// Assembly types (Milestone 06)
export interface Component {
  id: string;
  name: string;
  featureIds: string[];
  bodyIds: string[];
  visible?: boolean;
  locked?: boolean;
}

export interface ComponentInstance {
  id: string;
  componentId: string;
  name: string;
  transform: number[];
  lockedAxes: LockedAxes;
  grounded: boolean;
  visible?: boolean;
  locked?: boolean;
}

export interface LockedAxes {
  translateX: boolean;
  translateY: boolean;
  translateZ: boolean;
  rotateX: boolean;
  rotateY: boolean;
  rotateZ: boolean;
}

export interface MateConstraint {
  id: string;
  name: string;
  type: 'flush' | 'offset';
  refA: InstanceFaceRef;
  refB: InstanceFaceRef;
  offset: number;
  satisfied: boolean;
  errorMessage?: string;
  suppressed: boolean;
  /** New constraints drive geometry; migrated 0.2 constraints validate only. */
  driving?: boolean;
  status?: 'legacy-validate-only' | 'unsolved' | 'satisfied' | 'unsatisfied' | 'conflicting' | 'broken';
}

export interface InstanceFaceRef {
  instanceId: string;
  faceId: string;
  bodyId: string;
}

export interface DocumentMetadata {
  name: string;
  created: string;
  modified: string;
}

export interface Body {
  id: string;
  name: string;
  type: BodyType;
  transform: number[]; // 4x4 matrix as flat array (column-major)
  visible: boolean;
  locked: boolean;
}

export type BodyType = 'solid' | 'surface' | 'wire' | 'point';

export interface Feature {
  id: string;
  type: FeatureType;
  name: string;
  parameters: Record<string, unknown>;
  suppressed: boolean;
  refsIn: string[]; // IDs of features/entities this depends on
  refsOut: string[]; // IDs of entities created by this feature
}

export type FeatureType =
  | 'box'
  | 'sketch'
  | 'extrude'
  | 'extrudeCut'
  | 'revolve'
  | 'fillet'
  | 'chamfer'
  | 'hole'
  | 'boolean_union'
  | 'boolean_subtract'
  | 'boolean_intersect'
  | 'mirror'
  | 'rotateBody'
  | 'joinBodies'
  | 'bodyBoolean'
  | 'transformBodies'
  | 'woodJoint'
  | 'pattern_linear'
  | 'pattern_circular'
  | 'createComponent'
  | 'addInstance';

export interface SelectionState {
  selectedIds: Set<string>;
  activeId: string | null;
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  projection: 'perspective' | 'orthographic';
  zoom: number;
}

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

export function createDefaultAppConfig(): AppConfig {
  return {
    units: 'inch',
    gridSpacing: { major: 1, minor: 0.25 },
    snapEnabled: true,
  };
}

export function createDefaultDocument(name = 'Untitled'): Document {
  const now = new Date().toISOString();
  return {
    version: '0.3.0',
    metadata: {
      name,
      created: now,
      modified: now,
    },
    config: createDefaultAppConfig(),
    bodies: [],
    features: [],
    // Assembly fields (Milestone 06)
    components: [],
    componentInstances: [],
    constraints: [],
    activeComponentId: null,
    bodyMetadata: {},
    drawingDefinitions: [],
    manufacturingDefaults: {
      units: 'in',
      stockAllowance: { length: 0, width: 0, thickness: 0 },
    },
  };
}

export function createDefaultBody(id: string, name: string): Body {
  return {
    id,
    name,
    type: 'solid',
    transform: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    visible: true,
    locked: false,
  };
}

export function mergeBoundingBoxes(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  };
}

export function boundingBoxCenter(box: BoundingBox): [number, number, number] {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

export function boundingBoxSize(box: BoundingBox): [number, number, number] {
  return [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
}
