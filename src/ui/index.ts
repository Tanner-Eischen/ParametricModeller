export { Layout, type LayoutOptions, type SidebarSide } from './Layout';
export {
  CollapsiblePanelSection,
  type CollapsiblePanelSectionOptions,
} from './CollapsiblePanelSection';
export { Panel, type PanelOptions } from './Panel';
export { StatusBar } from './StatusBar';
export { FeatureTreePanel, type FeatureTreePanelOptions } from './FeatureTreePanel';
export { PropertyInspector, type PropertyInspectorOptions } from './PropertyInspector';
export { DiagnosticsPanel, type DiagnosticsPanelOptions } from './DiagnosticsPanel';

export {
  COMMAND_DEFINITIONS,
  MOUSE_HELP,
  SHORTCUT_CATEGORY_ORDER,
  TOOLBAR_GROUP_ORDER,
  getCommandDefinition,
  getShortcutHelpEntries,
  type AppCommandDefinition,
  type AppCommandId,
  type CommandGroup,
  type MouseHelpEntry,
  type ShortcutCategory,
  type ShortcutHelpEntry,
} from './CommandCatalog';
export {
  CommandToolbar,
  type CommandToolbarAction,
  type CommandToolbarOptions,
} from './CommandToolbar';
export {
  WelcomeOverlay,
  type WelcomeOverlayAction,
  type WelcomeOverlayOptions,
} from './WelcomeOverlay';
export {
  RecentFilesPanel,
  createRecentFilesPanel,
  type RecentFilesPanelOptions,
} from './RecentFilesPanel';
export {
  SketchSetupPanel,
  createSketchSetupPanel,
  type SketchSetupPanelOptions,
  type SketchSetupPanelState,
  type SketchPlaneSelection,
  type SketchToolSelection,
  type SketchConstraintSelection,
  type SketchProfileDiagnostic,
  type SketchNumericSubmission,
} from './SketchSetupPanel';

// Sketch Mode (Milestone 02)
export {
  SketchModeController,
  createSketchModeController,
} from './SketchModeController';

// Sketch Overlay (Milestone 02 UX)
export {
  SketchOverlay,
  type SketchOverlayOptions,
  type SketchEditableHandle,
  type SketchBlankPick,
  type SketchSegmentPick,
  type SketchOperationPreview,
  type SketchPreviewKind,
  type SketchDisplayUnit,
  type NormalizedSketchOverlayContext,
} from './SketchOverlay';

// Snapping utilities (Milestone 03)
export {
  snapToGrid,
  parseNumericInput,
  formatDistance,
  createSnapSettings,
  toggleSnap,
  setAxisLock,
  type SnapSettings,
  defaultSnapSettings,
} from './Snapping';

// Face Highlight (Milestone 03)
export {
  FaceHighlight,
  createFaceHighlight,
  type FaceHighlightOptions,
} from './FaceHighlight';
export { EdgeSelectionOverlay, type EdgeSelectionOverlayOptions } from './EdgeSelectionOverlay';
export {
  VertexSelectionOverlay,
  type VertexMarkerState,
  type VertexSelectionOverlayOptions,
  type VertexSelectionTarget,
} from './VertexSelectionOverlay';

// Push/Pull Gizmo (Milestone 03)
export {
  PushPullGizmo,
  createPushPullGizmo,
  type PushPullGizmoOptions,
} from './PushPullGizmo';

// Keyboard Shortcuts Panel
export {
  KeyboardShortcutsPanel,
  createKeyboardShortcutsPanel,
  type KeyboardShortcutsPanelOptions,
} from './KeyboardShortcutsPanel';

// Assembly Panel (Milestone 06)
export {
  AssemblyPanel,
  type AssemblyPanelOptions,
} from './AssemblyPanel';

// Constraint Creation Controller (Milestone 06)
export {
  ConstraintCreationController,
  type ConstraintCreationMode,
  type ConstraintCreationControllerOptions,
} from './ConstraintCreationController';

// Instance Transform Gizmo (Milestone 06)
export {
  InstanceTransformGizmo,
  type InstanceTransformGizmoOptions,
  type InstanceTransformEditSession,
} from './InstanceTransformGizmo';

// Constraint Visualization (Milestone 06)
export {
  ConstraintVisualization,
  type ConstraintVisualizationOptions,
} from './ConstraintVisualization';

// Sub-object Selection Panel (Milestone 07)
export {
  SubObjectSelectionPanel,
  createSubObjectSelectionPanel,
  type SubObjectSelectionPanelOptions,
} from './SubObjectSelectionPanel';
export {
  MoveVertexGizmo,
  type MoveVertexEditSession,
  type MoveVertexGizmoOptions,
} from './MoveVertexGizmo';
export {
  BodyRotateGizmo,
  type BodyRotateEditSession,
  type BodyRotateGizmoOptions,
} from './BodyRotateGizmo';
export {
  TranslationTriadGizmo,
  type TranslationAxis,
  type TranslationMode,
  type TranslationTriadEditSession,
  type TranslationNumericResult,
} from './TranslationTriadGizmo';
export {
  MoveCopyToolSession,
  createCopyToolSession,
  type MoveCopyToolSessionOptions,
} from './MoveCopyToolSession';
export {
  PlacementToolSession,
  MateToolSession,
  createPlacementToolSession,
  createMateToolSession,
  type PlacementToolKind,
  type PlacementToolStage,
  type PlacementDatumKind,
  type PlacementReferenceRequest,
  type PlacementAlignOptions,
  type PlacementPreview,
  type PlacementCommit,
  type DocumentTransactionAdapter,
  type PlacementToolSessionOptions,
  type MateToolStage,
  type MateReferenceRequest,
  type MatePreview,
  type MateToolSessionOptions,
} from './PlacementToolSession';
export {
  LinearPatternPreviewManipulator,
  MirrorPreviewManipulator,
  type LinearPatternPreviewOptions,
  type MirrorPreviewOptions,
} from './PatternMirrorManipulators';
export {
  VertexEditPrompt,
  type VertexEditActiveState,
  type VertexEditPromptOptions,
  type VertexEditSelectionState,
} from './VertexEditPrompt';
export { ViewCube, type ViewCubeOptions } from './ViewCube';
export {
  ModelBrowserPanel,
  type ModelBrowserData,
  type ModelBrowserTarget,
  type ModelBrowserRenameRequest,
  type ModelBrowserSuppressionRequest,
  type ModelBrowserVisibilityRequest,
  type ModelBrowserLockRequest,
  type ModelBrowserDependenciesRequest,
  type ModelBrowserRollbackRequest,
} from './ModelBrowserPanel';
export {
  CommandPalette,
  rankCommandDefinitions,
  type CommandPaletteAction,
  type CommandPaletteOptions,
} from './CommandPalette';
export {
  ContextTaskPanel,
  type ContextTaskPanelState,
  type ContextTaskFieldDescriptor,
  type ContextTaskFieldValue,
  type ContextTaskActionDescriptor,
} from './ContextTaskPanel';
export {
  WoodworkingPanel,
  createDefaultWoodworkingMetadata,
  type WoodworkingAxis,
  type WoodworkingMetadataDraft,
  type WoodworkingMeasurementView,
  type WoodworkingPanelState,
  type WoodworkingPanelOptions,
} from './WoodworkingPanel';
export {
  ViewportSelectionContext,
  createViewportSelectionContext,
  type ViewportSelectionContextOptions,
  type ViewportSelectionContextState,
  type ViewportSelectionDisplay,
  type ViewportSelectionAction,
} from './ViewportSelectionContext';
export {
  ViewportContextMenu,
  createViewportContextMenu,
  type ViewportContextMenuOptions,
  type ViewportContextMenuState,
  type ContextMenuItem,
} from './ViewportContextMenu';
export {
  CutListPreviewPanel,
  buildCutListPreviewModel,
  type CutListAllowanceDimension,
  type CutListPreviewIssue,
  type CutListPreviewModel,
  type CutListPreviewModelOptions,
  type CutListPreviewPanelOptions,
  type CutListPreviewRow,
} from './CutListPreviewPanel';
export {
  createEmptyFaceSketchFeature,
  getDefaultCutFlipForSketch,
  resolveExplicitBodyTarget,
  resolveExplicitSketchTarget,
  type ExplicitBodyTarget,
  type ExplicitBodyTargetOptions,
  type FaceSketchTarget,
} from './ModelingCommandTargets';
export {
  createWoodJointEditorPresenter,
  applyWoodJointEditorValue,
  woodJointKindLabel,
  type WoodJointEditorSection,
  type WoodJointEditorFieldDescriptor,
  type WoodJointEditorDiagnostic,
  type WoodJointEditorPresenter,
  type WoodJointEditorPresenterOptions,
  type WoodJointEditorUpdateResult,
} from './WoodJointEditor';
export {
  createTutorialController,
  getTutorialSteps,
  getCurrentStep,
  isTutorialComplete,
  getTutorialProgress,
  createTutorialState,
  markStepCompleted,
  type TutorialStep,
  type TutorialState,
  type TutorialOptions,
} from './Tutorial';
