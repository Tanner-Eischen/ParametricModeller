import * as THREE from 'three';
import { eventBus, createUndoRedoStack, generateId } from './core';
import { createSelectionState, select, selectMultiple, clearSelection, type SelectionState } from './core/selection';
import { createModuleLogger } from './core/logger';
import {
  Viewport,
  Picking,
  RenderMeshCache,
  GrainDirectionOverlay,
  applyNamedView,
  type NamedViewId,
} from './rendering';
import {
  Layout,
  StatusBar,
  FeatureTreePanel,
  PropertyInspector,
  DiagnosticsPanel,
  SketchModeController,
  SketchOverlay,
  FaceHighlight,
  EdgeSelectionOverlay,
  PushPullGizmo,
  KeyboardShortcutsPanel,
  CommandToolbar,
  WelcomeOverlay,
  RecentFilesPanel,
  SketchSetupPanel,
  AssemblyPanel,
  ConstraintCreationController,
  InstanceTransformGizmo,
  ConstraintVisualization,
  SubObjectSelectionPanel,
  MoveVertexGizmo,
  BodyRotateGizmo,
  VertexEditPrompt,
  TranslationTriadGizmo,
  MoveCopyToolSession,
  createCopyToolSession,
  createPlacementToolSession,
  createMateToolSession,
  createWoodJointEditorPresenter,
  applyWoodJointEditorValue,
  CutListPreviewPanel,
  LinearPatternPreviewManipulator,
  MirrorPreviewManipulator,
  ViewCube,
  ViewportSelectionContext,
  ModelBrowserPanel,
  CommandPalette,
  ContextTaskPanel,
  WoodworkingPanel,
  createDefaultWoodworkingMetadata,
  createEmptyFaceSketchFeature,
  getDefaultCutFlipForSketch,
  resolveExplicitBodyTarget,
  resolveExplicitSketchTarget,
  toggleSnap,
  type CommandToolbarAction,
  type SnapSettings,
  type SketchPlaneSelection,
  type SketchToolSelection,
  type SketchConstraintSelection,
  type SketchNumericSubmission,
  type SketchBlankPick,
  type SketchSegmentPick,
  type ModelBrowserTarget,
  type ModelBrowserRenameRequest,
  type ModelBrowserVisibilityRequest,
  type ModelBrowserLockRequest,
  type ModelBrowserDependenciesRequest,
  type ModelBrowserRollbackRequest,
  type ContextTaskPanelState,
  type ContextTaskFieldDescriptor,
  type ContextTaskFieldValue,
  type ContextTaskActionDescriptor,
  type PlacementToolSession,
  type PlacementReferenceRequest,
  type PlacementPreview,
  type MateToolSession,
  type MateReferenceRequest,
  type MatePreview,
  type CutListPreviewModel,
  type ViewportSelectionContextState,
  type WoodworkingAxis,
  type WoodworkingMetadataDraft,
  defaultSnapSettings,
} from './ui';
import {
  VertexSelectionOverlay,
  type VertexSelectionTarget,
} from './ui/VertexSelectionOverlay';
import {
  WorkspacePreferencesStore,
  type WorkspacePreferences,
} from './ui/WorkspacePreferencesStore';
import { DocumentManager, saveToFile, loadFromFile, AutosaveManager, RecentFilesStore, type RecentFileEntry } from './persistence';
import type { Document, Body, BodyPresentation, BodyWoodworkingMetadata, ShopDrawingDefinition } from './types';
import type { Body as BRepBody } from './geometry';
import { DEFAULT_TOLERANCE_POLICY, checkPlanarityPreservation, getBodyBoundingBox, getConstructionPlaneFromRef, getFaceVertexIds, getOrderedLoopVertices, createVertexRef, offsetFace, type EdgeRef, type SubObjectType, type VertexRef } from './geometry';
import {
  createRebuildEngine,
  rebuildBox,
  createBoxFeature,
  rebuildSketch,
  createSketchFeature,
  rebuildExtrudeWithAdapter,
  prismaticSolidBooleanAdapter,
  createExtrudeFeatureFromParams,
  getExtrudeDependencyIds,
  rebuildOffsetFace,
  createOffsetFaceFeature,
  createFaceRef,
  rebuildExtrudeCutWithAdapter,
  createExtrudeCutFeatureFromParams,
  getExtrudeCutDependencyIds,
  createBodyRef,
  rebuildLinearPattern,
  createLinearPatternFeature,
  rebuildMirror,
  createMirrorFeature,
  rebuildCreateComponent,
  createComponentFeature,
  rebuildMoveVertex,
  createMoveVertexFeature,
  rebuildRotateBody,
  createRotateBodyFeature,
  rebuildJoinBodies,
  createJoinBodiesFeature,
  rebuildBodyBoolean,
  rebuildTransformBodies,
  rebuildWoodJoint,
  createWoodJointFeature,
  planWoodJoint,
  getWoodJointManufacturingOperations,
  createFacePlacementRef,
  createEdgePlacementRef,
  createVertexPlacementRef,
  createEdgePointPlacementRef,
  createFaceCenterPlacementRef,
  createAxisAnglePlacement,
  solvePlacementMatrix,
  createTransformBodiesFeature,
  rebuildMiterCut,
  createMiterCutFeature,
  resolveThreeWayMiterCornerVertexId,
  MOVE_COPY_FEATURE_TYPE,
  rebuildMoveCopy,
  createMoveCopyFeature,
  BAKE_BODY_FEATURE_TYPE,
  rebuildBakeBody,
  type MoveVertexParams,
  type RotateBodyParams,
  type MoveCopyParams,
  type MiterCutParams,
  type WoodJointKind,
  type WoodJointParams,
  type WoodJointPlan,
  type WoodJointMemberRef,
  type FeatureRecord,
  type Diagnostic,
  createDependencyGraph,
  planFeatureSuppression,
  error,
} from './features';
import {
  type Component,
  type ComponentInstance,
  type MateConstraint,
  createComponent,
  createComponentInstance,
  CREATE_COMPONENT_FEATURE_TYPE,
  rebuildWithComponents,
  solveConstraints,
} from './assembly';
import { BOX_FEATURE_TYPE, type BoxParams } from './features/primitives';
import {
  SKETCH_FEATURE_TYPE,
  migrateSketchParams,
  synchronizeSketchFeatureRefsIn,
  type NormalizedSketchParams,
} from './features/sketch/SketchFeature';
import {
  EXTRUDE_FEATURE_TYPE,
  migrateExtrudeParams,
  type NormalizedExtrudeParams,
} from './features/extrude';
import { OFFSET_FACE_FEATURE_TYPE, type FaceRef } from './features/offsetFace';
import {
  EXTRUDE_CUT_FEATURE_TYPE,
  migrateExtrudeCutParams,
  type NormalizedExtrudeCutParams,
} from './features/cut';
import { MITER_CUT_FEATURE_TYPE } from './features/miter';
import { LINEAR_PATTERN_FEATURE_TYPE, MIRROR_FEATURE_TYPE, DUPLICATE_FEATURE_TYPE, rebuildDuplicate } from './features/pattern';
import { MOVE_VERTEX_FEATURE_TYPE } from './features/vertex';
import { ROTATE_BODY_FEATURE_TYPE, JOIN_BODIES_FEATURE_TYPE } from './features/transform';
import { PanelChrome } from './app/PanelChrome';
import { GizmoManager } from './app/GizmoManager';
import { BODY_BOOLEAN_FEATURE_TYPE, createBodyBooleanFeature } from './features/boolean';
import { TRANSFORM_BODIES_FEATURE_TYPE } from './features/placement';
import { WOOD_JOINT_FEATURE_TYPE } from './features/joints';
import {
  createWorldPlaneRef,
  extractProfiles,
  materializeLineEntities,
  toProfileSegments,
  analyzeProfiles,
  solveSketchConstraints,
  appendSharedPointRectangle,
  appendCenterRectangle,
  appendRegularPolygon,
  appendSharedPointPolyline,
  moveSketchPoint,
  addSketchRelation,
  addDrivingDistanceDimension,
  deleteSketchSelection,
  trimStraightSegment,
  extendStraightSegment,
  projectStraightSegments,
  projectModelEdgeToSketch,
  type Sketch,
  type SketchDimension,
  type PlaneRef,
  type Point2D,
  type NormalizedSketchGeometry,
  type SketchRelation,
  type SketchConstraint,
  type DrivingDistanceDimension,
  type SketchSelection,
} from './sketch';
import {
  CommandDispatcher,
  KeyboardRouter,
  PointerGestureRouter,
  PreviewTransaction,
  ToolSessionManager,
  type ToolSession,
  type ToolSessionPhase,
  resolveNumericInput,
  parseNumericInput,
  type NumericUnit,
} from './interaction';
import {
  buildCutListDocument,
  cutListDocumentToCsv,
  type CutListDocument,
} from './woodworking/CutList';
import {
  convertLength,
  formatLength,
  measureOrientedBoard,
  type Vector3,
} from './woodworking/Measurements';
import type { BoardMetadata } from './woodworking/Materials';
import {
  MeasurementToolSession,
  type MeasurementKind,
  type MeasurementReference,
  type MeasurementReferenceKind,
  type MeasurementResult,
  type MeasurementToolSessionState,
} from './woodworking/MeasurementToolSession';
import {
  pinMeasurementIntoDrawing,
  isPinnedMeasurementDimension,
  refreshPinnedDrawingMeasurements,
  validateDrawingReferences,
  repairDrawingReference,
  deleteDrawingReferenceTarget,
  type DrawingReferenceIssue,
} from './woodworking/DrawingReferences';

const log = createModuleLogger('App');

function cloneSnapshot<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function getWoodJointMemberCount(kind: WoodJointKind): 1 | 2 | 3 {
  if (kind === 'sawCut' || kind === 'chamfer') return 1;
  if (kind === 'threeWayMiter') return 3;
  return 2;
}

function formatWoodJointKind(kind: WoodJointKind): string {
  return kind
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

type ActiveSketchTool = Exclude<SketchToolSelection, null>;

interface SketchToolDraft {
  featureId: string;
  operationId: string;
  baseParams: NormalizedSketchParams;
  dirty: boolean;
  points: Point2D[];
  selectedPointIds: string[];
  selectedSegmentIds: string[];
  movePointId: string | null;
  trimPickPoint: Point2D | null;
}

interface WoodJointDraft {
  kind: WoodJointKind;
  members: WoodJointMemberRef[];
  sideClearance: number;
  endClearance: number;
  parameters: WoodJointParams;
  plan: WoodJointPlan | null;
  exploded: boolean;
  reselectIndex: number | null;
  selectionModeToRestore: SubObjectType;
}

type PointDatumMode = 'vertex' | 'edgePoint' | 'faceCenter';

interface AxisAnglePlacementDraft {
  sourceBodyRefs: ReturnType<typeof createBodyRef>[];
  axis: ReturnType<typeof createEdgePlacementRef> | null;
  angleDegrees: number;
}

interface DrawingRepairDraft {
  definitionId: string;
  issue: DrawingReferenceIssue;
  expectedKind: MeasurementReferenceKind;
  referenceIndex: number;
}

interface HistorySelectionSnapshot {
  selectedBodyIds: string[];
  activeBodyId: string | null;
  selectedFeatureId: string | null;
  selectionMode: SubObjectType;
  selectedFace: { faceId: string; bodyId: string } | null;
  selectedVertexRef: VertexRef | null;
  selectedEdgeRef: EdgeRef | null;
}

interface AppHistorySnapshot {
  document: Document;
  selection: HistorySelectionSnapshot;
}

export class App {
  private workspacePreferencesStore = new WorkspacePreferencesStore();
  private workspacePreferences: WorkspacePreferences;
  private viewport: Viewport;
  private layout: Layout;
  private _statusBar: StatusBar;
  private documentManager: DocumentManager;
  private picking: Picking;
  private selection: SelectionState;
  private sceneObjects: Map<string, THREE.Object3D> = new Map();
  private meshCache: RenderMeshCache;
  private bodyPresentations = new Map<string, BodyPresentation>();
  private grainDirectionOverlay = new GrainDirectionOverlay();

  // Feature system
  private features: FeatureRecord[] = [];
  private rebuildEngine = createRebuildEngine();
  private undoRedo = createUndoRedoStack<AppHistorySnapshot>({ capacity: 150 });
  private autosaveManager = new AutosaveManager();
  private recentFilesStore = new RecentFilesStore();
  private featureTreePanel: FeatureTreePanel;
  private propertyInspector: PropertyInspector;
  private diagnosticsPanel: DiagnosticsPanel;
  private subObjectSelectionPanel: SubObjectSelectionPanel;
  private sketchModeController: SketchModeController;
  private sketchOverlay: SketchOverlay;
  private rebuiltBodies: BRepBody[] = []; // Store rebuilt bodies for face lookup
  /** Exact immutable-per-feature outputs from the latest successful history rebuild. */
  private rebuiltBodiesByFeature = new Map<string, BRepBody[]>();
  private commandDispatcher = new CommandDispatcher<void>();
  private toolSessions = new ToolSessionManager();
  private keyboardRouter = new KeyboardRouter(this.toolSessions, this.commandDispatcher);
  private pointerGestureRouter = new PointerGestureRouter({ dragThreshold: 4 });
  private hoveredBodyId: string | null = null;
  private hoveredVertexRef: VertexRef | null = null;
  private preferredSketchPlane: 'xy' | 'xz' | 'yz' = 'xy';
  private selectedSketchEntityId: string | null = null;
  private activeSketchTool: ActiveSketchTool = 'select';
  private sketchLineDraftStart: Point2D | null = null;
  private sketchLineDraftLastPoint: Point2D | null = null;
  private sketchToolTransaction: PreviewTransaction<Document, NormalizedSketchParams> | null = null;
  private sketchToolDraft: SketchToolDraft | null = null;
  private sketchPolygonSides = 6;
  private sketchConstraintType: SketchConstraintSelection = 'coincident';
  private sketchNumericValue = '';
  private sketchNumericUnit: NumericUnit = 'in';
  private sketchNumericError: string | null = null;

  // Face selection mode
  private faceSelectionMode = false;
  private selectionMode: SubObjectType = 'body';
  private selectedFace: { faceId: string; bodyId: string } | null = null;
  private selectedVertexRef: VertexRef | null = null;
  private selectedEdgeRef: EdgeRef | null = null;
  private edgeSelectionOverlay: EdgeSelectionOverlay | null = null;

  // Push/Pull mode (Milestone 03)
  private pushPullMode = false;
  private faceHighlight: FaceHighlight | null = null;
  private pushPullGizmo: PushPullGizmo | null = null;
  private pushPullTransaction: PreviewTransaction<Document, number> | null = null;
  private pushPullSessionSequence = 0;
  private pushPullDistanceInput = '0';
  private pushPullDistanceError: string | null = null;
  private pushPullPreviousSelectionMode: SubObjectType | null = null;
  private pushPullInitialFace: { faceId: string; bodyId: string } | null = null;
  private pushPullPreviewObject: THREE.Object3D | null = null;
  private pushPullPreviewMeshCache: RenderMeshCache | null = null;
  private pushPullPreviewSource: { object: THREE.Object3D; visible: boolean } | null = null;
  private featurePreviewTransaction: PreviewTransaction<Document, never> | null = null;
  private featurePreviewFeatureId: string | null = null;
  private featurePreviewHistoryLabel: string | null = null;
  private featurePreviewParameterUpdateFailed = false;
  private featurePreviewInvalidFieldIds = new Set<string>();
  private lastFeatureUpdateFailureMessage: string | null = null;
  private featurePreviewSequence = 0;
  private woodJointDraft: WoodJointDraft | null = null;
  private woodJointExplodedPreview: THREE.Group | null = null;
  private woodJointPreviewSourceVisibility = new Map<string, boolean>();
  private woodJointDatumHiddenBody: { bodyId: string; visible: boolean } | null = null;
  private woodJointDatumFocusVisibility = new Map<string, boolean>();
  private placementSession: PlacementToolSession<Document> | null = null;
  private activePlacementKind: 'point-to-point' | 'align' | null = null;
  private placementReferenceRequest: PlacementReferenceRequest | null = null;
  private placementPointDatumMode: PointDatumMode = 'vertex';
  private placementPreviewGroup: THREE.Group | null = null;
  private placementPreviewSourceVisibility = new Map<string, boolean>();
  private axisAnglePlacementDraft: AxisAnglePlacementDraft | null = null;
  private mateSession: MateToolSession<Document> | null = null;
  private mateReferenceRequest: MateReferenceRequest | null = null;
  private measurementSession: MeasurementToolSession | null = null;
  private measurementState: MeasurementToolSessionState | null = null;
  private measurementKind: MeasurementKind = 'bodyDimensions';
  private drawingRepairDraft: DrawingRepairDraft | null = null;
  private drawingRepairReplacement: MeasurementReference | null = null;
  private pendingDrawingExportFormat: 'svg' | 'pdf' | 'dxf' | null = null;
  private cutListPreviewPanel: CutListPreviewPanel | null = null;
  private visibleContextSessionId: string | null = null;
  private moveCopyPreviewClone: THREE.Object3D | null = null;
  private directEditTransaction: PreviewTransaction<Document, never> | null = null;
  private directEditFeatureId: string | null = null;
  private directEditKind: 'move-vertex' | 'rotate-body' | null = null;
  private directEditPreviewTranslation: [number, number, number] | null = null;
  private directEditPreviewRotation: [number, number, number] | null = null;
  private constraintTransaction: PreviewTransaction<Document, never> | null = null;
  private snapSettings: SnapSettings = { ...defaultSnapSettings };
  private keyboardShortcutsPanel: KeyboardShortcutsPanel;
  private commandToolbar: CommandToolbar;
  private viewCube: ViewCube;
  private viewportSelectionContext: ViewportSelectionContext;
  private modelBrowser: ModelBrowserPanel;
  private commandPalette: CommandPalette;
  private contextTaskPanel: ContextTaskPanel;
  private woodworkingPanel: WoodworkingPanel;
  private panelChrome = new PanelChrome({
    store: this.workspacePreferencesStore,
    getPreferences: () => this.workspacePreferences,
    onPreferencesChanged: (prefs) => {
      this.workspacePreferences = prefs;
    },
  });
  private propertiesExpandedForFeatureId: string | null = null;
  private browserContextTask: ContextTaskPanelState | null = null;
  private welcomeOverlay: WelcomeOverlay;
  private recentFilesPanel: RecentFilesPanel;
  private sketchSetupPanel: SketchSetupPanel;
  private moveVertexGizmo: MoveVertexGizmo | null = null;
  private vertexSelectionOverlay = new VertexSelectionOverlay();
  private bodyRotateGizmo: BodyRotateGizmo | null = null;
  private vertexEditPrompt: VertexEditPrompt;
  private translationTriadGizmo = new TranslationTriadGizmo();
  /**
   * Centralized gizmo drag-state and camera-navigation suppression. Orbit is
   * suppressed whenever any gizmo is dragging (or a modal rotate session is
   * open), so one gizmo ending a drag can never re-enable the camera while
   * another is still mid-drag — the former rotate-gizmo-steals-camera bug.
   */
  private gizmos = new GizmoManager({
    getCameraControls: () => this.viewport.getCameraControls(),
  });

  // Assembly state (Milestone 06)
  private components: Component[] = [];
  private componentInstances: ComponentInstance[] = [];
  private instanceBodyIdsByInstance = new Map<string, string[]>();
  private instanceBodySourceIds = new Map<string, string>();
  private constraints: MateConstraint[] = [];
  private activeComponentId: string | null = null;
  private assemblyPanel: AssemblyPanel | null = null;
  private constraintCreationController: ConstraintCreationController | null = null;
  private instanceTransformGizmo: InstanceTransformGizmo | null = null;
  private instanceTransformTransaction: PreviewTransaction<Document, number[]> | null = null;
  private activeInstanceTransformId: string | null = null;
  private cancellingActiveInteraction = false;
  private interactionDiagnostics = {
    rebuilds: 0,
    remeshedBodies: 0,
    transformPreviewUpdates: 0,
  };
  private unsubscribeToolSessionEnd: (() => void) | null = null;
  private constraintVisualization: ConstraintVisualization | null = null;
  private handleBeforeUnload = (): void => {
    this.autosaveManager.flushPending();
  };

  constructor(container: HTMLElement) {
    log.info('Initializing Parametric Modeler');

    // Initialize layout
    this.workspacePreferences = this.workspacePreferencesStore.load();
    container.dataset.toolbarDensity = this.workspacePreferences.toolbarDensity;
    this.layout = new Layout(container, {
      panelWidth: this.workspacePreferences.sidebars.left.width,
      taskPanelWidth: this.workspacePreferences.sidebars.right.width,
      initialSidebarCollapsed: {
        left: this.workspacePreferences.sidebars.left.collapsed,
        right: this.workspacePreferences.sidebars.right.collapsed,
      },
      onSidebarChange: (side, collapsed, width) => {
        this.workspacePreferences = this.workspacePreferencesStore.update({
          sidebars: { [side]: { collapsed, width } },
        });
      },
    });

    // Initialize status bar
    this._statusBar = new StatusBar(this.layout.getStatusBar());

    // Initialize viewport
    this.viewport = new Viewport({
      container: this.layout.getViewport(),
      antialias: true,
    });
    this.grainDirectionOverlay.attachTo(this.viewport.getScene());
    this.vertexSelectionOverlay.attachTo(this.viewport.getScene());
    this.viewCube = new ViewCube({
      container: this.layout.getViewport(),
      initialView: 'isometric',
      onSelect: (view) => this.activateNamedView(view),
    });
    this.viewportSelectionContext = new ViewportSelectionContext(this.layout.getViewport(), {
      initialState: { mode: this.selectionMode, selection: null },
      onModeChange: (mode) => this.changeViewportSelectionMode(mode),
      onAction: (actionId) => this.handleViewportSelectionAction(actionId),
    });

    // Initialize document
    this.documentManager = new DocumentManager();

    // Initialize selection
    this.selection = createSelectionState();

    // Initialize picking
    this.picking = new Picking();

    // Initialize mesh cache
    this.meshCache = new RenderMeshCache();

    // Register feature handlers
    this.rebuildEngine.registerHandler(BOX_FEATURE_TYPE, rebuildBox);
    this.rebuildEngine.registerHandler(SKETCH_FEATURE_TYPE, rebuildSketch);
    this.rebuildEngine.registerHandler(EXTRUDE_FEATURE_TYPE, (feature, context) =>
      rebuildExtrudeWithAdapter(feature, context, prismaticSolidBooleanAdapter)
    );
    this.rebuildEngine.registerHandler(OFFSET_FACE_FEATURE_TYPE, rebuildOffsetFace);
    this.rebuildEngine.registerHandler(EXTRUDE_CUT_FEATURE_TYPE, (feature, context) =>
      rebuildExtrudeCutWithAdapter(feature, context, prismaticSolidBooleanAdapter)
    );
    this.rebuildEngine.registerHandler(MITER_CUT_FEATURE_TYPE, rebuildMiterCut);
    this.rebuildEngine.registerHandler(LINEAR_PATTERN_FEATURE_TYPE, rebuildLinearPattern);
    this.rebuildEngine.registerHandler(MIRROR_FEATURE_TYPE, rebuildMirror);
    this.rebuildEngine.registerHandler(DUPLICATE_FEATURE_TYPE, rebuildDuplicate);
    this.rebuildEngine.registerHandler(CREATE_COMPONENT_FEATURE_TYPE, rebuildCreateComponent);
    this.rebuildEngine.registerHandler(MOVE_VERTEX_FEATURE_TYPE, rebuildMoveVertex);
    this.rebuildEngine.registerHandler(ROTATE_BODY_FEATURE_TYPE, rebuildRotateBody);
    this.rebuildEngine.registerHandler(JOIN_BODIES_FEATURE_TYPE, rebuildJoinBodies);
    this.rebuildEngine.registerHandler(BODY_BOOLEAN_FEATURE_TYPE, rebuildBodyBoolean);
    this.rebuildEngine.registerHandler(TRANSFORM_BODIES_FEATURE_TYPE, rebuildTransformBodies);
    this.rebuildEngine.registerHandler(WOOD_JOINT_FEATURE_TYPE, rebuildWoodJoint);
    this.rebuildEngine.registerHandler(MOVE_COPY_FEATURE_TYPE, rebuildMoveCopy);
    this.rebuildEngine.registerHandler(BAKE_BODY_FEATURE_TYPE, rebuildBakeBody);
    this.translationTriadGizmo.attach(
      this.viewport.getScene(),
      this.viewport.getCameraControls(),
      this.viewport.getDomElement()
    );

    // Initialize UI panels
    this.subObjectSelectionPanel = new SubObjectSelectionPanel(
      this.panelChrome.createContainer(this.layout.getPanelLeft(), 'Selection', {
        description: 'Pick bodies, faces, edges, or vertices',
      }),
      {
        initialMode: this.selectionMode,
        onModeChange: (mode) => this.setSelectionMode(mode),
      }
    );

    this.modelBrowser = new ModelBrowserPanel({
      container: this.panelChrome.createContainer(this.layout.getPanelLeft(), 'Model browser', {
        description: 'Objects, assemblies, and edit history',
      }),
      onSelect: (target) => this.selectModelBrowserTarget(target),
      onRename: (request) => this.renameModelBrowserTarget(request),
      onSetSuppressed: (request) => this.setFeatureSuppressedFromBrowser(
        request.featureId,
        request.suppressed
      ),
      onSetVisibility: (request) => this.setModelBrowserVisibility(request),
      onSetLocked: (request) => this.setModelBrowserLocked(request),
      onRollback: (request) => this.rollbackHistoryFromBrowser(request),
      onShowDependencies: (request) => this.showFeatureDependencies(request),
    });

    const contextTaskContainer = this.panelChrome.createContainer(
      this.layout.getPanelRight(),
      'Active tool',
      { description: 'Controls for the active tool or current selection' },
    );
    contextTaskContainer.className = 'context-task-panel-host';

    // The legacy feature list remains as the event-backed selection adapter for
    // PropertyInspector. The Phase 5 model browser is the visible hierarchy.
    const legacyFeatureTreeContainer = document.createElement('div');
    legacyFeatureTreeContainer.hidden = true;
    this.layout.getPanelLeft().appendChild(legacyFeatureTreeContainer);
    this.featureTreePanel = new FeatureTreePanel({ container: legacyFeatureTreeContainer });

    this.propertyInspector = new PropertyInspector({
      container: this.panelChrome.createContainer(this.layout.getPanelRight(), 'Properties', {
        description: 'Parameters of the selected feature or body',
      }),
      units: this.documentManager.getDocument().config.units,
    });

    this.diagnosticsPanel = new DiagnosticsPanel({
      container: this.panelChrome.createContainer(this.layout.getPanelRight(), 'Diagnostics', {
        description: 'Rebuild errors and warnings',
        hidden: true,
      }),
    });

    this.woodworkingPanel = new WoodworkingPanel({
      container: this.panelChrome.createContainer(this.layout.getPanelRight(), 'Woodworking', {
        description: 'Tag boards, export cut list & shop drawings',
        hidden: true,
      }),
      onMetadataChange: (bodyId, metadata) => this.updateWoodworkingMetadata(bodyId, metadata),
      onExportCutList: () => this.exportCutList(),
      onExportDrawing: () => void this.exportShopDrawing('svg'),
      onExportDrawingPdf: () => void this.exportShopDrawing('pdf'),
      onExportDrawingDxf: () => void this.exportShopDrawing('dxf'),
    });

    // Initialize sketch mode controller
    this.sketchModeController = new SketchModeController();

    // Initialize sketch overlay
    this.sketchOverlay = new SketchOverlay({
      container: this.layout.getViewport(),
    });
    this.sketchOverlay.onRectangleCreate((start, end) => this.createRectangleFromSketchDrag(start, end));
    this.sketchOverlay.onLinePoint((point) => this.handleSketchLinePoint(point));
    this.sketchOverlay.onPointClick((pointId) => this.handleSketchPointIdClick(pointId));
    this.sketchOverlay.onSegmentClick((segmentId) => this.handleSketchSegmentClick(segmentId));
    this.sketchOverlay.onBlankPick((pick) => this.handleSketchBlankPick(pick));
    this.sketchOverlay.onSegmentPick((pick) => this.handleSketchSegmentPick(pick));

    // Initialize keyboard shortcuts panel
    this.keyboardShortcutsPanel = new KeyboardShortcutsPanel({
      container: document.body,
      onVisibilityChange: () => this.refreshUiChrome(),
    });

    const commandActions = this.createCommandActions().map((action) => ({
      ...action,
      getAvailability: () => this.getCommandAvailability(action),
    }));
    this.registerCommandActions(commandActions);
    this.registerKeyboardBindings();
    this.commandToolbar = new CommandToolbar({
      container: this.layout.getToolbar(),
      actions: commandActions.map((action) => ({
        ...action,
        onTrigger: () => {
          this.commandDispatcher.dispatch(action.id, undefined);
        },
      })),
    });
    this.commandPalette = new CommandPalette({
      container: document.body,
      actions: commandActions
        .filter((action) => action.id !== 'openCommandPalette')
        .map((action) => ({
          id: action.id,
          ...(action.isDisabled ? { isDisabled: action.isDisabled } : {}),
          ...(action.getAvailability ? { getAvailability: action.getAvailability } : {}),
          onTrigger: () => this.commandDispatcher.dispatch(action.id, undefined),
        })),
      onClose: () => this.refreshUiChrome(),
    });

    this.contextTaskPanel = new ContextTaskPanel({
      container: contextTaskContainer,
      onFieldChange: (fieldId, value) => this.updateContextTaskField(fieldId, value),
      onAction: (actionId) => this.handleContextTaskAction(actionId),
      onCommit: () => this.commitContextTask(),
      onCancel: () => this.toolSessions.cancelActive(),
    });

    this.welcomeOverlay = new WelcomeOverlay({
      container: this.layout.getViewport(),
      actions: this.createWelcomeActions(),
      dismissed: this.workspacePreferences.quickStartDismissed,
      onDismiss: () => {
        this.workspacePreferences = this.workspacePreferencesStore.update({
          quickStartDismissed: true,
        });
      },
    });

    this.sketchSetupPanel = new SketchSetupPanel({
      container: this.panelChrome.createContainer(this.layout.getPanelRight(), 'Sketch', {
        description: '2D sketch workspace',
        hidden: true,
      }),
      onPickWorldPlane: (plane) => this.startSketchOnWorldPlane(plane),
      onSketchSelectedFace: () => this.toggleFaceSelectionMode(),
      onSelectTool: (tool) => this.selectSketchTool(tool),
      onNumericExpression: (raw) => {
        this.sketchNumericValue = raw;
      },
      onNumericSubmit: (submission) => this.handleSketchNumericSubmit(submission),
      onUnitChange: (unit) => {
        this.sketchNumericUnit = unit;
        this.refreshUiChrome();
      },
      onPolygonSidesChange: (sides) => {
        this.sketchPolygonSides = sides;
        this.refreshUiChrome();
      },
      onConstraintChange: (constraint) => {
        this.sketchConstraintType = constraint;
        this.refreshUiChrome();
      },
      onProfileDiagnosticClick: (diagnostic) => this.focusSketchDiagnostic(diagnostic.entityIds ?? []),
      onCommit: () => this.toolSessions.commitActive(),
      onCancel: () => this.toolSessions.cancelActive(),
      onExitSketch: () => this.exitSketchMode(true),
    });

    const recentFilesContainer = this.panelChrome.createContainer(
      this.layout.getPanelRight(),
      'Recent files',
      { description: 'Reopen recent documents', hidden: true },
    );
    this.recentFilesPanel = new RecentFilesPanel({
      container: recentFilesContainer,
      recentFiles: this.recentFilesStore.list(),
      onOpenRecent: (entry) => this.openRecentFile(entry),
      onClearRecent: () => this.clearRecentFiles(),
    });

    // Initialize assembly UI components (Milestone 06)
    this.assemblyPanel = new AssemblyPanel({
      container: this.panelChrome.createContainer(this.layout.getPanelRight(), 'Assembly', {
        description: 'Group pieces into an assembly and place mates',
        hidden: true,
      }),
      onCreateComponent: () => this.createComponentFromSelection(),
      onAddInstance: (componentId) => this.addInstanceFromSelectedComponent(componentId),
      onSelectInstance: (instance) => this.beginInstanceTransformSession(instance),
      onCreateConstraint: () => this.startFlushConstraintCreation(),
    });

    this.constraintCreationController = new ConstraintCreationController({
      instances: () => this.componentInstances,
      resolveInstanceIdForBody: (bodyId) => this.getInstanceForBody(bodyId)?.id ?? null,
      onConstraintCreated: this.handleConstraintCreated,
    });

    this.instanceTransformGizmo = new InstanceTransformGizmo({
      snapEnabled: this.snapSettings.enabled,
    });
    this.instanceTransformGizmo.attach(
      this.viewport.getScene(),
      this.viewport.getCameraControls(),
      this.viewport.getDomElement()
    );

    this.moveVertexGizmo = new MoveVertexGizmo({
      snapEnabled: this.snapSettings.enabled,
      snapDistance: this.snapSettings.gridStep,
      onDraggingChange: (dragging) => this.gizmos.setDragState('moveVertex', dragging),
    });
    this.moveVertexGizmo.attach(
      this.viewport.getScene(),
      this.viewport.getCameraControls(),
      this.viewport.getDomElement()
    );

    this.bodyRotateGizmo = new BodyRotateGizmo({
      snapEnabled: this.snapSettings.enabled,
      onDraggingChange: (dragging) => this.gizmos.setDragState('bodyRotate', dragging),
      onActiveChange: (active) => this.gizmos.setRotateSessionActive(active),
    });
    this.bodyRotateGizmo.attach(
      this.viewport.getScene(),
      this.viewport.getCameraControls(),
      this.viewport.getDomElement()
    );

    this.vertexEditPrompt = new VertexEditPrompt({
      container: this.layout.getViewport(),
    });

    this.constraintVisualization = new ConstraintVisualization();
    this.constraintVisualization.attachToScene(this.viewport.getScene());

    // Set up event handlers
    this.setupEventHandlers();
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    this.seedDocumentHistory('Initial document');

    // Start render loop
    this.viewport.startRenderLoop();
    this.refreshUiChrome();
    eventBus.emit('ui:status', {
      message: 'Ready — choose Board or Sketch.',
    });

    log.info('App initialized');
  }

  private refreshModelBrowser(): void {
    // The Model browser section is never auto-expanded — the user opens it on
    // demand. This keeps the default panel a quiet row of labeled headers.

    const graph = createDependencyGraph(this.features);
    this.modelBrowser.setData({
      features: this.features.map((feature) => ({
        ...feature,
        dependentIds: graph.getDirectDependents(feature.id),
        outputBodyIds: feature.refsOut.filter((id) => this.sceneObjects.has(id)),
      })),
      bodies: this.documentManager.getDocument().bodies.map((body) => {
        const sourceFeatureId = this.getFeatureByBodyId(body.id)?.id;
        return {
          ...body,
          ...(sourceFeatureId ? { sourceFeatureId } : {}),
        };
      }),
      components: this.components.map((component) => ({
        ...component,
        visible: component.visible ?? true,
        locked: component.locked ?? false,
      })),
      instances: this.componentInstances.map((instance) => ({
        ...instance,
        visible: instance.visible ?? true,
        locked: instance.locked ?? instance.grounded,
      })),
    });
  }

  private selectModelBrowserTarget(target: ModelBrowserTarget): void {
    this.browserContextTask = null;
    if (target.kind === 'feature') {
      this.featureTreePanel.selectFeature(target.id);
      this.selectFeatureById(target.id);
      return;
    }

    if (target.kind === 'body') {
      const documentBody = this.documentManager.getDocument().bodies.find(
        (body) => body.id === target.id
      );
      if (!this.isBodyVisible(target.id) || this.isBodyLocked(target.id)) {
        eventBus.emit('ui:status', {
          message: this.isBodyLocked(target.id)
            ? `${documentBody?.name ?? 'Body'} is locked`
            : `${documentBody?.name ?? 'Body'} is hidden`,
        });
        return;
      }
      this.clearSubObjectSelectionState();
      this.selection = select(clearSelection(this.selection), target.id, false);
      const feature = this.getFeatureByBodyId(target.id);
      this.featureTreePanel.selectFeature(feature?.id ?? null);
      this.updateSelectionVisuals();
      this.refreshUiChrome();
      return;
    }

    const component = target.kind === 'component'
      ? this.components.find((item) => item.id === target.id) ?? null
      : null;
    const instance = target.kind === 'instance'
      ? this.componentInstances.find((item) => item.id === target.id) ?? null
      : null;
    this.activeComponentId = component?.id ?? instance?.componentId ?? null;
    const name = component?.name ?? instance?.name;
    this.refreshUiChrome();
    eventBus.emit('ui:status', { message: `${name ?? target.id} selected in the model browser` });
  }

  private renameModelBrowserTarget(request: ModelBrowserRenameRequest): void {
    this.cancelActiveInteraction();
    const name = request.name.trim();
    if (!name) return;
    const { target } = request;
    let previousName: string | null = null;

    if (target.kind === 'feature') {
      const feature = this.getFeatureById(target.id);
      if (feature) {
        previousName = feature.name;
        feature.name = name;
        eventBus.emit('document:loaded', { features: this.features });
      }
    } else if (target.kind === 'body') {
      const body = this.documentManager.getDocument().bodies.find((item) => item.id === target.id);
      if (body) {
        previousName = body.name;
        this.documentManager.updateBody(target.id, { name });
        this.updateBodyPresentation(target.id, { name });
        const object = this.sceneObjects.get(target.id);
        if (object) object.userData.name = name;
      }
    } else if (target.kind === 'component') {
      const component = this.components.find((item) => item.id === target.id);
      if (component) {
        previousName = component.name;
        component.name = name;
      }
    } else {
      const instance = this.componentInstances.find((item) => item.id === target.id);
      if (instance) {
        previousName = instance.name;
        instance.name = name;
      }
    }

    if (previousName === null || previousName === name) {
      this.refreshUiChrome();
      return;
    }
    this.updateAssemblyPanel();
    this.commitDocumentHistory(`Rename ${previousName}`);
    eventBus.emit('ui:status', { message: `Renamed ${previousName} to ${name}` });
    this.refreshUiChrome();
  }

  private setFeatureSuppressedFromBrowser(featureId: string, suppressed: boolean): void {
    this.cancelActiveInteraction();
    const feature = this.getFeatureById(featureId);
    if (!feature || feature.suppressed === suppressed) return;
    const graph = createDependencyGraph(this.features);

    if (suppressed) {
      const plan = planFeatureSuppression(graph, featureId);
      if (!plan.allowed) {
        this.emitBrowserDiagnostics(plan.diagnostics);
        return;
      }
    } else {
      const invalidDependencyIds = (graph.dependenciesByFeature.get(featureId) ?? []).filter(
        (dependencyId) => !graph.featuresById.has(dependencyId) || graph.featuresById.get(dependencyId)?.suppressed
      );
      if (invalidDependencyIds.length > 0) {
        this.emitBrowserDiagnostics([error(
          'RESUME_BLOCKED_BY_DEPENDENCY',
          `Cannot resume "${feature.name}" until these dependencies are active: ${invalidDependencyIds.join(', ')}.`,
          featureId
        )]);
        return;
      }
    }

    const previousSuppressed = feature.suppressed;
    feature.suppressed = suppressed;
    const result = this.rebuildAll(`${suppressed ? 'Suppress' : 'Resume'} ${feature.name}`);
    if (!result.ok) {
      const failedDiagnostics = result.diagnostics;
      feature.suppressed = previousSuppressed;
      this.rebuildAll(`Restore ${feature.name}`, { trackHistory: false });
      this.emitBrowserDiagnostics(failedDiagnostics);
      return;
    }
    eventBus.emit('ui:status', {
      message: `${suppressed ? 'Suppressed' : 'Resumed'} ${feature.name}`,
    });
  }

  private emitBrowserDiagnostics(diagnostics: Diagnostic[]): void {
    eventBus.emit('feature:diagnostics', { diagnostics });
    const message = diagnostics[0]?.message ?? 'The history operation was blocked';
    eventBus.emit('ui:status', { message });
    this.refreshUiChrome();
  }

  private getModelBrowserTargetBodyIds(target: ModelBrowserTarget): string[] {
    if (target.kind === 'body') return [target.id];
    if (target.kind === 'feature') {
      return this.getFeatureById(target.id)?.refsOut.filter((id) => this.sceneObjects.has(id)) ?? [];
    }
    if (target.kind === 'instance') return [...(this.instanceBodyIdsByInstance.get(target.id) ?? [])];

    const component = this.components.find((item) => item.id === target.id);
    if (!component) return [];
    const sourceBodyIds = component.featureIds.flatMap(
      (featureId) => this.getFeatureById(featureId)?.refsOut ?? []
    );
    const instanceBodyIds = this.componentInstances
      .filter((instance) => instance.componentId === component.id)
      .flatMap((instance) => this.instanceBodyIdsByInstance.get(instance.id) ?? []);
    return Array.from(new Set([...component.bodyIds, ...sourceBodyIds, ...instanceBodyIds]));
  }

  private setModelBrowserVisibility(request: ModelBrowserVisibilityRequest): void {
    this.cancelActiveInteraction();
    const { target, visible } = request;
    if (target.kind === 'component') {
      const component = this.components.find((item) => item.id === target.id);
      if (component) component.visible = visible;
    } else if (target.kind === 'instance') {
      const instance = this.componentInstances.find((item) => item.id === target.id);
      if (instance) instance.visible = visible;
    } else {
      for (const bodyId of this.getModelBrowserTargetBodyIds(target)) {
        this.documentManager.updateBody(bodyId, { visible });
        this.updateBodyPresentation(bodyId, { visible });
      }
    }
    this.applyDocumentBodyPresentation();
    if (!visible) this.removeBodiesFromSelection(this.getModelBrowserTargetBodyIds(target));
    this.commitDocumentHistory(`${visible ? 'Show' : 'Hide'} ${target.kind}`);
    eventBus.emit('ui:status', {
      message: `${visible ? 'Shown' : 'Hidden'} ${target.kind} ${target.id}`,
    });
    this.refreshUiChrome();
  }

  private setModelBrowserLocked(request: ModelBrowserLockRequest): void {
    this.cancelActiveInteraction();
    const { target, locked } = request;
    const affectedBodyIds = this.getModelBrowserTargetBodyIds(target);
    if (target.kind === 'component') {
      const component = this.components.find((item) => item.id === target.id);
      if (component) component.locked = locked;
    } else if (target.kind === 'instance') {
      const instance = this.componentInstances.find((item) => item.id === target.id);
      if (instance) instance.locked = locked;
    } else {
      for (const bodyId of affectedBodyIds) {
        this.documentManager.updateBody(bodyId, { locked });
        this.updateBodyPresentation(bodyId, { locked });
      }
    }
    if (locked) {
      this.removeBodiesFromSelection(affectedBodyIds);
      const affected = new Set(affectedBodyIds);
      const selectedFeature = this.featureTreePanel.getSelectedFeature();
      if (selectedFeature?.refsOut.some((bodyId) => affected.has(bodyId))) {
        this.featureTreePanel.selectFeature(null);
      }
    }
    this.commitDocumentHistory(`${locked ? 'Lock' : 'Unlock'} ${target.kind}`);
    eventBus.emit('ui:status', {
      message: `${locked ? 'Locked' : 'Unlocked'} ${target.kind} ${target.id}`,
    });
    this.refreshUiChrome();
  }

  private removeBodiesFromSelection(bodyIds: string[]): void {
    const removed = new Set(bodyIds);
    const remaining = [...this.selection.selectedIds].filter((id) => !removed.has(id));
    this.selection = clearSelection(this.selection);
    if (remaining.length > 0) this.selection = selectMultiple(this.selection, remaining, false);
    this.updateSelectionVisuals();
  }

  private rollbackHistoryFromBrowser(request: ModelBrowserRollbackRequest): void {
    if (!request.confirmed) return;
    this.cancelActiveInteraction();
    const laterFeatures = this.features.slice(request.featureIndex + 1);
    const changed = laterFeatures.filter((feature) => !feature.suppressed);
    if (changed.length === 0) {
      eventBus.emit('ui:status', { message: 'History is already rolled back to this feature' });
      return;
    }
    for (const feature of changed) feature.suppressed = true;
    const target = this.getFeatureById(request.featureId);
    const result = this.rebuildAll(`Rollback to ${target?.name ?? request.featureId}`);
    if (!result.ok) {
      const failedDiagnostics = result.diagnostics;
      for (const feature of changed) feature.suppressed = false;
      this.rebuildAll('Restore history after blocked rollback', { trackHistory: false });
      this.emitBrowserDiagnostics(failedDiagnostics);
      return;
    }
    eventBus.emit('ui:status', {
      message: `Rolled back after ${target?.name ?? request.featureId}; Undo restores later features`,
    });
  }

  private showFeatureDependencies(request: ModelBrowserDependenciesRequest): void {
    const graph = createDependencyGraph(this.features);
    const names = (ids: readonly string[]) => ids.map(
      (id) => graph.featuresById.get(id)?.name ?? id
    );
    const dependencies = names(request.dependencyIds);
    const dependents = names(request.dependentIds);
    this.browserContextTask = {
      toolName: `${graph.featuresById.get(request.featureId)?.name ?? request.featureId} dependencies`,
      instructions: 'References are resolved from the deterministic history dependency graph.',
      fields: [
        {
          id: 'dependencies',
          label: 'Depends on',
          type: 'readonly',
          value: dependencies.join(', ') || 'None',
        },
        {
          id: 'dependents',
          label: 'Used by',
          type: 'readonly',
          value: dependents.join(', ') || 'None',
        },
      ],
      canCommit: false,
      canCancel: false,
    };
    eventBus.emit('ui:status', { message: 'Dependency details shown in the task panel' });
    this.refreshUiChrome();
  }

  private createCommandActions(): CommandToolbarAction[] {
    return [
      { id: 'newDocument', onTrigger: () => this.newDocument() },
      { id: 'openDocument', onTrigger: () => void this.openDocument() },
      {
        id: 'saveDocument',
        onTrigger: () => void this.saveDocument(),
        isDisabled: () => this.toolSessions.activeSession !== null,
      },
      {
        id: 'undo',
        onTrigger: () => this.undoLastChange(),
        isDisabled: () => !this.undoRedo.canUndo(),
      },
      {
        id: 'redo',
        onTrigger: () => this.redoLastChange(),
        isDisabled: () => !this.undoRedo.canRedo(),
      },
      {
        id: 'addBox',
        onTrigger: () => this.addBoxFeature(),
        isDisabled: () => this.sketchModeController.isActive || this.toolSessions.activeSession !== null,
      },
      {
        id: 'addSketch',
        onTrigger: () => this.addSketchFeature(),
        isDisabled: () => this.sketchModeController.isActive || this.toolSessions.activeSession !== null,
      },
      {
        id: 'addExtrude',
        onTrigger: () => this.addExtrudeFeature(),
        isActive: () => this.toolSessions.activeSession?.kind === 'extrude',
        isDisabled: () => this.sketchModeController.isActive || !this.hasSelectedSketchProfile(),
      },
      {
        id: 'addExtrudeCut',
        onTrigger: () => this.addExtrudeCutFeature(),
        isActive: () => this.toolSessions.activeSession?.kind === 'cut',
        isDisabled: () =>
          this.sketchModeController.isActive ||
          !this.hasSelectedSketchProfile() ||
          this.getExplicitBodyTarget() === null,
      },
      {
        id: 'addWoodJoint',
        onTrigger: () => this.startWoodJointTool(),
        isActive: () => this.toolSessions.activeSession?.kind === 'wood-joint',
        isDisabled: () =>
          this.sketchModeController.isActive
          || this.toolSessions.activeSession !== null
          || this.rebuiltBodies.length === 0,
      },
      {
        id: 'addMiterCut',
        onTrigger: () => this.addMiterCutFeature(),
        isActive: () => this.toolSessions.activeSession?.kind === 'miter-cut',
        isDisabled: () =>
          this.sketchModeController.isActive
          || this.toolSessions.activeSession !== null
          || this.getSelectedFaceReference() === null,
      },
      {
        id: 'addFaceSketch',
        onTrigger: () => this.toggleFaceSelectionMode(),
        isActive: () => this.faceSelectionMode,
        isDisabled: () => !this.canCreateFaceSketch(),
      },
      {
        id: 'enterPushPull',
        onTrigger: () => this.enterPushPullMode(),
        isActive: () => this.pushPullMode,
        isDisabled: () => this.sketchModeController.isActive || this.rebuiltBodies.length === 0,
      },
      {
        id: 'addLinearPattern',
        onTrigger: () => this.addLinearPatternFeature(),
        isActive: () => this.toolSessions.activeSession?.kind === 'linear-pattern',
        isDisabled: () => this.sketchModeController.isActive || this.getExplicitBodyTarget() === null,
      },
      {
        id: 'addMirror',
        onTrigger: () => this.addMirrorFeature(),
        isActive: () => this.toolSessions.activeSession?.kind === 'mirror',
        isDisabled: () => this.sketchModeController.isActive || this.getExplicitBodyTarget() === null,
      },
      {
        id: 'addMove',
        onTrigger: () => this.addMoveBodyFeature(),
        isActive: () => this.toolSessions.activeSession?.kind === 'move-copy'
          && (this.getFeatureById(this.featurePreviewFeatureId)?.parameters as Partial<MoveCopyParams> | undefined)?.mode === 'move',
        isDisabled: () => this.sketchModeController.isActive || this.getExplicitBodyTarget() === null,
      },
      {
        id: 'addDuplicate',
        onTrigger: () => this.addDuplicateFeature(),
        isActive: () => this.toolSessions.activeSession?.kind === 'move-copy',
        isDisabled: () => this.sketchModeController.isActive || this.getExplicitBodyTarget() === null,
      },
      {
        id: 'addRotate',
        onTrigger: () => this.addRotateBodyFeature(),
        isActive: () => this.toolSessions.activeSession?.kind === 'rotate-body-create',
        isDisabled: () => this.sketchModeController.isActive || this.getExplicitBodyTarget() === null,
      },
      {
        id: 'placePointToPoint',
        onTrigger: () => this.startPlacementTool('point-to-point'),
        isActive: () => this.toolSessions.activeSession?.kind === 'placement',
        isDisabled: () => this.sketchModeController.isActive || this.toolSessions.activeSession !== null,
      },
      {
        id: 'alignFaces',
        onTrigger: () => this.startPlacementTool('align'),
        isActive: () => this.toolSessions.activeSession?.kind === 'placement',
        isDisabled: () => this.sketchModeController.isActive || this.toolSessions.activeSession !== null,
      },
      {
        id: 'rotateAboutEdge',
        onTrigger: () => this.startAxisAnglePlacement(),
        isActive: () => this.toolSessions.activeSession?.kind === 'axis-angle-placement',
        isDisabled: () =>
          this.sketchModeController.isActive
          || this.toolSessions.activeSession !== null
          || this.getSelectedBodyIds().length === 0,
      },
      {
        id: 'addJoin',
        onTrigger: () => this.addJoinBodiesFeature(),
        isDisabled: () => this.sketchModeController.isActive || this.getSelectedBodyIds().length < 2,
      },
      {
        id: 'addUnion',
        onTrigger: () => this.addBodyBooleanFeature('union'),
        isDisabled: () => this.sketchModeController.isActive || this.getSelectedBodyIds().length < 2,
      },
      {
        id: 'createComponent',
        onTrigger: () => this.createComponentFromSelection(),
        isDisabled: () => this.toolSessions.activeSession !== null ||
          this.getSelectedFeatureIdsForComponent().length === 0,
      },
      {
        id: 'addInstance',
        onTrigger: () => this.addInstanceFromSelectedComponent(),
        isDisabled: () => this.sketchModeController.isActive ||
          this.toolSessions.activeSession !== null ||
          this.getExplicitComponentTarget() === null,
      },
      {
        id: 'createMate',
        onTrigger: () => this.startMateTool(),
        isActive: () => this.toolSessions.activeSession?.kind === 'mate',
        isDisabled: () =>
          this.toolSessions.activeSession !== null
          || this.componentInstances.length < 2,
      },
      {
        id: 'rebuild',
        onTrigger: () => this.rebuildAll(),
        isDisabled: () => this.toolSessions.activeSession !== null,
      },
      {
        id: 'deleteSelected',
        onTrigger: () => this.deleteSelected(),
        isDisabled: () =>
          !this.sketchModeController.isActive
          && (
            this.toolSessions.activeSession !== null
            || (this.selection.selectedIds.size === 0 && this.featureTreePanel.getSelectedFeature() === null)
          ),
      },
      {
        id: 'addMoveVertex',
        onTrigger: () => this.addMoveVertexFeature(),
        isDisabled: () => this.sketchModeController.isActive || this.rebuiltBodies.length === 0,
      },
      {
        id: 'toggleGridSnap',
        onTrigger: () => this.toggleGridSnap(),
        isActive: () => this.snapSettings.enabled,
      },
      {
        id: 'toggleGrid',
        onTrigger: () => this.toggleGrid(),
        isActive: () => this.isGridVisible(),
      },
      {
        id: 'toggleProjection',
        onTrigger: () => this.toggleProjection(),
        isActive: () => this.viewport.getCameraControls().getProjection() === 'orthographic',
      },
      { id: 'resetCamera', onTrigger: () => this.resetCamera() },
      {
        id: 'fitView',
        onTrigger: () => this.fitViewToModel(),
        isDisabled: () => this.sceneObjects.size === 0,
      },
      {
        id: 'measureSelection',
        onTrigger: () => this.startMeasurementTool(),
        isActive: () => this.toolSessions.activeSession?.kind === 'measurement',
        isDisabled: () => this.rebuiltBodies.length === 0 || this.toolSessions.activeSession !== null,
      },
      {
        id: 'exportCutList',
        onTrigger: () => this.exportCutList(),
        isDisabled: () => this.getCutListParts().length === 0,
      },
      {
        id: 'exportDrawing',
        onTrigger: () => void this.exportShopDrawing('svg'),
        isDisabled: () => this.rebuiltBodies.length === 0,
      },
      {
        id: 'openCommandPalette',
        onTrigger: () => this.commandPalette.toggle(),
        isActive: () => this.commandPalette?.isOpen() ?? false,
      },
      {
        id: 'toggleHelp',
        onTrigger: () => this.toggleKeyboardShortcuts(),
        isActive: () => this.keyboardShortcutsPanel.getIsVisible(),
      },
    ];
  }

  private getCommandAvailability(action: CommandToolbarAction): {
    enabled: boolean;
    reason?: string;
  } {
    const enabled = !(action.isDisabled?.() ?? false);
    if (enabled) return { enabled: true };
    const reasons: Partial<Record<CommandToolbarAction['id'], string>> = {
      undo: 'Nothing to undo.',
      redo: 'Nothing to redo.',
      addBox: 'Finish or cancel the active tool first.',
      addSketch: 'Finish or cancel the active tool first.',
      addExtrude: 'Select one sketch with a valid closed region.',
      addExtrudeCut: 'Select one target body and one sketch region.',
      addWoodJoint: 'Create at least one body, then choose a joint type and exact datum.',
      addMiterCut: 'Select one planar face.',
      addFaceSketch: 'Select one planar face.',
      enterPushPull: 'Select one planar face.',
      addLinearPattern: 'Select one body.',
      addMirror: 'Select one body and a mirror datum.',
      addMove: 'Select one body.',
      addDuplicate: 'Select one body.',
      addRotate: 'Select one body.',
      placePointToPoint: 'Finish or cancel the active tool first.',
      alignFaces: 'Finish or cancel the active tool first.',
      rotateAboutEdge: 'Select one or more bodies, then choose an exact edge axis.',
      addJoin: 'Select at least two bodies. Overlapping bodies require Union.',
      addUnion: 'Select two or more bodies to fuse into one solid.',
      createComponent: 'Select one or more features.',
      addInstance: 'Select one component.',
      createMate: 'Create at least two component instances, then select one face on each.',
      measureSelection: 'Create geometry, then choose a measurement type and exact references.',
      deleteSelected: 'Select sketch geometry, a body, or a feature.',
      addMoveVertex: 'Switch to Vertex selection and select one vertex.',
      saveDocument: 'Finish or cancel the active preview before saving.',
      rebuild: 'Finish or cancel the active preview first.',
    };
    return {
      enabled: false,
      reason: reasons[action.id] ?? 'The command prerequisites are not met.',
    };
  }

  private registerCommandActions(actions: CommandToolbarAction[]): void {
    for (const action of actions) {
      this.commandDispatcher.register({
        id: action.id,
        canExecute: () => !(action.isDisabled?.() ?? false),
        execute: () => action.onTrigger(),
      });
    }

    this.commandDispatcher.register({
      id: 'toggleVertexSelection',
      canExecute: () => !this.sketchModeController.isActive,
      execute: () => this.setSelectionMode(this.selectionMode === 'vertex' ? 'body' : 'vertex'),
    });
  }

  private registerKeyboardBindings(): void {
    const bindings = [
      { commandId: 'deleteSelected', key: 'Delete' },
      { commandId: 'deleteSelected', key: 'Backspace' },
      { commandId: 'redo', key: 'z', primary: true, shift: true },
      { commandId: 'undo', key: 'z', primary: true, shift: false },
      { commandId: 'redo', key: 'y', primary: true },
      { commandId: 'addBox', key: 'b' },
      { commandId: 'saveDocument', key: 's', primary: true, allowInEditable: true },
      { commandId: 'addSketch', key: 's' },
      { commandId: 'addExtrude', key: 'e' },
      { commandId: 'addExtrudeCut', key: 'c' },
      { commandId: 'addDuplicate', key: 'd', primary: true },
      { commandId: 'addLinearPattern', key: 'l' },
      { commandId: 'addMirror', key: 'm' },
      { commandId: 'rebuild', key: 'Enter', primary: true },
      { commandId: 'openDocument', key: 'o', primary: true },
      { commandId: 'newDocument', key: 'n', primary: true },
      { commandId: 'toggleProjection', key: 'p', primary: true },
      { commandId: 'enterPushPull', key: 'p' },
      { commandId: 'resetCamera', key: 'r', primary: true },
      { commandId: 'addRotate', key: 'r', shift: true },
      { commandId: 'toggleGrid', key: 'g', primary: true },
      { commandId: 'createComponent', key: 'g', shift: true },
      { commandId: 'toggleGridSnap', key: 'g', shift: false },
      { commandId: 'addFaceSketch', key: 'f' },
      { commandId: 'addMoveVertex', key: 'v', shift: true },
      { commandId: 'toggleVertexSelection', key: 'v', shift: false },
      { commandId: 'addInstance', key: 'i' },
      { commandId: 'addWoodJoint', key: 'j', shift: true },
      { commandId: 'addJoin', key: 'j' },
      { commandId: 'toggleHelp', key: '?', shift: true },
      { commandId: 'toggleHelp', key: 'F1' },
      { commandId: 'openCommandPalette', key: 'k', primary: true, allowInEditable: true },
    ] as const;

    for (const binding of bindings) {
      this.keyboardRouter.register(binding);
    }
  }

  private createWelcomeActions() {
    return [
      {
        label: 'Board',
        description: 'Add a starter box feature',
        onTrigger: () => this.commandDispatcher.dispatch('addBox', undefined),
      },
      {
        label: 'Sketch',
        description: `Create a sketch on the ${this.preferredSketchPlane.toUpperCase()} plane`,
        onTrigger: () => this.commandDispatcher.dispatch('addSketch', undefined),
      },
      {
        label: 'Open',
        description: 'Load a saved document',
        onTrigger: () => this.commandDispatcher.dispatch('openDocument', undefined),
      },
    ];
  }

  private refreshUiChrome(): void {
    this.commandToolbar.refresh();
    this.commandPalette?.refresh();
    this.refreshModelBrowser();
    this.viewportSelectionContext.refresh(this.createViewportSelectionContextState());
    this.refreshContextTaskPanel();
    this.refreshWoodworkingExperience();
    const sketchSessionActive = this.toolSessions.activeSession?.kind === 'sketch-edit';
    const diagnostics = this.getActiveSketchProfileDiagnostics();
    this.sketchSetupPanel.refreshState({
      activePlane: this.getActiveSketchPanelPlane(),
      activeTool: this.sketchModeController.isActive ? this.activeSketchTool : null,
      canSketchOnSelectedFace: this.canCreateFaceSketch(),
      canAddRectangle: this.canEditCurrentSketch(),
      canAddLine: this.canEditCurrentSketch(),
      canExitSketch: this.sketchModeController.isActive,
      canCommit: sketchSessionActive && (this.sketchToolDraft?.dirty ?? false),
      canCancel: sketchSessionActive,
      disabledTools: this.canEditCurrentSketch() ? [] : [
        'select',
        'line',
        'rectangle',
        'center-rectangle',
        'regular-polygon',
        'dimension',
        'constraint',
        'trim',
        'extend',
        'project',
      ],
      numericLabel: this.activeSketchTool === 'dimension' ? 'Distance' : 'Value',
      numericValue: this.sketchNumericValue,
      numericUnit: this.sketchNumericUnit,
      numericError: this.sketchNumericError,
      numericEnabled: this.activeSketchTool !== 'dimension' || this.hasValidDimensionSelection(),
      polygonSides: this.sketchPolygonSides,
      constraintType: this.sketchConstraintType,
      profileDiagnostics: diagnostics,
      statusMessage: this.getSketchToolStatus(),
    });
    this.recentFilesPanel.setRecentFiles(this.recentFilesStore.list());
    // The Recent files section only appears when there's something to reopen.
    this.panelChrome.setHidden('Recent files', this.recentFilesStore.list().length === 0);
    // The quick-start overlay is never shown by default — it adds to an already
    // busy first-run screen. It is reachable on demand only (e.g. via Help).
    this.welcomeOverlay.refresh();
    this.welcomeOverlay.setVisible(false);
    this.refreshMoveVertexExperience();
    this.refreshRotateBodyExperience();
  }

  private createViewportSelectionContextState(): ViewportSelectionContextState {
    const activeBodyId = this.selection.activeId ?? [...this.selection.selectedIds][0] ?? null;
    const body = activeBodyId
      ? this.rebuiltBodies.find((candidate) => candidate.id === activeBodyId) ?? null
      : null;
    const owner = activeBodyId ? this.getFeatureByBodyId(activeBodyId) : null;
    const ownerName = owner?.name ?? body?.name ?? 'Body';

    if (this.selectionMode === 'face' && this.selectedFace && body) {
      return {
        mode: 'face',
        selection: {
          kind: 'Planar face',
          name: `${this.getFaceOrientationLabel(body, this.selectedFace.faceId)} - ${ownerName}`,
          detail: 'Selected face remains highlighted after the pointer moves away.',
        },
        actions: [
          { id: 'push-pull', label: 'Push/Pull', primary: true },
          { id: 'sketch', label: 'Sketch' },
          { id: 'miter', label: 'Miter cut' },
          { id: 'move', label: 'Move body' },
        ],
      };
    }

    if (this.selectionMode === 'edge' && this.selectedEdgeRef && body) {
      const edge = body.edges.get(this.selectedEdgeRef.edgeId);
      const start = edge ? body.vertices.get(edge.vertexIds[0]) : null;
      const end = edge ? body.vertices.get(edge.vertexIds[1]) : null;
      const length = start && end
        ? new THREE.Vector3(...start.position).distanceTo(new THREE.Vector3(...end.position))
        : null;
      return {
        mode: 'edge',
        selection: {
          kind: 'Edge',
          name: `${ownerName} edge`,
          ...(length === null ? {} : { detail: `Length ${formatLength(length, this.getWoodworkingUnit())}` }),
        },
        actions: [
          { id: 'rotate-edge', label: 'Rotate about edge', primary: true },
          { id: 'move', label: 'Move body' },
          { id: 'measure', label: 'Measure' },
        ],
      };
    }

    if (this.selectionMode === 'vertex' && this.selectedVertexRef && body) {
      const position = body.vertices.get(this.selectedVertexRef.vertexId)?.position;
      return {
        mode: 'vertex',
        selection: {
          kind: 'Vertex',
          name: `${ownerName} corner`,
          ...(position ? {
            detail: `X ${formatLength(position[0], this.getWoodworkingUnit())}  Y ${formatLength(position[1], this.getWoodworkingUnit())}  Z ${formatLength(position[2], this.getWoodworkingUnit())}`,
          } : {}),
        },
        actions: [
          { id: 'move-vertex', label: 'Move vertex', primary: true },
          { id: 'move', label: 'Move body' },
          { id: 'measure', label: 'Measure' },
        ],
      };
    }

    if (body && this.selectionMode === 'body') {
      const bounds = getBodyBoundingBox(body);
      const size = bounds.max.map((value, index) => value - bounds.min[index]!) as [number, number, number];
      const detail = `World size ${size.map((value) => formatLength(value, this.getWoodworkingUnit())).join(' x ')} | Bounds X ${formatLength(bounds.min[0], this.getWoodworkingUnit())}, Y ${formatLength(bounds.min[1], this.getWoodworkingUnit())}, Z ${formatLength(bounds.min[2], this.getWoodworkingUnit())}`;
      const requiresSingleBody = this.selection.selectedIds.size !== 1;
      const singleBodyAvailability = requiresSingleBody
        ? { disabled: true, title: 'Select exactly one body for this action' }
        : {};
      return {
        mode: 'body',
        selection: {
          kind: this.selection.selectedIds.size > 1 ? 'Bodies' : 'Body',
          name: this.selection.selectedIds.size > 1
            ? `${this.selection.selectedIds.size} bodies selected`
            : ownerName,
          detail,
        },
        actions: [
          { id: 'move', label: 'Move', primary: true, ...singleBodyAvailability },
          { id: 'edit', label: 'Edit parameters', ...singleBodyAvailability },
          { id: 'copy', label: 'Duplicate', ...singleBodyAvailability },
          { id: 'rotate', label: 'Rotate', ...singleBodyAvailability },
        ],
      };
    }

    const noun = this.selectionMode === 'face'
      ? 'planar face'
      : this.selectionMode === 'vertex' ? 'visible vertex marker' : this.selectionMode;
    return {
      mode: this.selectionMode,
      selection: null,
      hint: `Hover to preview, then click a ${noun} to select it.`,
    };
  }

  private getFaceOrientationLabel(body: BRepBody, faceId: string): string {
    const face = body.faces.get(faceId);
    const normal = face ? body.planes.get(face.planeId)?.normal : null;
    if (!normal) return 'Selected face';
    const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    if (axis === 2) return normal[2]! >= 0 ? 'Top face' : 'Bottom face';
    if (axis === 0) return normal[0]! >= 0 ? 'Right face' : 'Left face';
    return normal[1]! >= 0 ? 'Back face' : 'Front face';
  }

  private changeViewportSelectionMode(mode: SubObjectType): void {
    if (this.toolSessions.activeSession) {
      eventBus.emit('ui:status', { message: 'Press Enter to finish or Escape to cancel the active tool first.' });
      this.viewportSelectionContext.refresh(this.createViewportSelectionContextState());
      return;
    }
    this.setSelectionMode(mode);
  }

  private handleViewportSelectionAction(actionId: string): void {
    if (this.toolSessions.activeSession) {
      eventBus.emit('ui:status', { message: 'Press Enter to finish or Escape to cancel the active tool first.' });
      return;
    }
    if (actionId === 'edit') {
      this.openSelectedFeatureParameters();
    } else if (actionId === 'move') {
      this.addMoveBodyFeature();
    } else if (actionId === 'copy') {
      this.addDuplicateFeature();
    } else if (actionId === 'rotate') {
      this.addRotateBodyFeature();
    } else if (actionId === 'push-pull') {
      this.enterPushPullMode();
    } else if (actionId === 'sketch') {
      this.createSketchFromSelectedFace();
    } else if (actionId === 'miter') {
      this.addMiterCutFeature();
    } else if (actionId === 'rotate-edge') {
      this.startAxisAnglePlacement();
    } else if (actionId === 'move-vertex') {
      this.addMoveVertexFeature();
    } else if (actionId === 'measure') {
      this.startMeasurementTool();
    }
  }

  private openSelectedFeatureParameters(): void {
    const activeBodyId = this.selection.activeId ?? [...this.selection.selectedIds][0] ?? null;
    const feature = this.featureTreePanel.getSelectedFeature()
      ?? (activeBodyId ? this.getFeatureByBodyId(activeBodyId) : null);
    if (!feature) {
      eventBus.emit('ui:status', { message: 'Select one editable body first.' });
      return;
    }
    this.featureTreePanel.selectFeature(feature.id);
    this.layout.expandSidebar('right');
    this.panelChrome.collapse('Active tool');
    this.panelChrome.expand('Properties');
    this.propertiesExpandedForFeatureId = feature.id;
    this.refreshUiChrome();
    queueMicrotask(() => {
      const firstControl = this.layout.getPanelRight().querySelector<HTMLInputElement | HTMLSelectElement>(
        '.property-inspector input, .property-inspector select'
      );
      firstControl?.focus();
    });
    eventBus.emit('ui:status', { message: `Editing ${feature.name} dimensions and position.` });
  }

  private refreshWoodworkingExperience(): void {
    const body = this.getActiveWoodworkingBody();
    const metadata = body ? this.resolveWoodworkingMetadata(body.id) : null;
    const draft = metadata ? this.toWoodworkingDraft(metadata) : createDefaultWoodworkingMetadata();
    let measurement = null;
    if (body) {
      try {
        const dimensions = measureOrientedBoard(body, this.toBoardMetadata(draft));
        const unit = this.getWoodworkingUnit();
        const withoutUnit = (value: number): string => formatLength(value, unit, unit === 'mm' ? 1 : 3)
          .replace(/\s+(?:in|mm)$/, '');
        measurement = {
          length: withoutUnit(dimensions.length),
          width: withoutUnit(dimensions.width),
          thickness: withoutUnit(dimensions.thickness),
          units: unit,
        };
      } catch (error) {
        log.warn('Selected body could not be measured as a board', {
          bodyId: body.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.woodworkingPanel.refresh({
      bodyId: body?.id ?? null,
      bodyName: body?.name ?? null,
      metadata: draft,
      measurement,
      canExport: this.rebuiltBodies.length > 0,
    });
    // The Woodworking section is contextual: it only appears once a body exists
    // (and there's something to tag or export), and hides on an empty scene.
    this.panelChrome.setHidden('Woodworking', this.rebuiltBodies.length === 0);
    this.refreshGrainDirections();
  }

  private getActiveWoodworkingBody(): BRepBody | null {
    const selectedId = this.selection.activeId ?? [...this.selection.selectedIds][0] ?? null;
    if (selectedId) {
      const selected = this.rebuiltBodies.find((body) => body.id === selectedId);
      if (selected) return selected;
    }
    const selectedFeature = this.featureTreePanel.getSelectedFeature();
    const outputId = selectedFeature?.refsOut.find((bodyId) =>
      this.rebuiltBodies.some((body) => body.id === bodyId)
    );
    return outputId ? this.rebuiltBodies.find((body) => body.id === outputId) ?? null : null;
  }

  private updateWoodworkingMetadata(bodyId: string, draft: WoodworkingMetadataDraft): void {
    if (draft.grainAxis === draft.thicknessAxis) {
      eventBus.emit('ui:status', {
        message: 'Grain and thickness axes must be different',
      });
      this.refreshUiChrome();
      return;
    }
    const body = this.rebuiltBodies.find((candidate) => candidate.id === bodyId);
    if (!body) return;
    const document = this.documentManager.getDocument();
    const sourceFeatureId = this.getFeatureByBodyId(bodyId)?.id;
    const previous = this.resolveWoodworkingMetadata(bodyId);
    const metadata: BodyWoodworkingMetadata = {
      ...(previous ?? {}),
      ...(sourceFeatureId ? { sourceFeatureId } : {}),
      isBoard: draft.isBoard,
      label: draft.label || body.name,
      material: {
        ...(previous?.material ?? {}),
        id: this.createMaterialId(draft.material),
        species: draft.material,
      },
      grainAxis: this.axisToVector(draft.grainAxis),
      thicknessAxis: this.axisToVector(draft.thicknessAxis),
      ...(draft.notes ? { notes: draft.notes } : {}),
    };
    document.bodyMetadata = {
      ...(document.bodyMetadata ?? {}),
      [bodyId]: metadata,
    };
    this.documentManager.markDirty();
    this.commitDocumentHistory(`Update woodworking metadata for ${body.name}`);
    eventBus.emit('ui:status', {
      message: draft.isBoard
        ? `${body.name} added to the cut list as ${metadata.material.species}`
        : `${body.name} removed from the cut list`,
    });
    this.refreshUiChrome();
  }

  private resolveWoodworkingMetadata(
    bodyId: string,
    featureId = this.getFeatureByBodyId(bodyId)?.id,
    visited = new Set<string>()
  ): BodyWoodworkingMetadata | null {
    const visitKey = `${featureId ?? 'instance'}:${bodyId}`;
    if (visited.has(visitKey)) return null;
    visited.add(visitKey);
    const direct = this.documentManager.getDocument().bodyMetadata?.[bodyId];
    if (direct && (!direct.sourceFeatureId || direct.sourceFeatureId === featureId)) {
      return cloneSnapshot(direct);
    }

    const instance = this.getInstanceForBody(bodyId);
    if (instance) {
      const sourceId = this.instanceBodySourceIds.get(bodyId);
      if (sourceId) {
        const inherited = this.resolveWoodworkingMetadata(sourceId, this.getFeatureByBodyId(sourceId)?.id, visited);
        return inherited ? this.transformWoodworkingAxes(inherited, new THREE.Matrix4().fromArray(instance.transform)) : null;
      }
    }

    const feature = featureId ? this.getFeatureById(featureId) : this.getFeatureByBodyId(bodyId);
    if (!feature) return direct ? cloneSnapshot(direct) : null;
    const parameters = feature.parameters as {
      sourceBodyRef?: { featureId?: string; bodyId?: string };
      bodyRef?: { featureId?: string; bodyId?: string };
      targetBodyRef?: { featureId?: string; bodyId?: string };
      bodyRefs?: Array<{ featureId?: string; bodyId?: string }>;
      toolBodyRefs?: Array<{ featureId?: string; bodyId?: string }>;
      members?: Array<{ bodyRef?: { featureId?: string; bodyId?: string } }>;
      sourceFeatureId?: string;
      rotationDegrees?: [number, number, number];
      planeRef?: PlaneRef;
    };
    const candidateRefs = [
      parameters.sourceBodyRef,
      parameters.bodyRef,
      ...(parameters.members?.map((member) => member.bodyRef) ?? []),
      ...(parameters.bodyRefs ?? []),
    ].filter((reference): reference is { featureId?: string; bodyId?: string } =>
      reference !== undefined
    );
    let sourceRef = candidateRefs.find((reference) => reference.bodyId === bodyId);
    if (!sourceRef && feature.type === TRANSFORM_BODIES_FEATURE_TYPE) {
      const outputIndex = feature.refsOut.indexOf(bodyId);
      sourceRef = outputIndex >= 0 ? parameters.bodyRefs?.[outputIndex] : undefined;
    }
    if (
      !sourceRef
      && (
        feature.type === BODY_BOOLEAN_FEATURE_TYPE
        || feature.type === WOOD_JOINT_FEATURE_TYPE
        || feature.type === JOIN_BODIES_FEATURE_TYPE
      )
    ) {
      // Boolean primary/split results and joint members inherit the target
      // member's manufacturing identity; tool metadata is never substituted.
      sourceRef = parameters.targetBodyRef
        ?? candidateRefs[0];
    }
    // Legacy Move/Copy and other single-source features produce a new body ID,
    // so the output cannot match the persisted source reference by ID. Inherit
    // manufacturing identity from the explicitly authored source instead.
    sourceRef ??= parameters.sourceBodyRef;
    sourceRef ??= parameters.targetBodyRef;
    const sourceFeatureId = sourceRef?.featureId ?? parameters.sourceFeatureId;
    const sourceBodyId = sourceRef?.bodyId ?? (sourceFeatureId
      ? this.getFeatureById(sourceFeatureId)?.refsOut.find((id) => this.rebuiltBodies.some((body) => body.id === id))
      : undefined);
    if (!sourceBodyId) return direct ? cloneSnapshot(direct) : null;
    const inherited = this.resolveWoodworkingMetadata(sourceBodyId, sourceFeatureId, visited);
    if (!inherited) return null;

    if (feature.type === ROTATE_BODY_FEATURE_TYPE && parameters.rotationDegrees) {
      const [x, y, z] = parameters.rotationDegrees.map(THREE.MathUtils.degToRad) as [number, number, number];
      return this.transformWoodworkingAxes(
        inherited,
        new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ'))
      );
    }
    if (feature.type === MIRROR_FEATURE_TYPE && parameters.planeRef) {
      const plane = getConstructionPlaneFromRef(parameters.planeRef, this.rebuiltBodies);
      if (plane) {
        const normal = new THREE.Vector3(...plane.normal).normalize();
        const reflect = (axis: readonly [number, number, number]): [number, number, number] => {
          const vector = new THREE.Vector3(...axis);
          vector.addScaledVector(normal, -2 * vector.dot(normal)).normalize();
          return [vector.x, vector.y, vector.z];
        };
        return {
          ...inherited,
          grainAxis: reflect(inherited.grainAxis),
          thicknessAxis: reflect(inherited.thicknessAxis),
        };
      }
    }
    return inherited;
  }

  private transformWoodworkingAxes(
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

  private getCutListParts(): Array<{ body: BRepBody; metadata: BoardMetadata; name: string }> {
    return this.rebuiltBodies.flatMap((body) => {
      const metadata = this.resolveWoodworkingMetadata(body.id);
      if (!metadata?.isBoard) return [];
      return [{ body, metadata: this.toStoredBoardMetadata(metadata), name: metadata.label || body.name }];
    });
  }

  private startMeasurementTool(kind = this.inferInitialMeasurementKind()): void {
    this.toolSessions.cancelActive();
    this.measurementKind = kind;
    const session = new MeasurementToolSession({
      id: `measurement-${generateId()}`,
      kind,
      bodies: this.rebuiltBodies,
      getOwningFeatureId: (bodyId) => this.getStableOwnerIdForBody(bodyId) ?? undefined,
      getBodyOrientation: (bodyId) => {
        const metadata = this.resolveWoodworkingMetadata(bodyId);
        return metadata ? {
          grainAxis: metadata.grainAxis,
          thicknessAxis: metadata.thicknessAxis,
        } : undefined;
      },
      onStateChange: (state) => {
        this.measurementState = state;
        this.refreshUiChrome();
      },
      onCommit: (result) => this.pinMeasurement(result),
      onCancel: () => {
        this.measurementSession = null;
        this.measurementState = null;
        eventBus.emit('ui:status', { message: 'Measurement canceled - document unchanged' });
      },
    });
    this.measurementSession = session;
    this.measurementState = session.getState();
    this.toolSessions.start(session);
    if (kind === 'bodyDimensions' && this.selection.activeId) {
      this.consumeMeasurementReference(this.selection.activeId, 'body');
    } else if ((kind === 'edgeLength' || kind === 'edgeAngle') && this.selectedEdgeRef) {
      this.consumeMeasurementReference(
        this.selectedEdgeRef.bodyId,
        'edge',
        this.selectedEdgeRef.edgeId
      );
    } else if ((kind === 'faceProperties' || kind === 'parallelFaceDistance' || kind === 'faceAngle') && this.selectedFace) {
      this.consumeMeasurementReference(this.selectedFace.bodyId, 'face', this.selectedFace.faceId);
    } else if ((kind === 'vertexToVertex' || kind === 'vertexToFace') && this.selectedVertexRef) {
      this.consumeMeasurementReference(
        this.selectedVertexRef.bodyId,
        'vertex',
        this.selectedVertexRef.vertexId
      );
    }
  }

  private inferInitialMeasurementKind(): MeasurementKind {
    if (this.selectedEdgeRef) return 'edgeLength';
    if (this.selectedFace) return 'faceProperties';
    return 'bodyDimensions';
  }

  private getMeasurementKindOptions() {
    return [
      ['bodyDimensions', 'Body length / width / thickness'],
      ['edgeLength', 'Edge length'],
      ['faceProperties', 'Face area / perimeter'],
      ['vertexToVertex', 'Point-to-point distance + XYZ'],
      ['vertexToFace', 'Point-to-face distance'],
      ['parallelFaceDistance', 'Parallel-face distance'],
      ['edgeAngle', 'Edge-to-edge angle'],
      ['faceAngle', 'Face-to-face angle'],
    ].map(([value, label]) => ({ value: value!, label: label! }));
  }

  private getMeasurementResultFields(result: MeasurementResult | null): ContextTaskFieldDescriptor[] {
    if (!result) return [];
    const unit = this.getWoodworkingUnit();
    if (result.kind === 'bodyDimensions') {
      return [
        { id: 'measurement-length', label: 'Length', type: 'readonly', value: formatLength(result.length, unit) },
        { id: 'measurement-width', label: 'Width', type: 'readonly', value: formatLength(result.width, unit) },
        { id: 'measurement-thickness', label: 'Thickness', type: 'readonly', value: formatLength(result.thickness, unit) },
      ];
    }
    if (result.kind === 'faceProperties') {
      const factor = convertLength(1, 'in', unit);
      return [
        { id: 'measurement-area', label: 'Area', type: 'readonly', value: `${Number((result.area * factor * factor).toFixed(3))} ${unit}\u00b2` },
        { id: 'measurement-perimeter', label: 'Perimeter', type: 'readonly', value: formatLength(result.perimeter, unit) },
      ];
    }
    if (result.kind === 'vertexToVertex') {
      return [
        { id: 'measurement-distance', label: 'Distance', type: 'readonly', value: formatLength(result.distance, unit) },
        { id: 'measurement-delta', label: 'XYZ delta', type: 'readonly', value: result.delta.map((value) => formatLength(value, unit)).join(', ') },
      ];
    }
    if (result.kind === 'edgeLength') {
      return [{ id: 'measurement-length', label: 'Length', type: 'readonly', value: formatLength(result.length, unit) }];
    }
    if (result.kind === 'vertexToFace' || result.kind === 'parallelFaceDistance') {
      return [{ id: 'measurement-distance', label: 'Distance', type: 'readonly', value: formatLength(result.distance, unit) }];
    }
    return [{ id: 'measurement-angle', label: 'Angle', type: 'readonly', value: `${Number(result.degrees.toFixed(3))}\u00b0` }];
  }

  private consumeMeasurementReference(
    bodyId: string,
    kind: MeasurementReferenceKind,
    topologyId?: string
  ): void {
    const featureId = this.getStableOwnerIdForBody(bodyId);
    if (!featureId || !this.measurementSession) return;
    const reference: MeasurementReference = kind === 'body'
      ? { kind, featureId, bodyId }
      : kind === 'vertex'
        ? { kind, featureId, bodyId, vertexId: topologyId ?? '' }
        : kind === 'edge'
          ? { kind, featureId, bodyId, edgeId: topologyId ?? '' }
          : { kind, featureId, bodyId, faceId: topologyId ?? '' };
    this.measurementSession.addReference(reference);
  }

  private pinMeasurement(result: MeasurementResult): void {
    const document = this.documentManager.getDocument();
    const definition = this.ensureDrawingDefinition(document);
    const updated = pinMeasurementIntoDrawing(definition, result, {
      dimensionId: `dimension-${generateId()}`,
      view: definition.views[0] ?? 'front',
      position: [0.5, 0.5 + definition.dimensions.length * 0.25],
    });
    const definitions = document.drawingDefinitions ?? [];
    document.drawingDefinitions = definitions.some((candidate) => candidate.id === updated.id)
      ? definitions.map((candidate) => candidate.id === updated.id ? updated : candidate)
      : [updated];
    this.documentManager.markDirty();
    this.commitDocumentHistory('Pin Measurement');
    this.measurementSession = null;
    this.measurementState = null;
    eventBus.emit('ui:status', { message: `${result.label} pinned to ${updated.name}` });
  }

  private ensureDrawingDefinition(document = this.documentManager.getDocument()): ShopDrawingDefinition {
    const existing = document.drawingDefinitions?.[0];
    if (existing) return existing;
    const definition: ShopDrawingDefinition = {
      id: `drawing-${generateId()}`,
      name: 'Shop Drawing 1',
      scope: { type: 'document' },
      views: ['front', 'top', 'right'],
      sheet: { width: 11, height: 8.5, orientation: 'landscape' },
      scale: 'fit',
      unit: this.getWoodworkingUnit(),
      precision: this.getWoodworkingUnit() === 'mm' ? 1 : 3,
      showHiddenLines: false,
      dimensions: [],
      notes: [],
    };
    return definition;
  }

  private exportCutList(): void {
    try {
      const parts = this.getCutListParts();
      if (parts.length === 0) {
        eventBus.emit('ui:status', { message: 'Tag at least one body for the cut list first' });
        return;
      }
      const title = this.documentManager.getDocument().metadata.name;
      const cutList = buildCutListDocument(parts, { title, unit: this.getWoodworkingUnit() });
      const operations = this.collectManufacturingOperations();
      const partNumbers = new Map(parts.flatMap(({ body, metadata }) =>
        metadata.partNumber ? [[body.id, metadata.partNumber] as const] : []
      ));
      this.cutListPreviewPanel?.dispose();
      const container = document.createElement('div');
      document.body.appendChild(container);
      this.cutListPreviewPanel = new CutListPreviewPanel({
        container,
        document: cutList,
        operations,
        partNumbersByBodyId: partNumbers,
        onExport: (model) => this.exportCutListPreview(cutList, model),
        onClose: () => {
          this.cutListPreviewPanel?.dispose();
          this.cutListPreviewPanel = null;
          container.remove();
        },
      });
      this.cutListPreviewPanel.open();
      eventBus.emit('ui:status', { message: 'Review finished sizes, allowances, and machining before export.' });
    } catch (error) {
      eventBus.emit('ui:status', {
        message: `Cut-list export blocked: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private exportCutListPreview(document: CutListDocument, model: CutListPreviewModel): void {
    if (!model.canExport) return;
    const rows = document.rows.map((row) => {
      const preview = model.rows.find((candidate) => candidate.key === row.key);
      return preview ? {
        ...row,
        stockAllowance: { ...preview.allowances },
        stockDimensions: { ...preview.cutDimensions },
        boardFeet: (
          preview.cutDimensions.length
          * preview.cutDimensions.width
          * preview.cutDimensions.thickness
          * row.quantity
        ) / 144,
      } : row;
    });
    const resolved: CutListDocument = {
      ...document,
      rows,
      summary: {
        groupCount: rows.length,
        partCount: rows.reduce((sum, row) => sum + row.quantity, 0),
        totalBoardFeet: rows.reduce((sum, row) => sum + row.boardFeet, 0),
      },
    };
    const bodyMetadata = { ...(this.documentManager.getDocument().bodyMetadata ?? {}) };
    for (const row of rows) {
      for (const bodyId of row.partIds) {
        const inherited = this.resolveWoodworkingMetadata(bodyId);
        if (!inherited) continue;
        bodyMetadata[bodyId] = { ...inherited, stockAllowance: { ...row.stockAllowance } };
      }
    }
    this.documentManager.getDocument().bodyMetadata = bodyMetadata;
    this.documentManager.markDirty();
    this.commitDocumentHistory('Update Cut-list Allowances');
    this.downloadTextFile(
      cutListDocumentToCsv(resolved),
      `${document.title}-cut-list.csv`,
      'text/csv'
    );
    this.cutListPreviewPanel?.close();
    eventBus.emit('ui:status', { message: `Exported ${resolved.summary.partCount} cut-list parts.` });
  }

  private collectManufacturingOperations() {
    const context = this.createCurrentRebuildContext();
    return this.features.flatMap((feature) =>
      feature.type === WOOD_JOINT_FEATURE_TYPE
        ? getWoodJointManufacturingOperations(feature, context)
        : []
    );
  }

  private async exportShopDrawing(format: 'svg' | 'pdf' | 'dxf'): Promise<void> {
    try {
      const document = this.documentManager.getDocument();
      const currentDefinition = this.ensureDrawingDefinition(document);
      const validationContext = {
        bodies: this.rebuiltBodies,
        getOwningFeatureId: (bodyId: string) => this.getStableOwnerIdForBody(bodyId) ?? undefined,
        featureIds: new Set(this.features.map((feature) => feature.id)),
      };
      const refreshedDefinition = refreshPinnedDrawingMeasurements(
        currentDefinition,
        validationContext
      );
      document.drawingDefinitions = (document.drawingDefinitions ?? []).map((candidate) =>
        candidate.id === refreshedDefinition.id ? refreshedDefinition : candidate
      );
      const issues = validateDrawingReferences(refreshedDefinition, validationContext);
      if (issues.length > 0) {
        this.pendingDrawingExportFormat = format;
        this.showDrawingReferenceIssue(refreshedDefinition, issues[0]!);
        return;
      }
      const scopedBodyIds = refreshedDefinition.scope.type === 'bodies'
        ? new Set(refreshedDefinition.scope.bodyIds)
        : null;
      const bodies = scopedBodyIds
        ? this.rebuiltBodies.filter((body) => scopedBodyIds.has(body.id))
        : this.getSelectedBodyIds().length > 0
        ? this.rebuiltBodies.filter((body) => this.selection.selectedIds.has(body.id))
        : this.rebuiltBodies;
      if (bodies.length === 0) return;
      const title = refreshedDefinition.name || document.metadata.name;
      const { buildShopDrawingAsync } = await import('./woodworking/ShopDrawingWorker');
      const drawing = await buildShopDrawingAsync(bodies, {
        title,
        unit: refreshedDefinition.unit,
        scale: typeof refreshedDefinition.scale === 'number' ? refreshedDefinition.scale : 1,
        views: refreshedDefinition.views,
        dimensionPrecision: refreshedDefinition.precision,
        includeHiddenLines: refreshedDefinition.showHiddenLines,
        annotationMarks: refreshedDefinition.dimensions.flatMap((dimension) =>
          isPinnedMeasurementDimension(dimension)
            ? [{
                id: dimension.id,
                view: dimension.view,
                position: dimension.position,
                label: this.formatPinnedMeasurement(dimension.measurement),
              }]
            : []
        ),
      });
      if (format === 'svg') {
        const { renderDrawingSvg } = await import('./woodworking/ShopDrawingSvg');
        this.downloadTextFile(
          renderDrawingSvg(drawing),
          `${title}-drawing.svg`,
          'image/svg+xml'
        );
      } else if (format === 'dxf') {
        const { renderDrawingDxfR12 } = await import('./woodworking/ShopDrawingDxf');
        this.downloadTextFile(
          renderDrawingDxfR12(drawing),
          `${title}-drawing.dxf`,
          'application/dxf'
        );
      } else {
        const { renderDrawingPdf } = await import('./woodworking/ShopDrawingPdf');
        const pdf = await renderDrawingPdf(drawing);
        this.downloadBinaryFile(pdf, `${title}-drawing.pdf`, 'application/pdf');
      }
      eventBus.emit('ui:status', {
        message: `Exported ${format.toUpperCase()} shop drawing for ${bodies.length} body(s)`,
      });
    } catch (error) {
      eventBus.emit('ui:status', {
        message: `${format.toUpperCase()} export blocked: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private formatPinnedMeasurement(result: MeasurementResult): string {
    const unit = this.getWoodworkingUnit();
    if (result.kind === 'bodyDimensions') {
      return `L ${formatLength(result.length, unit)}  W ${formatLength(result.width, unit)}  T ${formatLength(result.thickness, unit)}`;
    }
    if (result.kind === 'edgeLength') return formatLength(result.length, unit);
    if (result.kind === 'faceProperties') {
      const factor = convertLength(1, 'in', unit);
      return `Area ${Number((result.area * factor * factor).toFixed(3))} ${unit}\u00b2; perimeter ${formatLength(result.perimeter, unit)}`;
    }
    if (result.kind === 'vertexToVertex' || result.kind === 'vertexToFace' || result.kind === 'parallelFaceDistance') {
      return formatLength(result.distance, unit);
    }
    return `${Number(result.degrees.toFixed(3))}\u00b0`;
  }

  private showDrawingReferenceIssue(
    definition: ShopDrawingDefinition,
    issue: DrawingReferenceIssue
  ): void {
    const actions: ContextTaskActionDescriptor[] = [];
    for (const action of issue.actions) {
      if (action.kind === 'repair') {
        actions.push({
          id: `drawing-repair:${definition.id}:${issue.id}`,
          label: 'Repair reference',
          kind: 'primary',
        });
      } else if (action.kind === 'repair-feature') {
        const selectedFeature = this.featureTreePanel.getSelectedFeature();
        actions.push({
          id: `drawing-repair-note:${definition.id}:${issue.target.id}`,
          label: 'Repair to selected feature',
          kind: 'primary',
          disabled: selectedFeature === null,
          title: selectedFeature
            ? `Use ${selectedFeature.name}`
            : 'Select the intended feature in the model browser first.',
        });
      } else if (action.kind === 'delete-dimension' || action.kind === 'delete-note') {
        actions.push({
          id: `drawing-delete:${definition.id}:${issue.target.kind}:${issue.target.id}`,
          label: 'Delete reference',
          kind: 'danger',
        });
      }
    }
    actions.push({ id: 'drawing-dismiss', label: 'Close', kind: 'secondary' });
    this.browserContextTask = {
      toolName: 'Repair drawing reference',
      instructions: issue.message,
      status: 'Export blocked until this reference is repaired or deleted.',
      fields: [{ id: 'drawing-reference', label: 'Affected item', type: 'readonly', value: issue.target.id }],
      actions,
      canCommit: false,
      canCancel: false,
    };
    this.refreshUiChrome();
  }

  private startDrawingReferenceRepair(definitionId: string, issueId: string): void {
    const definition = this.documentManager.getDocument().drawingDefinitions
      ?.find((candidate) => candidate.id === definitionId);
    if (!definition) return;
    const issues = validateDrawingReferences(definition, {
      bodies: this.rebuiltBodies,
      getOwningFeatureId: (bodyId) => this.getStableOwnerIdForBody(bodyId) ?? undefined,
      featureIds: new Set(this.features.map((feature) => feature.id)),
    });
    const issue = issues.find((candidate) => candidate.id === issueId);
    const repair = issue?.actions.find((action) => action.kind === 'repair');
    if (!issue || !repair || repair.kind !== 'repair') return;
    this.browserContextTask = null;
    this.drawingRepairDraft = {
      definitionId,
      issue,
      expectedKind: repair.expectedReferenceKind,
      referenceIndex: repair.referenceIndex,
    };
    this.drawingRepairReplacement = null;
    this.toolSessions.start({
      id: `drawing-repair-${generateId()}`,
      kind: 'drawing-reference-repair',
      phase: 'awaiting-input',
      start: () => this.refreshUiChrome(),
      commit: () => this.applyDrawingReferenceRepair(),
      cancel: () => {
        this.drawingRepairDraft = null;
        this.drawingRepairReplacement = null;
        eventBus.emit('ui:status', { message: 'Drawing repair canceled - document unchanged' });
      },
    });
  }

  private commitDrawingReferenceRepair(reference: MeasurementReference): void {
    if (!this.drawingRepairDraft || reference.kind !== this.drawingRepairDraft.expectedKind) return;
    this.drawingRepairReplacement = reference;
    eventBus.emit('ui:status', { message: 'Replacement selected. Press Enter to repair or Escape to cancel.' });
    this.refreshUiChrome();
  }

  private applyDrawingReferenceRepair(): boolean {
    const draft = this.drawingRepairDraft;
    const replacement = this.drawingRepairReplacement;
    if (!draft || !replacement || draft.issue.target.kind !== 'dimension') return false;
    const document = this.documentManager.getDocument();
    const definition = document.drawingDefinitions?.find((candidate) => candidate.id === draft.definitionId);
    if (!definition) return false;
    const result = repairDrawingReference(definition, {
      target: 'dimension',
      dimensionId: draft.issue.target.id,
      referenceIndex: draft.referenceIndex,
      replacement,
    }, {
      bodies: this.rebuiltBodies,
      getOwningFeatureId: (bodyId) => this.getStableOwnerIdForBody(bodyId) ?? undefined,
      featureIds: new Set(this.features.map((feature) => feature.id)),
    });
    if (!result.ok) {
      eventBus.emit('ui:status', { message: `Repair blocked: ${result.message}` });
      return false;
    }
    document.drawingDefinitions = (document.drawingDefinitions ?? []).map((candidate) =>
      candidate.id === definition.id ? result.definition : candidate
    );
    this.documentManager.markDirty();
    this.commitDocumentHistory('Repair Drawing Reference');
    this.drawingRepairDraft = null;
    this.drawingRepairReplacement = null;
    this.browserContextTask = null;
    eventBus.emit('ui:status', { message: 'Drawing reference repaired.' });
    const pending = this.pendingDrawingExportFormat;
    this.pendingDrawingExportFormat = null;
    if (pending) queueMicrotask(() => void this.exportShopDrawing(pending));
    return true;
  }

  private deleteDrawingReference(
    definitionId: string,
    target: { kind: 'dimension' | 'note'; id: string }
  ): void {
    const document = this.documentManager.getDocument();
    const definition = document.drawingDefinitions?.find((candidate) => candidate.id === definitionId);
    if (!definition) return;
    const updated = deleteDrawingReferenceTarget(definition, target);
    document.drawingDefinitions = (document.drawingDefinitions ?? []).map((candidate) =>
      candidate.id === definitionId ? updated : candidate
    );
    this.documentManager.markDirty();
    this.commitDocumentHistory('Delete Drawing Reference');
    this.browserContextTask = null;
    eventBus.emit('ui:status', { message: 'Broken drawing reference deleted.' });
    const pending = this.pendingDrawingExportFormat;
    this.pendingDrawingExportFormat = null;
    if (pending) queueMicrotask(() => void this.exportShopDrawing(pending));
    this.refreshUiChrome();
  }

  private repairDrawingNoteReference(definitionId: string, noteId: string): void {
    const selectedFeature = this.featureTreePanel.getSelectedFeature();
    const document = this.documentManager.getDocument();
    const definition = document.drawingDefinitions?.find((candidate) => candidate.id === definitionId);
    if (!selectedFeature || !definition) return;
    const result = repairDrawingReference(definition, {
      target: 'note',
      noteId,
      replacementFeatureId: selectedFeature.id,
    }, {
      bodies: this.rebuiltBodies,
      getOwningFeatureId: (bodyId) => this.getStableOwnerIdForBody(bodyId) ?? undefined,
      featureIds: new Set(this.features.map((feature) => feature.id)),
    });
    if (!result.ok) {
      eventBus.emit('ui:status', { message: `Repair blocked: ${result.message}` });
      return;
    }
    document.drawingDefinitions = (document.drawingDefinitions ?? []).map((candidate) =>
      candidate.id === definitionId ? result.definition : candidate
    );
    this.documentManager.markDirty();
    this.commitDocumentHistory('Repair Drawing Callout');
    this.browserContextTask = null;
    eventBus.emit('ui:status', { message: `Drawing callout repaired to ${selectedFeature.name}.` });
    const pending = this.pendingDrawingExportFormat;
    this.pendingDrawingExportFormat = null;
    if (pending) queueMicrotask(() => void this.exportShopDrawing(pending));
    this.refreshUiChrome();
  }

  private refreshGrainDirections(): void {
    this.grainDirectionOverlay.update(this.rebuiltBodies.flatMap((body) => {
      const metadata = this.resolveWoodworkingMetadata(body.id);
      if (!metadata?.isBoard) return [];
      const bounds = getBodyBoundingBox(body);
      const dimensions = measureOrientedBoard(body, metadata);
      return [{
        bodyId: body.id,
        center: [
          (bounds.min[0] + bounds.max[0]) / 2,
          (bounds.min[1] + bounds.max[1]) / 2,
          (bounds.min[2] + bounds.max[2]) / 2,
        ] as [number, number, number],
        direction: metadata.grainAxis,
        length: dimensions.length * 0.6,
        visible: this.isBodyVisible(body.id),
      }];
    }));
  }

  private toWoodworkingDraft(metadata: BodyWoodworkingMetadata): WoodworkingMetadataDraft {
    return {
      isBoard: metadata.isBoard,
      label: metadata.label,
      material: metadata.material.species,
      grainAxis: this.vectorToAxis(metadata.grainAxis),
      thicknessAxis: this.vectorToAxis(metadata.thicknessAxis),
      notes: metadata.notes ?? '',
    };
  }

  private toBoardMetadata(draft: WoodworkingMetadataDraft): BoardMetadata {
    return {
      material: { id: this.createMaterialId(draft.material), species: draft.material },
      grainAxis: this.axisToVector(draft.grainAxis),
      thicknessAxis: this.axisToVector(draft.thicknessAxis),
      ...(draft.label ? { partNumber: draft.label } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
    };
  }

  private toStoredBoardMetadata(metadata: BodyWoodworkingMetadata): BoardMetadata {
    return {
      material: { ...metadata.material },
      grainAxis: [...metadata.grainAxis] as [number, number, number],
      thicknessAxis: [...metadata.thicknessAxis] as [number, number, number],
      ...(metadata.grainPattern ? { grainPattern: metadata.grainPattern } : {}),
      ...(metadata.partNumber ? { partNumber: metadata.partNumber } : {}),
      ...(metadata.notes ? { notes: metadata.notes } : {}),
      ...(metadata.stockAllowance ? { stockAllowance: { ...metadata.stockAllowance } } : {}),
    };
  }

  private axisToVector(axis: WoodworkingAxis): [number, number, number] {
    if (axis === 'x') return [1, 0, 0];
    if (axis === 'y') return [0, 1, 0];
    return [0, 0, 1];
  }

  private vectorToAxis(vector: Vector3): WoodworkingAxis {
    const magnitudes = vector.map(Math.abs);
    const index = magnitudes.indexOf(Math.max(...magnitudes));
    return index === 0 ? 'x' : index === 1 ? 'y' : 'z';
  }

  private getWoodworkingUnit(): 'in' | 'mm' {
    return this.documentManager.getDocument().config.units === 'mm' ? 'mm' : 'in';
  }

  /** Format the inch-based model value in the active document unit for editable HUD fields. */
  private formatLengthInput(valueInches: number): string {
    const displayed = this.getWoodworkingUnit() === 'mm'
      ? valueInches * 25.4
      : valueInches;
    return String(Number(displayed.toFixed(6)));
  }

  private createMaterialId(material: string): string {
    return material.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unspecified';
  }

  private downloadTextFile(content: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private downloadBinaryFile(content: Uint8Array, filename: string, type: string): void {
    const bytes = new Uint8Array(content.byteLength);
    bytes.set(content);
    const url = URL.createObjectURL(new Blob([bytes.buffer], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private refreshContextTaskPanel(): void {
    const session = this.toolSessions.activeSession;
    if (session) {
      if (this.visibleContextSessionId !== session.id) {
        this.visibleContextSessionId = session.id;
        this.layout.expandSidebar('right');
      }
      this.panelChrome.expand('Active tool');
      this.panelChrome.collapse('Properties');
      this.propertiesExpandedForFeatureId = null;
      if (session.kind === 'sketch-edit') {
        this.panelChrome.expand('Sketch');
      }
      if (session.kind === 'placement' && this.placementSession) {
        const state = this.placementSession.readState();
        const pointPlacement = this.activePlacementKind === 'point-to-point';
        const placement = state.preview?.placement;
        const fields: ContextTaskFieldDescriptor[] = [];
        if (pointPlacement && (state.stage === 'source-datum' || state.stage === 'target-datum')) {
          fields.push({
            id: 'placement-datum-kind',
            label: 'Point datum',
            type: 'select',
            value: this.placementPointDatumMode,
            options: [
              { value: 'vertex', label: 'Vertex' },
              { value: 'edgePoint', label: 'Edge midpoint' },
              { value: 'faceCenter', label: 'Face center' },
            ],
            help: 'This filter belongs to the tool and does not change your global selection mode.',
          });
        }
        if (placement?.type === 'PointToPoint') {
          ['x', 'y', 'z'].forEach((axis, index) => fields.push({
            id: `placement-offset-${axis}`,
            label: `Offset ${axis.toUpperCase()}`,
            type: 'text',
            value: this.formatLengthInput(placement.offset?.[index] ?? 0),
            unit: this.getWoodworkingUnit(),
          }));
        } else if (placement?.type === 'Align') {
          fields.push(
            {
              id: 'placement-gap', label: 'Signed gap', type: 'text',
              value: this.formatLengthInput(placement.gap ?? 0), unit: this.getWoodworkingUnit(),
              help: 'Positive follows the target face normal; negative moves opposite.',
            },
            {
              id: 'placement-opposed', label: 'Oppose normals', type: 'checkbox',
              value: placement.opposed ?? true,
            },
            {
              id: 'placement-quarterTurns', label: 'Quarter-turn twist', type: 'select',
              value: String(placement.quarterTurns ?? 0),
              options: [0, 1, 2, 3].map((value) => ({ value: String(value), label: `${value * 90}\u00b0` })),
            }
          );
        }
        this.contextTaskPanel.refreshState({
          toolName: pointPlacement ? 'Point-to-point Placement' : 'Align Faces',
          instructions: this.placementReferenceRequest?.prompt ?? 'Adjust the exact placement preview.',
          status: state.stage === 'numeric-preview' ? 'Previewing without rebuilding' : this.formatToolName(state.stage),
          fields,
          canCommit: state.preview !== null,
          canCancel: true,
          commitLabel: 'Place',
        });
        return;
      }
      if (session.kind === 'axis-angle-placement' && this.axisAnglePlacementDraft) {
        this.contextTaskPanel.refreshState({
          toolName: 'Rotate about Edge',
          instructions: this.axisAnglePlacementDraft.axis
            ? 'Enter an angle. The selected bodies preview as one rigid set.'
            : 'Select the exact edge that defines the rotation axis.',
          status: this.axisAnglePlacementDraft.axis ? 'Previewing without rebuilding' : 'Select axis edge',
          fields: [{
            id: 'axis-angle-degrees', label: 'Angle', type: 'number',
            value: this.axisAnglePlacementDraft.angleDegrees, unit: '\u00b0', step: 1,
          }],
          canCommit: this.axisAnglePlacementDraft.axis !== null,
          canCancel: true,
          commitLabel: 'Rotate',
        });
        return;
      }
      if (session.kind === 'mate' && this.mateSession) {
        const state = this.mateSession.readState();
        this.contextTaskPanel.refreshState({
          toolName: 'Create Mate',
          instructions: this.mateReferenceRequest?.prompt
            ?? 'Adjust the signed face offset. Zero creates a flush mate.',
          status: state.stage === 'numeric-preview' ? 'Solver-validated preview' : this.formatToolName(state.stage),
          fields: [
            {
              id: 'mate-offset', label: 'Signed offset', type: 'text',
              value: this.formatLengthInput(state.offset), unit: this.getWoodworkingUnit(),
            },
            {
              id: 'mate-driving', label: 'Keep aligned', type: 'checkbox', value: state.driving,
              help: 'When off, the mate validates the current position without moving either instance.',
            },
          ],
          canCommit: state.stage === 'numeric-preview' && state.diagnostics.length === 0,
          canCancel: true,
          commitLabel: 'Create mate',
        });
        return;
      }
      if (session.kind === 'measurement' && this.measurementState) {
        this.contextTaskPanel.refreshState({
          toolName: 'Measurement',
          instructions: this.measurementState.instruction,
          status: this.measurementState.result ? 'Exact B-Rep result ready' : `${this.measurementState.references.length} reference(s) selected`,
          fields: [
            {
              id: 'measurement-kind', label: 'Measurement', type: 'select', value: this.measurementKind,
              options: this.getMeasurementKindOptions(),
            },
            ...this.getMeasurementResultFields(this.measurementState.result),
          ],
          actions: this.measurementState.references.length > 0
            ? [{ id: 'measurement-back', label: 'Remove last reference', kind: 'secondary' }]
            : [],
          canCommit: this.measurementState.canCommit,
          canCancel: true,
          commitLabel: 'Pin to drawing',
        });
        return;
      }
      if (session.kind === 'drawing-reference-repair' && this.drawingRepairDraft) {
        this.contextTaskPanel.refreshState({
          toolName: 'Repair Drawing Reference',
          instructions: `Select one exact ${this.drawingRepairDraft.expectedKind} to replace the broken reference.`,
          status: this.drawingRepairReplacement ? 'Replacement ready' : 'Awaiting exact reference',
          fields: [{
            id: 'drawing-repair-target', label: 'Broken item', type: 'readonly',
            value: this.drawingRepairDraft.issue.target.id,
          }],
          canCommit: this.drawingRepairReplacement !== null,
          canCancel: true,
          commitLabel: 'Repair',
        });
        return;
      }
      if (session.kind === 'wood-joint') {
        const draft = this.woodJointDraft;
        const expectedMembers = draft ? getWoodJointMemberCount(draft.kind) : 2;
        const presenter = draft ? createWoodJointEditorPresenter(draft.parameters, {
          ...(draft.plan ? { computedDefaults: draft.plan.computedDefaults } : {}),
          memberLabels: draft.members.map((member, index) =>
            `Member ${String.fromCharCode(65 + index)} · ${this.getFeatureByBodyId(member.bodyRef.bodyId)?.name ?? 'body'} ${member.datumRef.kind}`
          ),
          unit: this.getWoodworkingUnit(),
        }) : null;
        const fields: ContextTaskFieldDescriptor[] = presenter
          ? presenter.fields.map((field) => {
              const isLength = field.unit === this.getWoodworkingUnit() && field.type === 'number';
              return {
                ...field,
                id: `joint-${field.id}`,
                type: isLength ? 'text' as const : field.type,
                value: isLength && typeof field.value === 'number'
                  ? this.formatLengthInput(field.value)
                  : field.value,
                disabled: field.disabled || (field.id === 'kind' && draft!.members.length > 0),
              };
            })
          : [];
        if (draft?.plan?.threeWayClosure) {
          fields.push(
            {
              id: 'joint-closure-gap', label: 'Maximum closure gap', type: 'readonly',
              value: formatLength(draft.plan.threeWayClosure.maximumGap, this.getWoodworkingUnit()),
            },
            {
              id: 'joint-closure-status', label: 'Three-way closure', type: 'readonly',
              value: draft.plan.threeWayClosure.maximumGap <= draft.plan.threeWayClosure.tolerance
                ? 'Closed within tolerance' : 'Gap exceeds tolerance',
            }
          );
        }
        const actions = presenter?.actions.map((action) => ({
          ...action,
          id: `joint-${action.id}`,
        })) ?? [];
        if (draft?.plan) {
          actions.push({
            id: 'joint-toggle-exploded',
            label: draft.exploded ? 'Close assembly preview' : 'Explode assembly preview',
            kind: 'secondary',
          });
        }
        this.contextTaskPanel.refreshState({
          toolName: presenter?.title ?? 'Wood Joint',
          instructions: draft
            ? presenter?.guidance.length
              ? presenter.guidance
              : `Select ${expectedMembers} exact ${draft.kind === 'chamfer' ? 'edge' : 'member face'}${expectedMembers === 1 ? '' : 's'} in the viewport. Every complementary cut previews together.`
            : 'Select exact member faces in the viewport.',
          status: draft?.members.length === expectedMembers
            ? draft.plan?.threeWayClosure
              ? `Three-way closure gap ${formatLength(draft.plan.threeWayClosure.maximumGap, this.getWoodworkingUnit())}`
              : 'Previewing complementary edits'
            : `Select member ${(draft?.members.length ?? 0) + 1}`,
          fields,
          actions,
          canCommit: draft?.members.length === expectedMembers
            && this.featurePreviewFeatureId !== null
            && !this.featurePreviewParameterUpdateFailed
            && (presenter?.canApply ?? false),
          canCancel: true,
          commitLabel: 'Create joint',
        });
        return;
      }
      if (session.kind === 'push-pull') {
        const hasFace = this.pushPullGizmo?.isActive() ?? false;
        const parsedDistance = parseNumericInput(this.pushPullDistanceInput, {
          defaultUnit: this.getWoodworkingUnit(),
        });
        const canCommit = hasFace
          && parsedDistance.ok
          && Number.isFinite(parsedDistance.value)
          && Math.abs(parsedDistance.value) > DEFAULT_TOLERANCE_POLICY.linear;
        this.contextTaskPanel.refreshState({
          toolName: 'Push/Pull',
          instructions: hasFace
            ? 'Enter a signed distance or drag the arrow. Positive follows the face normal; negative moves opposite.'
            : 'Select a planar face.',
          status: hasFace ? 'Previewing' : 'Select a face',
          fields: [{
            id: 'push-pull-distance',
            label: 'Distance',
            type: 'text',
            value: this.pushPullDistanceInput,
            unit: this.getWoodworkingUnit(),
            help: 'Fractions and explicit units are accepted.',
            disabled: !hasFace,
            ...(this.pushPullDistanceError ? { error: this.pushPullDistanceError } : {}),
          }],
          canCommit,
          canCancel: true,
        });
        return;
      }
      if (session.kind === 'move-copy' && this.featurePreviewFeatureId) {
        const feature = this.getFeatureById(this.featurePreviewFeatureId);
        const params = feature?.parameters as unknown as MoveCopyParams | undefined;
        if (feature && params) {
          this.contextTaskPanel.refreshState({
            toolName: params.mode === 'copy' ? 'Duplicate Body' : 'Move Body',
            instructions: 'Drag an XYZ arrow in the viewport or enter an exact displacement. The document rebuilds only when you commit.',
            status: 'Previewing without rebuilding',
            fields: (['x', 'y', 'z'] as const).map((axis, index) => ({
              id: `move-copy-${axis}`,
              label: `${axis.toUpperCase()} displacement`,
              type: 'text' as const,
              value: this.formatLengthInput(params.translation[index]!),
              unit: this.getWoodworkingUnit(),
            })),
            canCommit: true,
            canCancel: true,
            commitLabel: params.mode === 'copy' ? 'Place copy' : 'Move body',
          });
          return;
        }
      }
      const previewFeature = this.getFeatureById(this.featurePreviewFeatureId);
      const feature = previewFeature ?? this.featureTreePanel.getSelectedFeature();
      const fields: ContextTaskFieldDescriptor[] = [];
      if (session.kind === 'sketch-edit') {
        fields.push({
          id: 'sketch-numeric',
          label: 'Numeric input',
          type: 'text',
          value: this.sketchNumericValue,
          unit: this.sketchNumericUnit,
          help: 'Fractions and metric units are accepted.',
          disabled: this.activeSketchTool === 'dimension' && !this.hasValidDimensionSelection(),
          ...(this.sketchNumericError ? { error: this.sketchNumericError } : {}),
        });
      }
      if (feature) {
        fields.push(...this.createFeatureTaskFields(feature, feature.id === previewFeature?.id));
      }
      if (session.kind === 'rotate-body-create') {
        this.contextTaskPanel.refreshState({
          toolName: 'Rotate Body',
          instructions: [
            'Drag a colored ring in the viewport to rotate, or type exact X/Y/Z degrees above.',
            'Click Apply to finish or Cancel to discard. (Enter / Escape also work.)',
          ],
          status: session.phase === 'previewing' ? 'Previewing' : 'Awaiting input',
          fields,
          canCommit: !this.featurePreviewParameterUpdateFailed,
          canCancel: true,
          commitLabel: 'Apply rotation',
        });
        return;
      }
      this.contextTaskPanel.refreshState({
        toolName: this.formatToolName(session.kind),
        instructions: session.kind === 'miter-cut'
          ? (feature?.type === MITER_CUT_FEATURE_TYPE
            && ((feature.parameters as unknown as Partial<MiterCutParams>).cutStyle ?? 'single') === 'threeWay'
              ? 'Choose the joint corner and whether to keep all three pieces or trim both offcuts. Click Apply to finish or Cancel to discard.'
              : 'Set the angle and choose whether to keep both pieces or discard the offcut. Click Apply to finish or Cancel to discard.')
          : [
              'Adjust the highlighted geometry or parameters.',
              'Click Apply to finish or Cancel to discard. (Enter / Escape also work.)',
            ],
        status: session.phase === 'previewing' ? 'Previewing' : 'Awaiting input',
        fields,
        canCommit: !this.featurePreviewParameterUpdateFailed,
        canCancel: true,
        commitLabel: 'Apply',
      });
      return;
    }

    this.visibleContextSessionId = null;

    if (this.browserContextTask) {
      this.layout.expandSidebar('right');
      this.panelChrome.expand('Active tool');
      this.panelChrome.collapse('Properties');
      this.contextTaskPanel.refreshState(this.browserContextTask);
      return;
    }

    const selectedFeature = this.featureTreePanel.getSelectedFeature();
    if (selectedFeature) {
      this.panelChrome.collapse('Active tool');
      if (this.propertiesExpandedForFeatureId !== selectedFeature.id) {
        this.panelChrome.expand('Properties');
        this.propertiesExpandedForFeatureId = selectedFeature.id;
      }
      this.contextTaskPanel.refreshState(null);
      return;
    }
    this.propertiesExpandedForFeatureId = null;
    this.panelChrome.collapse('Active tool');
    this.contextTaskPanel.refreshState(null);
  }

  private createFeatureTaskFields(
    feature: FeatureRecord,
    editable: boolean
  ): ContextTaskFieldDescriptor[] {
    if (feature.type === SKETCH_FEATURE_TYPE) {
      return [];
    }
    if (feature.type === EXTRUDE_FEATURE_TYPE || feature.type === EXTRUDE_CUT_FEATURE_TYPE) {
      const params: NormalizedExtrudeParams | NormalizedExtrudeCutParams =
        feature.type === EXTRUDE_FEATURE_TYPE
          ? migrateExtrudeParams(feature.parameters)
          : migrateExtrudeCutParams(feature.parameters);
      const fields: ContextTaskFieldDescriptor[] = [];
      if (feature.type === EXTRUDE_FEATURE_TYPE) {
        const operation = (params as NormalizedExtrudeParams).operation;
        fields.push({
          id: 'feature-operation',
          label: 'Operation',
          type: editable ? 'select' : 'readonly',
          value: operation,
          options: [
            { value: 'New', label: 'New body' },
            { value: 'Add', label: 'Add material' },
            { value: 'Cut', label: 'Cut material' },
          ],
        });
      }
      fields.push(
        {
          id: 'feature-extentDirection',
          label: 'Direction',
          type: editable ? 'select' : 'readonly',
          value: params.extent.direction,
          options: [
            { value: 'OneSided', label: 'One sided' },
            { value: 'Symmetric', label: 'Symmetric' },
          ],
        },
        {
          id: 'feature-extentLimit',
          label: 'Limit',
          type: editable ? 'select' : 'readonly',
          value: params.extent.limit,
          options: [
            { value: 'Distance', label: 'Distance' },
            { value: 'UpToFace', label: 'Up to face' },
            { value: 'ThroughAll', label: 'Through all' },
          ],
          ...(params.extent.limit === 'UpToFace'
            ? {
                help: 'Select the limiting planar face in the viewport before choosing Up to face.',
              }
            : {}),
        }
      );
      if (params.extent.limit === 'Distance') {
        fields.push({
          id: 'feature-distance',
          label: 'Distance',
          type: editable ? 'number' : 'readonly',
          value: params.extent.distance ?? params.distance ?? 0,
          unit: this.getWoodworkingUnit(),
          min: DEFAULT_TOLERANCE_POLICY.linear,
          step: 0.125,
        });
      } else if (params.extent.limit === 'UpToFace') {
        fields.push({
          id: 'feature-upToFace',
          label: 'Limiting face',
          type: 'readonly',
          value: params.extent.upToFaceRef ? 'Selected planar face' : 'Select a planar face',
        });
      }
      fields.push({
        id: 'feature-flip',
        label: 'Reverse direction',
        type: editable ? 'checkbox' : 'readonly',
        value: params.flip,
      });
      return fields;
    }
    if (feature.type === MITER_CUT_FEATURE_TYPE) {
      const params = feature.parameters as unknown as MiterCutParams;
      const cutStyle = params.cutStyle ?? 'single';
      const threeWayCorner = params.threeWayCorner ?? 'corner0';
      const displayedInset = this.getWoodworkingUnit() === 'mm'
        ? params.inset * 25.4
        : params.inset;
      const fields: ContextTaskFieldDescriptor[] = [
        {
          id: 'feature-cutStyle',
          label: 'Cut type',
          type: editable ? 'select' : 'readonly',
          value: editable ? cutStyle : cutStyle === 'threeWay' ? 'Three-way end' : 'Single miter',
          options: [
            { value: 'single', label: 'Single miter' },
            { value: 'threeWay', label: 'Three-way end' },
          ],
        },
        {
          id: 'feature-resultMode',
          label: 'Result',
          type: editable ? 'select' : 'readonly',
          value: editable
            ? params.resultMode
            : params.resultMode === 'trim'
              ? 'Trim end'
              : cutStyle === 'threeWay' ? 'Keep all pieces' : 'Keep both pieces',
          options: [
            {
              value: 'split',
              label: cutStyle === 'threeWay' ? 'Keep all pieces' : 'Keep both pieces',
            },
            { value: 'trim', label: 'Trim end' },
          ],
        },
        {
          id: 'feature-inset',
          label: 'Inset',
          type: editable ? 'text' : 'readonly',
          value: String(displayedInset),
          unit: this.getWoodworkingUnit(),
          help: 'Moves the cut inward from the selected end face. Fractions and explicit units are accepted.',
        },
      ];
      if (cutStyle === 'threeWay') {
        fields.splice(2, 0,
          {
            id: 'feature-threeWayCorner',
            label: 'Joint corner',
            type: editable ? 'select' : 'readonly',
            value: editable ? threeWayCorner : `Corner ${Number(threeWayCorner.slice(-1)) + 1}`,
            options: [0, 1, 2, 3].map((index) => ({
              value: `corner${index}`,
              label: `Corner ${index + 1}`,
            })),
            help: 'The preview shows which end-face corner becomes the joint tip.',
          },
          {
            id: 'feature-threeWayAngles',
            label: 'Angles',
            type: 'readonly',
            value: '45\u00b0 + 45\u00b0',
          }
        );
      } else {
        fields.splice(2, 0,
          {
            id: 'feature-angleDegrees',
            label: 'Angle',
            type: editable ? 'number' : 'readonly',
            value: params.angleDegrees,
            unit: 'deg',
            min: -89.9,
            max: 89.9,
            step: 1,
            help: 'Use a negative angle to miter toward the opposite side.',
          },
          {
            id: 'feature-tiltAxis',
            label: 'Angle across',
            type: editable ? 'select' : 'readonly',
            value: editable ? params.tiltAxis : params.tiltAxis === 'v' ? 'Face V' : 'Face U',
            options: [
              { value: 'u', label: 'Face U' },
              { value: 'v', label: 'Face V' },
            ],
          }
        );
      }
      return fields;
    }
    if (feature.type === MOVE_COPY_FEATURE_TYPE) {
      const params = feature.parameters as unknown as MoveCopyParams;
      return [
        {
          id: 'feature-mode',
          label: 'Operation',
          type: editable ? 'select' : 'readonly',
          value: editable ? params.mode : params.mode === 'copy' ? 'Copy' : 'Move',
          options: [
            { value: 'move', label: 'Move body' },
            { value: 'copy', label: 'Copy body' },
          ],
          help: 'Move replaces the source result; Copy keeps the source and creates another body.',
        },
        {
          id: 'feature-translation',
          label: 'Placement',
          type: 'readonly',
          value: `${params.translation.map((value) => this.formatLengthInput(value)).join(', ')} ${this.getWoodworkingUnit()}`,
          help: 'Drag the local triad to change placement without rebuilding.',
        },
      ];
    }
    return Object.entries(feature.parameters)
      .filter(([id, value]) =>
        !/(^|_)(id|ref|ids)$/i.test(id)
        && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')
      )
      .slice(0, 8)
      .map(([id, value]) => {
        const label = id.replace(/([A-Z])/g, ' $1').replace(
          /^./,
          (letter) => letter.toUpperCase()
        );
        if (editable && typeof value === 'number') {
          return { id: `feature-${id}`, label, type: 'number', value };
        }
        if (editable && typeof value === 'boolean') {
          return { id: `feature-${id}`, label, type: 'checkbox', value };
        }
        return { id: `feature-${id}`, label, type: 'readonly', value: String(value) };
      });
  }

  private formatToolName(kind: string): string {
    return kind
      .split('-')
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(' ');
  }

  private updateContextTaskField(fieldId: string, value: ContextTaskFieldValue): void {
    if (fieldId.startsWith('move-copy-') && this.toolSessions.activeSession?.kind === 'move-copy') {
      const parsed = parseNumericInput(String(value ?? ''), { defaultUnit: this.getWoodworkingUnit() });
      if (!parsed.ok) {
        this.contextTaskPanel.setFieldError(fieldId, parsed.error);
        this.contextTaskPanel.setCommitEnabled(false);
        return;
      }
      const next = this.translationTriadGizmo.readTranslation();
      const axis = fieldId.slice('move-copy-'.length);
      const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      next[index] = parsed.value;
      if (!this.translationTriadGizmo.previewTranslation(next)) {
        this.contextTaskPanel.setFieldError(fieldId, 'This position cannot be previewed.');
        this.contextTaskPanel.setCommitEnabled(false);
        return;
      }
      const feature = this.featurePreviewFeatureId ? this.getFeatureById(this.featurePreviewFeatureId) : null;
      if (feature) {
        feature.parameters = {
          ...(feature.parameters as unknown as MoveCopyParams),
          translation: [...next],
        } as unknown as Record<string, unknown>;
      }
      this.contextTaskPanel.setFieldError(fieldId, null);
      this.contextTaskPanel.setCommitEnabled(true);
      return;
    }
    if (fieldId === 'placement-datum-kind') {
      if (value === 'vertex' || value === 'edgePoint' || value === 'faceCenter') {
        this.placementPointDatumMode = value;
        this.refreshContextTaskPanel();
      }
      return;
    }
    if (fieldId.startsWith('placement-offset-') && this.placementSession) {
      const parsed = parseNumericInput(String(value ?? ''), { defaultUnit: this.getWoodworkingUnit() });
      if (!parsed.ok) {
        this.contextTaskPanel.setFieldError(fieldId, parsed.error);
        return;
      }
      const state = this.placementSession.readState();
      const placement = state.preview?.placement;
      if (placement?.type !== 'PointToPoint') return;
      const next = [...(placement.offset ?? [0, 0, 0])] as [number, number, number];
      const index = fieldId.endsWith('-x') ? 0 : fieldId.endsWith('-y') ? 1 : 2;
      next[index] = parsed.value;
      this.placementSession.setPointOffset(next);
      return;
    }
    if (fieldId === 'placement-gap' && this.placementSession) {
      const parsed = parseNumericInput(String(value ?? ''), { defaultUnit: this.getWoodworkingUnit() });
      if (!parsed.ok) {
        this.contextTaskPanel.setFieldError(fieldId, parsed.error);
        return;
      }
      this.placementSession.previewSignedDistance(parsed.value);
      return;
    }
    if (fieldId === 'placement-opposed' && this.placementSession) {
      this.placementSession.setAlignOptions({ opposed: Boolean(value) });
      return;
    }
    if (fieldId === 'placement-quarterTurns' && this.placementSession) {
      this.placementSession.setAlignOptions({ quarterTurns: Number(value) });
      return;
    }
    if (fieldId === 'axis-angle-degrees' && this.axisAnglePlacementDraft) {
      this.axisAnglePlacementDraft.angleDegrees = Number(value);
      this.updateAxisAnglePreview();
      return;
    }
    if (fieldId === 'mate-offset' && this.mateSession) {
      const parsed = parseNumericInput(String(value ?? ''), { defaultUnit: this.getWoodworkingUnit() });
      if (!parsed.ok) {
        this.contextTaskPanel.setFieldError(fieldId, parsed.error);
        return;
      }
      this.mateSession.setSignedOffset(parsed.value);
      return;
    }
    if (fieldId === 'mate-driving' && this.mateSession) {
      this.mateSession.setDriving(Boolean(value));
      return;
    }
    if (fieldId === 'measurement-kind') {
      const kind = String(value) as MeasurementKind;
      if (this.getMeasurementKindOptions().some((option) => option.value === kind)) {
        this.startMeasurementTool(kind);
      }
      return;
    }
    if (fieldId.startsWith('joint-')) {
      this.updateWoodJointDraftField(fieldId.slice('joint-'.length), value);
      return;
    }
    if (fieldId === 'sketch-numeric') {
      this.sketchNumericValue = String(value ?? '');
      return;
    }
    if (fieldId === 'push-pull-distance') {
      this.pushPullDistanceInput = String(value ?? '');
      const parsed = parseNumericInput(this.pushPullDistanceInput, {
        defaultUnit: this.getWoodworkingUnit(),
      });
      if (!parsed.ok) {
        this.pushPullDistanceError = parsed.error;
        this.contextTaskPanel.setFieldError(fieldId, parsed.error);
        this.contextTaskPanel.setCommitEnabled(false);
        return;
      }
      if (Math.abs(parsed.value) <= DEFAULT_TOLERANCE_POLICY.linear) {
        this.pushPullDistanceError = 'Distance must be non-zero.';
        this.contextTaskPanel.setFieldError(fieldId, this.pushPullDistanceError);
        this.pushPullGizmo?.updateDelta(0, false);
        this.contextTaskPanel.setCommitEnabled(false);
        return;
      }
      this.pushPullDistanceError = null;
      this.contextTaskPanel.setFieldError(fieldId, null);
      this.pushPullGizmo?.updateDelta(parsed.value, false);
      this.contextTaskPanel.setCommitEnabled(true);
      return;
    }
    if (!fieldId.startsWith('feature-') || !this.featurePreviewFeatureId) return;
    const parameterId = fieldId.slice('feature-'.length);
    const feature = this.getFeatureById(this.featurePreviewFeatureId);
    if (!feature || !parameterId) return;
    if (feature.type === MITER_CUT_FEATURE_TYPE && parameterId === 'cutStyle') {
      const hiddenFieldIds = value === 'threeWay'
        ? ['feature-angleDegrees', 'feature-tiltAxis']
        : ['feature-threeWayCorner', 'feature-threeWayAngles'];
      hiddenFieldIds.forEach((hiddenFieldId) => this.featurePreviewInvalidFieldIds.delete(hiddenFieldId));
    }
    const parameters = cloneSnapshot(feature.parameters);
    if (
      (feature.type === EXTRUDE_FEATURE_TYPE || feature.type === EXTRUDE_CUT_FEATURE_TYPE)
      && parameterId.startsWith('extent')
    ) {
      const extent = {
        ...((parameters.extent as Record<string, unknown> | undefined) ?? {}),
      };
      if (parameterId === 'extentDirection') extent.direction = value;
      if (parameterId === 'extentLimit') {
        extent.limit = value;
        if (value !== 'UpToFace') delete extent.upToFaceRef;
      }
      parameters.extent = extent;
    }
    if (feature.type === MITER_CUT_FEATURE_TYPE && parameterId === 'inset') {
      const parsed = parseNumericInput(String(value ?? ''), {
        defaultUnit: this.getWoodworkingUnit(),
      });
      if (!parsed.ok) {
        this.featurePreviewInvalidFieldIds.add(fieldId);
        this.featurePreviewParameterUpdateFailed = true;
        this.contextTaskPanel.setFieldError(fieldId, parsed.error);
        this.contextTaskPanel.setCommitEnabled(false);
        return;
      }
      parameters[parameterId] = parsed.value;
    } else if (
      feature.type === MITER_CUT_FEATURE_TYPE
      && parameterId === 'angleDegrees'
    ) {
      parameters[parameterId] = value === '' ? Number.NaN : Number(value);
    } else if (
      (feature.type === EXTRUDE_FEATURE_TYPE || feature.type === EXTRUDE_CUT_FEATURE_TYPE)
      && parameterId === 'distance'
    ) {
      const distance = value === '' ? Number.NaN : Number(value);
      parameters.distance = distance;
      parameters.extent = {
        ...((parameters.extent as Record<string, unknown> | undefined) ?? {}),
        distance,
      };
    } else if (!parameterId.startsWith('extent')) {
      parameters[parameterId] = value;
    }
    const updated = this.updateFeatureParameters(
      feature.id,
      parameters,
      {
        emitStatus: false,
        trackHistory: false,
        historyLabel: `Preview ${feature.name}`,
        selectFeatureAfterUpdate: true,
        refreshUi: false,
      }
    );
    if (updated) {
      this.featurePreviewInvalidFieldIds.delete(fieldId);
      this.featurePreviewInvalidFieldIds.delete('__preview__');
      this.refreshModelBrowser();
    } else {
      this.featurePreviewInvalidFieldIds.add(fieldId);
    }
    this.featurePreviewParameterUpdateFailed = this.featurePreviewInvalidFieldIds.size > 0;
    const message = !updated
      ? this.lastFeatureUpdateFailureMessage
        ?? 'This value does not produce a valid miter cut. Adjust it and try again.'
      : null;
    if (message) {
      eventBus.emit('ui:status', { message });
    }
    this.contextTaskPanel.setFieldError(fieldId, message);
    this.contextTaskPanel.setCommitEnabled(!this.featurePreviewParameterUpdateFailed);
    if (
      updated
      && (
        (feature.type === MITER_CUT_FEATURE_TYPE && parameterId === 'cutStyle')
        || (
          (feature.type === EXTRUDE_FEATURE_TYPE || feature.type === EXTRUDE_CUT_FEATURE_TYPE)
          && parameterId === 'extentLimit'
        )
      )
    ) {
      this.refreshContextTaskPanel();
    }
  }

  private handleContextTaskAction(actionId: string): void {
    if (actionId === 'measurement-back') {
      this.measurementSession?.removeLastReference();
      return;
    }
    if (actionId === 'joint-toggle-exploded') {
      if (this.woodJointDraft) {
        this.woodJointDraft.exploded = !this.woodJointDraft.exploded;
        this.refreshWoodJointExplodedPreview();
        this.refreshUiChrome();
      }
      return;
    }
    if (actionId.startsWith('joint-reselectMember:')) {
      const index = Number(actionId.split(':')[1]);
      if (this.woodJointDraft && Number.isInteger(index)) {
        this.restoreWoodJointDatumMember();
        this.woodJointDraft.members.splice(index, 1);
        this.woodJointDraft.reselectIndex = index;
        this.woodJointDraft.parameters.members = [...this.woodJointDraft.members];
        this.removeWoodJointPreviewFeature();
        if (this.woodJointDraft.members.length === 1) {
          this.temporarilyHideWoodJointDatumMember(
            this.woodJointDraft.members[0]!.bodyRef.bodyId
          );
        }
        eventBus.emit('ui:status', { message: `Reselect member ${String.fromCharCode(65 + index)} datum.` });
        this.refreshUiChrome();
      }
      return;
    }
    if (actionId === 'joint-reselectChamferEdges' && this.woodJointDraft) {
      this.woodJointDraft.members.splice(0, 1);
      this.woodJointDraft.reselectIndex = 0;
      this.woodJointDraft.parameters.members = [];
      this.removeWoodJointPreviewFeature();
      eventBus.emit('ui:status', { message: 'Reselect the chamfer edge.' });
      this.refreshUiChrome();
      return;
    }
    if (actionId.startsWith('drawing-repair:')) {
      const [, definitionId, ...issueParts] = actionId.split(':');
      this.startDrawingReferenceRepair(definitionId ?? '', issueParts.join(':'));
      return;
    }
    if (actionId.startsWith('drawing-repair-note:')) {
      const [, definitionId, ...noteParts] = actionId.split(':');
      this.repairDrawingNoteReference(definitionId ?? '', noteParts.join(':'));
      return;
    }
    if (actionId.startsWith('drawing-delete:')) {
      const [, definitionId, kind, ...idParts] = actionId.split(':');
      if (kind === 'dimension' || kind === 'note') {
        this.deleteDrawingReference(definitionId ?? '', { kind, id: idParts.join(':') });
      }
      return;
    }
    if (actionId === 'drawing-dismiss') {
      this.browserContextTask = null;
      this.pendingDrawingExportFormat = null;
      this.refreshUiChrome();
    }
  }

  private commitContextTask(): void {
    if (this.featurePreviewInvalidFieldIds.size > 0) {
      this.contextTaskPanel.setCommitEnabled(false);
      return;
    }
    if (this.toolSessions.activeSession?.kind === 'sketch-edit' && this.sketchNumericValue.trim()) {
      this.sketchNumericError = null;
      this.handleSketchNumericSubmit({
        raw: this.sketchNumericValue,
        result: parseNumericInput(this.sketchNumericValue, {
          defaultUnit: this.sketchNumericUnit,
        }),
      });
      if (this.sketchNumericError) return;
    }
    if (this.toolSessions.activeSession?.kind === 'push-pull') {
      const parsed = parseNumericInput(this.pushPullDistanceInput, {
        defaultUnit: this.getWoodworkingUnit(),
      });
      if (!parsed.ok) {
        this.pushPullDistanceError = parsed.error;
        this.refreshContextTaskPanel();
        return;
      }
      this.pushPullDistanceError = null;
      this.pushPullGizmo?.updateDelta(parsed.value, false);
    }
    if (this.featurePreviewFeatureId) {
      this.featurePreviewParameterUpdateFailed = false;
      const applied = this.propertyInspector.applyPendingChanges();
      if (applied && this.featurePreviewParameterUpdateFailed) return;
    }
    const result = this.toolSessions.commitActive();
    this.refreshUiChrome();
    if (result.handled && result.ended) {
      queueMicrotask(() => this.refreshUiChrome());
    }
  }

  private refreshMoveVertexExperience(): void {
    const selectedFeature = this.featureTreePanel.getSelectedFeature();
    if (
      this.sketchModeController.isActive ||
      this.pushPullMode ||
      !this.moveVertexGizmo
    ) {
      this.moveVertexGizmo?.hide();
      this.moveVertexGizmo?.clearVertexTargets();
      this.vertexSelectionOverlay.clear();
      this.vertexEditPrompt.hide();
      return;
    }

    this.moveVertexGizmo.clearVertexTargets();
    this.refreshVertexSelectionOverlay();

    if (selectedFeature?.type === ROTATE_BODY_FEATURE_TYPE) {
      this.moveVertexGizmo.hide();
      this.vertexEditPrompt.hide();
      return;
    }

    if (selectedFeature?.type === MOVE_VERTEX_FEATURE_TYPE) {
      const params = this.getMoveVertexParams(selectedFeature);
      const currentPosition = params ? this.getCurrentVertexPosition(params.vertexRef) : null;
      if (!params || !currentPosition) {
        this.moveVertexGizmo.hide();
        this.vertexEditPrompt.hide();
        return;
      }

      const translation = this.normalizeMoveVertexTranslation(
        params.translation ?? [0, 0, 0],
        params.constrainAxis
      );
      const basePosition: [number, number, number] = [
        currentPosition[0] - translation[0],
        currentPosition[1] - translation[1],
        currentPosition[2] - translation[2],
      ];

      this.moveVertexGizmo.showEditor({
        featureId: selectedFeature.id,
        vertexRef: params.vertexRef,
        basePosition,
        translation,
        constrainAxis: params.constrainAxis,
        ...(this.sceneObjects.get(params.vertexRef.bodyId)
          ? { object: this.sceneObjects.get(params.vertexRef.bodyId)! }
          : {}),
        onSessionStart: (featureId) => this.beginDirectEditSession('move-vertex', featureId),
        onPreview: (featureId, nextTranslation) =>
          this.previewMoveVertexTranslation(featureId, nextTranslation),
      });
      this.vertexEditPrompt.showEditing({
        vertexId: params.vertexRef.vertexId,
        translation,
        constrainAxis: params.constrainAxis,
        onSetConstraint: (axis) => this.setMoveVertexConstraint(selectedFeature.id, axis),
      });
      return;
    }

    if (this.selectionMode === 'vertex' && this.selectedVertexRef) {
      const currentPosition = this.getCurrentVertexPosition(this.selectedVertexRef);
      if (!currentPosition) {
        this.moveVertexGizmo.hide();
        this.vertexEditPrompt.hide();
        return;
      }

      // Selection is represented by VertexSelectionOverlay. Keep transform
      // controls hidden until the user explicitly starts Move Vertex.
      this.moveVertexGizmo.hide();
      this.vertexEditPrompt.showSelection({
        vertexId: this.selectedVertexRef.vertexId,
        onStart: () => this.addMoveVertexFeature(),
      });
      return;
    }

    this.moveVertexGizmo.hide();
    this.vertexEditPrompt.hide();
  }

  private refreshRotateBodyExperience(): void {
    const selectedFeature = this.featureTreePanel.getSelectedFeature();
    if (
      this.sketchModeController.isActive ||
      this.pushPullMode ||
      !this.bodyRotateGizmo
    ) {
      this.bodyRotateGizmo?.hide();
      return;
    }

    // While a rotate-creation session owns the gizmo, do not rebind to the
    // direct-edit callbacks. Rebinding installs a session-start handler that
    // starts a second ('rotate-body') session on the first ring drag; because
    // its kind differs from 'rotate-body-create', ToolSessionManager supersedes
    // (cancels) the creation session — making the rotation impossible to commit.
    if (this.toolSessions.activeSession?.kind === 'rotate-body-create') {
      return;
    }

    const params = this.getRotateBodyParams(selectedFeature);
    if (!selectedFeature || !params) {
      this.bodyRotateGizmo.hide();
      return;
    }

    const pivot = this.getRotatePivot(params.bodyRef, params.pivot);
    if (!pivot) {
      this.bodyRotateGizmo.hide();
      return;
    }

    this.bodyRotateGizmo.showEditor({
      featureId: selectedFeature.id,
      bodyId: params.bodyRef.bodyId,
      pivot,
      rotationDegrees: [...(params.rotationDegrees ?? [0, 0, 0])] as [number, number, number],
      objects: [this.sceneObjects.get(params.bodyRef.bodyId)].filter(
        (object): object is THREE.Object3D => Boolean(object)
      ),
      onSessionStart: (featureId) => this.beginDirectEditSession('rotate-body', featureId),
      onPreview: (featureId, rotationDegrees) =>
        this.previewRotateBody(featureId, rotationDegrees),
    });
  }

  private beginDirectEditSession(kind: 'move-vertex' | 'rotate-body', featureId: string): void {
    if (
      this.toolSessions.activeSession?.kind === kind &&
      this.directEditFeatureId === featureId
    ) {
      return;
    }

    this.toolSessions.start({
      id: `${kind}-${featureId}`,
      kind,
      phase: 'previewing',
      start: () => {
        this.directEditFeatureId = featureId;
        this.directEditKind = kind;
        const feature = this.getFeatureById(featureId);
        const moveParams = this.getMoveVertexParams(feature);
        const rotateParams = this.getRotateBodyParams(feature);
        this.directEditPreviewTranslation = moveParams
          ? [...moveParams.translation]
          : null;
        this.directEditPreviewRotation = rotateParams
          ? [...rotateParams.rotationDegrees]
          : null;
        this.directEditTransaction = new PreviewTransaction<Document, never>({
          capture: () => this.buildDocumentSnapshot(),
          serialize: (snapshot) => JSON.stringify(snapshot),
          applyPreview: () => true,
          // Pointer previews are view-only, so cancellation needs no document rebuild.
          restore: () => undefined,
        });
      },
      commit: () => this.commitDirectEditSession(),
      cancel: () => this.cancelDirectEditSession(),
    });
  }

  private commitDirectEditSession(): boolean {
    const feature = this.directEditFeatureId ? this.getFeatureById(this.directEditFeatureId) : null;
    let committed = false;
    if (feature && this.directEditKind === 'move-vertex') {
      const params = this.getMoveVertexParams(feature);
      committed = params
        ? this.commitMoveVertexTranslation(
            feature.id,
            this.directEditPreviewTranslation ?? params.translation ?? [0, 0, 0]
          )
        : false;
    } else if (feature && this.directEditKind === 'rotate-body') {
      const params = this.getRotateBodyParams(feature);
      committed = params
        ? this.commitRotateBody(
            feature.id,
            this.directEditPreviewRotation ?? params.rotationDegrees ?? [0, 0, 0]
          )
        : false;
    }

    if (!committed) {
      return false;
    }
    this.directEditTransaction?.commit(`Update ${feature?.name ?? 'feature'}`);
    this.clearDirectEditSessionState();
    return true;
  }

  private cancelDirectEditSession(): void {
    const transaction = this.directEditTransaction;
    const featureId = this.directEditFeatureId;
    if (this.directEditKind === 'move-vertex') this.moveVertexGizmo?.resetPreview();
    if (this.directEditKind === 'rotate-body') this.bodyRotateGizmo?.resetPreview();
    const result = transaction?.state === 'active' ? transaction.cancel() : null;
    this.clearDirectEditSessionState();
    if (featureId) {
      this.featureTreePanel.selectFeature(featureId);
    }
    eventBus.emit('ui:status', {
      message: result?.byteEquivalent === false
        ? 'Edit canceled, but exact document recovery could not be verified'
        : 'Edit canceled - document unchanged',
    });
  }

  private clearDirectEditSessionState(): void {
    this.directEditTransaction = null;
    this.directEditFeatureId = null;
    this.directEditKind = null;
    this.directEditPreviewTranslation = null;
    this.directEditPreviewRotation = null;
  }

  private restoreInteractiveDocument(snapshot: Document, path: string | null): void {
    const snapshotFeatures = cloneSnapshot(snapshot.features) as unknown as FeatureRecord[];
    this.features = snapshotFeatures;
    this.loadAssemblyStateFromDocument(snapshot);
    this.documentManager.load(cloneSnapshot(snapshot), path ?? undefined);
    this.restoreBodyPresentations(snapshot);
    this.rebuildAll('Restore Canceled Edit', { trackHistory: false });
    this.features = cloneSnapshot(snapshotFeatures);
    this.documentManager.load(cloneSnapshot(snapshot), path ?? undefined);
    this.restoreBodyPresentations(snapshot);
    this.propertyInspector.setUnitContext(snapshot.config.units);
    eventBus.emit('document:loaded', { features: this.features });
    this.refreshDocumentDirtyState();
    this.refreshUiChrome();
  }

  private isGridVisible(): boolean {
    return this.viewport.getGrid().group.visible;
  }

  private canCreateFaceSketch(): boolean {
    return !this.sketchModeController.isActive && this.rebuiltBodies.length > 0;
  }

  /** Tool-claimant for the gesture router: own the press while a gizmo is dragging. */
  private isPointerClaimedByGizmo(pointerId: number): boolean {
    if (this.pushPullGizmo?.ownsPointer(pointerId)) return true;
    return this.gizmos.isAnyOwningNavigation();
  }

  private setupEventHandlers(): void {
    const viewportElement = this.viewport.getDomElement();

    this.unsubscribeToolSessionEnd = this.toolSessions.onSessionEnd(() => {
      this.refreshUiChrome();
    });

    // The Diagnostics section is hidden by default; show it only when a rebuild
    // actually produces errors or warnings, and hide it again when it's clean.
    const syncDiagnosticsSection = (diagnostics: unknown) => {
      const count = Array.isArray(diagnostics) ? diagnostics.length : 0;
      this.panelChrome.setHidden('Diagnostics', count === 0);
    };
    eventBus.on('rebuild:complete', ({ diagnostics }) => syncDiagnosticsSection(diagnostics));
    eventBus.on('rebuild:failed', ({ diagnostics }) => syncDiagnosticsSection(diagnostics));

    this.pointerGestureRouter.setToolClaimant({
      claim: (press) => this.isPointerClaimedByGizmo(press.start.pointerId),
      handle: () => undefined,
    });
    this.pointerGestureRouter.setNavigationClaimant({
      claim: () => !this.gizmos.isAnyOwningNavigation(),
      handle: () => undefined,
    });
    this.pointerGestureRouter.setSelectionHandler((gesture) => {
      const rect = viewportElement.getBoundingClientRect();
      this.handleSelectionClick(
        gesture.current.x,
        gesture.current.y,
        rect.width,
        rect.height,
        gesture.current.shiftKey === true
      );
    });
    viewportElement.addEventListener('pointerdown', (event) => {
      this.pointerGestureRouter.pointerDown(this.toPointerSample(event, viewportElement));
    });
    viewportElement.addEventListener('pointermove', (event) => {
      this.pointerGestureRouter.pointerMove(this.toPointerSample(event, viewportElement));
      if (event.buttons === 0) {
        this.updateHoverPreselection(event, viewportElement);
      }
    });
    // Complete the routed gesture before OrbitControls/TransformControls release
    // pointer capture at the target. Some browsers otherwise retarget the
    // pointerup and leave the application router stuck in its pressed state.
    window.addEventListener('pointerup', (event) => {
      this.pointerGestureRouter.pointerUp(this.toPointerSample(event, viewportElement));
    }, true);
    window.addEventListener('pointercancel', (event) => {
      this.pointerGestureRouter.pointerCancel(this.toPointerSample(event, viewportElement));
    }, true);
    viewportElement.addEventListener('pointerleave', () => {
      this.setHoveredBody(null);
      this.setHoveredVertex(null);
      this.faceHighlight?.clearHover();
      this.edgeSelectionOverlay?.clearHover();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));

    // Listen for document dirty state
    eventBus.on('document:dirty', ({ isDirty }) => {
      const doc = this.documentManager.getDocument();
      const title = isDirty ? `${doc.metadata.name} *` : doc.metadata.name;
      document.title = `${title} - Parametric Modeler`;
    });

    // Listen for feature updates
    eventBus.on('feature:update', ({ featureId, parameters }) => {
      const isActivePreview = featureId === this.featurePreviewFeatureId;
      const updated = this.updateFeatureParameters(featureId, parameters, isActivePreview
        ? {
            trackHistory: false,
            historyLabel: 'Update feature preview',
            successMessage: 'Preview updated - press Enter to commit or Escape to cancel',
            selectFeatureAfterUpdate: true,
          }
        : {});
      if (isActivePreview) {
        if (updated) this.featurePreviewInvalidFieldIds.delete('__property__');
        else {
          // Property-panel edits are staged outside the authoritative feature.
          // A failed rebuild restores the last valid parameters, so reflect that
          // rollback in the inspector. Keep this Enter press from committing,
          // then allow the restored valid preview to commit on the next press.
          this.featurePreviewInvalidFieldIds.add('__property__');
          const restoredFeature = this.getFeatureById(featureId);
          if (restoredFeature) this.propertyInspector.setFeature(restoredFeature);
          queueMicrotask(() => {
            this.featurePreviewInvalidFieldIds.delete('__property__');
            this.featurePreviewParameterUpdateFailed = this.featurePreviewInvalidFieldIds.size > 0;
            this.contextTaskPanel.setCommitEnabled(!this.featurePreviewParameterUpdateFailed);
          });
        }
        this.featurePreviewParameterUpdateFailed = this.featurePreviewInvalidFieldIds.size > 0;
      }
    });

    eventBus.on('feature:create-box', ({ parameters }) => {
      this.addBoxFeature(parameters);
    });

    // Listen for feature selection
    eventBus.on('feature:selected', ({ featureId }) => {
      this.selectFeatureById(featureId);
    });

    // Handle sketch mode - show plane and align camera
    eventBus.on('sketch:enter', ({ planeRef, sketchId }) => {
      const plane = getConstructionPlaneFromRef(
        planeRef,
        this.rebuiltBodies,
        this.getRebuiltBodiesByFeature()
      );
      if (plane) {
        this.viewport.showPlane(plane);
        this.viewport.getCameraControls().alignToPlane(plane);

        // Show sketch overlay with sketch data
        const sketch = this.getSketchFromFeatureId(sketchId);
        if (sketch) {
          this.sketchOverlay.show(sketch, plane);
          this.sketchOverlay.setSelectedEntity(this.selectedSketchEntityId);
        }
      }
      this.refreshUiChrome();
      log.info('Entered sketch mode', { sketchId });
    });

    // Handle sketch mode exit - hide plane and restore camera
    eventBus.on('sketch:exit', () => {
      this.viewport.hidePlane();
      this.viewport.getCameraControls().restoreFromSketch();
      this.sketchOverlay.hide();
      this.selectedSketchEntityId = null;
      this.activeSketchTool = 'select';
      this.resetSketchLineDraft();
      this.refreshUiChrome();
      log.info('Exited sketch mode');
    });

    // Handle push/pull commit (Milestone 03)
    eventBus.on('pushpull:commit', ({ faceRef, distance }) => {
      if (this.commitPushPull(faceRef, distance)) {
        this.pushPullTransaction?.commit('Push/Pull');
        this.pushPullTransaction = null;
        this.closePushPullMode();
      }
    });

    eventBus.on('pushpull:update', ({ delta }) => {
      if (this.pushPullTransaction?.state === 'active') {
        this.pushPullTransaction.preview(delta);
      }
      const distanceInput = document.getElementById('context-task-field-push-pull-distance');
      if (document.activeElement !== distanceInput) {
        const displayDistance = this.getWoodworkingUnit() === 'mm' ? delta * 25.4 : delta;
        this.pushPullDistanceInput = String(Number(displayDistance.toFixed(6)));
        this.pushPullDistanceError = null;
        this.refreshContextTaskPanel();
      }
    });

    // Handle push/pull cancel (Milestone 03)
    eventBus.on('pushpull:cancel', () => {
      this.exitPushPullMode();
    });

    eventBus.on('selection:change', () => {
      this.commandToolbar.refresh();
    });
  }

  private getFeatureByBodyId(bodyId: string | null): FeatureRecord | null {
    if (!bodyId) {
      return null;
    }

    for (let i = this.features.length - 1; i >= 0; i--) {
      const feature = this.features[i];
      if (feature?.refsOut.includes(bodyId)) {
        return feature;
      }
    }

    return null;
  }

  private getStableOwnerIdForBody(bodyId: string): string | null {
    const feature = this.getFeatureByBodyId(bodyId);
    if (feature) return feature.id;
    const instance = this.getInstanceForBody(bodyId);
    return instance ? `instance:${instance.id}` : null;
  }

  private getFeatureById(featureId: string | null): FeatureRecord | null {
    if (!featureId) {
      return null;
    }

    return this.features.find((feature) => feature.id === featureId) ?? null;
  }

  private getRebuiltBodiesByFeature(): Map<string, BRepBody[]> {
    return new Map(
      [...this.rebuiltBodiesByFeature].map(([featureId, bodies]) => [featureId, [...bodies]])
    );
  }

  private createCurrentRebuildContext() {
    return {
      featuresById: new Map(this.features.map((feature) => [feature.id, feature])),
      outputsByFeature: new Map(),
      bodiesByFeature: this.getRebuiltBodiesByFeature(),
      allBodies: [...this.rebuiltBodies],
      currentFeatureId: '',
    };
  }

  private getMoveVertexParams(feature: FeatureRecord | null): MoveVertexParams | null {
    if (!feature || feature.type !== MOVE_VERTEX_FEATURE_TYPE) {
      return null;
    }

    return feature.parameters as unknown as MoveVertexParams;
  }

  private getRotateBodyParams(feature: FeatureRecord | null): RotateBodyParams | null {
    if (!feature || feature.type !== ROTATE_BODY_FEATURE_TYPE) {
      return null;
    }

    return feature.parameters as unknown as RotateBodyParams;
  }

  private getCurrentVertexPosition(vertexRef: VertexRef): [number, number, number] | null {
    const body = this.rebuiltBodies.find((item) => item.id === vertexRef.bodyId);
    const vertex = body?.vertices.get(vertexRef.vertexId);
    if (!vertex) {
      return null;
    }

    return [...vertex.position];
  }

  private getVisibleVertexTargets(): VertexSelectionTarget[] {
    return Array.from(this.getPickableBodies(), ([bodyId, { body, featureId }]) =>
      Array.from(body.vertices.values(), (vertex) => ({
        targetId: this.getVertexTargetId(bodyId, vertex.id),
        bodyId,
        featureId,
        vertexId: vertex.id,
        position: [...vertex.position] as [number, number, number],
      }))
    ).flat();
  }

  private getVertexTargetId(bodyId: string, vertexId: string): string {
    return `${bodyId}:${vertexId}`;
  }

  private refreshVertexSelectionOverlay(): void {
    if (this.selectionMode !== 'vertex') {
      this.vertexSelectionOverlay.clear();
      return;
    }
    this.vertexSelectionOverlay.setTargets(
      this.getVisibleVertexTargets(),
      this.selectedVertexRef
        ? this.getVertexTargetId(this.selectedVertexRef.bodyId, this.selectedVertexRef.vertexId)
        : null,
      this.hoveredVertexRef
        ? this.getVertexTargetId(this.hoveredVertexRef.bodyId, this.hoveredVertexRef.vertexId)
        : null,
    );
  }

  private findMoveVertexFeatureForVertex(vertexRef: VertexRef): FeatureRecord | null {
    for (let index = this.features.length - 1; index >= 0; index--) {
      const feature = this.features[index];
      const params = this.getMoveVertexParams(feature ?? null);
      if (
        feature &&
        params &&
        params.vertexRef.bodyId === vertexRef.bodyId &&
        params.vertexRef.vertexId === vertexRef.vertexId
      ) {
        return feature;
      }
    }

    return null;
  }

  private ensureMoveVertexFeature(vertexRef: VertexRef): FeatureRecord | null {
    const existing = this.findMoveVertexFeatureForVertex(vertexRef);
    if (existing) {
      const params = this.getMoveVertexParams(existing);
      if (
        params &&
        (params.vertexRef.featureId !== vertexRef.featureId ||
          params.vertexRef.bodyId !== vertexRef.bodyId)
      ) {
        params.vertexRef = { ...vertexRef };
        existing.parameters = cloneSnapshot(params) as unknown as Record<string, unknown>;
        existing.refsIn = [vertexRef.featureId];
      }
      this.featureTreePanel.selectFeature(existing.id);
      this.refreshUiChrome();
      return existing;
    }

    const feature = createMoveVertexFeature(
      {
        vertexRef,
        translation: [0, 0, 0],
      },
      `Move Vertex ${this.features.length + 1}`
    );

    this.features.push(feature);
    const result = this.rebuildAll('Add Move Vertex');
    if (!result.ok) {
      const errorMsg = result.diagnostics[0]?.message ?? 'Unknown error';
      eventBus.emit('ui:status', { message: `Move Vertex failed: ${errorMsg}` });
      return null;
    }

    this.featureTreePanel.selectFeature(feature.id);
    this.refreshUiChrome();
    return feature;
  }

  private normalizeMoveVertexTranslation(
    translation: [number, number, number],
    axis?: 'x' | 'y' | 'z'
  ): [number, number, number] {
    if (!axis) {
      return [...translation];
    }

    if (axis === 'x') {
      return [translation[0] ?? 0, 0, 0];
    }
    if (axis === 'y') {
      return [0, translation[1] ?? 0, 0];
    }

    return [0, 0, translation[2] ?? 0];
  }

  private getRotatePivot(
    bodyRef: { bodyId: string; featureId: string },
    pivotMode: 'bodyCenter' | 'worldOrigin'
  ): [number, number, number] | null {
    if (pivotMode === 'worldOrigin') {
      return [0, 0, 0];
    }

    const body = this.rebuiltBodies.find((item) => item.id === bodyRef.bodyId);
    if (!body || body.vertices.size === 0) {
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const vertex of body.vertices.values()) {
      minX = Math.min(minX, vertex.position[0]);
      minY = Math.min(minY, vertex.position[1]);
      minZ = Math.min(minZ, vertex.position[2]);
      maxX = Math.max(maxX, vertex.position[0]);
      maxY = Math.max(maxY, vertex.position[1]);
      maxZ = Math.max(maxZ, vertex.position[2]);
    }

    return [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ];
  }

  private getPreferredSketchFeature(): FeatureRecord | null {
    const activeSketchId = this.sketchModeController.currentSketchId;
    if (activeSketchId) {
      const activeSketch = this.features.find((feature) => feature.id === activeSketchId);
      if (activeSketch?.type === SKETCH_FEATURE_TYPE) {
        return activeSketch;
      }
    }

    const selectedFeature = this.featureTreePanel.getSelectedFeature();
    if (selectedFeature?.type === SKETCH_FEATURE_TYPE) {
      return selectedFeature;
    }

    for (let i = this.features.length - 1; i >= 0; i--) {
      const feature = this.features[i];
      if (feature?.type === SKETCH_FEATURE_TYPE) {
        return feature;
      }
    }

    return null;
  }

  private getExplicitSketchTarget(): FeatureRecord | null {
    return resolveExplicitSketchTarget(this.featureTreePanel.getSelectedFeature());
  }

  private hasSelectedSketchProfile(): boolean {
    const sketchFeature = this.getExplicitSketchTarget();
    return sketchFeature !== null && this.getSketchProfileCount(sketchFeature) > 0;
  }

  private getSketchProfileCount(feature: FeatureRecord): number {
    if (feature.type !== SKETCH_FEATURE_TYPE) {
      return 0;
    }

    const sketch = this.getSketchFromFeatureId(feature.id);
    if (!sketch) {
      return 0;
    }

    return extractProfiles(sketch).length;
  }

  private getExplicitBodyTarget(): { body: BRepBody; feature: FeatureRecord } | null {
    const target = resolveExplicitBodyTarget({
      activeBodyId: this.selection.activeId,
      selectedBodyIds: this.selection.selectedIds,
      bodies: this.rebuiltBodies,
      getFeatureByBodyId: (bodyId) => this.getFeatureByBodyId(bodyId),
    });
    if (!target ||
      !this.sceneObjects.has(target.body.id) ||
      !this.isBodyVisible(target.body.id) ||
      this.isBodyLocked(target.body.id)) {
      return null;
    }
    return target;
  }

  private getSelectedFaceReference(): FaceRef | null {
    if (!this.selectedFace) return null;
    const owner = this.getFeatureByBodyId(this.selectedFace.bodyId);
    return owner
      ? createFaceRef(this.selectedFace.faceId, this.selectedFace.bodyId, owner.id)
      : null;
  }

  private getSelectedBodyIds(): string[] {
    return Array.from(this.selection.selectedIds).filter((bodyId) => this.sceneObjects.has(bodyId));
  }

  private getSelectedFeatureIdsForComponent(): string[] {
    const featureIds = new Set<string>();

    const selectedFeature = this.featureTreePanel.getSelectedFeature();
    if (selectedFeature &&
      selectedFeature.type !== SKETCH_FEATURE_TYPE &&
      selectedFeature.type !== CREATE_COMPONENT_FEATURE_TYPE) {
      featureIds.add(selectedFeature.id);
    }

    for (const selectedId of this.selection.selectedIds) {
      const feature = this.getFeatureByBodyId(selectedId);
      if (feature &&
        feature.type !== SKETCH_FEATURE_TYPE &&
        feature.type !== CREATE_COMPONENT_FEATURE_TYPE) {
        featureIds.add(feature.id);
      }
    }

    return Array.from(featureIds);
  }

  private getExplicitComponentTarget(): Component | null {
    const browserTarget = this.modelBrowser.getSelectedTarget();
    if (browserTarget?.kind === 'component') {
      return this.components.find((component) => component.id === browserTarget.id) ?? null;
    }
    return this.assemblyPanel?.getSelectedComponent() ?? null;
  }

  private getSelectedFeatureIdsForDeletion(): string[] {
    const featureIds = new Set<string>();

    const selectedFeature = this.featureTreePanel.getSelectedFeature();
    if (selectedFeature) {
      featureIds.add(selectedFeature.id);
    }

    for (const selectedId of this.selection.selectedIds) {
      const feature = this.getFeatureByBodyId(selectedId);
      if (feature) {
        featureIds.add(feature.id);
      }
    }

    return Array.from(featureIds);
  }

  private toggleKeyboardShortcuts(): void {
    this.keyboardShortcutsPanel.toggle();
    this.refreshUiChrome();
  }

  private hideKeyboardShortcuts(): void {
    this.keyboardShortcutsPanel.hide();
    this.refreshUiChrome();
  }

  private toggleProjection(): void {
    this.viewport.getCameraControls().toggleProjection();
    this.refreshUiChrome();
  }

  private resetCamera(): void {
    this.viewport.getCameraControls().reset();
    this.refreshUiChrome();
  }

  private fitViewToModel(announce = true): void {
    if (this.sceneObjects.size === 0) {
      if (announce) eventBus.emit('ui:status', { message: 'No geometry to fit in view yet' });
      return;
    }

    const bounds = new THREE.Box3();
    for (const object of this.sceneObjects.values()) {
      bounds.expandByObject(object);
    }

    if (bounds.isEmpty()) {
      if (announce) eventBus.emit('ui:status', { message: 'Unable to compute model bounds' });
      return;
    }

    this.viewport.fitToView(bounds);
    if (announce) {
      eventBus.emit('ui:status', { message: 'Camera fit to model' });
      this.refreshUiChrome();
    }
  }

  private startPlacementTool(kind: 'point-to-point' | 'align'): void {
    this.toolSessions.cancelActive();
    const selectedSources = this.getSelectedBodyIds().flatMap((bodyId) => {
      const owner = this.getFeatureByBodyId(bodyId);
      return owner ? [createBodyRef(bodyId, owner.id)] : [];
    });
    const pathAtStart = this.documentManager.currentFilePath;
    const session = createPlacementToolSession<Document>({
      id: `placement-${generateId()}`,
      kind,
      mode: 'move',
      document: {
        capture: () => this.buildDocumentSnapshot(),
        serialize: (snapshot) => JSON.stringify(snapshot),
        restore: (snapshot) => this.restoreInteractiveDocument(snapshot, pathAtStart),
      },
      getPlacementContext: () => ({ bodiesByFeature: this.getRebuiltBodiesByFeature() }),
      ...(selectedSources.length > 0 ? { initialSourceBodyRefs: selectedSources } : {}),
      onReferenceRequest: (request) => {
        this.placementReferenceRequest = request;
        this.refreshUiChrome();
      },
      onPreview: (preview) => this.renderPlacementPreview(preview),
      onClearPreview: () => this.clearPlacementPreview(),
      onDiagnostics: (diagnostics) => {
        const message = diagnostics[0]?.message;
        if (message) eventBus.emit('ui:status', { message });
        this.refreshUiChrome();
      },
      onCommit: (commit) => this.commitPlacementFeature(commit),
      onCancel: (result) => {
        this.placementSession = null;
        this.activePlacementKind = null;
        this.placementReferenceRequest = null;
        eventBus.emit('ui:status', {
          message: result.byteEquivalent
            ? 'Placement canceled - document unchanged'
            : 'Placement cancel recovery could not be verified',
        });
      },
    });
    this.placementSession = session;
    this.activePlacementKind = kind;
    this.placementPointDatumMode = 'vertex';
    this.toolSessions.start(session);
  }

  private startAxisAnglePlacement(): void {
    const sourceBodyRefs = this.getSelectedBodyIds().flatMap((bodyId) => {
      const owner = this.getFeatureByBodyId(bodyId);
      return owner ? [createBodyRef(bodyId, owner.id)] : [];
    });
    if (sourceBodyRefs.length === 0) {
      eventBus.emit('ui:status', { message: 'Select one or more bodies before Rotate about Edge.' });
      return;
    }
    const pathAtStart = this.documentManager.currentFilePath;
    const baseline = this.buildDocumentSnapshot();
    const initialAxis = this.selectedEdgeRef
      ? createEdgePlacementRef(
          this.selectedEdgeRef.featureId,
          this.selectedEdgeRef.bodyId,
          this.selectedEdgeRef.edgeId
        )
      : null;
    this.axisAnglePlacementDraft = { sourceBodyRefs, axis: initialAxis, angleDegrees: 45 };
    const session: ToolSession = {
      id: `axis-angle-${generateId()}`,
      kind: 'axis-angle-placement',
      phase: 'awaiting-input',
      start: () => {
        if (initialAxis) {
          this.updateAxisAnglePreview();
          eventBus.emit('ui:status', { message: 'Selected edge is the rotation axis. Drag or enter an angle, then press Enter.' });
        } else {
          eventBus.emit('ui:status', { message: 'Select the exact edge to use as the rotation axis.' });
        }
        this.refreshUiChrome();
      },
      commit: () => {
        const draft = this.axisAnglePlacementDraft;
        if (!draft?.axis) return false;
        const placement = createAxisAnglePlacement(draft.axis, draft.angleDegrees);
        const committed = this.commitPlacementFeature({
          sourceBodyRefs: draft.sourceBodyRefs,
          mode: 'move',
          placement,
          label: 'Rotate about Edge',
        });
        if (committed) {
          this.axisAnglePlacementDraft = null;
          this.clearPlacementPreview();
        }
        return committed;
      },
      cancel: () => {
        this.clearPlacementPreview();
        this.axisAnglePlacementDraft = null;
        this.restoreInteractiveDocument(baseline, pathAtStart);
        eventBus.emit('ui:status', { message: 'Rotation canceled - document unchanged' });
      },
    };
    this.toolSessions.start(session);
  }

  private updateAxisAnglePreview(): boolean {
    const draft = this.axisAnglePlacementDraft;
    if (!draft?.axis) return false;
    const placement = createAxisAnglePlacement(draft.axis, draft.angleDegrees);
    const solved = solvePlacementMatrix(
      placement,
      { bodiesByFeature: this.getRebuiltBodiesByFeature() }
    );
    if (!solved.ok) {
      eventBus.emit('ui:status', { message: solved.diagnostics[0]?.message ?? 'Rotation is invalid.' });
      this.clearPlacementPreview();
      return false;
    }
    return this.renderPlacementPreview({
      sourceBodyRefs: draft.sourceBodyRefs,
      mode: 'move',
      placement,
      matrix: solved.matrix.toArray(),
    });
  }

  private startMateTool(): void {
    this.toolSessions.cancelActive();
    const pathAtStart = this.documentManager.currentFilePath;
    const session = createMateToolSession<Document>({
      id: `mate-${generateId()}`,
      type: 'offset',
      initialOffset: 0,
      driving: true,
      document: {
        capture: () => this.buildDocumentSnapshot(),
        serialize: (snapshot) => JSON.stringify(snapshot),
        restore: (snapshot) => this.restoreInteractiveDocument(snapshot, pathAtStart),
      },
      getSolverContext: () => this.createConstraintSolverContext(),
      onReferenceRequest: (request) => {
        this.mateReferenceRequest = request;
        this.refreshUiChrome();
      },
      onPreview: (preview) => this.renderMatePreview(preview),
      onClearPreview: () => this.clearPlacementPreview(),
      onDiagnostics: (diagnostics) => {
        const message = diagnostics[0]?.message;
        if (message) eventBus.emit('ui:status', { message });
        this.refreshUiChrome();
      },
      onCommit: (preview) => this.commitMatePreview(preview),
      onCancel: (result) => {
        this.mateSession = null;
        this.mateReferenceRequest = null;
        eventBus.emit('ui:status', {
          message: result.byteEquivalent ? 'Mate canceled - document unchanged' : 'Mate recovery could not be verified',
        });
      },
    });
    this.mateSession = session;
    this.toolSessions.start(session);
  }

  private createConstraintSolverContext() {
    const instanceBodies = new Map(
      this.componentInstances.map((instance) => [
        instance.id,
        (this.instanceBodyIdsByInstance.get(instance.id) ?? [])
          .map((bodyId) => this.rebuiltBodies.find((body) => body.id === bodyId))
          .filter((body): body is BRepBody => Boolean(body)),
      ])
    );
    return {
      instances: this.componentInstances,
      constraints: this.constraints,
      instanceBodies,
      tolerance: DEFAULT_TOLERANCE_POLICY.linear,
    };
  }

  private renderPlacementPreview(preview: PlacementPreview): boolean {
    this.clearPlacementPreview();
    const group = new THREE.Group();
    group.name = 'placement-preview';
    const matrix = new THREE.Matrix4().fromArray(preview.matrix);
    for (const ref of preview.sourceBodyRefs) {
      const source = this.sceneObjects.get(ref.bodyId);
      if (!source) continue;
      this.placementPreviewSourceVisibility.set(ref.bodyId, source.visible);
      if (preview.mode === 'move') source.visible = false;
      const clone = source.clone(true);
      clone.traverse((child) => {
        if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        child.material = materials.map((material) => {
          const next = material.clone();
          next.transparent = true;
          next.opacity = child instanceof THREE.Mesh ? 0.72 : 0.95;
          return next;
        });
      });
      group.add(clone);
    }
    group.applyMatrix4(matrix);
    this.viewport.add(group);
    this.placementPreviewGroup = group;
    this.interactionDiagnostics.transformPreviewUpdates += 1;
    return group.children.length > 0;
  }

  private renderMatePreview(preview: MatePreview): boolean {
    this.clearPlacementPreview();
    const group = new THREE.Group();
    group.name = 'mate-preview';
    for (const current of this.componentInstances) {
      const updated = preview.solve.updatedInstances.get(current.id);
      if (!updated) continue;
      const delta = new THREE.Matrix4().fromArray(updated.transform)
        .multiply(new THREE.Matrix4().fromArray(current.transform).invert());
      for (const bodyId of this.instanceBodyIdsByInstance.get(current.id) ?? []) {
        const source = this.sceneObjects.get(bodyId);
        if (!source) continue;
        this.placementPreviewSourceVisibility.set(bodyId, source.visible);
        source.visible = false;
        const clone = source.clone(true);
        clone.applyMatrix4(delta);
        group.add(clone);
      }
    }
    this.viewport.add(group);
    this.placementPreviewGroup = group;
    this.interactionDiagnostics.transformPreviewUpdates += 1;
    return true;
  }

  private clearPlacementPreview(): void {
    if (this.placementPreviewGroup) {
      this.viewport.remove(this.placementPreviewGroup);
      this.placementPreviewGroup = null;
    }
    for (const [bodyId, visible] of this.placementPreviewSourceVisibility) {
      const source = this.sceneObjects.get(bodyId);
      if (source) source.visible = visible;
    }
    this.placementPreviewSourceVisibility.clear();
  }

  private commitPlacementFeature(commit: {
    sourceBodyRefs: readonly ReturnType<typeof createBodyRef>[];
    mode: 'move' | 'copy';
    placement: Parameters<typeof createTransformBodiesFeature>[1];
    label: string;
  }): boolean {
    const feature = createTransformBodiesFeature(
      [...commit.sourceBodyRefs],
      commit.placement,
      commit.mode,
      commit.label
    );
    this.features.push(feature);
    const rebuild = this.rebuildAll(`Validate ${commit.label}`, { trackHistory: false });
    if (!rebuild.ok) {
      this.features = this.features.filter((candidate) => candidate.id !== feature.id);
      this.rebuildAll(`Restore after failed ${commit.label}`, { trackHistory: false });
      eventBus.emit('ui:status', {
        message: rebuild.diagnostics[0]?.message ?? `${commit.label} could not rebuild.`,
      });
      return false;
    }
    this.commitDocumentHistory(commit.label);
    this.selectFeatureById(feature.id);
    this.placementSession = null;
    this.activePlacementKind = null;
    this.placementReferenceRequest = null;
    eventBus.emit('ui:status', { message: `${commit.label} committed` });
    return true;
  }

  private commitMatePreview(preview: MatePreview): boolean {
    this.componentInstances = this.componentInstances.map((instance) =>
      preview.solve.updatedInstances.get(instance.id) ?? instance
    );
    this.constraints = [...this.constraints, preview.constraint];
    const rebuild = this.rebuildAll('Validate Mate', { trackHistory: false });
    if (!rebuild.ok) return false;
    this.commitDocumentHistory('Add Mate');
    this.updateAssemblyPanel();
    this.mateSession = null;
    this.mateReferenceRequest = null;
    eventBus.emit('ui:status', { message: 'Mate committed as one assembly edit' });
    return true;
  }

  private startFlushConstraintCreation(): void {
    this.toolSessions.cancelActive();
    if (!this.constraintCreationController?.startFlushConstraint()) {
      this.refreshUiChrome();
      return;
    }

    const pathAtStart = this.documentManager.currentFilePath;
    this.constraintTransaction = new PreviewTransaction<Document, never>({
      capture: () => this.buildDocumentSnapshot(),
      serialize: (snapshot) => JSON.stringify(snapshot),
      applyPreview: () => true,
      restore: (snapshot) => this.restoreInteractiveDocument(snapshot, pathAtStart),
    });
    this.toolSessions.start({
      id: `constraint-${Date.now()}`,
      kind: 'constraint',
      phase: 'awaiting-input',
      commit: () => {
        const committed = this.constraintCreationController?.commit() ?? false;
        if (committed) {
          this.constraintTransaction?.commit('Add Constraint');
          this.constraintTransaction = null;
        }
        return committed;
      },
      cancel: () => {
        this.constraintCreationController?.cancel();
        const result = this.constraintTransaction?.state === 'active'
          ? this.constraintTransaction.cancel()
          : null;
        this.constraintTransaction = null;
        if (result?.byteEquivalent === false) {
          eventBus.emit('ui:status', { message: 'Constraint cancel recovery could not be verified' });
        }
      },
    });
    this.refreshUiChrome();
  }

  private handleSelectionClick(
    x: number,
    y: number,
    width: number,
    height: number,
    additive: boolean
  ): void {
    this.syncPickMatrices();
    if (this.directEditFeatureId) {
      this.toolSessions.cancelActive();
    }
    const toolReferenceMode = this.getToolReferenceMode();
    if (toolReferenceMode === 'face' || this.isFacePickingActive()) {
      this.handleFaceSelectionClick(x, y, width, height);
      return;
    }

    if (this.sketchModeController.isActive) {
      return;
    }

    if (toolReferenceMode === 'vertex' || this.selectionMode === 'vertex') {
      this.handleVertexSelectionClick(x, y, width, height);
      return;
    }

    if (toolReferenceMode === 'edge' || this.selectionMode === 'edge') {
      this.handleEdgeSelectionClick(x, y, width, height);
      return;
    }

    const result = this.picking.pick(
      x,
      y,
      width,
      height,
      this.viewport.getCameraControls().camera,
      this.getPickableSceneObjects()
    );

    if (result.objectId) {
      this.clearSubObjectSelectionState();
      this.selection = select(this.selection, result.objectId, additive);
      this.updateSelectionVisuals();
      const owner = this.getFeatureByBodyId(result.objectId);
      if (additive || this.selection.selectedIds.size > 1) {
        this.featureTreePanel.selectFeature(null);
        this.modelBrowser.select(null);
      } else {
        this.featureTreePanel.selectFeature(owner?.id ?? null);
        this.modelBrowser.select({ kind: 'body', id: result.objectId });
      }
      if (this.placementReferenceRequest?.stage === 'source-selection' && this.placementSession) {
        const refs = [...this.selection.selectedIds].flatMap((bodyId) => {
          const owner = this.getFeatureByBodyId(bodyId);
          return owner ? [createBodyRef(bodyId, owner.id)] : [];
        });
        this.placementSession.selectSources(refs);
      } else if (this.measurementState?.expectedReferenceKind === 'body') {
        this.consumeMeasurementReference(result.objectId, 'body');
      } else if (this.drawingRepairDraft?.expectedKind === 'body') {
        this.commitDrawingReferenceRepair({
          kind: 'body',
          featureId: this.getStableOwnerIdForBody(result.objectId) ?? '',
          bodyId: result.objectId,
        });
      }
      const selectedName = owner?.name
        ?? this.rebuiltBodies.find((body) => body.id === result.objectId)?.name
        ?? 'Body';
      this._statusBar.setCenterMessage(
        this.selection.selectedIds.size > 1
          ? `${this.selection.selectedIds.size} bodies selected`
          : `${selectedName} | Body selected`
      );
      eventBus.emit('ui:status', {
        message: this.selection.selectedIds.size > 1
          ? `${this.selection.selectedIds.size} bodies selected - choose a transform or joint`
          : `${selectedName} selected - use Edit parameters or drag Move in the selection bar`,
      });
      log.debug('Object selected', { id: result.objectId });
    } else if (!additive) {
      this.clearSubObjectSelectionState();
      this.selection = clearSelection(this.selection);
      this.updateSelectionVisuals();
      this.featureTreePanel.selectFeature(null);
      this.modelBrowser.select(null);
      this._statusBar.setCenterMessage('');
    }

    this.refreshUiChrome();
  }

  private toPointerSample(event: PointerEvent, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    return {
      pointerId: event.pointerId,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      button: event.button,
      buttons: event.buttons,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
  }

  /**
   * Ensure pickable geometry and the active camera have current world matrices
   * before raycasting. Pointer events can land between render frames (right
   * after a body move, a gizmo drag, or a sidebar resize), and without this the
   * raycaster can intersect stale geometry and highlight/select the wrong body
   * relative to the cursor.
   */
  private syncPickMatrices(): void {
    this.viewport.getScene().updateMatrixWorld(true);
    this.viewport.getCameraControls().camera.updateMatrixWorld();
  }

  private updateHoverPreselection(event: PointerEvent, element: HTMLElement): void {
    if (this.sketchModeController.isActive || this.pushPullGizmo?.isActive()) {
      this.setHoveredBody(null);
      this.setHoveredVertex(null);
      this.faceHighlight?.clearHover();
      this.edgeSelectionOverlay?.clearHover();
      return;
    }

    this.syncPickMatrices();

    const toolReferenceMode = this.getToolReferenceMode();
    if (toolReferenceMode === 'vertex' || this.selectionMode === 'vertex') {
      this.setHoveredBody(null);
      this.faceHighlight?.clearHover();
      this.edgeSelectionOverlay?.clearHover();
      this.updateVertexHoverPreselection(event, element);
      return;
    }

    this.setHoveredVertex(null);
    if (toolReferenceMode === 'edge' || this.selectionMode === 'edge') {
      this.setHoveredBody(null);
      this.faceHighlight?.clearHover();
      this.updateEdgeHoverPreselection(event, element);
      return;
    }

    this.edgeSelectionOverlay?.clearHover();
    if (this.isFacePickingActive()) {
      this.setHoveredBody(null);
      this.updateFaceHoverPreselection(event, element);
      return;
    }

    this.faceHighlight?.clearHover();

    const rect = element.getBoundingClientRect();
    const result = this.picking.pick(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      this.viewport.getCameraControls().camera,
      this.getPickableSceneObjects()
    );
    this.setHoveredBody(result.objectId);
  }

  private updateEdgeHoverPreselection(event: PointerEvent, element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const result = this.picking.pickEdge(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      this.viewport.getCameraControls().camera,
      this.getPickableBodies(),
    );
    if (!result?.edgeId || !result.bodyId) {
      this.edgeSelectionOverlay?.clearHover();
      element.style.cursor = '';
      return;
    }
    const body = this.rebuiltBodies.find((candidate) => candidate.id === result.bodyId);
    if (!body?.edges.has(result.edgeId)) {
      this.edgeSelectionOverlay?.clearHover();
      element.style.cursor = '';
      return;
    }
    this.ensureEdgeSelectionOverlay().setHoveredEdge(body, result.edgeId);
    element.style.cursor = 'crosshair';
  }

  private updateVertexHoverPreselection(event: PointerEvent, element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const result = this.picking.pickVertex(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      this.viewport.getCameraControls().camera,
      this.getPickableBodies(),
    );
    if (!result?.vertexId || !result.bodyId || !result.featureId) {
      this.setHoveredVertex(null);
      return;
    }
    this.setHoveredVertex(createVertexRef(result.featureId, result.bodyId, result.vertexId));
  }

  private updateFaceHoverPreselection(event: PointerEvent, element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const result = this.picking.pickFace(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      this.viewport.getCameraControls().camera,
      this.getPickableSceneObjects()
    );
    if (!result.faceId || !result.bodyId) {
      this.faceHighlight?.clearHover();
      element.style.cursor = '';
      return;
    }

    const body = this.rebuiltBodies.find((candidate) => candidate.id === result.bodyId);
    const faceId = this.meshCache.getFaceIdFromBody(result.bodyId, Number(result.faceId)) ?? result.faceId;
    if (!body?.faces.has(faceId)) {
      this.faceHighlight?.clearHover();
      element.style.cursor = '';
      return;
    }
    this.ensureFaceHighlight().setHoveredFace(body, faceId);
    element.style.cursor = 'pointer';
  }

  private ensureFaceHighlight(): FaceHighlight {
    if (!this.faceHighlight) {
      this.faceHighlight = new FaceHighlight();
      this.faceHighlight.attachToScene(this.viewport.getScene());
    }
    return this.faceHighlight;
  }

  private setHoveredBody(bodyId: string | null): void {
    if (this.hoveredBodyId === bodyId) {
      return;
    }
    this.hoveredBodyId = bodyId;
    this.updateSelectionVisuals();
    this.viewport.getDomElement().style.cursor = bodyId ? 'pointer' : '';
  }

  private setHoveredVertex(vertexRef: VertexRef | null): void {
    if (
      this.hoveredVertexRef?.bodyId === vertexRef?.bodyId &&
      this.hoveredVertexRef?.vertexId === vertexRef?.vertexId
    ) {
      return;
    }
    this.hoveredVertexRef = vertexRef ? { ...vertexRef } : null;
    this.refreshVertexSelectionOverlay();
    this.viewport.getDomElement().style.cursor = vertexRef ? 'pointer' : '';
  }

  private isFacePickingActive(): boolean {
    return (
      this.faceSelectionMode ||
      this.pushPullMode ||
      this.constraintCreationController?.isActive() === true ||
      this.selectionMode === 'face' ||
      this.getToolReferenceMode() === 'face'
    );
  }

  private getToolReferenceMode(): SubObjectType | null {
    if (this.placementReferenceRequest) {
      if (this.placementReferenceRequest.stage === 'source-datum' || this.placementReferenceRequest.stage === 'target-datum') {
        return this.placementSession?.readState().sourceDatum?.kind === 'face'
          || this.placementReferenceRequest.acceptedKinds.length === 1
          ? this.placementReferenceRequest.requestedSelectionMode
          : this.placementPointDatumMode === 'edgePoint'
            ? 'edge'
            : this.placementPointDatumMode === 'faceCenter' ? 'face' : 'vertex';
      }
      return this.placementReferenceRequest.requestedSelectionMode;
    }
    if (this.mateReferenceRequest) return 'face';
    if (this.measurementState?.expectedReferenceKind) return this.measurementState.expectedReferenceKind;
    if (this.drawingRepairDraft) return this.drawingRepairDraft.expectedKind;
    if (this.axisAnglePlacementDraft && !this.axisAnglePlacementDraft.axis) return 'edge';
    return null;
  }

  /**
   * Handle click in face selection mode.
   */
  private handleFaceSelectionClick(x: number, y: number, width: number, height: number): void {
    const result = this.picking.pickFace(
      x,
      y,
      width,
      height,
      this.viewport.getCameraControls().camera,
      this.getPickableSceneObjects()
    );

    if (result.faceId && result.bodyId) {
      const faceId = this.meshCache.getFaceIdFromBody(result.bodyId, Number(result.faceId)) ?? result.faceId;
      this.selectedFace = { faceId, bodyId: result.bodyId };
      this.selectedVertexRef = null;
      this.selectedEdgeRef = null;
      this.selection = select(this.selection, result.bodyId, false);
      this.updateSelectionVisuals();
      this.featureTreePanel.selectFeature(this.getFeatureByBodyId(result.bodyId)?.id ?? null);
      this.modelBrowser.select({ kind: 'body', id: result.bodyId });
      const body = this.rebuiltBodies.find((candidate) => candidate.id === result.bodyId);
      if (body?.faces.has(faceId)) {
        this.ensureFaceHighlight().setSelectedFace(body, faceId);
      }
      eventBus.emit('face:selected', { faceId, bodyId: result.bodyId });
      log.debug('Face selected', { faceId, bodyId: result.bodyId });

      const instance = this.getInstanceForBody(result.bodyId);
      if (this.mateSession && this.mateReferenceRequest && instance) {
        this.mateSession.selectFace({ instanceId: instance.id, bodyId: result.bodyId, faceId });
        this.refreshUiChrome();
        return;
      }
      const ownerId = this.getStableOwnerIdForBody(result.bodyId);
      if (this.placementSession && this.placementReferenceRequest && ownerId) {
        const datum = this.placementReferenceRequest.acceptedKinds.includes('face')
          ? createFacePlacementRef(ownerId, result.bodyId, faceId)
          : createFaceCenterPlacementRef(ownerId, result.bodyId, faceId);
        this.placementSession.selectDatum(datum);
        this.refreshUiChrome();
        return;
      }
      if (this.measurementState?.expectedReferenceKind === 'face') {
        this.consumeMeasurementReference(result.bodyId, 'face', faceId);
        this.refreshUiChrome();
        return;
      }
      if (this.drawingRepairDraft?.expectedKind === 'face') {
        this.commitDrawingReferenceRepair({
          kind: 'face', featureId: ownerId ?? '', bodyId: result.bodyId, faceId,
        });
        return;
      }

      if (this.toolSessions.activeSession?.kind === 'wood-joint') {
        const owner = this.getFeatureByBodyId(result.bodyId);
        if (owner && body) {
          const faceVertexIds = getFaceVertexIds(body, faceId);
          const cornerVertexId = result.point && faceVertexIds.length > 0
            ? [...faceVertexIds].sort((left, right) => {
                const leftPoint = body.vertices.get(left)?.position;
                const rightPoint = body.vertices.get(right)?.position;
                const leftDistance = leftPoint
                  ? result.point!.distanceToSquared(new THREE.Vector3(...leftPoint))
                  : Number.POSITIVE_INFINITY;
                const rightDistance = rightPoint
                  ? result.point!.distanceToSquared(new THREE.Vector3(...rightPoint))
                  : Number.POSITIVE_INFINITY;
                return leftDistance - rightDistance || left.localeCompare(right);
              })[0]
            : undefined;
          const captured = this.captureWoodJointMember({
            bodyRef: createBodyRef(result.bodyId, owner.id),
            datumRef: createFacePlacementRef(owner.id, result.bodyId, faceId),
            ...(this.woodJointDraft?.kind === 'threeWayMiter' && cornerVertexId
              ? { cornerVertexId }
              : {}),
          });
          if (captured) {
            this.refreshUiChrome();
            return;
          }
        }
      }
      if (this.faceSelectionMode) {
        this.createSketchFromSelectedFace();
      } else {
        const ownerName = this.getFeatureByBodyId(result.bodyId)?.name ?? 'Body';
        this._statusBar.setCenterMessage(`${ownerName} | Face selected`);
        eventBus.emit('ui:status', {
          message: `${ownerName} face selected - choose Push/Pull or Sketch in the selection bar`,
        });
      }
    } else {
      this.clearSubObjectSelectionState();
      this.selection = clearSelection(this.selection);
      this.updateSelectionVisuals();
      this.featureTreePanel.selectFeature(null);
      this.modelBrowser.select(null);
      this._statusBar.setCenterMessage('');
    }

    this.refreshUiChrome();
  }

  /**
   * Toggle face selection mode on/off.
   */
  private toggleFaceSelectionMode(): void {
    if (this.faceSelectionMode) {
      this.exitFaceSelectionMode();
      return;
    }

    if (!this.canCreateFaceSketch()) {
      eventBus.emit('ui:status', {
        message: 'No faces available yet - create a box or extrude first',
      });
      return;
    }

    this.faceSelectionMode = true;
    this.setSelectionMode('face', false);
    eventBus.emit('face:mode:changed', { isActive: true });
    eventBus.emit('ui:status', { message: 'Sketch on face mode - click a face to create a sketch' });
    log.info('Entered sketch on face mode');

    this.refreshUiChrome();
  }

  /**
   * Exit face selection mode.
   */
  private exitFaceSelectionMode(announce = true): void {
    if (this.selectionMode === 'face') {
      this.setSelectionMode('body', false);
    } else {
      this.faceSelectionMode = false;
      this.selectedFace = null;
      this.faceHighlight?.clearHighlight();
      eventBus.emit('face:mode:changed', { isActive: false });
    }
    if (announce) {
      eventBus.emit('ui:status', { message: 'Exited sketch on face mode' });
    }
    log.info('Exited sketch on face mode');
    this.refreshUiChrome();
  }

  /**
   * Create a sketch feature from the selected face.
   */
  private createSketchFromSelectedFace(): void {
    if (!this.selectedFace) {
      eventBus.emit('ui:status', { message: 'No face selected' });
      return;
    }

    const { faceId, bodyId } = this.selectedFace;

    const ownerFeature = this.getFeatureByBodyId(bodyId);
    const ownerBody = this.rebuiltBodies.find((body) => body.id === bodyId);
    const faceVertices = ownerBody
      ? getFaceVertexIds(ownerBody, faceId).flatMap((vertexId) => {
          const vertex = ownerBody.vertices.get(vertexId);
          return vertex ? [vertex.position] : [];
        })
      : [];
    if (!ownerFeature || faceVertices.length === 0) {
      eventBus.emit('ui:status', {
        message: 'Cannot sketch on this face because its owning geometry could not be resolved',
      });
      return;
    }
    const origin: [number, number, number] = [
      faceVertices.reduce((sum, point) => sum + point[0], 0) / faceVertices.length,
      faceVertices.reduce((sum, point) => sum + point[1], 0) / faceVertices.length,
      faceVertices.reduce((sum, point) => sum + point[2], 0) / faceVertices.length,
    ];

    // Start with an empty, editable sketch. Geometry belongs to the user's
    // sketch transaction rather than being silently seeded by the command.
    const feature = createEmptyFaceSketchFeature({
      faceId,
      bodyId,
      featureId: ownerFeature.id,
      origin,
    }, `Sketch on Face ${this.features.length + 1}`);

    this.features.push(feature);
    this.rebuildAll('Sketch on Face');

    // Release face picking before activating the sketch overlay so subsequent
    // pointer gestures are owned by the sketch tool, not face selection.
    this.exitFaceSelectionMode(false);

    this.featureTreePanel.selectFeature(feature.id);
    this.enterSketchModeForFeature(feature.id);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const isTextEntry = event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement;
    if (event.key === 'Enter' && this.featurePreviewFeatureId) {
      if (this.featurePreviewInvalidFieldIds.size > 0) {
        event.preventDefault();
        return;
      }
      const applied = this.propertyInspector.applyPendingChanges();
      if (applied && this.featurePreviewParameterUpdateFailed) {
        event.preventDefault();
        return;
      }
    }

    const routed = this.keyboardRouter.route(event, undefined);
    if (routed.handled) {
      event.preventDefault();
      return;
    }

    // Ignore if typing in an input
    if (isTextEntry) {
      return;
    }

    // A selected modeling target takes precedence over the non-modal Quick
    // Start card. One Escape must always return the viewport to a neutral
    // selection state after creating or selecting geometry.
    if (
      event.key === 'Escape'
      && this.welcomeOverlay.getIsVisible()
      && this.selection.selectedIds.size === 0
      && this.selectedFace === null
      && this.selectedEdgeRef === null
      && this.selectedVertexRef === null
    ) {
      this.welcomeOverlay.dismiss();
      this.refreshUiChrome();
      return;
    }

    if (event.key !== 'Escape') return;

    if (this.keyboardShortcutsPanel.getIsVisible()) {
      this.hideKeyboardShortcuts();
    } else if (this.constraintCreationController?.isActive()) {
      this.constraintCreationController.cancel();
      this.refreshUiChrome();
    } else if (this.sketchModeController.isActive) {
      this.exitSketchMode();
    } else if (this.faceSelectionMode) {
      this.exitFaceSelectionMode();
    } else {
      this.clearSubObjectSelectionState();
      this.selection = clearSelection(this.selection);
      this.updateSelectionVisuals();
      this.featureTreePanel.selectFeature(null);
      this.modelBrowser.select(null);
      this._statusBar.setCenterMessage('');
      this.refreshUiChrome();
    }
  }

  private updateSelectionVisuals(): void {
    // Sub-object modes retain the owning body in SelectionState so modeling
    // commands can resolve an explicit target. Only body mode should turn that
    // ownership into a whole-solid highlight; face/edge/vertex overlays own
    // their visual feedback.
    const showBodyHighlight = this.selectionMode === 'body';
    for (const [id] of this.sceneObjects) {
      const state = showBodyHighlight && this.selection.selectedIds.has(id)
        ? 'selected'
        : showBodyHighlight && id === this.hoveredBodyId
          ? 'hovered'
          : 'default';
      this.meshCache.setInteractionState(id, state);
    }
  }

  private deleteSelected(): void {
    if (this.sketchModeController.isActive) {
      this.deleteActiveSketchSelection();
      return;
    }

    const featureIds = this.expandFeatureDeletionTargets(this.getSelectedFeatureIdsForDeletion());
    if (featureIds.length > 0) {
      const deletedFeatures = this.features.filter((feature) => featureIds.includes(feature.id));
      for (const feature of deletedFeatures) {
        for (const bodyId of feature.refsOut) {
          this.bodyPresentations.delete(bodyId);
          if (this.documentManager.getDocument().bodyMetadata) {
            delete this.documentManager.getDocument().bodyMetadata![bodyId];
          }
        }
      }
      this.features = this.features.filter((feature) => !featureIds.includes(feature.id));
      this.clearSubObjectSelectionState();
      this.pruneAssemblyStateAfterFeatureDeletion(deletedFeatures);
      this.selection = clearSelection(this.selection);
      this.featureTreePanel.selectFeature(null);
      this.rebuildAll('Delete');
      this.updateAssemblyPanel();
      eventBus.emit('ui:status', {
        message: `Deleted ${featureIds.length} feature${featureIds.length === 1 ? '' : 's'}`,
      });
      return;
    }

    const selectedIds = Array.from(this.selection.selectedIds);
    if (selectedIds.length === 0) {
      return;
    }

    for (const id of selectedIds) {
      const object = this.sceneObjects.get(id);
      if (object) {
        this.viewport.remove(object);
        this.sceneObjects.delete(id);
        this.meshCache.removeBody(id);
        this.documentManager.removeBody(id);
        this.bodyPresentations.delete(id);
        if (this.documentManager.getDocument().bodyMetadata) {
          delete this.documentManager.getDocument().bodyMetadata![id];
        }
      }
    }

    this.selection = clearSelection(this.selection);
    this.clearSubObjectSelectionState();
    this.featureTreePanel.selectFeature(null);
    this.commitDocumentHistory('Delete Objects');
    eventBus.emit('ui:status', { message: `Deleted ${selectedIds.length} object(s)` });
    this.refreshUiChrome();
  }

  private deleteActiveSketchSelection(): void {
    const activeSketchId = this.sketchModeController.currentSketchId;
    if (!activeSketchId) {
      eventBus.emit('ui:status', { message: 'Select sketch geometry to delete.' });
      return;
    }

    const draft = this.sketchToolDraft;
    const selectedPointIds = [...(draft?.selectedPointIds ?? [])];
    const selectedSegmentIds = [...(draft?.selectedSegmentIds ?? [])];
    const selectedId = this.selectedSketchEntityId;
    if (selectedId) {
      const params = this.getResolvedSketchParams(activeSketchId);
      if (params?.geometry.points.some((point) => point.id === selectedId)) {
        if (!selectedPointIds.includes(selectedId)) selectedPointIds.push(selectedId);
      } else if (params?.geometry.segments.some((segment) => segment.id === selectedId)) {
        if (!selectedSegmentIds.includes(selectedId)) selectedSegmentIds.push(selectedId);
      }
    }

    // Delete is authoritative over any in-progress preview. Capture the user's
    // explicit selection first, then restore the byte-equivalent baseline.
    if (this.toolSessions.activeSession?.kind === 'sketch-edit') {
      this.toolSessions.cancelActive();
    }

    const params = this.getResolvedSketchParams(activeSketchId);
    const selection: SketchSelection = {
      pointIds: selectedPointIds,
      segmentIds: selectedSegmentIds,
      relationIds: [],
      dimensionIds: [],
    };
    if (
      !params
      || (
        selection.pointIds.length === 0
        && selection.segmentIds.length === 0
        && selection.relationIds.length === 0
        && selection.dimensionIds.length === 0
      )
    ) {
      eventBus.emit('ui:status', { message: 'Select sketch geometry to delete.' });
      return;
    }

    const deletion = deleteSketchSelection(
      params.geometry,
      selection,
      params.relations,
      params.drivingDimensions
    );
    if (
      deletion.removedPointIds.length === 0
      && deletion.removedSegmentIds.length === 0
      && deletion.removedRelationIds.length === 0
      && deletion.removedDimensionIds.length === 0
    ) {
      eventBus.emit('ui:status', {
        message: deletion.diagnostics[0]?.message ?? 'Select sketch geometry to delete.',
      });
      return;
    }

    const nextParams = this.createAuthoritativeSketchParams(
      params,
      deletion.geometry,
      deletion.relations,
      deletion.dimensions
    );
    const updated = this.updateFeatureParameters(
      activeSketchId,
      nextParams as unknown as Record<string, unknown>,
      {
        trackHistory: false,
        historyLabel: 'Delete Sketch Geometry',
        successMessage: 'Deleted selected sketch geometry',
        failureMessage: 'Delete blocked because dependent geometry would become invalid',
        selectFeatureAfterUpdate: true,
      }
    );
    if (!updated) return;

    this.selectedSketchEntityId = null;
    this.sketchOverlay.setSelectedEntity(null);
    this.commitDocumentHistory('Delete Sketch Geometry');
    this.refreshActiveSketchOverlay();
  }

  /**
   * Add a new box feature.
   */
  private addBoxFeature(params: Partial<BoxParams> = {}): void {
    const feature = createBoxFeature(params, `Box ${this.features.length + 1}`);
    this.features.push(feature);

    // Rebuild to create the body
    const result = this.rebuildAll('Add Box');

    if (result.ok) {
      // A newly created solid is an explicit user target, so select its body
      // output as well as its history row. Follow-up tools never need a
      // silent "latest body" fallback.
      this.selectFeatureById(feature.id);
      this.fitViewToModel(false);
      eventBus.emit('ui:status', {
        message: `Added ${feature.name}. Adjust width, depth, and height in Properties.`,
      });
      this.refreshUiChrome();
    }
  }

  /**
   * Add a new sketch feature.
   */
  private addSketchFeature(): void {
    this.addSketchFeatureOnPlane(this.preferredSketchPlane);
  }

  private addSketchFeatureOnPlane(plane: SketchPlaneSelection): void {
    this.preferredSketchPlane = plane;
    const planeRef = createWorldPlaneRef(plane, 0);

    const feature = createSketchFeature({
      planeRef,
      entities: [],
      dimensions: [],
    }, `Sketch ${this.features.length + 1}`);

    this.features.push(feature);

    // Rebuild (sketch doesn't create bodies, but we update the UI)
    this.rebuildAll('Add Sketch');

    // Select the new feature
    this.featureTreePanel.selectFeature(feature.id);
    this.enterSketchModeForFeature(feature.id);
    eventBus.emit('ui:status', { message: `Added ${feature.name}` });
  }

  /**
   * Run a feature-creation command as a transient document preview. The feature
   * participates in normal rebuilds so the viewport always shows the real
   * result, but undo history is touched only after the universal Enter commit.
   */
  private beginFeaturePreview(
    feature: FeatureRecord,
    kind: 'extrude' | 'cut' | 'miter-cut',
    historyLabel: string
  ): void {
    const sessionId = `${kind}-preview-${++this.featurePreviewSequence}`;
    this.toolSessions.start({
      id: sessionId,
      kind,
      phase: 'previewing',
      start: () => {
        const pathAtStart = this.documentManager.currentFilePath;
        this.featurePreviewTransaction = new PreviewTransaction<Document, never>({
          capture: () => this.buildDocumentSnapshot(),
          serialize: (snapshot) => JSON.stringify(snapshot),
          applyPreview: () => true,
          restore: (snapshot) => this.restoreInteractiveDocument(snapshot, pathAtStart),
        });
        this.featurePreviewFeatureId = feature.id;
        this.featurePreviewHistoryLabel = historyLabel;
        this.featurePreviewInvalidFieldIds.clear();
        this.featurePreviewParameterUpdateFailed = false;
        this.features.push(feature);

        const result = this.rebuildAll(`Preview ${historyLabel}`, { trackHistory: false });
        if (!result.ok) {
          this.featurePreviewInvalidFieldIds.add('__preview__');
          this.featurePreviewParameterUpdateFailed = true;
          const message = result.diagnostics[0]?.message ?? 'The preview could not be rebuilt.';
          eventBus.emit('ui:status', { message: `${historyLabel} blocked: ${message}` });
          this.refreshUiChrome();
          return;
        }

        this.featureTreePanel.selectFeature(feature.id);
        eventBus.emit('ui:status', {
          message: `Previewing ${feature.name} - edit parameters, then press Enter to commit or Escape to cancel`,
        });
        this.refreshUiChrome();
      },
      commit: () => this.commitFeaturePreview(),
      cancel: () => this.cancelFeaturePreview(),
    });
  }

  private applyTransformFeaturePreview(
    feature: FeatureRecord,
    parameters: Record<string, unknown>,
    historyLabel: string
  ): boolean {
    if (this.featurePreviewFeatureId !== feature.id) {
      const pathAtStart = this.documentManager.currentFilePath;
      this.featurePreviewTransaction = new PreviewTransaction<Document, never>({
        capture: () => this.buildDocumentSnapshot(),
        serialize: (snapshot) => JSON.stringify(snapshot),
        applyPreview: () => true,
        restore: (snapshot) => this.restoreInteractiveDocument(snapshot, pathAtStart),
      });
      this.featurePreviewFeatureId = feature.id;
      this.featurePreviewHistoryLabel = historyLabel;
      this.features.push(feature);
    }
    feature.parameters = cloneSnapshot(parameters);
    const result = this.rebuildAll(`Preview ${historyLabel}`, { trackHistory: false });
    if (!result.ok) {
      eventBus.emit('ui:status', {
        message: `${feature.name} preview blocked: ${result.diagnostics[0]?.message ?? 'invalid result'}`,
      });
      return false;
    }
    this.featureTreePanel.selectFeature(feature.id);
    eventBus.emit('ui:status', {
      message: `Previewing ${feature.name} - press Enter to commit or Escape to cancel`,
    });
    this.refreshUiChrome();
    return true;
  }

  private beginMoveCopyPreview(
    feature: FeatureRecord,
    sourceBodyRef: ReturnType<typeof createBodyRef>
  ): void {
    const sourceObject = this.sceneObjects.get(sourceBodyRef.bodyId);
    if (!sourceObject) {
      eventBus.emit('ui:status', { message: 'The selected copy source is not visible.' });
      return;
    }
    const params = feature.parameters as unknown as MoveCopyParams;
    const previewObject = params.mode === 'copy' ? sourceObject.clone(true) : sourceObject;
    if (params.mode === 'copy') {
      previewObject.name = `preview:${feature.id}`;
      previewObject.userData.isTransformPreview = true;
      this.viewport.add(previewObject);
      this.moveCopyPreviewClone = previewObject;
    }
    const pathAtStart = this.documentManager.currentFilePath;
    this.featurePreviewTransaction = new PreviewTransaction<Document, never>({
      capture: () => this.buildDocumentSnapshot(),
      serialize: (snapshot) => JSON.stringify(snapshot),
      applyPreview: () => true,
      restore: (snapshot) => {
        this.features = cloneSnapshot(snapshot.features) as unknown as FeatureRecord[];
        this.documentManager.load(cloneSnapshot(snapshot), pathAtStart ?? undefined);
      },
    });
    this.featurePreviewFeatureId = feature.id;
    this.featurePreviewHistoryLabel = params.mode === 'copy' ? 'Add Copy' : 'Move Body';
    this.features.push(feature);
    const defaultUnit: NumericUnit = this.documentManager.getDocument().config.units === 'mm' ? 'mm' : 'in';
    const sessionOptions = {
      id: `move-copy-preview-${++this.featurePreviewSequence}`,
      sourceBodyRef,
      objects: [previewObject],
      gizmo: this.translationTriadGizmo,
      initialTranslation: params.translation,
      defaultUnit,
      onPreview: (next: MoveCopyParams) => {
        feature.parameters = cloneSnapshot(next) as unknown as Record<string, unknown>;
        this.interactionDiagnostics.transformPreviewUpdates += 1;
        return true;
      },
      onDraggingChange: (dragging: boolean) => {
        this.gizmos.setDragState('moveCopy', dragging);
      },
      onCommit: () => this.commitFeaturePreview(),
      onCancel: () => this.cancelFeaturePreview(),
    };
    this.toolSessions.start(params.mode === 'copy'
      ? createCopyToolSession(sessionOptions)
      : new MoveCopyToolSession({ ...sessionOptions, mode: 'move' }));
    // Move/Copy is a view-only preview, so no rebuild event refreshes the
    // legacy property adapter. Publish the transient feature explicitly.
    this.featureTreePanel.setFeatures(this.features);
    this.featureTreePanel.selectFeature(feature.id);
    eventBus.emit('ui:status', {
      message: `Previewing ${feature.name} - drag the triad, then press Enter to commit or Escape to cancel`,
    });
    this.refreshUiChrome();
  }

  private beginPatternPreview(
    feature: FeatureRecord,
    sourceBodyRef: ReturnType<typeof createBodyRef>
  ): void {
    const params = feature.parameters as unknown as {
      count: number;
      spacing: number;
      direction: [number, number, number];
      symmetric: boolean;
    };
    this.toolSessions.start(new LinearPatternPreviewManipulator({
      id: `linear-pattern-preview-${++this.featurePreviewSequence}`,
      sourceBodyRef,
      count: params.count,
      spacing: params.spacing,
      direction: params.direction,
      symmetric: params.symmetric,
      defaultUnit: this.documentManager.getDocument().config.units === 'mm' ? 'mm' : 'in',
      onPreview: (next) => this.applyTransformFeaturePreview(
        feature,
        next as unknown as Record<string, unknown>,
        'Add Linear Pattern'
      ),
      onCommit: () => this.commitFeaturePreview(),
      onCancel: () => this.cancelFeaturePreview(),
    }));
  }

  private beginMirrorPreview(
    feature: FeatureRecord,
    sourceBodyRef: ReturnType<typeof createBodyRef>,
    planeRef: PlaneRef
  ): void {
    this.toolSessions.start(new MirrorPreviewManipulator({
      id: `mirror-preview-${++this.featurePreviewSequence}`,
      sourceBodyRef,
      planeRef,
      defaultUnit: this.documentManager.getDocument().config.units === 'mm' ? 'mm' : 'in',
      onPreview: (next) => this.applyTransformFeaturePreview(
        feature,
        next as unknown as Record<string, unknown>,
        'Add Mirror'
      ),
      onCommit: () => this.commitFeaturePreview(),
      onCancel: () => this.cancelFeaturePreview(),
    }));
  }

  private beginRotateFeaturePreview(
    feature: FeatureRecord,
    bodyRef: ReturnType<typeof createBodyRef>
  ): void {
    const sourceObject = this.sceneObjects.get(bodyRef.bodyId);
    const pivot = this.getRotatePivot(bodyRef, 'bodyCenter');
    if (!sourceObject || !pivot || !this.bodyRotateGizmo) {
      eventBus.emit('ui:status', { message: 'The selected rotate source is not visible.' });
      return;
    }
    const pathAtStart = this.documentManager.currentFilePath;
    this.featurePreviewTransaction = new PreviewTransaction<Document, never>({
      capture: () => this.buildDocumentSnapshot(),
      serialize: (snapshot) => JSON.stringify(snapshot),
      applyPreview: () => true,
      restore: (snapshot) => {
        this.features = cloneSnapshot(snapshot.features) as unknown as FeatureRecord[];
        this.documentManager.load(cloneSnapshot(snapshot), pathAtStart ?? undefined);
      },
    });
    this.featurePreviewFeatureId = feature.id;
    this.featurePreviewHistoryLabel = 'Add Rotate';
    this.features.push(feature);

    const session: ToolSession = {
      id: `rotate-preview-${++this.featurePreviewSequence}`,
      kind: 'rotate-body-create',
      phase: 'previewing',
      start: () => {
        this.bodyRotateGizmo?.showEditor({
          featureId: feature.id,
          bodyId: bodyRef.bodyId,
          pivot,
          rotationDegrees: [0, 0, 0],
          objects: [sourceObject],
          onPreview: (_featureId, rotationDegrees) => {
            feature.parameters = {
              ...(feature.parameters as unknown as RotateBodyParams),
              rotationDegrees: [...rotationDegrees],
            } as unknown as Record<string, unknown>;
            this.interactionDiagnostics.transformPreviewUpdates += 1;
            return true;
          },
        });
        this.featureTreePanel.selectFeature(feature.id);
        eventBus.emit('ui:status', {
          message: `Previewing ${feature.name} - drag the rings, Enter to commit, Escape to cancel`,
        });
      },
      commit: () => this.commitFeaturePreview(),
      cancel: () => this.cancelFeaturePreview(),
    };
    this.toolSessions.start(session);
  }

  private commitFeaturePreview(): boolean {
    if (this.featurePreviewInvalidFieldIds.size > 0) {
      eventBus.emit('ui:status', { message: 'Fix the invalid preview values before committing.' });
      return false;
    }
    const feature = this.featurePreviewFeatureId
      ? this.getFeatureById(this.featurePreviewFeatureId)
      : null;
    if (!feature || !this.featurePreviewHistoryLabel) {
      return false;
    }

    const result = this.rebuildAll(`Validate ${this.featurePreviewHistoryLabel}`, {
      trackHistory: false,
    });
    if (!result.ok) {
      const message = result.diagnostics[0]?.message ?? 'The preview is not valid.';
      eventBus.emit('ui:status', {
        message: `${feature.name} is not ready to commit: ${message}`,
      });
      return false;
    }

    const label = this.featurePreviewHistoryLabel;
    this.commitDocumentHistory(label);
    this.featurePreviewTransaction?.commit(label);
    this.translationTriadGizmo.hide(false);
    this.bodyRotateGizmo?.hide();
    this.removeMoveCopyPreviewClone();
    this.gizmos.releaseAll();
    this.clearFeaturePreviewState();
    this.selectFeatureById(feature.id);
    eventBus.emit('ui:status', { message: `Added ${feature.name}` });
    this.refreshUiChrome();
    return true;
  }

  private cancelFeaturePreview(): void {
    const transaction = this.featurePreviewTransaction;
    this.translationTriadGizmo.hide(true);
    this.bodyRotateGizmo?.hide();
    this.removeMoveCopyPreviewClone();
    this.gizmos.releaseAll();
    const result = transaction?.state === 'active' ? transaction.cancel() : null;
    this.featureTreePanel.setFeatures(this.features);
    this.clearFeaturePreviewState();
    eventBus.emit('ui:status', {
      message: result?.byteEquivalent === false
        ? 'Preview canceled, but exact document recovery could not be verified'
        : 'Preview canceled - document unchanged',
    });
    this.refreshUiChrome();
  }

  private clearFeaturePreviewState(): void {
    this.featurePreviewTransaction = null;
    this.featurePreviewFeatureId = null;
    this.featurePreviewHistoryLabel = null;
    this.featurePreviewParameterUpdateFailed = false;
    this.featurePreviewInvalidFieldIds.clear();
  }

  private startWoodJointTool(): void {
    if (this.rebuiltBodies.length === 0) {
      eventBus.emit('ui:status', {
        message: 'Create at least one body before starting a woodworking joint.',
      });
      return;
    }
    const selectionModeToRestore = this.selectionMode;
    this.restoreWoodJointDatumMember();
    this.restoreWoodJointDatumFocus();
    const initialDatumBodyId = this.getExplicitBodyTarget()?.body.id ?? null;
    const seed = createWoodJointFeature({
      kind: 'mortiseTenon',
      members: [],
      sideClearance: 0,
      endClearance: 0,
    });
    const parameters = cloneSnapshot(seed.parameters) as unknown as WoodJointParams;
    this.woodJointDraft = {
      kind: 'mortiseTenon',
      members: [],
      sideClearance: 0,
      endClearance: 0,
      parameters,
      plan: null,
      exploded: false,
      reselectIndex: null,
      selectionModeToRestore,
    };
    const pathAtStart = this.documentManager.currentFilePath;
    this.toolSessions.start({
      id: `wood-joint-${++this.featurePreviewSequence}`,
      kind: 'wood-joint',
      phase: 'awaiting-input',
      start: () => {
        this.featurePreviewTransaction = new PreviewTransaction<Document, never>({
          capture: () => this.buildDocumentSnapshot(),
          serialize: (snapshot) => JSON.stringify(snapshot),
          applyPreview: () => true,
          restore: (snapshot) => this.restoreInteractiveDocument(snapshot, pathAtStart),
        });
        this.setSelectionMode('face', false);
        if (initialDatumBodyId) this.focusWoodJointDatumBody(initialDatumBodyId);
        eventBus.emit('ui:status', {
          message: initialDatumBodyId
            ? 'Wood Joint: the selected body is isolated for Member A. Pick its end face; other bodies restore automatically.'
            : 'Wood Joint: select the first exact member face. Enter commits; Escape cancels.',
        });
        this.refreshUiChrome();
      },
      commit: () => {
        const draft = this.woodJointDraft;
        const expected = draft ? getWoodJointMemberCount(draft.kind) : 0;
        if (!draft || draft.members.length !== expected || !this.featurePreviewFeatureId) {
          eventBus.emit('ui:status', {
            message: `Select ${expected || 2} valid member datum${expected === 1 ? '' : 's'} before creating the joint.`,
          });
          return false;
        }
        const restoreMode = draft.selectionModeToRestore;
        this.restoreWoodJointDatumMember();
        this.restoreWoodJointDatumFocus();
        this.clearWoodJointExplodedPreview();
        const committed = this.commitFeaturePreview();
        if (committed) {
          this.woodJointDraft = null;
          this.setSelectionMode(restoreMode, false);
        }
        return committed;
      },
      cancel: () => {
        const restoreMode = this.woodJointDraft?.selectionModeToRestore ?? 'body';
        this.restoreWoodJointDatumMember();
        this.restoreWoodJointDatumFocus();
        this.cancelFeaturePreview();
        this.clearWoodJointExplodedPreview();
        this.woodJointDraft = null;
        this.setSelectionMode(restoreMode, false);
      },
    });
  }

  private updateWoodJointDraftField(
    field: string,
    value: ContextTaskFieldValue
  ): void {
    const draft = this.woodJointDraft;
    if (!draft || this.toolSessions.activeSession?.kind !== 'wood-joint') return;
    if (field === 'kind' && draft.members.length > 0) return;
    const presenter = createWoodJointEditorPresenter(draft.parameters, {
      ...(draft.plan ? { computedDefaults: draft.plan.computedDefaults } : {}),
      unit: this.getWoodworkingUnit(),
    });
    const descriptor = presenter.fields.find((candidate) => candidate.id === field);
    let normalizedValue = value;
    if (descriptor?.unit === this.getWoodworkingUnit() && descriptor.type === 'number') {
      const parsed = parseNumericInput(String(value ?? ''), { defaultUnit: this.getWoodworkingUnit() });
      if (!parsed.ok) {
        this.contextTaskPanel.setFieldError(`joint-${field}`, parsed.error);
        this.contextTaskPanel.setCommitEnabled(false);
        return;
      }
      normalizedValue = parsed.value;
    }
    const update = applyWoodJointEditorValue(draft.parameters, field, normalizedValue);
    draft.parameters = update.parameters;
    draft.kind = update.parameters.kind;
    draft.members = [...update.parameters.members];
    draft.sideClearance = update.parameters.sideClearance;
    draft.endClearance = update.parameters.endClearance;
    this.contextTaskPanel.setFieldError(`joint-${field}`, null);
    if (field === 'kind') {
      if (draft.kind !== 'mortiseTenon' && draft.kind !== 'bridle') {
        this.restoreWoodJointDatumMember();
        this.restoreWoodJointDatumFocus();
      }
      this.setSelectionMode(draft.kind === 'chamfer' ? 'edge' : 'face', false);
      this.refreshContextTaskPanel();
      return;
    }
    const feature = this.featurePreviewFeatureId
      ? this.getFeatureById(this.featurePreviewFeatureId)
      : null;
    if (!feature) {
      this.refreshContextTaskPanel();
      return;
    }
    const updated = this.updateFeatureParameters(feature.id, cloneSnapshot(update.parameters) as unknown as Record<string, unknown>, {
      emitStatus: false,
      trackHistory: false,
      historyLabel: `Preview ${feature.name}`,
      selectFeatureAfterUpdate: true,
      refreshUi: false,
    });
    this.featurePreviewParameterUpdateFailed = !updated;
    const message = updated
      ? update.diagnostics[0]?.message ?? null
      : this.lastFeatureUpdateFailureMessage ?? 'The joint parameter is invalid.';
    this.contextTaskPanel.setFieldError(`joint-${field}`, message);
    if (updated) this.refreshWoodJointPlan(feature);
    this.contextTaskPanel.setCommitEnabled(updated && update.ok);
    if (message) eventBus.emit('ui:status', { message });
    this.refreshUiChrome();
  }

  private captureWoodJointMember(member: WoodJointMemberRef): boolean {
    const draft = this.woodJointDraft;
    if (!draft || this.toolSessions.activeSession?.kind !== 'wood-joint') return false;
    const expected = getWoodJointMemberCount(draft.kind);
    if (draft.members.length >= expected) {
      eventBus.emit('ui:status', {
        message: 'All member datums are selected. Press Enter to create the joint or Escape to cancel.',
      });
      return true;
    }
    if (draft.members.some((candidate) => candidate.bodyRef.bodyId === member.bodyRef.bodyId)) {
      eventBus.emit('ui:status', {
        message: 'Choose a datum on a different member body.',
      });
      return true;
    }
    if (draft.reselectIndex !== null) {
      draft.members.splice(draft.reselectIndex, 0, member);
      draft.reselectIndex = null;
    } else {
      draft.members.push(member);
    }
    draft.parameters = { ...draft.parameters, members: [...draft.members] };
    if (draft.members.length < expected) {
      this.restoreWoodJointDatumFocus();
      const stagesCoincidentEndDatums = draft.kind === 'mortiseTenon' || draft.kind === 'bridle';
      if (stagesCoincidentEndDatums) {
        this.temporarilyHideWoodJointDatumMember(member.bodyRef.bodyId);
      }
      eventBus.emit('ui:status', {
        message: stagesCoincidentEndDatums
          ? `Member ${draft.members.length} selected and temporarily hidden. Select member ${draft.members.length + 1}; it will be restored automatically.`
          : `Member ${draft.members.length} selected. Select member ${draft.members.length + 1} on a different body.`,
      });
      this.refreshUiChrome();
      return true;
    }

    this.restoreWoodJointDatumMember();
    this.restoreWoodJointDatumFocus();
    const feature = createWoodJointFeature(
      cloneSnapshot(draft.parameters),
      `${formatWoodJointKind(draft.kind)} ${this.features.length + 1}`
    );
    this.featurePreviewFeatureId = feature.id;
    this.featurePreviewHistoryLabel = `Add ${formatWoodJointKind(draft.kind)}`;
    this.featurePreviewInvalidFieldIds.clear();
    this.featurePreviewParameterUpdateFailed = false;
    this.features.push(feature);
    const result = this.rebuildAll(`Preview ${feature.name}`, { trackHistory: false });
    if (!result.ok) {
      const message = result.diagnostics[0]?.message ?? 'The selected datums do not form a valid joint.';
      this.features = this.features.filter((candidate) => candidate.id !== feature.id);
      this.featurePreviewFeatureId = null;
      this.featurePreviewHistoryLabel = null;
      draft.members.pop();
      draft.parameters = { ...draft.parameters, members: [...draft.members] };
      this.rebuildAll('Restore after invalid joint preview', { trackHistory: false });
      if (
        draft.members.length === 1
        && (draft.kind === 'mortiseTenon' || draft.kind === 'bridle')
      ) {
        this.temporarilyHideWoodJointDatumMember(draft.members[0]!.bodyRef.bodyId);
      }
      eventBus.emit('ui:status', { message: `Joint preview blocked: ${message}` });
      this.refreshUiChrome();
      return true;
    }
    draft.parameters = cloneSnapshot(feature.parameters) as unknown as WoodJointParams;
    this.refreshWoodJointPlan(feature);
    this.featureTreePanel.selectFeature(feature.id);
    eventBus.emit('ui:status', {
      message: `Previewing ${feature.name}. Enter creates one joint feature; Escape restores both members.`,
    });
    this.refreshUiChrome();
    return true;
  }

  private refreshWoodJointPlan(feature: FeatureRecord): void {
    const result = planWoodJoint(feature, this.createCurrentRebuildContext());
    if (!this.woodJointDraft) return;
    this.woodJointDraft.plan = result.ok ? result.plan : null;
    if (!result.ok) {
      eventBus.emit('ui:status', { message: result.diagnostics[0]?.message ?? result.error });
    }
    this.refreshWoodJointExplodedPreview();
  }

  private refreshWoodJointExplodedPreview(): void {
    this.clearWoodJointExplodedPreview();
    const draft = this.woodJointDraft;
    if (!draft?.exploded || !draft.plan) return;
    const group = new THREE.Group();
    group.name = 'wood-joint-exploded-preview';
    const colors = [0x4da3ff, 0xffa64d, 0x64c987];
    for (const member of draft.plan.explodedPreview.members) {
      const source = this.sceneObjects.get(member.bodyId);
      if (!source) continue;
      this.woodJointPreviewSourceVisibility.set(member.bodyId, source.visible);
      source.visible = false;
      const clone = source.clone(true);
      clone.applyMatrix4(new THREE.Matrix4().fromArray(member.transform));
      clone.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        child.material = materials.map((material) => {
          const next = material.clone();
          if ('color' in next) next.color.setHex(colors[member.memberIndex] ?? 0xffffff);
          next.transparent = true;
          next.opacity = 0.82;
          return next;
        });
      });
      group.add(clone);
    }
    this.viewport.add(group);
    this.woodJointExplodedPreview = group;
  }

  private clearWoodJointExplodedPreview(): void {
    if (this.woodJointExplodedPreview) {
      this.viewport.remove(this.woodJointExplodedPreview);
      this.woodJointExplodedPreview = null;
    }
    for (const [bodyId, visible] of this.woodJointPreviewSourceVisibility) {
      const source = this.sceneObjects.get(bodyId);
      if (source) source.visible = visible;
    }
    this.woodJointPreviewSourceVisibility.clear();
  }

  /**
   * Reveal a coincident receiving end face without changing document or model-
   * browser visibility. Member A is restored before preview, cancel, or
   * reselection, so this remains a view-only staging aid.
   */
  private temporarilyHideWoodJointDatumMember(bodyId: string): void {
    this.restoreWoodJointDatumMember();
    const object = this.sceneObjects.get(bodyId);
    const hasAnotherVisibleMember = [...this.sceneObjects.entries()].some(
      ([candidateId, candidate]) => candidateId !== bodyId && candidate.visible
    );
    if (!object?.visible || !hasAnotherVisibleMember) return;
    this.woodJointDatumHiddenBody = { bodyId, visible: object.visible };
    object.visible = false;
    this.faceHighlight?.clearHighlight();
  }

  private restoreWoodJointDatumMember(): void {
    const hidden = this.woodJointDatumHiddenBody;
    if (!hidden) return;
    const object = this.sceneObjects.get(hidden.bodyId);
    if (object) object.visible = hidden.visible;
    this.woodJointDatumHiddenBody = null;
  }

  private focusWoodJointDatumBody(bodyId: string): void {
    this.restoreWoodJointDatumFocus();
    for (const [candidateId, object] of this.sceneObjects) {
      if (candidateId === bodyId || !object.visible) continue;
      this.woodJointDatumFocusVisibility.set(candidateId, object.visible);
      object.visible = false;
    }
  }

  private restoreWoodJointDatumFocus(): void {
    for (const [bodyId, visible] of this.woodJointDatumFocusVisibility) {
      const object = this.sceneObjects.get(bodyId);
      if (object) object.visible = visible;
    }
    this.woodJointDatumFocusVisibility.clear();
  }

  private removeWoodJointPreviewFeature(): void {
    this.clearWoodJointExplodedPreview();
    if (this.featurePreviewFeatureId) {
      this.features = this.features.filter((feature) => feature.id !== this.featurePreviewFeatureId);
      this.featurePreviewFeatureId = null;
      this.featurePreviewHistoryLabel = null;
      this.woodJointDraft!.plan = null;
      this.rebuildAll('Reselect joint member', { trackHistory: false });
    }
  }

  private removeMoveCopyPreviewClone(): void {
    if (!this.moveCopyPreviewClone) return;
    this.viewport.remove(this.moveCopyPreviewClone);
    this.moveCopyPreviewClone = null;
  }

  /** Add an extrude feature from the explicitly selected sketch. */
  private addExtrudeFeature(): void {
    const sketchFeature = this.getExplicitSketchTarget();
    if (!sketchFeature) {
      eventBus.emit('ui:status', { message: 'Select a sketch with a closed profile before extruding' });
      return;
    }

    if (this.getSketchProfileCount(sketchFeature) === 0) {
      eventBus.emit('ui:status', {
        message: 'This sketch has no closed profile yet - add a rectangle before extruding',
      });
      return;
    }

    const target = this.getExplicitBodyTarget();
    const upToFaceRef = this.getSelectedFaceReference();
    const feature = createExtrudeFeatureFromParams(sketchFeature, {
      profileIndex: 0,
      distance: 1,
      flip: false,
      operation: 'New',
      extent: {
        direction: 'OneSided',
        limit: 'Distance',
        distance: 1,
        ...(upToFaceRef ? { upToFaceRef } : {}),
      },
      ...(target
        ? { targetBodyRef: createBodyRef(target.body.id, target.feature.id) }
        : {}),
    }, `Extrude ${this.features.length + 1}`);

    this.beginFeaturePreview(feature, 'extrude', 'Add Extrude');
  }

  /** Cut an explicitly selected body with an explicitly selected sketch. */
  private addExtrudeCutFeature(): void {
    const sketchFeature = this.getExplicitSketchTarget();
    if (!sketchFeature) {
      eventBus.emit('ui:status', { message: 'Select a sketch with a closed profile before cutting' });
      return;
    }

    if (this.getSketchProfileCount(sketchFeature) === 0) {
      eventBus.emit('ui:status', {
        message: 'This sketch has no closed profile yet - add a rectangle before cutting',
      });
      return;
    }

    const target = this.getExplicitBodyTarget();
    if (!target) {
      eventBus.emit('ui:status', { message: 'Select the body to cut, then select the sketch in the model browser' });
      return;
    }

    const bodyRef = createBodyRef(target.body.id, target.feature.id);
    const flip = getDefaultCutFlipForSketch(sketchFeature);

    const upToFaceRef = this.getSelectedFaceReference();
    const feature = createExtrudeCutFeatureFromParams(
      bodyRef,
      sketchFeature,
      {
        mode: 'distance',
        distance: 0.5,
        flip,
        extent: {
          direction: 'OneSided',
          limit: 'Distance',
          distance: 0.5,
          ...(upToFaceRef ? { upToFaceRef } : {}),
        },
      },
      `Cut ${this.features.length + 1}`
    );

    this.beginFeaturePreview(feature, 'cut', 'Add Cut');
  }

  /** Angle-cut an explicitly selected planar face and preview both result modes. */
  private addMiterCutFeature(): void {
    const faceRef = this.getSelectedFaceReference();
    if (!faceRef) {
      eventBus.emit('ui:status', {
        message: 'Switch to Face selection and select the planar end face to miter.',
      });
      return;
    }

    const feature = createMiterCutFeature(
      faceRef,
      {
        ...(() => {
          const body = this.rebuiltBodies.find((candidate) => candidate.id === faceRef.bodyId);
          const face = body?.faces.get(faceRef.faceId);
          const vertexIds = body && face
            ? getOrderedLoopVertices(body, face.boundaryEdgeIds).map((vertex) => vertex.id)
            : [];
          return vertexIds.length === 4
            ? {
                threeWayVertexId: vertexIds[0]!,
                threeWayVertexIds: vertexIds as [string, string, string, string],
              }
            : {};
        })(),
        cutStyle: 'single',
        threeWayCorner: 'corner0',
        angleDegrees: 45,
        inset: 0,
        tiltAxis: 'u',
        resultMode: 'split',
      },
      `Miter Cut ${this.features.length + 1}`
    );
    this.beginFeaturePreview(feature, 'miter-cut', 'Add Miter Cut');
  }

  /** Add a linear pattern from the explicitly selected body. */
  private addLinearPatternFeature(): void {
    const target = this.getExplicitBodyTarget();
    if (!target) {
      eventBus.emit('ui:status', { message: 'Select one body to pattern' });
      return;
    }

    const feature = createLinearPatternFeature(
      createBodyRef(target.body.id, target.feature.id),
      3, // count
      1, // spacing
      [1, 0, 0], // direction (X-axis)
      false, // symmetric
      `Linear Pattern ${this.features.length + 1}`
    );

    this.beginPatternPreview(feature, createBodyRef(target.body.id, target.feature.id));
  }

  /** Add a mirror feature from the explicitly selected body. */
  private addMirrorFeature(): void {
    const target = this.getExplicitBodyTarget();
    if (!target) {
      eventBus.emit('ui:status', { message: 'Select one body to mirror' });
      return;
    }

    // Create a default YZ mirror plane
    const planeRef = createWorldPlaneRef('yz', 0);

    const feature = createMirrorFeature(
      createBodyRef(target.body.id, target.feature.id),
      planeRef,
      `Mirror ${this.features.length + 1}`
    );

    this.beginMirrorPreview(
      feature,
      createBodyRef(target.body.id, target.feature.id),
      planeRef
    );
  }

  /** Start copy placement for the explicitly selected body. */
  private addMoveBodyFeature(): void {
    const target = this.getExplicitBodyTarget();
    if (!target) {
      eventBus.emit('ui:status', { message: 'Select one body to move' });
      return;
    }

    // A whole-body move owns the viewport until commit/cancel. Clear any
    // independent face/edge/vertex overlay so it cannot lag behind the preview.
    this.setSelectionMode('body', false);

    const feature = createMoveCopyFeature(
      createBodyRef(target.body.id, target.feature.id),
      [0, 0, 0],
      'move',
      `Move ${target.feature.name}`
    );

    this.beginMoveCopyPreview(feature, createBodyRef(target.body.id, target.feature.id));
  }

  /** Start copy placement for the explicitly selected body. */
  private addDuplicateFeature(): void {
    const target = this.getExplicitBodyTarget();
    if (!target) {
      eventBus.emit('ui:status', { message: 'Select one body to copy' });
      return;
    }

    const feature = createMoveCopyFeature(
      createBodyRef(target.body.id, target.feature.id),
      [0, 0, 0],
      'copy',
      `Copy ${this.features.length + 1}`
    );

    this.beginMoveCopyPreview(feature, createBodyRef(target.body.id, target.feature.id));
  }

  private addRotateBodyFeature(): void {
    const target = this.getExplicitBodyTarget();
    if (!target) {
      eventBus.emit('ui:status', { message: 'Select a body to rotate first' });
      return;
    }

    const bodyRef = createBodyRef(target.body.id, target.feature.id);
    const feature = createRotateBodyFeature(
      bodyRef,
      [0, 0, 0],
      'bodyCenter',
      `Rotate ${this.features.length + 1}`
    );

    this.beginRotateFeaturePreview(feature, bodyRef);
  }

  private addJoinBodiesFeature(): void {
    const selectedBodyIds = this.getSelectedBodyIds();
    if (selectedBodyIds.length < 2) {
      eventBus.emit('ui:status', { message: 'Select at least two bodies to compound' });
      return;
    }

    const bodyRefs = selectedBodyIds
      .map((bodyId) => {
        const feature = this.getFeatureByBodyId(bodyId);
        return feature ? createBodyRef(bodyId, feature.id) : null;
      })
      .filter((bodyRef): bodyRef is ReturnType<typeof createBodyRef> => bodyRef !== null);

    if (bodyRefs.length < 2) {
      eventBus.emit('ui:status', { message: 'Could not resolve the selected bodies back to source features' });
      return;
    }

    const feature = createJoinBodiesFeature(bodyRefs, `Compound ${this.features.length + 1}`);
    this.features.push(feature);

    const result = this.rebuildAll('Add Join');
    if (result.ok) {
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', {
        message: `Added ${feature.name} - ${bodyRefs.length} bodies are now joined into one edit target`,
      });
    } else {
      const errorMsg = result.diagnostics[0]?.message ?? 'Unknown error';
      eventBus.emit('ui:status', { message: `Compound Bodies failed: ${errorMsg}` });
    }
  }

  /**
   * Fuse (or subtract/intersect) selected bodies as a Boolean feature.
   * The first selected body is the target; the rest are tool bodies. This is
   * the "merge two overlapping bodies into one solid" operation — unlike
   * Compound Bodies, it resolves volumetric overlaps via planar Boolean.
   */
  private addBodyBooleanFeature(
    operation: 'union' | 'difference' | 'intersection' | 'split' = 'union',
  ): void {
    const selectedBodyIds = this.getSelectedBodyIds();
    if (selectedBodyIds.length < 2) {
      eventBus.emit('ui:status', {
        message: 'Select two or more bodies to combine (the first picked is the target)',
      });
      return;
    }

    const refs = selectedBodyIds
      .map((bodyId) => {
        const feature = this.getFeatureByBodyId(bodyId);
        return feature ? createBodyRef(bodyId, feature.id) : null;
      })
      .filter((ref): ref is ReturnType<typeof createBodyRef> => ref !== null);

    if (refs.length < 2) {
      eventBus.emit('ui:status', { message: 'Could not resolve the selected bodies back to source features' });
      return;
    }

    const target = refs[0]!;
    const tools = refs.slice(1);
    const labelMap: Record<typeof operation, string> = {
      union: 'Union',
      difference: 'Subtract',
      intersection: 'Intersect',
      split: 'Split',
    };
    const feature = createBodyBooleanFeature(
      { operation, targetBodyRef: target, toolBodyRefs: tools, keepTools: false },
      `${labelMap[operation]} ${this.features.length + 1}`,
    );
    this.features.push(feature);

    const result = this.rebuildAll(`Add ${labelMap[operation]}`);
    if (result.ok) {
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', {
        message: `Combined ${refs.length} bodies with ${labelMap[operation].toLowerCase()} into one solid`,
      });
    } else {
      const errorMsg = result.diagnostics[0]?.message ?? 'Unknown error';
      eventBus.emit('ui:status', { message: `${labelMap[operation]} failed: ${errorMsg}` });
    }
  }

  /**
   * Create a component from selected features.
   * Milestone 06: Assembly-lite
   */
  private createComponentFromSelection(): void {
    const featureIds = this.getSelectedFeatureIdsForComponent();

    if (featureIds.length === 0) {
      eventBus.emit('ui:status', { message: 'Select one or more solid features to create a component' });
      return;
    }

    // Create the component
    const component = createComponent(
      `Component ${this.components.length + 1}`,
      featureIds,
      []
    );

    this.components.push(component);
    this.activeComponentId = component.id;

    // Create the createComponent feature
    const feature = createComponentFeature({
      name: component.name,
      featureIds: featureIds,
    }, component.name);

    this.features.push(feature);

    // Rebuild
    const result = this.rebuildAll('Create Component');
    if (!result.ok) {
      this.features = this.features.filter((candidate) => candidate.id !== feature.id);
      this.components = this.components.filter((candidate) => candidate.id !== component.id);
      this.activeComponentId = null;
      this.updateAssemblyPanel();
      eventBus.emit('ui:status', {
        message: `Component creation failed: ${result.diagnostics[0]?.message ?? 'Unknown error'}`,
      });
      return;
    }

    // Update assembly panel
    this.updateAssemblyPanel();
    this.modelBrowser.select({ kind: 'component', id: component.id });

    eventBus.emit('component:created', { componentId: component.id, name: component.name });
    eventBus.emit('ui:status', { message: `Created component: ${component.name}` });

    log.info('Component created', { id: component.id, featureCount: featureIds.length });
  }

  /**
   * Add an instance of the selected component.
   * Milestone 06: Assembly-lite
   */
  private addInstanceFromSelectedComponent(componentId?: string | null): void {
    // Need at least one component
    if (this.components.length === 0) {
      eventBus.emit('ui:status', { message: 'No components - press Shift+G to create one first' });
      return;
    }

    const component = componentId
      ? this.components.find((component) => component.id === componentId) ?? null
      : this.getExplicitComponentTarget();
    if (!component) {
      eventBus.emit('ui:status', { message: 'Select a component before adding an instance' });
      return;
    }

    // Create an instance with offset translation
    const offset = this.componentInstances.length * 2 + 2; // Offset each new instance
    const transform = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      offset, 0, 0, 1,
    ];

    const instance = createComponentInstance(
      component.id,
      `${component.name} Instance ${this.componentInstances.length + 1}`,
      transform
    );

    this.componentInstances.push(instance);

    // Update assembly panel
    this.updateAssemblyPanel();

    // Rebuild to show the instance
    const result = this.rebuildAll('Add Instance');
    if (!result.ok) {
      this.componentInstances = this.componentInstances.filter(
        (candidate) => candidate.id !== instance.id
      );
      this.updateAssemblyPanel();
      eventBus.emit('ui:status', {
        message: `Instance creation failed: ${result.diagnostics[0]?.message ?? 'Unknown error'}`,
      });
      return;
    }

    eventBus.emit('instance:added', { instanceId: instance.id, componentId: component.id });
    eventBus.emit('ui:status', { message: `Added instance: ${instance.name}` });

    log.info('Instance added', { id: instance.id, componentId: component.id });
  }

  /**
   * Update the assembly panel with current data.
   */
  private updateAssemblyPanel(): void {
    if (this.assemblyPanel) {
      this.assemblyPanel.setAssemblyData(
        this.components,
        this.componentInstances,
        this.constraints
      );
    }
    // The Assembly section is contextual: it only appears once you've grouped
    // pieces (created a component) or placed a copy (instance).
    this.panelChrome.setHidden(
      'Assembly',
      this.components.length === 0 && this.componentInstances.length === 0,
    );
  }

  private beginInstanceTransformSession(selected: ComponentInstance): void {
    this.cancelActiveInteraction();
    const instance = this.componentInstances.find((candidate) => candidate.id === selected.id);
    const meshes = instance ? this.resolveInstanceMeshes(instance.id) : [];
    const mesh = meshes[0];
    if (!instance || !mesh || !this.instanceTransformGizmo) {
      eventBus.emit('ui:status', {
        message: 'The selected instance has no rendered body to transform',
      });
      return;
    }
    if (instance.grounded) {
      eventBus.emit('ui:status', { message: `${instance.name} is grounded and cannot be moved` });
      return;
    }

    const pathAtStart = this.documentManager.currentFilePath;
    this.instanceTransformTransaction = new PreviewTransaction<Document, number[]>({
      capture: () => this.buildDocumentSnapshot(),
      serialize: (snapshot) => JSON.stringify(snapshot),
      applyPreview: (transform) => transform.length === 16,
      restore: (snapshot) => this.restoreInteractiveDocument(snapshot, pathAtStart),
    });
    this.activeInstanceTransformId = instance.id;

    const session: ToolSession = {
      id: `instance-transform-${instance.id}`,
      kind: 'instance-transform',
      get phase(): ToolSessionPhase {
        return 'previewing';
      },
      start: () => {
        this.instanceTransformGizmo?.showEditor({
          instance,
          mesh,
          meshes,
          onPreview: (_instanceId, transform) => {
            this.interactionDiagnostics.transformPreviewUpdates += 1;
            return this.instanceTransformTransaction?.preview(transform) ?? false;
          },
          onDraggingChange: (dragging) => {
            this.gizmos.setDragState('instance', dragging);
          },
        });
      },
      commit: () => this.commitInstanceTransformSession(),
      cancel: () => this.cancelInstanceTransformSession(),
    };
    this.toolSessions.start(session);
  }

  private resolveInstanceMeshes(instanceId: string): THREE.Object3D[] {
    return (this.instanceBodyIdsByInstance.get(instanceId) ?? [])
      .map((bodyId) => this.sceneObjects.get(bodyId))
      .filter((mesh): mesh is THREE.Object3D => Boolean(mesh));
  }

  private commitInstanceTransformSession(): boolean {
    const instanceId = this.activeInstanceTransformId;
    const transaction = this.instanceTransformTransaction;
    const deltaElements = this.instanceTransformGizmo?.readTransform();
    const instance = instanceId
      ? this.componentInstances.find((candidate) => candidate.id === instanceId)
      : null;
    if (!instance || !transaction || transaction.state !== 'active' || !deltaElements) {
      return false;
    }

    const baseline = new THREE.Matrix4().fromArray(instance.transform);
    const delta = new THREE.Matrix4().fromArray(deltaElements);
    const nextTransform = Array.from(new THREE.Matrix4().multiplyMatrices(delta, baseline).elements);
    instance.transform = nextTransform;
    this.instanceTransformGizmo?.hide(false);
    this.gizmos.releaseAll();

    const result = this.rebuildAll(`Move ${instance.name}`, { trackHistory: false });
    if (!result.ok) {
      instance.transform = Array.from(baseline.elements);
      this.rebuildAll(`Restore ${instance.name}`, { trackHistory: false });
      eventBus.emit('ui:status', { message: `Could not transform ${instance.name}` });
      return false;
    }

    transaction.commit(`Move ${instance.name}`);
    this.instanceTransformTransaction = null;
    this.activeInstanceTransformId = null;
    this.updateAssemblyPanel();
    this.commitDocumentHistory(`Move ${instance.name}`);
    eventBus.emit('ui:status', { message: `Moved ${instance.name}` });
    return true;
  }

  private cancelInstanceTransformSession(): void {
    const transaction = this.instanceTransformTransaction;
    this.instanceTransformGizmo?.hide(true);
    this.gizmos.releaseAll();
    this.instanceTransformTransaction = null;
    this.activeInstanceTransformId = null;
    const result = transaction?.state === 'active' ? transaction.cancel() : null;
    this.updateAssemblyPanel();
    eventBus.emit('ui:status', {
      message: result?.byteEquivalent === false
        ? 'Instance transform canceled, but exact recovery could not be verified'
        : 'Instance transform canceled - document unchanged',
    });
  }

  /**
   * Handle constraint creation.
   */
  private handleConstraintCreated = (constraint: MateConstraint): boolean => {
    const previousInstances = cloneSnapshot(this.componentInstances);
    this.constraints.push(constraint);
    const instanceBodies = new Map(
      this.componentInstances.map((instance) => [
        instance.id,
        (this.instanceBodyIdsByInstance.get(instance.id) ?? [])
          .map((bodyId) => this.rebuiltBodies.find((body) => body.id === bodyId))
          .filter((body): body is BRepBody => Boolean(body)),
      ])
    );
    const solved = solveConstraints({
      instances: this.componentInstances,
      constraints: this.constraints,
      instanceBodies,
      tolerance: DEFAULT_TOLERANCE_POLICY.linear,
    });
    if (!solved.ok || !solved.committed) {
      this.constraints = this.constraints.filter((candidate) => candidate.id !== constraint.id);
      const reason = solved.errors.get(constraint.id) ?? 'The selected mate is conflicting or broken.';
      eventBus.emit('ui:status', { message: `Constraint blocked: ${reason}` });
      this.updateAssemblyPanel();
      return false;
    }

    this.componentInstances = this.componentInstances.map((instance) =>
      solved.updatedInstances.get(instance.id) ?? instance
    );
    for (const candidate of this.constraints) {
      const runtime = solved.constraintStatuses.get(candidate.id);
      if (!runtime) continue;
      candidate.satisfied = runtime.state === 'satisfied';
      candidate.status = runtime.state;
      if (runtime.message) candidate.errorMessage = runtime.message;
      else delete candidate.errorMessage;
      eventBus.emit('constraint:solved', {
        constraintId: candidate.id,
        satisfied: candidate.satisfied,
      });
    }

    const rebuild = this.rebuildAll('Solve Constraint', { trackHistory: false });
    if (!rebuild.ok) {
      this.componentInstances = previousInstances;
      this.constraints = this.constraints.filter((candidate) => candidate.id !== constraint.id);
      this.rebuildAll('Restore Constraint State', { trackHistory: false });
      eventBus.emit('ui:status', {
        message: 'Constraint blocked because the solved assembly could not rebuild.',
      });
      this.updateAssemblyPanel();
      return false;
    }

    this.commitDocumentHistory('Add Constraint');

    log.info('Constraint created', { id: constraint.id, type: constraint.type });
    this.updateAssemblyPanel();
    this.refreshUiChrome();
    return true;
  };

  /**
   * Exit sketch mode.
   */
  private exitSketchMode(commitPending = false): void {
    if (this.toolSessions.activeSession?.kind === 'sketch-edit') {
      if (commitPending && this.sketchToolDraft?.dirty) {
        this.toolSessions.commitActive();
      } else {
        this.toolSessions.cancelActive();
      }
    }
    this.sketchModeController.exit();
    this.activeSketchTool = 'select';
    this.resetSketchLineDraft();
    this.sketchOverlay.clearOperationPreview();
    // Remove the Sketch section now that we're back to modeling.
    this.panelChrome.hide('Sketch');
    eventBus.emit('ui:status', { message: 'Exited sketch mode' });
  }

  /**
   * Update feature parameters and rebuild.
   */
  private updateFeatureParameters(
    featureId: string,
    parameters: Record<string, unknown>,
    options: {
      emitStatus?: boolean;
      successMessage?: string;
      failureMessage?: string;
      trackHistory?: boolean;
      historyLabel?: string;
      selectFeatureAfterUpdate?: boolean;
      refreshUi?: boolean;
    } = {}
  ): boolean {
    const feature = this.features.find((f) => f.id === featureId);
    if (!feature) return false;
    this.lastFeatureUpdateFailureMessage = null;

    const previousParameters = cloneSnapshot(feature.parameters);
    const previousRefsIn = [...feature.refsIn];
    const wasSelected = this.featureTreePanel.getSelectedFeature()?.id === featureId;

    // Update parameters. Up-to-face uses the current typed face selection when
    // the inspector switches the extent without already carrying a reference.
    let nextParameters = cloneSnapshot(parameters);
    const extent = nextParameters.extent as Record<string, unknown> | undefined;
    if (extent?.limit === 'UpToFace' && !extent.upToFaceRef) {
      const selectedFaceRef = this.getSelectedFaceReference();
      if (selectedFaceRef) {
        nextParameters = {
          ...nextParameters,
          extent: { ...extent, upToFaceRef: selectedFaceRef },
        };
      }
    }
    if (feature.type === MITER_CUT_FEATURE_TYPE && nextParameters.cutStyle === 'threeWay') {
      const desired = nextParameters as unknown as MiterCutParams;
      const previous = previousParameters as unknown as Partial<MiterCutParams>;
      if (!desired.threeWayVertexId || desired.threeWayCorner !== previous.threeWayCorner) {
        const cornerIndex = Number(desired.threeWayCorner.slice('corner'.length));
        const body = this.rebuiltBodies.find((candidate) => candidate.id === desired.sourceBodyRef?.bodyId);
        const vertexId = desired.threeWayVertexIds?.[cornerIndex]
          ?? (body
            ? resolveThreeWayMiterCornerVertexId(body, desired.faceRef.faceId, desired.threeWayCorner)
            : null);
        if (vertexId) nextParameters.threeWayVertexId = vertexId;
      }
    }
    feature.parameters = nextParameters;
    if (feature.type === EXTRUDE_FEATURE_TYPE) {
      feature.refsIn = getExtrudeDependencyIds(nextParameters);
    } else if (feature.type === EXTRUDE_CUT_FEATURE_TYPE) {
      feature.refsIn = getExtrudeCutDependencyIds(nextParameters);
    }

    // Rebuild
    const rebuildOptions = options.trackHistory === undefined
      ? {}
      : { trackHistory: options.trackHistory };
    const refreshOptions = options.refreshUi === undefined
      ? {}
      : { refreshUi: options.refreshUi };
    const result = this.rebuildAll(options.historyLabel ?? `Update ${feature.name}`, {
      ...rebuildOptions,
      ...refreshOptions,
    });

    if (!result.ok) {
      this.lastFeatureUpdateFailureMessage = result.diagnostics[0]?.message ?? 'Unknown error';
      feature.parameters = previousParameters;
      feature.refsIn = previousRefsIn;
      this.rebuildAll('Restore Feature After Failed Update', {
        trackHistory: false,
        ...refreshOptions,
      });
      if (options.emitStatus !== false) {
        const errorMsg = this.lastFeatureUpdateFailureMessage ?? 'Unknown error';
        eventBus.emit('ui:status', {
          message: options.failureMessage ?? `Update blocked for ${feature.name}: ${errorMsg}`,
        });
      }
      return false;
    }

    if (wasSelected || options.selectFeatureAfterUpdate) {
      this.featureTreePanel.selectFeature(featureId);
    }

    if (options.emitStatus !== false) {
      eventBus.emit('ui:status', {
        message: options.successMessage ?? `Updated ${feature.name}`,
      });
    }
    return true;
  }

  private previewMoveVertexTranslation(
    featureId: string,
    translation: [number, number, number]
  ): boolean {
    const feature = this.getFeatureById(featureId);
    const params = this.getMoveVertexParams(feature);
    if (!feature || !params) {
      return false;
    }

    const nextTranslation = this.normalizeMoveVertexTranslation(translation, params.constrainAxis);
    const body = this.rebuiltBodies.find((candidate) => candidate.id === params.vertexRef.bodyId);
    const currentVertex = body?.vertices.get(params.vertexRef.vertexId);
    if (!body || !currentVertex) return false;
    const nextPosition: [number, number, number] = [
      currentVertex.position[0] - params.translation[0] + nextTranslation[0],
      currentVertex.position[1] - params.translation[1] + nextTranslation[1],
      currentVertex.position[2] - params.translation[2] + nextTranslation[2],
    ];
    const planarity = checkPlanarityPreservation(body, params.vertexRef.vertexId, nextPosition);
    if (!planarity.ok) {
      eventBus.emit('ui:status', {
        message: `Move blocked for ${feature.name}. Guarded vertex edits must keep adjacent faces planar.`,
      });
      return false;
    }
    this.directEditPreviewTranslation = nextTranslation;
    this.interactionDiagnostics.transformPreviewUpdates += 1;
    return true;
  }

  private previewRotateBody(
    featureId: string,
    rotationDegrees: [number, number, number]
  ): boolean {
    const feature = this.getFeatureById(featureId);
    const params = this.getRotateBodyParams(feature);
    if (!feature || !params) {
      return false;
    }

    if (!rotationDegrees.every(Number.isFinite)) return false;
    this.directEditPreviewRotation = [...rotationDegrees];
    this.interactionDiagnostics.transformPreviewUpdates += 1;
    return true;
  }

  private commitRotateBody(
    featureId: string,
    rotationDegrees: [number, number, number]
  ): boolean {
    const feature = this.getFeatureById(featureId);
    const params = this.getRotateBodyParams(feature);
    if (!feature || !params) {
      return false;
    }

    const nextParams = {
      ...cloneSnapshot(params),
      rotationDegrees: [...rotationDegrees],
    } as unknown as Record<string, unknown>;

    const updated = this.updateFeatureParameters(featureId, nextParams, {
      emitStatus: false,
      trackHistory: false,
      historyLabel: `Preview ${feature.name}`,
      selectFeatureAfterUpdate: true,
    });
    if (!updated) {
      return false;
    }

    this.commitDocumentHistory(`Update ${feature.name}`);
    this.refreshUiChrome();
    return true;
  }

  private commitMoveVertexTranslation(
    featureId: string,
    translation: [number, number, number]
  ): boolean {
    const feature = this.getFeatureById(featureId);
    const params = this.getMoveVertexParams(feature);
    if (!feature || !params) {
      return false;
    }

    const nextParams = {
      ...cloneSnapshot(params),
      translation: this.normalizeMoveVertexTranslation(translation, params.constrainAxis),
    } as unknown as Record<string, unknown>;

    const updated = this.updateFeatureParameters(featureId, nextParams, {
      emitStatus: false,
      trackHistory: false,
      historyLabel: `Preview ${feature.name}`,
      selectFeatureAfterUpdate: true,
    });
    if (!updated) {
      return false;
    }

    this.commitDocumentHistory(`Update ${feature.name}`);
    this.refreshUiChrome();
    return true;
  }

  private setMoveVertexConstraint(
    featureId: string,
    axis: 'x' | 'y' | 'z' | undefined
  ): void {
    const feature = this.getFeatureById(featureId);
    const params = this.getMoveVertexParams(feature);
    if (!feature || !params) {
      return;
    }

    const nextTranslation = this.normalizeMoveVertexTranslation(
      params.translation ?? [0, 0, 0],
      axis
    );

    const nextParams = {
      ...cloneSnapshot(params),
      translation: nextTranslation,
      ...(axis ? { constrainAxis: axis } : {}),
    } satisfies MoveVertexParams;

    if (!axis) {
      delete nextParams.constrainAxis;
    }

    this.updateFeatureParameters(featureId, nextParams as unknown as Record<string, unknown>, {
      historyLabel: `Update ${feature.name}`,
      successMessage: axis
        ? `Locked ${feature.name} to the ${axis.toUpperCase()} axis`
        : `Cleared axis lock for ${feature.name}`,
      selectFeatureAfterUpdate: true,
    });
  }

  /**
   * Rebuild all features and update the scene.
   */
  private rebuildAll(
    historyLabel = 'Rebuild',
    options: { trackHistory?: boolean; refreshUi?: boolean } = {}
  ): { ok: boolean; diagnostics: Diagnostic[] } {
    this.interactionDiagnostics.rebuilds += 1;
    for (const feature of this.features) synchronizeSketchFeatureRefsIn(feature);
    const result = this.rebuildEngine.rebuild(this.features);

    let rebuildSucceeded = result.ok;
    let rebuildDiagnostics = result.diagnostics;
    let rebuildError = result.ok ? null : result.error;

    if (result.ok) {
      const assemblyResult = rebuildWithComponents(result, this.components, this.componentInstances);
      if (!assemblyResult.ok) {
        rebuildSucceeded = false;
        rebuildDiagnostics = assemblyResult.diagnostics;
        rebuildError = assemblyResult.error ?? 'Assembly reconstruction failed';
      } else {
        this.applyFeatureOutputRefs(result.outputsByFeature);
        this.rebuiltBodiesByFeature = new Map(
          [...result.bodiesByFeature].map(([featureId, bodies]) => [featureId, [...bodies]])
        );
        this.refreshComponentBodyIds();
        const displayedBodies = assemblyResult.bodies;
        this.instanceBodyIdsByInstance = new Map(
          [...assemblyResult.instanceBodies].map(([instanceId, bodies]) => [
            instanceId,
            bodies.map((body) => body.id).sort((left, right) => left.localeCompare(right)),
          ])
        );
        this.instanceBodySourceIds = new Map(assemblyResult.instanceBodySourceIds);
        // Store rebuilt bodies for face lookup
        this.rebuiltBodies = displayedBodies;

        // Clear current scene objects
        for (const object of this.sceneObjects.values()) {
          this.viewport.remove(object);
        }
        this.sceneObjects.clear();
        this.meshCache.clear();

        // Create meshes from rebuilt bodies
        for (const body of displayedBodies) {
          const mesh = this.meshCache.getOrCreateMesh(body);
          this.interactionDiagnostics.remeshedBodies += 1;
          this.viewport.add(mesh);
          this.sceneObjects.set(body.id, mesh);
        }

        // Update document bodies
        this.syncDocumentBodies(displayedBodies);
        this.applyDocumentBodyPresentation();
        this.reconcileSelectionVisualsAfterRebuild();

        // Update feature tree
        eventBus.emit('document:loaded', {
          features: this.features,
        });

        eventBus.emit('rebuild:complete', {
          diagnostics: result.diagnostics,
        });

        this.refreshActiveSketchOverlay();
      }
    }

    if (!rebuildSucceeded) {
      eventBus.emit('document:loaded', {
        features: this.features,
      });

      eventBus.emit('rebuild:failed', {
        diagnostics: rebuildDiagnostics,
      });

      eventBus.emit('ui:status', {
        message: `Rebuild failed: ${rebuildError ?? 'Unknown error'}`,
      });
    }

    eventBus.emit('feature:diagnostics', {
      diagnostics: rebuildDiagnostics,
    });
    if (rebuildSucceeded && options.trackHistory !== false) {
      this.commitDocumentHistory(historyLabel);
    }
    if (options.refreshUi !== false) this.refreshUiChrome();
    return { ok: rebuildSucceeded, diagnostics: rebuildDiagnostics };
  }

  private reconcileSelectionVisualsAfterRebuild(): void {
    const availableBodyIds = new Set(this.rebuiltBodies.map((body) => body.id));
    const retainedBodyIds = [...this.selection.selectedIds].filter((bodyId) => availableBodyIds.has(bodyId));
    if (retainedBodyIds.length !== this.selection.selectedIds.size) {
      this.selection = selectMultiple(createSelectionState(), retainedBodyIds, false);
    }
    this.updateSelectionVisuals();

    if (this.selectedFace) {
      const body = this.rebuiltBodies.find((candidate) => candidate.id === this.selectedFace?.bodyId);
      if (body?.faces.has(this.selectedFace.faceId)) {
        this.faceHighlight?.clearSelection();
        this.ensureFaceHighlight().setSelectedFace(body, this.selectedFace.faceId);
      } else {
        this.selectedFace = null;
        this.faceHighlight?.clearSelection();
      }
    }
    if (this.selectedEdgeRef) {
      const body = this.rebuiltBodies.find((candidate) => candidate.id === this.selectedEdgeRef?.bodyId);
      if (body?.edges.has(this.selectedEdgeRef.edgeId)) {
        this.edgeSelectionOverlay?.clearSelection();
        this.ensureEdgeSelectionOverlay().setSelectedEdge(body, this.selectedEdgeRef.edgeId);
      } else {
        this.selectedEdgeRef = null;
        this.edgeSelectionOverlay?.clearSelection();
      }
    }
    if (this.selectedVertexRef) {
      const body = this.rebuiltBodies.find((candidate) => candidate.id === this.selectedVertexRef?.bodyId);
      if (!body?.vertices.has(this.selectedVertexRef.vertexId)) {
        this.selectedVertexRef = null;
      }
    }
    this.refreshVertexSelectionOverlay();
  }

  /**
   * Sync B-Rep bodies to document bodies.
   */
  private syncDocumentBodies(brepBodies: BRepBody[]): void {
    const doc = this.documentManager.getDocument();
    const existingById = new Map(doc.bodies.map((body) => [body.id, body]));
    for (const body of doc.bodies) {
      this.bodyPresentations.set(body.id, {
        name: body.name,
        visible: body.visible,
        locked: body.locked,
      });
    }

    // Geometry is rebuilt from history, while user-facing browser state follows
    // stable body IDs across rebuilds.
    for (const body of doc.bodies) {
      this.documentManager.removeBody(body.id);
    }

    for (const body of brepBodies) {
      const existing = existingById.get(body.id);
      const presentation = existing ?? this.bodyPresentations.get(body.id);
      const docBody: Body = {
        id: body.id,
        name: presentation?.name ?? body.name,
        type: 'solid',
        transform: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
        visible: presentation?.visible ?? true,
        locked: presentation?.locked ?? false,
      };
      this.documentManager.addBody(docBody);
      this.bodyPresentations.set(body.id, {
        name: docBody.name,
        visible: docBody.visible,
        locked: docBody.locked,
      });
    }
  }

  private updateBodyPresentation(id: string, updates: Partial<BodyPresentation>): void {
    const active = this.documentManager.getDocument().bodies.find((body) => body.id === id);
    const current = this.bodyPresentations.get(id) ?? {
      name: active?.name ?? id,
      visible: active?.visible ?? true,
      locked: active?.locked ?? false,
    };
    this.bodyPresentations.set(id, { ...current, ...updates });
  }

  private restoreBodyPresentations(document: Document): void {
    this.bodyPresentations = new Map(Object.entries(document.bodyPresentations ?? {}));
    for (const body of document.bodies) {
      this.bodyPresentations.set(body.id, {
        name: body.name,
        visible: body.visible,
        locked: body.locked,
      });
    }
  }

  private applyDocumentBodyPresentation(): void {
    for (const body of this.documentManager.getDocument().bodies) {
      const object = this.sceneObjects.get(body.id);
      if (object) object.visible = this.isBodyVisible(body.id);
    }
  }

  private refreshComponentBodyIds(): void {
    for (const component of this.components) {
      component.bodyIds = Array.from(new Set(component.featureIds.flatMap(
        (featureId) => this.getFeatureById(featureId)?.refsOut ?? []
      )));
    }
  }

  private getInstanceForBody(bodyId: string): ComponentInstance | null {
    for (const instance of this.componentInstances) {
      if (this.instanceBodyIdsByInstance.get(instance.id)?.includes(bodyId)) return instance;
    }
    return null;
  }

  private getComponentForBody(bodyId: string): Component | null {
    const instance = this.getInstanceForBody(bodyId);
    if (instance) {
      return this.components.find((component) => component.id === instance.componentId) ?? null;
    }
    return this.components.find((component) => component.bodyIds.includes(bodyId)) ?? null;
  }

  private isBodyVisible(bodyId: string): boolean {
    const body = this.documentManager.getDocument().bodies.find((item) => item.id === bodyId);
    const component = this.getComponentForBody(bodyId);
    const instance = this.getInstanceForBody(bodyId);
    return (body?.visible ?? true) &&
      (component?.visible ?? true) &&
      (instance?.visible ?? true);
  }

  private isBodyLocked(bodyId: string): boolean {
    const body = this.documentManager.getDocument().bodies.find((item) => item.id === bodyId);
    const component = this.getComponentForBody(bodyId);
    const instance = this.getInstanceForBody(bodyId);
    return (body?.locked ?? false) ||
      (component?.locked ?? false) ||
      (instance?.locked ?? false) ||
      (instance?.grounded ?? false);
  }

  private applyFeatureOutputRefs(outputsByFeature: Map<string, string[]>): void {
    for (const feature of this.features) {
      feature.refsOut = [...(outputsByFeature.get(feature.id) ?? [])];
      if (feature.type === SKETCH_FEATURE_TYPE && !feature.refsOut.includes(feature.id)) {
        feature.refsOut.push(feature.id);
      }
    }
  }

  /**
   * Select a feature by ID.
   */
  private selectFeatureById(featureId: string): void {
    if (this.directEditFeatureId && this.directEditFeatureId !== featureId) {
      this.toolSessions.cancelActive();
    }
    const feature = this.features.find((f) => f.id === featureId);
    this.modelBrowser.select({ kind: 'feature', id: featureId });
    this.featureTreePanel.selectFeature(feature?.id ?? null);
    const outputBodyIds = feature?.refsOut.filter((bodyId) => this.sceneObjects.has(bodyId)) ?? [];
    const preserveExplicitBodyTarget = feature?.type === SKETCH_FEATURE_TYPE &&
      this.getExplicitBodyTarget() !== null;
    if (outputBodyIds.some((bodyId) => this.isBodyLocked(bodyId))) {
      this.selection = clearSelection(this.selection);
      this.featureTreePanel.selectFeature(null);
      this.updateSelectionVisuals();
      eventBus.emit('ui:status', {
        message: `${feature?.name ?? 'Feature'} is locked through one of its output bodies`,
      });
      this.refreshUiChrome();
      return;
    }
    const bodyIds = outputBodyIds.filter((bodyId) => this.isBodyVisible(bodyId));

    this.clearSubObjectSelectionState();
    if (feature?.type === SKETCH_FEATURE_TYPE) {
      this.enterSketchModeForFeature(feature.id);
    } else if (this.sketchModeController.isActive) {
      this.exitSketchMode();
    }
    if (!preserveExplicitBodyTarget) {
      this.selection = clearSelection(this.selection);
    }
    if (!preserveExplicitBodyTarget && bodyIds.length > 0) {
      this.selection = selectMultiple(this.selection, bodyIds, false);
    }

    this.updateSelectionVisuals();
    this.refreshUiChrome();
  }

  private async saveDocument(): Promise<void> {
    const snapshot = this.buildDocumentSnapshot();
    const result = await saveToFile(snapshot, `${snapshot.metadata.name}.json`);

    if (result.ok) {
      this.documentManager.setFilePath(result.path);
      this.recentFilesStore.add(result.path, snapshot.metadata.name);
      this.undoRedo.markClean();
      this.autosaveManager.saveNow(snapshot, {
        filePath: result.path,
        reason: 'manual-save',
      });
      this.refreshDocumentDirtyState();
      this.refreshUiChrome();
      eventBus.emit('document:save', { path: result.path });
      eventBus.emit('ui:status', { message: `Saved: ${result.path}` });
    } else if (result.error !== 'Save cancelled') {
      eventBus.emit('ui:status', { message: `Save failed: ${result.error}` });
    }
  }

  private async openDocument(): Promise<void> {
    const result = await loadFromFile();

    if (result.ok) {
      this.loadDocument(result.document, {
        path: result.path,
        seedHistory: true,
        recordRecent: true,
      });
      eventBus.emit('document:load', { path: result.path });
      eventBus.emit('ui:status', { message: `Opened: ${result.path}` });
    } else if (result.error !== 'Open cancelled') {
      eventBus.emit('ui:status', { message: `Open failed: ${result.error}` });
    }
  }

  private cancelActiveInteraction(): void {
    if (this.cancellingActiveInteraction) return;

    this.cancellingActiveInteraction = true;
    try {
      this.toolSessions.cancelActive();
      this.constraintCreationController?.cancel();
      if (this.instanceTransformGizmo?.isActive()) {
        this.instanceTransformGizmo.hide(true);
      }
      if (this.pushPullMode) this.closePushPullMode();
    } finally {
      this.cancellingActiveInteraction = false;
    }
  }

  private newDocument(): void {
    this.cancelActiveInteraction();
    if (this.constraintCreationController?.isActive()) {
      this.constraintCreationController.cancel();
    }
    if (this.pushPullMode) {
      this.exitPushPullMode();
    }
    if (this.sketchModeController.isActive) {
      this.exitSketchMode();
    }
    if (this.faceSelectionMode) {
      this.exitFaceSelectionMode();
    }
    if (this.keyboardShortcutsPanel.getIsVisible()) {
      this.hideKeyboardShortcuts();
    }

    // Clear scene
    for (const object of this.sceneObjects.values()) {
      this.viewport.remove(object);
    }
    this.sceneObjects.clear();
    this.meshCache.clear();

    // Reset features
    this.features = [];
    this.rebuiltBodies = [];
    this.bodyPresentations.clear();
    this.resetAssemblyState();

    // Reset document
    this.documentManager.new();
    this.propertyInspector.setUnitContext(this.documentManager.getDocument().config.units);
    // Reset selection
    this.clearSubObjectSelectionState();
    this.selection = clearSelection(this.selection);

    // Update UI
    this.featureTreePanel.setFeatures([]);
    this.propertyInspector.clear();
    this.diagnosticsPanel.clear();
    this.updateAssemblyPanel();
    this.seedDocumentHistory('New document');

    eventBus.emit('ui:status', { message: 'New document created' });
    this.refreshUiChrome();
  }

  private loadDocument(
    doc: Document,
    options: {
      path?: string | null;
      seedHistory?: boolean;
      recordRecent?: boolean;
      restoreSelection?: HistorySelectionSnapshot;
    } = {}
  ): void {
    this.cancelActiveInteraction();
    if (this.constraintCreationController?.isActive()) {
      this.constraintCreationController.cancel();
    }
    if (this.pushPullMode) {
      this.exitPushPullMode();
    }
    if (this.sketchModeController.isActive) {
      this.exitSketchMode();
    }
    if (this.faceSelectionMode) {
      this.exitFaceSelectionMode();
    }
    if (this.keyboardShortcutsPanel.getIsVisible()) {
      this.hideKeyboardShortcuts();
    }

    // Clear current scene
    for (const object of this.sceneObjects.values()) {
      this.viewport.remove(object);
    }
    this.sceneObjects.clear();
    this.meshCache.clear();

    // Load document
    this.documentManager.load(doc, options.path ?? undefined);
    this.restoreBodyPresentations(doc);
    this.propertyInspector.setUnitContext(doc.config.units);
    this.welcomeOverlay.resetDismissed();
    this.rebuiltBodies = [];
    this.selectedSketchEntityId = null;
    this.loadAssemblyStateFromDocument(doc);
    this.propertyInspector.clear();
    this.diagnosticsPanel.clear();

    // Load features from document
    const docWithFeatures = doc as Document & { features?: FeatureRecord[] };
    if (docWithFeatures.features && Array.isArray(docWithFeatures.features)) {
      this.features = docWithFeatures.features;
    } else {
      this.features = [];
    }

    // Rebuild from features
    if (this.features.length > 0) {
      this.rebuildAll('Load Document', { trackHistory: false });
    } else {
      // Legacy: create meshes from bodies directly
      for (const body of doc.bodies) {
        const mesh = this.createLegacyBoxMesh(body);
        mesh.visible = body.visible;
        this.viewport.add(mesh);
        this.sceneObjects.set(body.id, mesh);
      }
    }

    // Update UI
    this.featureTreePanel.setFeatures(this.features);

    // Restore only references that remain valid after the rebuild.
    this.restoreHistorySelection(options.restoreSelection ?? null);
    this.updateAssemblyPanel();
    if (options.recordRecent !== false && options.path) {
      this.recentFilesStore.add(options.path, doc.metadata.name);
    }
    if (options.seedHistory !== false) {
      this.seedDocumentHistory(options.path ? 'Open Document' : 'Load Document');
    } else {
      this.refreshDocumentDirtyState();
    }
    this.refreshUiChrome();
  }

  private createLegacyBoxMesh(body: Body, color = 0x4a9eff): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.1,
      roughness: 0.8,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.id = body.id;
    mesh.userData.name = body.name;

    // Apply transform
    const matrix = new THREE.Matrix4();
    matrix.fromArray(body.transform);
    mesh.applyMatrix4(matrix);

    // Add wireframe for better visibility
    const wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 })
    );
    mesh.add(wireframe);

    return mesh;
  }

  private toggleGrid(): void {
    const grid = this.viewport.getGrid();
    grid.group.visible = !grid.group.visible;
    eventBus.emit('ui:status', {
      message: `Grid ${grid.group.visible ? 'shown' : 'hidden'}`,
    });
    this.refreshUiChrome();
  }

  private activateNamedView(view: NamedViewId): void {
    if (this.sketchModeController.isActive) {
      this.viewCube.setActiveView(null);
      eventBus.emit('ui:status', {
        message: 'Finish or exit the active sketch before changing to a named model view',
      });
      return;
    }
    applyNamedView(this.viewport.getCameraControls(), view);
    this.viewCube.setActiveView(view);
    eventBus.emit('ui:status', {
      message: `${view.charAt(0).toUpperCase()}${view.slice(1)} view`,
    });
    this.refreshUiChrome();
  }

  /**
   * Get sketch data from a feature ID.
   */
  private getSketchFromFeatureId(featureId: string): Sketch | null {
    const feature = this.features.find(f => f.id === featureId);
    if (!feature || feature.type !== SKETCH_FEATURE_TYPE) return null;

    const params = migrateSketchParams(
      feature.parameters as unknown as Partial<NormalizedSketchParams>
    );
    const solved = solveSketchConstraints(params.geometry, [
      ...params.relations,
      ...params.drivingDimensions,
    ]);
    const geometry = solved.ok ? solved.geometry : params.geometry;

    return {
      id: feature.id,
      name: feature.name,
      planeRef: params.planeRef,
      entities: materializeLineEntities(geometry),
      dimensions: [
        ...params.dimensions,
        ...params.drivingDimensions.map((dimension): SketchDimension => ({
          id: dimension.id,
          type: 'distance',
          entityId: dimension.pointAId,
          value: dimension.value,
          ...(dimension.name ? { name: dimension.name } : {}),
        })),
      ],
    };
  }

  private enterSketchModeForFeature(featureId: string): void {
    const sketch = this.getSketchFromFeatureId(featureId);
    if (!sketch) {
      return;
    }

    if (sketch.planeRef.type === 'world' && sketch.planeRef.worldPlane) {
      this.preferredSketchPlane = sketch.planeRef.worldPlane;
    }
    this.selectedSketchEntityId = sketch.entities[0]?.id ?? null;
    const initialTool: ActiveSketchTool = sketch.entities.length === 0 ? 'rectangle' : 'select';
    this.activeSketchTool = initialTool;
    this.resetSketchLineDraft();
    this.sketchModeController.enter(
      sketch.planeRef,
      sketch.id,
      this.rebuiltBodies,
      this.getRebuiltBodiesByFeature()
    );
    this.updateSketchOverlayTool();
    this.sketchOverlay.setSelectedEntity(this.selectedSketchEntityId);
    // The Sketch section only appears while sketch mode is active.
    this.panelChrome.show('Sketch');
    this.panelChrome.expand('Sketch');
    eventBus.emit('ui:status', {
      message: sketch.entities.length === 0
        ? `Sketch mode on ${this.describePlaneRef(sketch.planeRef)} - drag to draw a rectangle or switch to Line for custom prism profiles`
        : `Sketch mode on ${this.describePlaneRef(sketch.planeRef)} - choose Rectangle or Line to keep shaping the profile`,
    });
    if (initialTool !== 'select') {
      this.beginSketchToolSession(initialTool);
    }
  }

  private refreshActiveSketchOverlay(): void {
    const activeSketchId = this.sketchModeController.currentSketchId;
    if (!activeSketchId) {
      return;
    }

    const sketch = this.getSketchFromFeatureId(activeSketchId);
    const plane = sketch
      ? getConstructionPlaneFromRef(
        sketch.planeRef,
        this.rebuiltBodies,
        this.getRebuiltBodiesByFeature()
      )
      : null;
    if (!sketch || !plane) {
      this.exitSketchMode();
      return;
    }

    this.sketchOverlay.show(sketch, plane);
    const normalized = this.getResolvedSketchParams(activeSketchId);
    this.sketchOverlay.setNormalizedContext(normalized ? {
      geometry: normalized.geometry,
      relations: normalized.relations,
      drivingDimensions: normalized.drivingDimensions,
      displayUnit: this.sketchNumericUnit === 'mm' ? 'mm' : 'in',
    } : null);
    this.updateSketchOverlayTool();
    this.sketchOverlay.setLineDraftAnchor(this.sketchLineDraftLastPoint);
    this.sketchOverlay.setSelectedEntity(this.selectedSketchEntityId);
  }

  private getResolvedSketchParams(featureId: string): NormalizedSketchParams | null {
    const feature = this.getFeatureById(featureId);
    if (!feature || feature.type !== SKETCH_FEATURE_TYPE) return null;
    const params = migrateSketchParams(
      feature.parameters as unknown as Partial<NormalizedSketchParams>
    );
    const solved = solveSketchConstraints(params.geometry, [
      ...params.relations,
      ...params.drivingDimensions,
    ]);
    return this.createAuthoritativeSketchParams(
      params,
      solved.ok ? solved.geometry : params.geometry,
      params.relations,
      params.drivingDimensions
    );
  }

  private handleSketchSegmentClick(entityId: string): void {
    if (!this.sketchModeController.isActive) {
      return;
    }

    this.selectedSketchEntityId = entityId;
    this.sketchOverlay.setSelectedEntity(entityId);
    const draft = this.sketchToolDraft;
    if (!draft || this.activeSketchTool === 'select') {
      eventBus.emit('ui:status', { message: `Sketch entity selected: ${entityId}` });
      return;
    }

    const selected = this.toggleSketchSelection(draft.selectedSegmentIds, entityId);
    if (!selected) {
      this.selectedSketchEntityId = null;
      this.sketchOverlay.setSelectedEntity(null);
      return;
    }
    // Coincident is endpoint-to-endpoint: a segment click must not silently
    // count as selecting both endpoints and complete the tool in one gesture.
    if (
      this.activeSketchTool !== 'dimension'
      && !(this.activeSketchTool === 'constraint' && this.sketchConstraintType === 'coincident')
    ) {
      this.resolveSegmentPointSelection(draft, entityId);
    }
    this.tryApplySelectionDrivenSketchTool();
  }

  private handleSketchSegmentPick(pick: SketchSegmentPick): void {
    const draft = this.sketchToolDraft;
    if (
      draft
      && (this.activeSketchTool === 'trim' || this.activeSketchTool === 'extend')
      && draft.selectedSegmentIds[0] === pick.segmentId
      && !draft.dirty
    ) {
      draft.trimPickPoint = [...pick.sketchPoint];
    }
  }

  private handleSketchBlankPick(pick: SketchBlankPick): void {
    const draft = this.sketchToolDraft;
    if (!draft || this.activeSketchTool !== 'project') return;

    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sketch-canvas"]');
    const width = canvas?.clientWidth ?? 0;
    const height = canvas?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) return;

    const picked = this.picking.pickEdge(
      pick.canvas.x,
      pick.canvas.y,
      width,
      height,
      this.viewport.getCameraControls().camera,
      this.getPickableBodies()
    );
    const body = picked?.bodyId
      ? this.rebuiltBodies.find((candidate) => candidate.id === picked.bodyId)
      : null;
    if (!picked?.edgeId || !picked.bodyId || !picked.featureId || !body) {
      eventBus.emit('ui:status', { message: 'Click a visible model edge to project it' });
      return;
    }

    const sketchFeature = this.getFeatureById(draft.featureId);
    if (!sketchFeature || sketchFeature.type !== SKETCH_FEATURE_TYPE) return;
    const planeRef = (sketchFeature.parameters as Partial<{ planeRef: PlaneRef }>).planeRef;
    const plane = planeRef
      ? getConstructionPlaneFromRef(planeRef, this.rebuiltBodies, this.getRebuiltBodiesByFeature())
      : null;
    if (!plane) {
      this.showSketchEditError('The active sketch plane could not be resolved');
      return;
    }

    const result = projectModelEdgeToSketch(
      draft.baseParams.geometry,
      { featureId: picked.featureId, bodyId: picked.bodyId, edgeId: picked.edgeId },
      body,
      plane
    );
    if (!result.ok) {
      this.showSketchEditError(result.error.message);
      return;
    }
    const points = result.createdPointIds
      .map((id) => result.geometry.points.find((point) => point.id === id)?.position)
      .filter((point): point is Point2D => Boolean(point));
    this.sketchOverlay.previewProject(points, false, 'Projected model edge preview');
    this.applySketchGeometryPreview(result.geometry, 'Model edge projection preview - Enter to commit');
  }

  private handleSketchPointIdClick(pointId: string): void {
    if (!this.sketchModeController.isActive) return;

    if (this.activeSketchTool === 'select' && !this.sketchToolDraft) {
      this.beginSketchToolSession('select');
    }
    const draft = this.sketchToolDraft;
    if (!draft) return;
    const selected = this.toggleSketchSelection(draft.selectedPointIds, pointId);
    this.selectedSketchEntityId = selected ? pointId : null;
    this.sketchOverlay.setSelectedEntity(this.selectedSketchEntityId);

    if (!selected) {
      if (draft.movePointId === pointId) draft.movePointId = null;
      return;
    }

    if (this.activeSketchTool === 'select') {
      draft.movePointId = pointId;
      this.updateSketchOverlayTool(true);
      eventBus.emit('ui:status', { message: 'Endpoint selected - click its new location, then press Enter' });
      return;
    }
    this.tryApplySelectionDrivenSketchTool();
  }

  private toggleSketchSelection(ids: string[], id: string): boolean {
    const index = ids.indexOf(id);
    if (index >= 0) {
      ids.splice(index, 1);
      return false;
    }
    ids.push(id);
    return true;
  }

  private canEditCurrentSketch(): boolean {
    return this.getPreferredSketchFeature()?.type === SKETCH_FEATURE_TYPE;
  }

  private getActiveSketchPanelPlane(): SketchPlaneSelection | null {
    if (this.sketchModeController.isActive) {
      const activeSketch = this.getPreferredSketchFeature();
      if (
        activeSketch?.type === SKETCH_FEATURE_TYPE &&
        (activeSketch.parameters as Partial<{ planeRef: PlaneRef }>).planeRef?.type === 'world'
      ) {
        const plane = (activeSketch.parameters as { planeRef: PlaneRef }).planeRef.worldPlane;
        return plane ?? null;
      }

      return null;
    }

    return this.preferredSketchPlane;
  }

  private startSketchOnWorldPlane(plane: SketchPlaneSelection): void {
    this.preferredSketchPlane = plane;
    if (this.sketchModeController.isActive) {
      this.exitSketchMode();
    }
    this.addSketchFeatureOnPlane(plane);
  }

  private selectSketchTool(tool: ActiveSketchTool): void {
    if (!this.canEditCurrentSketch()) {
      eventBus.emit('ui:status', { message: 'Select or create a sketch first' });
      return;
    }

    if (tool === 'select') {
      if (this.toolSessions.activeSession?.kind === 'sketch-edit') {
        this.toolSessions.cancelActive();
      }
      this.activeSketchTool = 'select';
      this.resetSketchLineDraft();
      this.sketchOverlay.clearOperationPreview();
      this.updateSketchOverlayTool();
      eventBus.emit('ui:status', { message: 'Select tool active - click geometry or an endpoint' });
      this.refreshUiChrome();
      return;
    }

    this.beginSketchToolSession(tool);
  }

  private beginSketchToolSession(tool: ActiveSketchTool): void {
    // Roll back the previous preview before reading the next tool's baseline.
    // Otherwise the new transaction can capture a superseded preview and later
    // resurrect it when Escape is pressed.
    this.toolSessions.cancelActive('superseded');

    const feature = this.getPreferredSketchFeature();
    if (!feature || feature.type !== SKETCH_FEATURE_TYPE) return;

    const baseParams = migrateSketchParams(
      feature.parameters as unknown as Partial<NormalizedSketchParams>
    );
    const pathAtStart = this.documentManager.currentFilePath;
    const operationId = this.allocateSketchOperationNamespace(feature.id, baseParams);
    this.toolSessions.start({
      id: `sketch-edit-${operationId}`,
      kind: 'sketch-edit',
      get phase(): ToolSessionPhase {
        return 'previewing';
      },
      start: () => {
        this.activeSketchTool = tool;
        this.sketchNumericValue = '';
        this.sketchNumericError = null;
        this.selectedSketchEntityId = null;
        this.sketchToolDraft = {
          featureId: feature.id,
          operationId,
          baseParams,
          dirty: false,
          points: [],
          selectedPointIds: [],
          selectedSegmentIds: [],
          movePointId: null,
          trimPickPoint: null,
        };
        this.sketchToolTransaction = new PreviewTransaction<Document, NormalizedSketchParams>({
          capture: () => this.buildDocumentSnapshot(),
          serialize: (snapshot) => JSON.stringify(snapshot),
          restore: (snapshot) => this.restoreInteractiveDocument(snapshot, pathAtStart),
          applyPreview: (params) => this.updateFeatureParameters(feature.id, params as unknown as Record<string, unknown>, {
            emitStatus: false,
            trackHistory: false,
            historyLabel: `Preview ${this.describeSketchTool(tool)}`,
          }),
        });
        this.resetSketchLineDraft();
        this.sketchOverlay.clearOperationPreview();
        this.updateSketchOverlayTool();
        this.refreshUiChrome();
      },
      commit: () => this.commitSketchToolSession(),
      cancel: () => this.cancelSketchToolSession(),
    });
  }

  private commitSketchToolSession(): boolean {
    const draft = this.sketchToolDraft;
    const transaction = this.sketchToolTransaction;
    if (!draft?.dirty || !transaction || transaction.state !== 'active') {
      eventBus.emit('ui:status', { message: `${this.describeSketchTool(this.activeSketchTool)} needs a valid preview before commit` });
      return false;
    }

    const label = this.getSketchHistoryLabel(this.activeSketchTool);
    transaction.commit(label);
    this.commitDocumentHistory(label);
    this.clearSketchToolSessionState();
    eventBus.emit('ui:status', { message: `${label} committed` });
    return true;
  }

  private allocateSketchOperationNamespace(
    featureId: string,
    params: NormalizedSketchParams
  ): string {
    const occupiedIds = new Set([
      ...params.geometry.points.map((point) => point.id),
      ...params.geometry.segments.map((segment) => segment.id),
      ...params.relations.map((relation) => relation.id),
      ...params.drivingDimensions.map((dimension) => dimension.id),
      ...params.dimensions.map((dimension) => dimension.id),
      ...params.entities.map((entity) => entity.id),
    ]);
    const base = `${featureId}:edit:`;
    let ordinal = 1;
    while ([...occupiedIds].some((id) => id === `${base}${ordinal}` || id.startsWith(`${base}${ordinal}:`))) {
      ordinal += 1;
    }
    return `${base}${ordinal}`;
  }

  private cancelSketchToolSession(): void {
    const draft = this.sketchToolDraft;
    const transaction = this.sketchToolTransaction;
    const result = transaction?.state === 'active' ? transaction.cancel() : null;
    const featureId = draft?.featureId ?? null;
    this.clearSketchToolSessionState();
    if (featureId && this.getFeatureById(featureId)) {
      this.featureTreePanel.selectFeature(featureId);
      this.refreshActiveSketchOverlay();
    }
    eventBus.emit('ui:status', {
      message: result?.byteEquivalent === false
        ? 'Sketch edit canceled, but exact recovery could not be verified'
        : 'Sketch edit canceled - document unchanged',
    });
  }

  private clearSketchToolSessionState(): void {
    this.sketchToolTransaction = null;
    this.sketchToolDraft = null;
    this.activeSketchTool = 'select';
    this.selectedSketchEntityId = null;
    this.resetSketchLineDraft();
    this.sketchOverlay.clearOperationPreview();
    this.updateSketchOverlayTool();
    this.refreshUiChrome();
  }

  private createRectangleFromSketchDrag(start: Point2D, end: Point2D): void {
    const draft = this.sketchToolDraft;
    if (!draft || this.activeSketchTool !== 'rectangle') return;
    const width = Math.abs(end[0] - start[0]);
    const height = Math.abs(end[1] - start[1]);
    if (width < 0.05 || height < 0.05) {
      eventBus.emit('ui:status', { message: 'Drag farther to create a rectangle' });
      return;
    }

    const result = appendSharedPointRectangle(
      draft.baseParams.geometry,
      draft.operationId,
      start,
      end
    );
    if (!result.ok) {
      this.showSketchEditError(result.error.message);
      return;
    }
    this.applySketchGeometryPreview(result.geometry, 'Rectangle preview - Enter to commit, Escape to cancel');
  }

  private handleSketchLinePoint(point: Point2D): void {
    const draft = this.sketchToolDraft;
    if (!draft) return;

    if (this.activeSketchTool === 'center-rectangle' || this.activeSketchTool === 'regular-polygon') {
      this.handleTwoPointPrimitive(point);
      return;
    }

    if (this.activeSketchTool === 'select' && draft.movePointId) {
      const result = moveSketchPoint(draft.baseParams.geometry, draft.movePointId, point);
      if (!result.ok) {
        this.showSketchEditError(result.error.message);
        return;
      }
      this.applySketchGeometryPreview(result.geometry, 'Endpoint move preview - Enter to commit');
      return;
    }

    if (this.activeSketchTool !== 'line') return;

    if (draft.points.length === 0) {
      draft.points.push([...point]);
      this.sketchLineDraftStart = point;
      this.sketchLineDraftLastPoint = point;
      this.sketchOverlay.setLineDraftAnchor(point);
      eventBus.emit('ui:status', {
        message: 'First corner placed - click the next corner, then click near the first point to close the loop',
      });
      return;
    }

    let nextPoint: Point2D = [...point];
    const shouldClose = this.sketchLineDraftStart &&
      draft.points.length >= 3 &&
      this.areSketchPointsNear(point, this.sketchLineDraftStart, 0.2);
    if (shouldClose && this.sketchLineDraftStart) {
      nextPoint = [...this.sketchLineDraftStart];
    } else if (
      this.sketchLineDraftLastPoint
      && this.areSketchPointsNear(point, this.sketchLineDraftLastPoint, 0.05)
    ) {
      return;
    }

    if (!shouldClose) draft.points.push(nextPoint);
    const result = appendSharedPointPolyline(
      draft.baseParams.geometry,
      draft.operationId,
      draft.points,
      { closed: Boolean(shouldClose) }
    );
    if (!result.ok) {
      this.showSketchEditError(result.error.message);
      return;
    }
    this.applySketchGeometryPreview(
      result.geometry,
      shouldClose
        ? 'Closed polyline preview - Enter to commit'
        : 'Open polyline preview - continue drawing or Enter to commit'
    );
    this.sketchLineDraftLastPoint = shouldClose ? null : nextPoint;

    if (shouldClose) {
      this.sketchOverlay.setLineDraftAnchor(null);
    } else {
      this.sketchOverlay.setLineDraftAnchor(this.sketchLineDraftLastPoint);
    }
  }

  private resetSketchLineDraft(): void {
    this.sketchLineDraftStart = null;
    this.sketchLineDraftLastPoint = null;
    this.sketchOverlay.setLineDraftAnchor(null);
  }

  private areSketchPointsNear(left: Point2D, right: Point2D, tolerance: number): boolean {
    return Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance;
  }

  private updateSketchOverlayTool(forcePointInput = false): void {
    const pointDriven = forcePointInput
      || this.activeSketchTool === 'line'
      || this.activeSketchTool === 'center-rectangle'
      || this.activeSketchTool === 'regular-polygon';
    this.sketchOverlay.setTool(
      this.activeSketchTool === 'rectangle'
        ? 'rectangle'
        : pointDriven ? 'line' : 'select'
    );
  }

  private handleTwoPointPrimitive(point: Point2D): void {
    const draft = this.sketchToolDraft;
    if (!draft) return;
    if (draft.points.length === 0) {
      draft.points.push([...point]);
      this.sketchOverlay.setLineDraftAnchor(point);
      eventBus.emit('ui:status', { message: 'Center placed - click an outside point' });
      return;
    }

    const center = draft.points[0]!;
    const result = this.activeSketchTool === 'center-rectangle'
      ? appendCenterRectangle(draft.baseParams.geometry, draft.operationId, center, point)
      : appendRegularPolygon(
        draft.baseParams.geometry,
        draft.operationId,
        center,
        point,
        this.sketchPolygonSides
      );
    if (!result.ok) {
      this.showSketchEditError(result.error.message);
      return;
    }
    if (this.activeSketchTool === 'center-rectangle') {
      this.sketchOverlay.previewCenterRectangle(center, point);
    } else {
      this.sketchOverlay.previewRegularPolygon(center, point, this.sketchPolygonSides);
    }
    this.applySketchGeometryPreview(
      result.geometry,
      `${this.describeSketchTool(this.activeSketchTool)} preview - Enter to commit`
    );
  }

  private applySketchGeometryPreview(geometry: NormalizedSketchGeometry, message: string): boolean {
    const draft = this.sketchToolDraft;
    return draft
      ? this.applySketchStatePreview(
        geometry,
        draft.baseParams.relations,
        draft.baseParams.drivingDimensions,
        message
      )
      : false;
  }

  private applySketchStatePreview(
    geometry: NormalizedSketchGeometry,
    relations: readonly SketchConstraint[],
    drivingDimensions: readonly DrivingDistanceDimension[],
    message: string
  ): boolean {
    const draft = this.sketchToolDraft;
    const transaction = this.sketchToolTransaction;
    if (!draft || !transaction || transaction.state !== 'active') return false;
    const solved = solveSketchConstraints(geometry, [...relations, ...drivingDimensions]);
    if (!solved.ok) {
      this.showSketchEditError(solved.diagnostics[0]?.message ?? 'Sketch constraints could not be solved');
      return false;
    }
    const params = this.createAuthoritativeSketchParams(
      draft.baseParams,
      solved.geometry,
      relations,
      drivingDimensions
    );
    if (!transaction.preview(params)) {
      this.showSketchEditError('Sketch preview was rejected by rebuild validation');
      return false;
    }
    draft.dirty = true;
    this.sketchNumericError = null;
    eventBus.emit('ui:status', { message });
    this.refreshActiveSketchOverlay();
    this.refreshUiChrome();
    return true;
  }

  private createAuthoritativeSketchParams(
    base: NormalizedSketchParams,
    geometry: NormalizedSketchGeometry,
    relations: readonly SketchConstraint[],
    drivingDimensions: readonly DrivingDistanceDimension[]
  ): NormalizedSketchParams {
    const { legacySourceSignature: _legacySignature, ...baseWithoutSignature } = cloneSnapshot(base);
    return migrateSketchParams({
      ...baseWithoutSignature,
      geometry: cloneSnapshot(geometry),
      entities: materializeLineEntities(geometry),
      relations: cloneSnapshot([...relations]),
      drivingDimensions: cloneSnapshot([...drivingDimensions]),
    });
  }

  private handleSketchNumericSubmit(submission: SketchNumericSubmission): void {
    this.sketchNumericValue = submission.raw;
    if (!submission.result.ok) {
      this.sketchNumericError = submission.result.error;
      this.refreshUiChrome();
      return;
    }
    const draft = this.sketchToolDraft;
    if (!draft) return;

    if (this.activeSketchTool === 'dimension'
      || (this.activeSketchTool === 'constraint' && this.sketchConstraintType === 'distance')) {
      const pointIds = draft.selectedPointIds.slice();
      if (draft.selectedSegmentIds.length === 1 && pointIds.length === 0) {
        const segment = draft.baseParams.geometry.segments.find(
          (candidate) => candidate.id === draft.selectedSegmentIds[0]
        );
        if (segment) pointIds.push(segment.startPointId, segment.endPointId);
      }
      const hasValidReferenceSelection = (
        draft.selectedSegmentIds.length === 1
        && draft.selectedPointIds.length === 0
      ) || (
        draft.selectedSegmentIds.length === 0
        && draft.selectedPointIds.length === 2
      );
      if (!hasValidReferenceSelection || pointIds.length !== 2) {
        this.showSketchEditError('Select exactly one segment or exactly two endpoints before entering a distance');
        return;
      }
      const pointById = new Map(draft.baseParams.geometry.points.map((point) => [point.id, point]));
      const first = pointById.get(pointIds[0]!);
      const second = pointById.get(pointIds[1]!);
      if (!first || !second) return;
      const current = Math.hypot(
        second.position[0] - first.position[0],
        second.position[1] - first.position[1]
      );
      const value = resolveNumericInput(current, submission.result);
      if (value <= 0) {
        this.showSketchEditError('Driving distance must be greater than zero');
        return;
      }
      const relationResult = addDrivingDistanceDimension(
        draft.baseParams.geometry,
        [...draft.baseParams.relations, ...draft.baseParams.drivingDimensions],
        `${draft.operationId}:distance`,
        pointIds[0]!,
        pointIds[1]!,
        value,
        'Driving distance'
      );
      if (!relationResult.ok) {
        this.showSketchEditError(relationResult.error.message);
        return;
      }
      const split = this.splitSketchRelations(relationResult.relations);
      this.applySketchStatePreview(
        draft.baseParams.geometry,
        split.relations,
        split.drivingDimensions,
        `Driving distance ${submission.raw} preview - Enter to commit`
      );
      return;
    }

    if (this.activeSketchTool === 'regular-polygon' && draft.points.length === 1) {
      const radius = resolveNumericInput(0, submission.result);
      if (radius <= 0) {
        this.showSketchEditError('Polygon radius must be greater than zero');
        return;
      }
      this.handleTwoPointPrimitive([draft.points[0]![0] + radius, draft.points[0]![1]]);
      return;
    }

    this.showSketchEditError('This tool does not currently use a standalone numeric value');
  }

  private hasValidDimensionSelection(): boolean {
    const draft = this.sketchToolDraft;
    if (!draft) return false;
    return (
      draft.selectedSegmentIds.length === 1
      && draft.selectedPointIds.length === 0
    ) || (
      draft.selectedSegmentIds.length === 0
      && draft.selectedPointIds.length === 2
    );
  }

  private splitSketchRelations(relations: readonly SketchRelation[]): {
    relations: SketchConstraint[];
    drivingDimensions: DrivingDistanceDimension[];
  } {
    return {
      relations: relations.filter((relation): relation is SketchConstraint => relation.type !== 'distance'),
      drivingDimensions: relations.filter(
        (relation): relation is DrivingDistanceDimension => relation.type === 'distance'
      ),
    };
  }

  private resolveSegmentPointSelection(draft: SketchToolDraft, segmentId: string): void {
    const segment = draft.baseParams.geometry.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) return;
    for (const pointId of [segment.startPointId, segment.endPointId]) {
      if (!draft.selectedPointIds.includes(pointId)) draft.selectedPointIds.push(pointId);
    }
  }

  private tryApplySelectionDrivenSketchTool(): void {
    const draft = this.sketchToolDraft;
    if (!draft) return;
    if (this.activeSketchTool === 'constraint') {
      this.tryApplySelectedConstraint();
      return;
    }
    if (this.activeSketchTool === 'dimension') {
      const valid = (
        draft.selectedSegmentIds.length === 1
        && draft.selectedPointIds.length === 0
      ) || (
        draft.selectedSegmentIds.length === 0
        && draft.selectedPointIds.length === 2
      );
      eventBus.emit('ui:status', {
        message: valid
          ? 'Selection ready - enter a driving distance'
          : 'Select exactly one segment or exactly two endpoints',
      });
      this.refreshUiChrome();
      return;
    }
    if (this.activeSketchTool === 'trim' && draft.selectedSegmentIds.length >= 2) {
      const [target, cutter] = draft.selectedSegmentIds;
      const targetSegment = draft.baseParams.geometry.segments.find((segment) => segment.id === target);
      const pointById = new Map(draft.baseParams.geometry.points.map((point) => [point.id, point.position]));
      const startPoint = targetSegment ? pointById.get(targetSegment.startPointId) : null;
      const endPoint = targetSegment ? pointById.get(targetSegment.endPointId) : null;
      const removeSide = draft.trimPickPoint && startPoint && endPoint
        ? this.pointDistance2D(draft.trimPickPoint, startPoint) <= this.pointDistance2D(draft.trimPickPoint, endPoint)
          ? 'start'
          : 'end'
        : 'start';
      const result = trimStraightSegment(
        draft.baseParams.geometry,
        draft.operationId,
        target!,
        cutter!,
        { removeSide }
      );
      if (!result.ok) return this.showSketchEditError(result.error.message);
      this.previewEditedSegment(result.geometry, target!, 'trim');
      this.applySketchGeometryPreview(result.geometry, 'Trim preview - Enter to commit');
      return;
    }
    if (this.activeSketchTool === 'extend' && draft.selectedSegmentIds.length >= 2) {
      const [target, boundary] = draft.selectedSegmentIds;
      const targetSegment = draft.baseParams.geometry.segments.find((segment) => segment.id === target);
      const pointById = new Map(draft.baseParams.geometry.points.map((point) => [point.id, point.position]));
      const startPoint = targetSegment ? pointById.get(targetSegment.startPointId) : null;
      const endPoint = targetSegment ? pointById.get(targetSegment.endPointId) : null;
      const endpoint = draft.trimPickPoint && startPoint && endPoint
        ? this.pointDistance2D(draft.trimPickPoint, startPoint) <= this.pointDistance2D(draft.trimPickPoint, endPoint)
          ? 'start'
          : 'end'
        : null;
      if (!endpoint) return this.showSketchEditError('Click the exact endpoint side to extend, then click its boundary');
      const result = extendStraightSegment(
        draft.baseParams.geometry,
        draft.operationId,
        target!,
        boundary!,
        endpoint
      );
      if (!result.ok) return this.showSketchEditError(result.error.message);
      this.previewEditedSegment(result.geometry, target!, 'extend');
      this.applySketchGeometryPreview(result.geometry, 'Extend preview - Enter to commit');
      return;
    }
    if (this.activeSketchTool === 'project' && draft.selectedSegmentIds.length >= 1) {
      const result = projectStraightSegments(
        draft.baseParams.geometry,
        draft.baseParams.geometry,
        draft.selectedSegmentIds,
        draft.operationId
      );
      if (!result.ok) return this.showSketchEditError(result.error.message);
      const points = result.createdPointIds
        .map((id) => result.geometry.points.find((point) => point.id === id)?.position)
        .filter((point): point is Point2D => Boolean(point));
      this.sketchOverlay.previewProject(points, false, 'Projected construction geometry preview');
      this.applySketchGeometryPreview(result.geometry, 'Projection preview - Enter to commit');
    }
  }

  private pointDistance2D(left: Point2D, right: Point2D): number {
    return Math.hypot(left[0] - right[0], left[1] - right[1]);
  }

  private tryApplySelectedConstraint(): void {
    const draft = this.sketchToolDraft;
    if (!draft || this.sketchConstraintType === 'distance') return;
    if (this.sketchConstraintType === 'angle') {
      this.showSketchEditError('Angular driving dimensions are not implemented yet');
      return;
    }
    const id = `${draft.operationId}:constraint`;
    const segments = draft.selectedSegmentIds;
    const points = draft.selectedPointIds;
    let relation: SketchConstraint | null = null;
    if (this.sketchConstraintType === 'horizontal' || this.sketchConstraintType === 'vertical') {
      if (segments.length >= 1) relation = { id, type: this.sketchConstraintType, segmentId: segments[0]! };
    } else if (
      this.sketchConstraintType === 'parallel'
      || this.sketchConstraintType === 'perpendicular'
      || this.sketchConstraintType === 'equal'
    ) {
      if (segments.length >= 2) {
        relation = {
          id,
          type: this.sketchConstraintType,
          segmentAId: segments[0]!,
          segmentBId: segments[1]!,
        };
      }
    } else if (this.sketchConstraintType === 'coincident') {
      if (points.length >= 2) relation = { id, type: 'coincident', pointAId: points[0]!, pointBId: points[1]! };
    } else if (this.sketchConstraintType === 'fixed' && points.length >= 1) {
      const point = draft.baseParams.geometry.points.find((candidate) => candidate.id === points[0]);
      if (point) relation = { id, type: 'fixed', pointId: point.id, position: [...point.position] };
    }
    if (!relation) {
      eventBus.emit('ui:status', { message: 'Select compatible sketch geometry for this constraint' });
      return;
    }
    const result = addSketchRelation(
      draft.baseParams.geometry,
      [...draft.baseParams.relations, ...draft.baseParams.drivingDimensions],
      relation
    );
    if (!result.ok) return this.showSketchEditError(result.error.message);
    const split = this.splitSketchRelations(result.relations);
    this.applySketchStatePreview(
      draft.baseParams.geometry,
      split.relations,
      split.drivingDimensions,
      `${this.sketchConstraintType} constraint preview - Enter to commit`
    );
  }

  private previewEditedSegment(
    geometry: NormalizedSketchGeometry,
    segmentId: string,
    kind: 'trim' | 'extend'
  ): void {
    const segment = geometry.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) return;
    const pointById = new Map(geometry.points.map((point) => [point.id, point.position]));
    const points = [pointById.get(segment.startPointId), pointById.get(segment.endPointId)]
      .filter((point): point is Point2D => Boolean(point));
    if (kind === 'trim') this.sketchOverlay.previewTrim(points);
    else this.sketchOverlay.previewExtend(points);
  }

  private getActiveSketchProfileDiagnostics() {
    const sketchId = this.sketchModeController.currentSketchId;
    const params = sketchId ? this.getResolvedSketchParams(sketchId) : null;
    if (!params) return [];
    return analyzeProfiles(toProfileSegments(params.geometry)).issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: 'error' as const,
      entityIds: issue.entityIds,
    }));
  }

  private focusSketchDiagnostic(entityIds: string[]): void {
    const entityId = entityIds[0];
    if (entityId) {
      this.selectedSketchEntityId = entityId;
      this.sketchOverlay.setSelectedEntity(entityId);
    }
    eventBus.emit('ui:status', { message: entityId ? `Profile issue focused on ${entityId}` : 'Profile issue selected' });
  }

  private getSketchToolStatus(): string | null {
    const draft = this.sketchToolDraft;
    if (!this.sketchModeController.isActive) return null;
    if (!draft) return this.activeSketchTool === 'select' ? 'Select geometry or an endpoint to edit.' : null;
    if (draft.dirty) return 'Preview ready. Press Enter to commit or Escape to cancel.';
    if (this.activeSketchTool === 'dimension') return 'Select a segment or two points, then enter a distance.';
    if (this.activeSketchTool === 'constraint') return 'Select geometry compatible with the chosen constraint.';
    return null;
  }

  private describeSketchTool(tool: ActiveSketchTool): string {
    return tool.replaceAll('-', ' ');
  }

  private getSketchHistoryLabel(tool: ActiveSketchTool): string {
    const labels: Record<ActiveSketchTool, string> = {
      select: 'Move Sketch Endpoint',
      line: 'Draw Polyline',
      rectangle: 'Draw Rectangle',
      'center-rectangle': 'Draw Center Rectangle',
      'regular-polygon': 'Draw Regular Polygon',
      dimension: 'Add Driving Dimension',
      constraint: 'Add Sketch Constraint',
      trim: 'Trim Sketch Segment',
      extend: 'Extend Sketch Segment',
      project: 'Project Sketch Geometry',
    };
    return labels[tool];
  }

  private showSketchEditError(message: string): void {
    this.sketchNumericError = message;
    eventBus.emit('ui:status', { message });
    this.refreshUiChrome();
  }

  private describePlaneRef(planeRef: PlaneRef): string {
    if (planeRef.type === 'world') {
      return `${planeRef.worldPlane?.toUpperCase() ?? 'XY'} plane`;
    }

    return `face ${planeRef.faceId ?? 'unknown'}`;
  }

  /**
   * Enter push/pull mode for face selection.
   * Milestone 03: Push/Pull as a Feature
   */
  private enterPushPullMode(): void {
    if (this.toolSessions.activeSession?.kind === 'push-pull') {
      this.toolSessions.cancelActive();
      return;
    }
    if (this.pushPullMode) {
      this.closePushPullMode('Exited push/pull mode');
      return;
    }

    // Check if we have bodies to push/pull
    if (this.rebuiltBodies.length === 0) {
      eventBus.emit('ui:status', { message: 'No bodies available - create a box or extrude first' });
      return;
    }

    this.toolSessions.start(this.createPushPullToolSession());
  }

  private createPushPullToolSession(): ToolSession {
    const id = `push-pull-${++this.pushPullSessionSequence}`;
    const initialFace = this.selectedFace ? { ...this.selectedFace } : null;
    const getPhase = (): ToolSessionPhase =>
      this.pushPullGizmo?.isActive() ? 'previewing' : 'awaiting-input';
    return {
      id,
      kind: 'push-pull',
      get phase(): ToolSessionPhase {
        return getPhase();
      },
      start: () => this.beginPushPullMode(initialFace),
      commit: () => this.commitPushPullToolSession(),
      cancel: () => this.cancelPushPullToolSession(),
    };
  }

  private beginPushPullMode(initialFace: { faceId: string; bodyId: string } | null = null): void {
    if (this.constraintCreationController?.isActive()) {
      this.constraintCreationController.cancel();
    }
    if (this.faceSelectionMode) {
      this.faceSelectionMode = false;
      eventBus.emit('face:mode:changed', { isActive: false });
    }

    this.pushPullMode = true;
    this.pushPullPreviousSelectionMode = this.selectionMode;
    this.pushPullInitialFace = initialFace ? { ...initialFace } : null;
    this.pushPullDistanceInput = '0';
    this.pushPullDistanceError = null;
    this.panelChrome.collapse('Properties');
    this.propertiesExpandedForFeatureId = null;
    this.setSelectionMode('face', false);

    this.ensureFaceHighlight();

    // Initialize push/pull gizmo if needed
    if (!this.pushPullGizmo) {
      this.pushPullGizmo = new PushPullGizmo({
        snapSettings: this.snapSettings,
        onDraggingChange: (dragging) => {
          this.gizmos.setDragState('pushPull', dragging);
        },
      });
      this.pushPullGizmo.attach(
        this.viewport.getScene(),
        this.viewport.getCameraControls(),
        this.viewport.getDomElement()
      );
    }

    const pathAtStart = this.documentManager.currentFilePath;
    this.pushPullTransaction = new PreviewTransaction<Document, number>({
      capture: () => this.buildDocumentSnapshot(),
      serialize: (snapshot) => JSON.stringify(snapshot),
      applyPreview: (distance) => this.updatePushPullGeometryPreview(distance),
      restore: (snapshot) => {
        if (JSON.stringify(this.buildDocumentSnapshot()) === JSON.stringify(snapshot)) {
          return;
        }
        this.loadDocument(cloneSnapshot(snapshot), {
          path: pathAtStart,
          seedHistory: false,
          recordRecent: false,
        });
      },
    });

    // Listen for face selection in push/pull mode
    eventBus.on('face:selected', this.handlePushPullFaceSelected);

    if (initialFace) {
      this.handlePushPullFaceSelected(initialFace);
    } else {
      eventBus.emit('ui:status', { message: 'Push/Pull mode - click a face to offset' });
    }
    log.info('Entered push/pull mode');
    this.refreshUiChrome();
  }

  /**
   * Exit push/pull mode.
   */
  private exitPushPullMode(): void {
    if (this.toolSessions.activeSession?.kind === 'push-pull') {
      this.toolSessions.cancelActive();
      return;
    }
    this.closePushPullMode('Exited push/pull mode');
  }

  private cancelPushPullToolSession(): void {
    const transaction = this.pushPullTransaction;
    this.pushPullTransaction = null;
    this.closePushPullMode(undefined, true);

    const result = transaction?.state === 'active' ? transaction.cancel() : null;
    if (result && !result.byteEquivalent) {
      log.error('Push/Pull cancellation failed to restore the document baseline');
      eventBus.emit('ui:status', { message: 'Push/Pull cancel could not restore the original document' });
      return;
    }
    eventBus.emit('ui:status', { message: 'Push/Pull canceled - document unchanged' });
  }

  private commitPushPullToolSession(): boolean {
    const distance = this.pushPullGizmo?.getCurrentDelta() ?? 0;
    if (
      !this.pushPullGizmo?.isActive()
      || !Number.isFinite(distance)
      || Math.abs(distance) <= DEFAULT_TOLERANCE_POLICY.linear
    ) {
      eventBus.emit('ui:status', {
        message: 'Select a face and enter or drag a non-zero distance before committing Push/Pull',
      });
      return false;
    }

    const committed = this.pushPullGizmo.commit((faceRef, distance) =>
      this.commitPushPull(faceRef, distance)
    );
    if (!committed) {
      return false;
    }

    this.pushPullTransaction?.commit('Push/Pull');
    this.pushPullTransaction = null;
    this.closePushPullMode();
    return true;
  }

  private closePushPullMode(statusMessage?: string, restoreInitialFace = false): void {
    const selectionModeToRestore = this.pushPullPreviousSelectionMode ?? 'body';
    const initialFace = restoreInitialFace && this.pushPullInitialFace
      ? { ...this.pushPullInitialFace }
      : null;
    this.pushPullPreviousSelectionMode = null;
    this.pushPullInitialFace = null;
    this.pushPullMode = false;
    this.clearPushPullGeometryPreview();

    // Clear face highlight
    if (this.faceHighlight) {
      this.faceHighlight.clearHighlight();
    }

    // Hide gizmo
    if (this.pushPullGizmo) {
      this.pushPullGizmo.hide();
    }
    this.gizmos.releaseAll();

    // Remove event listener
    eventBus.off('face:selected', this.handlePushPullFaceSelected);

    this.selectedFace = null;
    this.setSelectionMode(selectionModeToRestore, false);
    if (selectionModeToRestore === 'face' && initialFace) {
      const body = this.rebuiltBodies.find((candidate) => candidate.id === initialFace.bodyId);
      if (body?.faces.has(initialFace.faceId)) {
        this.selectedFace = initialFace;
        this.selection = select(this.selection, initialFace.bodyId, false);
        this.featureTreePanel.selectFeature(this.getFeatureByBodyId(initialFace.bodyId)?.id ?? null);
        this.modelBrowser.select({ kind: 'body', id: initialFace.bodyId });
        this.ensureFaceHighlight().setSelectedFace(body, initialFace.faceId);
      }
    }
    if (statusMessage) {
      eventBus.emit('ui:status', { message: statusMessage });
    }
    log.info('Exited push/pull mode');
    this.refreshUiChrome();
  }

  /**
   * Handle face selection in push/pull mode.
   */
  private handlePushPullFaceSelected = ({ faceId, bodyId }: { faceId: string; bodyId: string }): void => {
    if (!this.pushPullMode) return;
    this.clearPushPullGeometryPreview();

    // Find the body
    const body = this.rebuiltBodies.find(b => b.id === bodyId);
    if (!body) {
      eventBus.emit('ui:status', { message: 'Body not found' });
      return;
    }

    // Find the face
    const face = body.faces.get(faceId);
    if (!face) {
      eventBus.emit('ui:status', { message: 'Face not found' });
      return;
    }

    // Get face plane for normal
    const plane = body.planes.get(face.planeId);
    if (!plane) {
      eventBus.emit('ui:status', { message: 'Face plane not found' });
      return;
    }

    // Store selected face
    this.selectedFace = { faceId, bodyId };

    // Highlight the face
    this.ensureFaceHighlight().setSelectedFace(body, faceId);

    // Calculate face center for gizmo position
    let center: [number, number, number] = [0, 0, 0];
    let count = 0;
    for (const edgeId of face.boundaryEdgeIds) {
      const edge = body.edges.get(edgeId);
      if (!edge) continue;
      for (const vertexId of edge.vertexIds) {
        const vertex = body.vertices.get(vertexId);
        if (vertex) {
          center[0] += vertex.position[0];
          center[1] += vertex.position[1];
          center[2] += vertex.position[2];
          count++;
        }
      }
    }
    if (count > 0) {
      center = [center[0] / count, center[1] / count, center[2] / count];
    }

    // Link the push/pull feature back to the feature that owns this body.
    const featureId = this.getFeatureByBodyId(bodyId)?.id ?? '';

    // Create face reference
    const faceRef = createFaceRef(faceId, bodyId, featureId);

    // Show push/pull gizmo
    if (this.pushPullGizmo) {
      this.pushPullGizmo.show(faceRef, center, plane.normal);
    }

    this.pushPullDistanceInput = '0';
    this.pushPullDistanceError = null;
    this.refreshContextTaskPanel();

    eventBus.emit('ui:status', {
      message: 'Face selected - enter a signed distance or drag, then press Enter to commit',
    });
  };

  private updatePushPullGeometryPreview(distance: number): boolean {
    this.clearPushPullGeometryPreview();
    if (
      !this.selectedFace
      || !Number.isFinite(distance)
      || Math.abs(distance) <= DEFAULT_TOLERANCE_POLICY.linear
    ) {
      return false;
    }

    const body = this.rebuiltBodies.find((candidate) => candidate.id === this.selectedFace?.bodyId);
    if (!body) return false;
    const previewBody = offsetFace(body, this.selectedFace.faceId, distance);
    if (!previewBody) return false;

    const cache = new RenderMeshCache();
    const previewObject = cache.getOrCreateMesh(previewBody);
    previewObject.name = `push-pull-preview:${body.id}`;
    previewObject.userData.isPushPullPreview = true;
    previewObject.traverse((child) => {
      if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = child instanceof THREE.Mesh ? 0.72 : 0.95;
        material.depthWrite = false;
        if (child instanceof THREE.LineSegments && 'color' in material) {
          (material as THREE.LineBasicMaterial).color.set(0xffd54a);
        }
      }
    });

    const sourceObject = this.sceneObjects.get(body.id) ?? null;
    if (sourceObject) {
      this.pushPullPreviewSource = { object: sourceObject, visible: sourceObject.visible };
      sourceObject.visible = false;
    }
    this.pushPullPreviewMeshCache = cache;
    this.pushPullPreviewObject = previewObject;
    this.viewport.add(previewObject);
    return true;
  }

  private clearPushPullGeometryPreview(): void {
    if (this.pushPullPreviewObject) {
      this.viewport.remove(this.pushPullPreviewObject);
      this.pushPullPreviewObject = null;
    }
    this.pushPullPreviewMeshCache?.dispose();
    this.pushPullPreviewMeshCache = null;
    if (this.pushPullPreviewSource) {
      this.pushPullPreviewSource.object.visible = this.pushPullPreviewSource.visible;
      this.pushPullPreviewSource = null;
    }
  }

  /**
   * Toggle grid snap.
   */
  private toggleGridSnap(): void {
    this.snapSettings = toggleSnap(this.snapSettings);
    this.moveVertexGizmo?.setSnapEnabled(this.snapSettings.enabled, this.snapSettings.gridStep);
    this.bodyRotateGizmo?.setSnapEnabled(this.snapSettings.enabled);
    this.instanceTransformGizmo?.setSnapEnabled(this.snapSettings.enabled);
    this.pushPullGizmo?.setSnapSettings(this.snapSettings);
    eventBus.emit('ui:status', {
      message: `Grid snap ${this.snapSettings.enabled ? 'enabled' : 'disabled'}`,
    });
    this.refreshUiChrome();
  }

  private resetAssemblyState(): void {
    this.components = [];
    this.componentInstances = [];
    this.constraints = [];
    this.activeComponentId = null;
    this.instanceBodyIdsByInstance.clear();
    this.instanceBodySourceIds.clear();
  }

  private loadAssemblyStateFromDocument(doc: Document): void {
    this.instanceBodyIdsByInstance.clear();
    this.instanceBodySourceIds.clear();
    this.components = Array.isArray(doc.components)
      ? doc.components.map((component) => ({
        ...component,
        featureIds: [...component.featureIds],
        bodyIds: [...component.bodyIds],
      }))
      : [];
    this.componentInstances = Array.isArray(doc.componentInstances)
      ? doc.componentInstances.map((instance) => ({
        ...instance,
        transform: [...instance.transform],
        lockedAxes: { ...instance.lockedAxes },
      }))
      : [];
    this.constraints = Array.isArray(doc.constraints)
      ? doc.constraints.map((constraint) => ({
        ...constraint,
        refA: { ...constraint.refA },
        refB: { ...constraint.refB },
      }))
      : [];
    this.activeComponentId = doc.activeComponentId ?? null;
  }

  private expandFeatureDeletionTargets(featureIds: string[]): string[] {
    const deletedIds = new Set(featureIds);

    for (const feature of this.features) {
      if (feature.type !== CREATE_COMPONENT_FEATURE_TYPE) {
        continue;
      }

      if (feature.refsIn.some((featureId) => deletedIds.has(featureId))) {
        deletedIds.add(feature.id);
      }
    }

    return Array.from(deletedIds);
  }

  private pruneAssemblyStateAfterFeatureDeletion(deletedFeatures: FeatureRecord[]): void {
    if (deletedFeatures.length === 0) {
      return;
    }

    const deletedFeatureIds = new Set(deletedFeatures.map((feature) => feature.id));
    const deletedComponentNames = new Set(
      deletedFeatures
        .filter((feature) => feature.type === CREATE_COMPONENT_FEATURE_TYPE)
        .map((feature) => {
          const params = feature.parameters as { name?: unknown };
          return typeof params.name === 'string' && params.name.length > 0
            ? params.name
            : feature.name;
        })
    );

    const removedComponentIds = new Set(
      this.components
        .filter((component) =>
          deletedComponentNames.has(component.name) ||
          component.featureIds.some((featureId) => deletedFeatureIds.has(featureId))
        )
        .map((component) => component.id)
    );

    if (removedComponentIds.size === 0) {
      return;
    }

    this.components = this.components.filter((component) => !removedComponentIds.has(component.id));

    const removedInstanceIds = new Set(
      this.componentInstances
        .filter((instance) => removedComponentIds.has(instance.componentId))
        .map((instance) => instance.id)
    );

    this.componentInstances = this.componentInstances.filter(
      (instance) => !removedComponentIds.has(instance.componentId)
    );
    this.constraints = this.constraints.filter(
      (constraint) =>
        !removedInstanceIds.has(constraint.refA.instanceId) &&
        !removedInstanceIds.has(constraint.refB.instanceId)
    );

    if (this.activeComponentId && removedComponentIds.has(this.activeComponentId)) {
      this.activeComponentId = null;
    }
  }

  /**
   * Commit a push/pull operation.
   */
  private commitPushPull(faceRef: FaceRef, distance: number): boolean {
    const baselineDocument = this.buildDocumentSnapshot();
    const baselineFeatures = cloneSnapshot(this.features);
    const currentPath = this.documentManager.currentFilePath;
    this.clearPushPullGeometryPreview();

    // Create offset face feature
    const feature = createOffsetFaceFeature(faceRef, distance, `Push/Pull ${this.features.length + 1}`);
    this.features.push(feature);

    // Rebuild without history. The history entry is created only after success.
    const result = this.rebuildAll('Preview Push/Pull Commit', { trackHistory: false });

    if (!result.ok) {
      const failureMessage = result.diagnostics[0]?.message ?? 'Push/Pull rebuild failed';

      // Restore both feature records and the exact pre-commit document. The failed
      // rebuild never receives a history entry, so the undo cursor is unchanged.
      this.features = baselineFeatures;
      const restoreResult = this.rebuildAll('Restore After Failed Push/Pull', { trackHistory: false });
      this.features = cloneSnapshot(baselineFeatures);
      this.documentManager.load(cloneSnapshot(baselineDocument), currentPath ?? undefined);
      eventBus.emit('document:loaded', { features: this.features });
      this.refreshDocumentDirtyState();

      const restoredBytes = JSON.stringify(this.buildDocumentSnapshot());
      const baselineBytes = JSON.stringify(baselineDocument);
      if (!restoreResult.ok || restoredBytes !== baselineBytes) {
        log.error('Push/Pull rollback could not reproduce the document baseline', {
          restoreDiagnostics: restoreResult.diagnostics,
        });
        eventBus.emit('ui:status', {
          message: 'Push/Pull failed and document recovery could not be verified',
        });
      } else {
        eventBus.emit('ui:status', {
          message: `Push/Pull blocked: ${failureMessage}. Adjust the preview or press Escape.`,
        });
      }
      this.refreshUiChrome();
      return false;
    }

    this.commitDocumentHistory('Push/Pull');
    this.featureTreePanel.selectFeature(feature.id);
    eventBus.emit('ui:status', { message: `Created ${feature.name} with distance ${distance.toFixed(3)}` });
    return true;
  }

  private handleVertexSelectionClick(x: number, y: number, width: number, height: number): void {
    const result = this.picking.pickVertex(
      x,
      y,
      width,
      height,
      this.viewport.getCameraControls().camera,
      this.getPickableBodies()
    );

    if (!result?.vertexId || !result.bodyId || !result.featureId) {
      this.clearSubObjectSelectionState();
      this.selection = clearSelection(this.selection);
      this.updateSelectionVisuals();
      this.featureTreePanel.selectFeature(null);
      this.modelBrowser.select(null);
      this._statusBar.setCenterMessage('');
      this.refreshUiChrome();
      return;
    }

    this.selectedVertexRef = createVertexRef(
      result.featureId,
      result.bodyId,
      result.vertexId
    );
    this.selectedFace = null;
    this.selectedEdgeRef = null;
    this.selection = select(this.selection, result.bodyId, false);
    this.updateSelectionVisuals();
    this.featureTreePanel.selectFeature(result.featureId);
    this.modelBrowser.select({ kind: 'body', id: result.bodyId });
    if (this.placementSession && this.placementReferenceRequest) {
      this.placementSession.selectDatum(
        createVertexPlacementRef(result.featureId, result.bodyId, result.vertexId)
      );
      this.refreshUiChrome();
      return;
    }
    if (this.measurementState?.expectedReferenceKind === 'vertex') {
      this.consumeMeasurementReference(result.bodyId, 'vertex', result.vertexId);
      this.refreshUiChrome();
      return;
    }
    if (this.drawingRepairDraft?.expectedKind === 'vertex') {
      this.commitDrawingReferenceRepair({
        kind: 'vertex', featureId: result.featureId, bodyId: result.bodyId, vertexId: result.vertexId,
      });
      return;
    }
    const ownerName = this.getFeatureByBodyId(result.bodyId)?.name ?? 'Body';
    this._statusBar.setCenterMessage(`${ownerName} | Vertex selected`);
    eventBus.emit('ui:status', {
      message: `${ownerName} vertex selected - choose Move Vertex in the selection bar`,
    });
    this.refreshUiChrome();
  }

  private handleEdgeSelectionClick(x: number, y: number, width: number, height: number): void {
    const result = this.picking.pickEdge(
      x,
      y,
      width,
      height,
      this.viewport.getCameraControls().camera,
      this.getPickableBodies()
    );

    if (!result?.edgeId || !result.bodyId || !result.featureId) {
      this.clearSubObjectSelectionState();
      this.selection = clearSelection(this.selection);
      this.updateSelectionVisuals();
      this.featureTreePanel.selectFeature(null);
      this.modelBrowser.select(null);
      this._statusBar.setCenterMessage('');
      this.refreshUiChrome();
      return;
    }

    this.selectedEdgeRef = {
      featureId: result.featureId,
      bodyId: result.bodyId,
      edgeId: result.edgeId,
    };
    this.selectedFace = null;
    this.selectedVertexRef = null;
    this.selection = select(this.selection, result.bodyId, false);
    this.updateSelectionVisuals();
    const body = this.rebuiltBodies.find((candidate) => candidate.id === result.bodyId);
    if (body) {
      this.ensureEdgeSelectionOverlay().setSelectedEdge(body, result.edgeId);
    }
    this.featureTreePanel.selectFeature(result.featureId);
    this.modelBrowser.select({ kind: 'body', id: result.bodyId });
    if (this.axisAnglePlacementDraft && !this.axisAnglePlacementDraft.axis) {
      this.axisAnglePlacementDraft.axis = createEdgePlacementRef(
        result.featureId,
        result.bodyId,
        result.edgeId
      );
      this.updateAxisAnglePreview();
      this.refreshUiChrome();
      return;
    }
    if (this.placementSession && this.placementReferenceRequest) {
      this.placementSession.selectDatum(
        createEdgePointPlacementRef(result.featureId, result.bodyId, result.edgeId, 0.5)
      );
      this.refreshUiChrome();
      return;
    }
    if (this.measurementState?.expectedReferenceKind === 'edge') {
      this.consumeMeasurementReference(result.bodyId, 'edge', result.edgeId);
      this.refreshUiChrome();
      return;
    }
    if (this.drawingRepairDraft?.expectedKind === 'edge') {
      this.commitDrawingReferenceRepair({
        kind: 'edge', featureId: result.featureId, bodyId: result.bodyId, edgeId: result.edgeId,
      });
      return;
    }
    if (
      this.toolSessions.activeSession?.kind === 'wood-joint'
      && this.woodJointDraft?.kind === 'chamfer'
    ) {
      const captured = this.captureWoodJointMember({
        bodyRef: createBodyRef(result.bodyId, result.featureId),
        datumRef: createEdgePlacementRef(result.featureId, result.bodyId, result.edgeId),
      });
      if (captured) {
        this.refreshUiChrome();
        return;
      }
    }
    const ownerName = this.getFeatureByBodyId(result.bodyId)?.name ?? 'Body';
    this._statusBar.setCenterMessage(`${ownerName} | Edge selected`);
    eventBus.emit('ui:status', {
      message: `${ownerName} edge selected - choose Rotate about edge or another compatible action`,
    });
    this.refreshUiChrome();
  }

  private addMoveVertexFeature(): void {
    if (!this.selectedVertexRef) {
      this.setSelectionMode('vertex');
      eventBus.emit('ui:status', {
        message: 'Click a vertex to reveal drag handles and start a guarded edit',
      });
      return;
    }

    const feature = this.ensureMoveVertexFeature(this.selectedVertexRef);
    if (!feature) {
      return;
    }

    this.featureTreePanel.selectFeature(feature.id);
    eventBus.emit('ui:status', {
      message: `Editing ${feature.name}. Drag the viewport handles or fine-tune dX/dY/dZ in Properties.`,
    });
    this.refreshUiChrome();
  }

  private setSelectionMode(mode: SubObjectType, announce = true): void {
    const changed = this.selectionMode !== mode;
    this.selectionMode = mode;
    if (mode !== 'body') {
      this.setHoveredBody(null);
    }
    this.setHoveredVertex(null);
    this.clearSubObjectSelectionState();

    if (mode !== 'face' && this.faceSelectionMode) {
      this.faceSelectionMode = false;
      eventBus.emit('face:mode:changed', { isActive: false });
    }
    if (mode !== 'face' && this.pushPullMode) {
      this.exitPushPullMode();
    }
    if (mode === 'face') {
      this.ensureFaceHighlight();
    } else {
      this.faceHighlight?.clearHighlight();
    }
    if (mode === 'edge') {
      this.ensureEdgeSelectionOverlay();
    } else {
      this.edgeSelectionOverlay?.clear();
    }

    if (this.subObjectSelectionPanel.getMode() !== mode) {
      this.subObjectSelectionPanel.setMode(mode);
    }

    if (announce && changed) {
      eventBus.emit('ui:status', { message: this.getSelectionModeMessage(mode) });
    }

    this.updateSelectionVisuals();
    this.refreshUiChrome();
  }

  private getSelectionModeMessage(mode: SubObjectType): string {
    switch (mode) {
      case 'face':
        return this.rebuiltBodies.length > 0
          ? 'Face selection mode - click a face to inspect it, or press F to sketch on one'
          : 'Face selection mode - create geometry first to pick faces';
      case 'edge':
        return this.rebuiltBodies.length > 0
          ? 'Edge selection mode - hover to preselect and click an edge to select it'
          : 'Edge selection mode - create geometry first to pick edges';
      case 'vertex':
        return this.rebuiltBodies.length > 0
          ? 'Vertex selection mode - visible markers are selectable; hover to preselect and click to select'
          : 'Vertex selection mode - create geometry first to pick vertices';
      case 'body':
      default:
        return 'Body selection mode - click geometry to select bodies and their features';
    }
  }

  private clearSubObjectSelectionState(): void {
    this.selectedFace = null;
    this.selectedVertexRef = null;
    this.selectedEdgeRef = null;
    this.faceHighlight?.clearSelection();
    this.edgeSelectionOverlay?.clearSelection();
  }

  private ensureEdgeSelectionOverlay(): EdgeSelectionOverlay {
    if (!this.edgeSelectionOverlay) {
      this.edgeSelectionOverlay = new EdgeSelectionOverlay();
      this.edgeSelectionOverlay.attachToScene(this.viewport.getScene());
    }
    return this.edgeSelectionOverlay;
  }

  private getPickableBodies(): Map<string, { body: BRepBody; featureId: string }> {
    const bodies = new Map<string, { body: BRepBody; featureId: string }>();

    for (const body of this.rebuiltBodies) {
      if (!this.isBodyVisible(body.id) || this.isBodyLocked(body.id)) {
        continue;
      }
      const featureId = this.getFeatureByBodyId(body.id)?.id;
      if (!featureId) {
        continue;
      }

      bodies.set(body.id, { body, featureId });
    }

    return bodies;
  }

  private getPickableSceneObjects(): THREE.Object3D[] {
    return [...this.sceneObjects]
      .filter(([bodyId, object]) => object.visible && this.isBodyVisible(bodyId) && !this.isBodyLocked(bodyId))
      .map(([, object]) => object);
  }

  private buildDocumentSnapshot(): Document {
    const doc = this.documentManager.getDocument();
    return cloneSnapshot({
      ...doc,
      metadata: { ...doc.metadata },
      config: {
        ...doc.config,
        gridSpacing: { ...doc.config.gridSpacing },
      },
      bodies: doc.bodies.map((body) => ({
        ...body,
        transform: [...body.transform],
      })),
      features: cloneSnapshot(this.features) as unknown as Document['features'],
      components: this.components.map((component) => ({
        ...component,
        featureIds: [...component.featureIds],
        bodyIds: [...component.bodyIds],
      })),
      componentInstances: this.componentInstances.map((instance) => ({
        ...instance,
        transform: [...instance.transform],
        lockedAxes: { ...instance.lockedAxes },
      })),
      constraints: this.constraints.map((constraint) => ({
        ...constraint,
        refA: { ...constraint.refA },
        refB: { ...constraint.refB },
      })),
      activeComponentId: this.activeComponentId,
      bodyPresentations: Object.fromEntries(
        [...this.bodyPresentations.entries()].map(([id, presentation]) => [
          id,
          { ...presentation },
        ])
      ),
    });
  }

  private buildHistorySnapshot(): AppHistorySnapshot {
    return {
      document: this.buildDocumentSnapshot(),
      selection: this.buildHistorySelectionSnapshot(),
    };
  }

  private buildHistorySelectionSnapshot(): HistorySelectionSnapshot {
    return {
      selectedBodyIds: [...this.selection.selectedIds],
      activeBodyId: this.selection.activeId,
      selectedFeatureId: this.featureTreePanel.getSelectedFeature()?.id ?? null,
      selectionMode: this.selectionMode,
      selectedFace: this.selectedFace ? { ...this.selectedFace } : null,
      selectedVertexRef: this.selectedVertexRef ? { ...this.selectedVertexRef } : null,
      selectedEdgeRef: this.selectedEdgeRef ? { ...this.selectedEdgeRef } : null,
    };
  }

  private refreshPresentHistorySelection(): void {
    const present = this.undoRedo.getPresent();
    if (!present) return;
    this.undoRedo.replacePresent({
      document: present.document,
      selection: this.buildHistorySelectionSnapshot(),
    });
  }

  private restoreHistorySelection(snapshot: HistorySelectionSnapshot | null): void {
    this.clearSubObjectSelectionState();
    this.selection = clearSelection(this.selection);

    const mode = snapshot?.selectionMode;
    this.selectionMode = mode === 'face' || mode === 'edge' || mode === 'vertex' ? mode : 'body';
    if (this.subObjectSelectionPanel.getMode() !== this.selectionMode) {
      this.subObjectSelectionPanel.setMode(this.selectionMode);
    }

    const selectedFeatureId = snapshot?.selectedFeatureId;
    const selectedFeature = selectedFeatureId ? this.getFeatureById(selectedFeatureId) : null;
    const featureHasLockedOutput = selectedFeature?.refsOut.some(
      (bodyId) => this.sceneObjects.has(bodyId) && this.isBodyLocked(bodyId)
    ) ?? false;
    this.featureTreePanel.selectFeature(selectedFeature && !featureHasLockedOutput
      ? selectedFeature.id
      : null);

    const selectedBodyIds = snapshot?.selectedBodyIds.filter(
      (id) => this.sceneObjects.has(id) && this.isBodyVisible(id) && !this.isBodyLocked(id)
    ) ?? [];
    if (selectedBodyIds.length > 0) {
      this.selection = {
        selectedIds: new Set(selectedBodyIds),
        activeId: snapshot?.activeBodyId && selectedBodyIds.includes(snapshot.activeBodyId)
          ? snapshot.activeBodyId
          : selectedBodyIds[selectedBodyIds.length - 1] ?? null,
      };
    }

    const face = snapshot?.selectedFace;
    const faceBody = face ? this.rebuiltBodies.find((body) => body.id === face.bodyId) : null;
    if (face && faceBody?.faces.has(face.faceId)) this.selectedFace = { ...face };

    const vertex = snapshot?.selectedVertexRef;
    const vertexBody = vertex ? this.rebuiltBodies.find((body) => body.id === vertex.bodyId) : null;
    if (vertex && this.getFeatureById(vertex.featureId) && vertexBody?.vertices.has(vertex.vertexId)) {
      this.selectedVertexRef = { ...vertex };
    }

    const edge = snapshot?.selectedEdgeRef;
    const edgeBody = edge ? this.rebuiltBodies.find((body) => body.id === edge.bodyId) : null;
    if (edge && this.getFeatureById(edge.featureId) && edgeBody?.edges.has(edge.edgeId)) {
      this.selectedEdgeRef = { ...edge };
    }

    this.updateSelectionVisuals();
  }

  private commitDocumentHistory(label: string): void {
    const snapshot = this.buildHistorySnapshot();
    const result = this.undoRedo.commit(snapshot, label);
    if (result.committed) {
      this.autosaveManager.schedule(snapshot.document, {
        filePath: this.documentManager.currentFilePath,
        reason: label,
      });
    }
    this.refreshDocumentDirtyState();
  }

  private seedDocumentHistory(label: string): void {
    const snapshot = this.buildHistorySnapshot();
    this.undoRedo.seed(snapshot, label);
    this.undoRedo.markClean();
    this.autosaveManager.cancelPending();
    this.refreshDocumentDirtyState();
  }

  private refreshDocumentDirtyState(): void {
    eventBus.emit('document:dirty', {
      isDirty: this.undoRedo.isDirty(),
    });
  }

  private undoLastChange(): void {
    this.cancelActiveInteraction();
    this.refreshPresentHistorySelection();
    const result = this.undoRedo.undo();
    if (!result) {
      eventBus.emit('ui:status', { message: 'Nothing to undo' });
      return;
    }

    this.loadDocument(result.snapshot.document, {
      path: this.documentManager.currentFilePath,
      seedHistory: false,
      recordRecent: false,
      restoreSelection: result.snapshot.selection,
    });
    this.autosaveManager.schedule(result.snapshot.document, {
      filePath: this.documentManager.currentFilePath,
      reason: 'undo',
    });
    eventBus.emit('ui:status', { message: `Undo: ${result.entry.label}` });
  }

  private redoLastChange(): void {
    this.cancelActiveInteraction();
    this.refreshPresentHistorySelection();
    const result = this.undoRedo.redo();
    if (!result) {
      eventBus.emit('ui:status', { message: 'Nothing to redo' });
      return;
    }

    this.loadDocument(result.snapshot.document, {
      path: this.documentManager.currentFilePath,
      seedHistory: false,
      recordRecent: false,
      restoreSelection: result.snapshot.selection,
    });
    this.autosaveManager.schedule(result.snapshot.document, {
      filePath: this.documentManager.currentFilePath,
      reason: 'redo',
    });
    eventBus.emit('ui:status', { message: `Redo: ${result.entry.label}` });
  }

  private openRecentFile(entry: RecentFileEntry): void {
    const restored = this.autosaveManager.restoreLatestByPath(entry.path);
    if (restored) {
      this.loadDocument(restored.document, {
        path: entry.path,
        seedHistory: true,
        recordRecent: true,
      });
      this.undoRedo.markDirty();
      this.refreshDocumentDirtyState();
      eventBus.emit('ui:status', {
        message: `Reopened ${entry.name} from the latest autosaved snapshot`,
      });
      return;
    }

    eventBus.emit('ui:status', {
      message: `No local snapshot found for ${entry.name} - choose the file again to reopen it.`,
    });
    void this.openDocument();
  }

  private clearRecentFiles(): void {
    this.recentFilesStore.clear();
    this.refreshUiChrome();
    eventBus.emit('ui:status', { message: 'Cleared recent files list' });
  }

  dispose(): void {
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this.unsubscribeToolSessionEnd?.();
    this.unsubscribeToolSessionEnd = null;
    this.toolSessions.cancelActive();
    this.autosaveManager.dispose();
    this.vertexSelectionOverlay.dispose();
    this.edgeSelectionOverlay?.dispose();
    this.viewport.dispose();
    this.picking.dispose();
    this.meshCache.dispose();
    this.grainDirectionOverlay.dispose();
    this.subObjectSelectionPanel.dispose();
    this.featureTreePanel.dispose();
    this.propertyInspector.dispose();
    this.diagnosticsPanel.dispose();
    this.sketchModeController.dispose();
    this.sketchOverlay.dispose();
    if (this.faceHighlight) {
      this.faceHighlight.dispose();
    }
    if (this.pushPullGizmo) {
      this.pushPullGizmo.dispose();
    }
    if (this.moveVertexGizmo) {
      this.moveVertexGizmo.dispose();
    }
    if (this.bodyRotateGizmo) {
      this.bodyRotateGizmo.dispose();
    }
    this.translationTriadGizmo.dispose();
    this.keyboardShortcutsPanel.dispose();
    this.commandToolbar.dispose();
    this.commandPalette.dispose();
    this.contextTaskPanel.dispose();
    this.woodworkingPanel.dispose();
    this.modelBrowser.dispose();
    this.viewCube.dispose();
    this.viewportSelectionContext.dispose();
    this.welcomeOverlay.dispose();
    this.recentFilesPanel.dispose();
    this.vertexEditPrompt.dispose();
    this.sketchSetupPanel.dispose();
    // Assembly components (Milestone 06)
    if (this.assemblyPanel) {
      this.assemblyPanel.dispose();
    }
    if (this.constraintCreationController) {
      this.constraintCreationController.dispose();
    }
    if (this.instanceTransformGizmo) {
      this.instanceTransformGizmo.dispose();
    }
    if (this.constraintVisualization) {
      this.constraintVisualization.dispose();
    }
    log.info('App disposed');
  }

  // Exposed for potential future use
  getStatusBar(): StatusBar {
    return this._statusBar;
  }

  /** Stable browser-test hook for transform preview regressions and active-camera checks. */
  getInteractionDiagnostics(): Readonly<{
    rebuilds: number;
    remeshedBodies: number;
    transformPreviewUpdates: number;
    activeCameraUuid: string;
    projection: 'perspective' | 'orthographic';
  }> {
    const controls = this.viewport.getCameraControls();
    return {
      ...this.interactionDiagnostics,
      activeCameraUuid: controls.camera.uuid,
      projection: controls.getProjection(),
    };
  }
}
