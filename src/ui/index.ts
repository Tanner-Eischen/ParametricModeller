export { Layout, type LayoutOptions } from './Layout';
export { Panel, type PanelOptions } from './Panel';
export { StatusBar } from './StatusBar';
export { FeatureTreePanel, type FeatureTreePanelOptions } from './FeatureTreePanel';
export { PropertyInspector, type PropertyInspectorOptions } from './PropertyInspector';
export { DiagnosticsPanel, type DiagnosticsPanelOptions } from './DiagnosticsPanel';

// Sketch Mode (Milestone 02)
export {
  SketchModeController,
  createSketchModeController,
} from './SketchModeController';

// Sketch Overlay (Milestone 02 UX)
export { SketchOverlay, type SketchOverlayOptions } from './SketchOverlay';

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
