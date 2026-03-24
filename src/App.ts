import * as THREE from 'three';
import { eventBus } from './core';
import { createSelectionState, select, clearSelection, type SelectionState } from './core/selection';
import { createModuleLogger } from './core/logger';
import { Viewport, Picking, RenderMeshCache } from './rendering';
import { Layout, StatusBar, FeatureTreePanel, PropertyInspector, DiagnosticsPanel, SketchModeController, SketchOverlay, FaceHighlight, PushPullGizmo, KeyboardShortcutsPanel, AssemblyPanel, ConstraintCreationController, InstanceTransformGizmo, ConstraintVisualization, toggleSnap, type SnapSettings, defaultSnapSettings } from './ui';
import { DocumentManager, saveToFile, loadFromFile } from './persistence';
import type { Document, Body } from './types';
import type { Body as BRepBody } from './geometry';
import { getConstructionPlaneFromRef } from './geometry';
import {
  createRebuildEngine,
  rebuildBox,
  createBoxFeature,
  rebuildSketch,
  createSketchFeature,
  rebuildExtrude,
  createExtrudeFeature,
  rebuildOffsetFace,
  createOffsetFaceFeature,
  createFaceRef,
  rebuildExtrudeCut,
  createExtrudeCutFeature,
  createBodyRef,
  rebuildLinearPattern,
  createLinearPatternFeature,
  rebuildMirror,
  createMirrorFeature,
  rebuildCreateComponent,
  createComponentFeature,
  type FeatureRecord,
  type Diagnostic,
} from './features';
import {
  type Component,
  type ComponentInstance,
  type MateConstraint,
  createComponent,
  createComponentInstance,
  createDefaultAssemblyData,
  CREATE_COMPONENT_FEATURE_TYPE,
} from './assembly';
import { BOX_FEATURE_TYPE } from './features/primitives';
import { SKETCH_FEATURE_TYPE } from './features/sketch';
import { EXTRUDE_FEATURE_TYPE } from './features/extrude';
import { OFFSET_FACE_FEATURE_TYPE, type FaceRef } from './features/offsetFace';
import { EXTRUDE_CUT_FEATURE_TYPE } from './features/cut';
import { LINEAR_PATTERN_FEATURE_TYPE, MIRROR_FEATURE_TYPE, DUPLICATE_FEATURE_TYPE, rebuildDuplicate, createDuplicateFeature } from './features/pattern';
import { createWorldPlaneRef, createFacePlaneRef, createRectangleEntity, type Sketch, type SketchEntity, type SketchDimension, type PlaneRef } from './sketch';

const log = createModuleLogger('App');

export class App {
  private viewport: Viewport;
  private layout: Layout;
  private _statusBar: StatusBar;
  private documentManager: DocumentManager;
  private picking: Picking;
  private selection: SelectionState;
  private sceneObjects: Map<string, THREE.Object3D> = new Map();
  private meshCache: RenderMeshCache;

  // Feature system
  private features: FeatureRecord[] = [];
  private rebuildEngine = createRebuildEngine();
  private featureTreePanel: FeatureTreePanel;
  private propertyInspector: PropertyInspector;
  private diagnosticsPanel: DiagnosticsPanel;
  private sketchModeController: SketchModeController;
  private sketchOverlay: SketchOverlay;
  private rebuiltBodies: BRepBody[] = []; // Store rebuilt bodies for face lookup

  // Face selection mode
  private faceSelectionMode = false;
  private selectedFace: { faceId: string; bodyId: string } | null = null;

  // Push/Pull mode (Milestone 03)
  private pushPullMode = false;
  private faceHighlight: FaceHighlight | null = null;
  private pushPullGizmo: PushPullGizmo | null = null;
  private snapSettings: SnapSettings = { ...defaultSnapSettings };
  private keyboardShortcutsPanel: KeyboardShortcutsPanel;

  // Assembly state (Milestone 06)
  private components: Component[] = [];
  private componentInstances: ComponentInstance[] = [];
  private constraints: MateConstraint[] = [];
  private activeComponentId: string | null = null;
  private assemblyPanel: AssemblyPanel | null = null;
  private constraintCreationController: ConstraintCreationController | null = null;
  private instanceTransformGizmo: InstanceTransformGizmo | null = null;
  private constraintVisualization: ConstraintVisualization | null = null;

  constructor(container: HTMLElement) {
    log.info('Initializing Parametric Modeler');

    // Initialize layout
    this.layout = new Layout(container);

    // Initialize status bar
    this._statusBar = new StatusBar(this.layout.getStatusBar());

    // Initialize viewport
    this.viewport = new Viewport({
      container: this.layout.getViewport(),
      antialias: true,
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
    this.rebuildEngine.registerHandler(EXTRUDE_FEATURE_TYPE, rebuildExtrude);
    this.rebuildEngine.registerHandler(OFFSET_FACE_FEATURE_TYPE, rebuildOffsetFace);
    this.rebuildEngine.registerHandler(EXTRUDE_CUT_FEATURE_TYPE, rebuildExtrudeCut);
    this.rebuildEngine.registerHandler(LINEAR_PATTERN_FEATURE_TYPE, rebuildLinearPattern);
    this.rebuildEngine.registerHandler(MIRROR_FEATURE_TYPE, rebuildMirror);
    this.rebuildEngine.registerHandler(DUPLICATE_FEATURE_TYPE, rebuildDuplicate);
    this.rebuildEngine.registerHandler(CREATE_COMPONENT_FEATURE_TYPE, rebuildCreateComponent);

    // Initialize UI panels
    this.featureTreePanel = new FeatureTreePanel({
      container: this.createPanelContainer(this.layout.getPanelLeft(), 'Features'),
    });

    this.propertyInspector = new PropertyInspector({
      container: this.createPanelContainer(this.layout.getPanelLeft(), 'Properties'),
    });

    this.diagnosticsPanel = new DiagnosticsPanel({
      container: this.createPanelContainer(this.layout.getPanelLeft(), 'Diagnostics'),
    });

    // Initialize sketch mode controller
    this.sketchModeController = new SketchModeController();

    // Initialize sketch overlay
    this.sketchOverlay = new SketchOverlay({
      container: this.layout.getViewport(),
    });

    // Initialize keyboard shortcuts panel
    this.keyboardShortcutsPanel = new KeyboardShortcutsPanel({
      container: document.body,
    });

    // Initialize assembly UI components (Milestone 06)
    this.assemblyPanel = new AssemblyPanel({
      container: this.createPanelContainer(this.layout.getPanelLeft(), 'Assembly'),
    });

    this.constraintCreationController = new ConstraintCreationController({
      instances: () => this.componentInstances,
      onConstraintCreated: this.handleConstraintCreated,
    });

    this.instanceTransformGizmo = new InstanceTransformGizmo({
      snapEnabled: this.snapSettings.enabled,
    });
    this.instanceTransformGizmo.attach(
      this.viewport.getScene(),
      this.viewport.getCameraControls().camera,
      this.layout.getViewport()
    );

    this.constraintVisualization = new ConstraintVisualization();
    this.constraintVisualization.attachToScene(this.viewport.getScene());

    // Set up event handlers
    this.setupEventHandlers();

    // Start render loop
    this.viewport.startRenderLoop();

    log.info('App initialized');
  }

  private createPanelContainer(parent: HTMLElement, title: string): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText = `
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid #333;
    `;

    const header = document.createElement('div');
    header.textContent = title;
    header.style.cssText = `
      padding: 8px 12px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      color: #888;
      background: #222;
      border-bottom: 1px solid #333;
    `;
    section.appendChild(header);

    const content = document.createElement('div');
    content.style.cssText = 'flex: 1; display: flex; flex-direction: column; min-height: 100px;';
    section.appendChild(content);

    parent.appendChild(section);
    return content;
  }

  private setupEventHandlers(): void {
    const viewportElement = this.layout.getViewport();

    // Mouse click for selection
    viewportElement.addEventListener('click', (e) => this.handleClick(e));

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
      this.updateFeatureParameters(featureId, parameters);
    });

    // Listen for feature selection
    eventBus.on('feature:selected', ({ featureId }) => {
      this.selectFeatureById(featureId);
    });

    // Handle sketch mode - show plane and align camera
    eventBus.on('sketch:enter', ({ planeRef, sketchId }) => {
      const plane = getConstructionPlaneFromRef(planeRef, this.rebuiltBodies);
      if (plane) {
        this.viewport.showPlane(plane);
        this.viewport.getCameraControls().alignToPlane(plane);

        // Show sketch overlay with sketch data
        const sketch = this.getSketchFromFeatureId(sketchId);
        if (sketch) {
          this.sketchOverlay.show(sketch, plane);
        }
      }
      log.info('Entered sketch mode', { sketchId });
    });

    // Handle sketch mode exit - hide plane and restore camera
    eventBus.on('sketch:exit', () => {
      this.viewport.hidePlane();
      this.viewport.getCameraControls().restoreFromSketch();
      this.sketchOverlay.hide();
      log.info('Exited sketch mode');
    });

    // Handle push/pull commit (Milestone 03)
    eventBus.on('pushpull:commit', ({ faceRef, distance }) => {
      this.commitPushPull(faceRef, distance);
    });

    // Handle push/pull cancel (Milestone 03)
    eventBus.on('pushpull:cancel', () => {
      this.exitPushPullMode();
    });
  }

  private handleClick(event: MouseEvent): void {
    const viewportElement = this.layout.getViewport();
    const rect = viewportElement.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Handle face selection mode
    if (this.faceSelectionMode) {
      this.handleFaceSelectionClick(x, y, rect.width, rect.height);
      return;
    }

    const result = this.picking.pick(
      x,
      y,
      rect.width,
      rect.height,
      this.viewport.getCameraControls().camera,
      Array.from(this.sceneObjects.values())
    );

    if (result.objectId) {
      this.selection = select(this.selection, result.objectId, event.shiftKey);
      this.updateSelectionVisuals();
      log.debug('Object selected', { id: result.objectId });
    } else if (!event.shiftKey) {
      this.selection = clearSelection(this.selection);
      this.updateSelectionVisuals();
    }
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
      Array.from(this.sceneObjects.values())
    );

    if (result.faceId && result.bodyId) {
      this.selectedFace = { faceId: result.faceId, bodyId: result.bodyId };
      eventBus.emit('face:selected', { faceId: result.faceId, bodyId: result.bodyId });
      log.debug('Face selected', { faceId: result.faceId, bodyId: result.bodyId });

      // Create a sketch on the selected face
      this.createSketchFromSelectedFace();
    }
  }

  /**
   * Toggle face selection mode on/off.
   */
  private toggleFaceSelectionMode(): void {
    this.faceSelectionMode = !this.faceSelectionMode;

    if (this.faceSelectionMode) {
      eventBus.emit('face:mode:changed', { isActive: true });
      eventBus.emit('ui:status', { message: 'Face selection mode - click a face to create sketch' });
      log.info('Entered face selection mode');
    } else {
      this.exitFaceSelectionMode();
    }
  }

  /**
   * Exit face selection mode.
   */
  private exitFaceSelectionMode(): void {
    this.faceSelectionMode = false;
    this.selectedFace = null;
    eventBus.emit('face:mode:changed', { isActive: false });
    eventBus.emit('ui:status', { message: 'Exited face selection mode' });
    log.info('Exited face selection mode');
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

    // Create a face-based plane reference using the factory function
    const planeRef = createFacePlaneRef(faceId, bodyId);

    // Create a sketch feature on this face
    const rect = createRectangleEntity([0, 0], 1, 1, 0);
    const feature = createSketchFeature({
      planeRef,
      entities: [rect],
      dimensions: [],
    }, `Sketch on Face ${this.features.length + 1}`);

    this.features.push(feature);
    this.rebuildAll();

    // Exit face selection mode
    this.exitFaceSelectionMode();

    // Select the new feature
    this.featureTreePanel.selectFeature(feature.id);
    eventBus.emit('ui:status', { message: `Created ${feature.name}` });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Ignore if typing in an input
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        this.deleteSelected();
        break;

      case 'Escape':
        if (this.keyboardShortcutsPanel.getIsVisible()) {
          this.keyboardShortcutsPanel.hide();
        } else if (this.pushPullMode) {
          this.exitPushPullMode();
        } else if (this.sketchModeController.isActive) {
          this.exitSketchMode();
        } else if (this.faceSelectionMode) {
          this.exitFaceSelectionMode();
        } else {
          this.selection = clearSelection(this.selection);
          this.updateSelectionVisuals();
          this.featureTreePanel.selectFeature(null);
        }
        break;

      case 'b':
      case 'B':
        if (!event.ctrlKey && !event.metaKey) {
          this.addBoxFeature();
        }
        break;

      case 's':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.saveDocument();
        } else if (!this.sketchModeController.isActive) {
          this.addSketchFeature();
        }
        break;

      case 'S':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.saveDocument();
        } else if (!this.sketchModeController.isActive) {
          this.addSketchFeature();
        }
        break;

      case 'e':
      case 'E':
        if (!event.ctrlKey && !event.metaKey && !this.sketchModeController.isActive) {
          this.addExtrudeFeature();
        }
        break;

      case 'c':
      case 'C':
        if (!event.ctrlKey && !event.metaKey && !this.sketchModeController.isActive) {
          this.addExtrudeCutFeature();
        }
        break;

      case 'd':
      case 'D':
        if ((event.ctrlKey || event.metaKey) && !this.sketchModeController.isActive) {
          event.preventDefault();
          this.addDuplicateFeature();
        }
        break;

      case 'l':
      case 'L':
        if (!event.ctrlKey && !event.metaKey && !this.sketchModeController.isActive) {
          this.addLinearPatternFeature();
        }
        break;

      case 'm':
      case 'M':
        if (!event.ctrlKey && !event.metaKey && !this.sketchModeController.isActive) {
          this.addMirrorFeature();
        }
        break;

      case 'Enter':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.rebuildAll();
        }
        break;

      case 'o':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.openDocument();
        }
        break;

      case 'n':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.newDocument();
        }
        break;

      case 'p':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.viewport.getCameraControls().toggleProjection();
        }
        break;

      case 'r':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.viewport.getCameraControls().reset();
        }
        break;

      case 'g':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.toggleGrid();
        }
        break;

      case 'f':
      case 'F':
        if (!event.ctrlKey && !event.metaKey && !this.sketchModeController.isActive) {
          this.toggleFaceSelectionMode();
        }
        break;

      case 'P':
        if (!event.ctrlKey && !event.metaKey && !this.sketchModeController.isActive) {
          this.enterPushPullMode();
        }
        break;

      case 'G':
        if (!event.ctrlKey && !event.metaKey) {
          // Shift+G = create component from selected features
          if (event.shiftKey) {
            this.createComponentFromSelection();
          } else {
            this.toggleGridSnap();
          }
        }
        break;

      case 'i':
      case 'I':
        if (!event.ctrlKey && !event.metaKey && !this.sketchModeController.isActive) {
          this.addInstanceFromSelectedComponent();
        }
        break;

      case '?':
        this.keyboardShortcutsPanel.toggle();
        break;

      case 'F1':
        event.preventDefault();
        this.keyboardShortcutsPanel.show();
        break;
    }
  }

  private updateSelectionVisuals(): void {
    // Update mesh cache selection state
    for (const [id] of this.sceneObjects) {
      const isSelected = this.selection.selectedIds.has(id);
      this.meshCache.setSelectionState(id, isSelected);
    }
  }

  private deleteSelected(): void {
    const selectedIds = Array.from(this.selection.selectedIds);
    if (selectedIds.length === 0) return;

    for (const id of selectedIds) {
      const object = this.sceneObjects.get(id);
      if (object) {
        this.viewport.remove(object);
        this.sceneObjects.delete(id);
        this.meshCache.removeBody(id);
        this.documentManager.removeBody(id);
      }
    }

    this.selection = clearSelection(this.selection);
    eventBus.emit('ui:status', { message: `Deleted ${selectedIds.length} object(s)` });
  }

  /**
   * Add a new box feature.
   */
  private addBoxFeature(): void {
    const feature = createBoxFeature({}, `Box ${this.features.length + 1}`);
    this.features.push(feature);

    // Rebuild to create the body
    const result = this.rebuildAll();

    if (result.ok) {
      // Select the new feature
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', { message: `Added ${feature.name}` });
    }
  }

  /**
   * Add a new sketch feature.
   */
  private addSketchFeature(): void {
    // Create a sketch on the XY plane by default
    const planeRef = createWorldPlaneRef('xy', 0);

    // Create a default rectangle in the sketch
    const rect = createRectangleEntity([0, 0], 1, 1, 0);

    const feature = createSketchFeature({
      planeRef,
      entities: [rect],
      dimensions: [],
    }, `Sketch ${this.features.length + 1}`);

    this.features.push(feature);

    // Rebuild (sketch doesn't create bodies, but we update the UI)
    this.rebuildAll();

    // Select the new feature
    this.featureTreePanel.selectFeature(feature.id);
    eventBus.emit('ui:status', { message: `Added ${feature.name}` });
  }

  /**
   * Add an extrude feature from the last sketch.
   */
  private addExtrudeFeature(): void {
    // Find the last sketch feature
    const sketchFeatures = this.features.filter(f => f.type === SKETCH_FEATURE_TYPE);
    if (sketchFeatures.length === 0) {
      eventBus.emit('ui:status', { message: 'No sketch to extrude - press S to create a sketch first' });
      return;
    }

    const lastSketch = sketchFeatures[sketchFeatures.length - 1];
    if (!lastSketch) {
      return;
    }

    const feature = createExtrudeFeature(
      lastSketch,
      0, // profile index
      1, // distance
      false, // flip
      `Extrude ${this.features.length + 1}`
    );

    this.features.push(feature);

    // Rebuild to create the extruded body
    const result = this.rebuildAll();

    if (result.ok) {
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', { message: `Added ${feature.name}` });
    }
  }

  /**
   * Add an extrude cut feature from the last sketch.
   */
  private addExtrudeCutFeature(): void {
    // Find the last sketch feature
    const sketchFeatures = this.features.filter(f => f.type === SKETCH_FEATURE_TYPE);
    if (sketchFeatures.length === 0) {
      eventBus.emit('ui:status', { message: 'No sketch to cut - press S or F to create a sketch first' });
      return;
    }

    const lastSketch = sketchFeatures[sketchFeatures.length - 1];
    if (!lastSketch) {
      return;
    }

    // Find a target body - look for the last body-producing feature
    // We need to find a feature that created a body
    if (this.rebuiltBodies.length === 0) {
      eventBus.emit('ui:status', { message: 'No target body - create a box or extrude first' });
      return;
    }

    // Get the last body (simplified for v1)
    const targetBody = this.rebuiltBodies[this.rebuiltBodies.length - 1];
    if (!targetBody) {
      eventBus.emit('ui:status', { message: 'No target body found' });
      return;
    }

    // Find the feature that created this body
    // For simplicity, use the feature that has this body in its refsOut
    let targetFeatureId = '';
    for (const feature of this.features) {
      if (feature.refsOut.includes(targetBody.id)) {
        targetFeatureId = feature.id;
        break;
      }
    }

    // If not found by refsOut, use the last non-sketch feature
    if (!targetFeatureId) {
      for (let i = this.features.length - 1; i >= 0; i--) {
        const f = this.features[i];
        if (f && f.type !== SKETCH_FEATURE_TYPE) {
          targetFeatureId = f.id;
          break;
        }
      }
    }

    if (!targetFeatureId) {
      eventBus.emit('ui:status', { message: 'Could not determine target feature' });
      return;
    }

    const bodyRef = createBodyRef(targetBody.id, targetFeatureId);

    const feature = createExtrudeCutFeature(
      bodyRef,
      lastSketch,
      'distance',
      0.5,
      false,
      `Cut ${this.features.length + 1}`
    );

    this.features.push(feature);

    // Rebuild to create the cut
    const result = this.rebuildAll();

    if (result.ok) {
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', { message: `Added ${feature.name}` });
    } else {
      const errorMsg = result.diagnostics.length > 0 ? result.diagnostics[0]?.message : 'Unknown error';
      eventBus.emit('ui:status', { message: `Cut failed: ${errorMsg}` });
    }
  }

  /**
   * Add a linear pattern feature from the last body-producing feature.
   */
  private addLinearPatternFeature(): void {
    // Find the last body-producing feature
    if (this.rebuiltBodies.length === 0) {
      eventBus.emit('ui:status', { message: 'No bodies to pattern - create a box or extrude first' });
      return;
    }

    // Find the last non-sketch, non-pattern feature
    let sourceFeatureId = '';
    for (let i = this.features.length - 1; i >= 0; i--) {
      const f = this.features[i];
      if (f && f.type !== SKETCH_FEATURE_TYPE &&
          f.type !== LINEAR_PATTERN_FEATURE_TYPE &&
          f.type !== MIRROR_FEATURE_TYPE) {
        sourceFeatureId = f.id;
        break;
      }
    }

    if (!sourceFeatureId) {
      eventBus.emit('ui:status', { message: 'No valid source feature to pattern' });
      return;
    }

    const feature = createLinearPatternFeature(
      sourceFeatureId,
      3, // count
      1, // spacing
      [1, 0, 0], // direction (X-axis)
      false, // symmetric
      `Linear Pattern ${this.features.length + 1}`
    );

    this.features.push(feature);

    // Rebuild
    const result = this.rebuildAll();

    if (result.ok) {
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', { message: `Added ${feature.name}` });
    } else {
      const errorMsg = result.diagnostics.length > 0 ? result.diagnostics[0]?.message : 'Unknown error';
      eventBus.emit('ui:status', { message: `Pattern failed: ${errorMsg}` });
    }
  }

  /**
   * Add a mirror feature from the last body-producing feature.
   */
  private addMirrorFeature(): void {
    // Find the last body-producing feature
    if (this.rebuiltBodies.length === 0) {
      eventBus.emit('ui:status', { message: 'No bodies to mirror - create a box or extrude first' });
      return;
    }

    // Find the last non-sketch, non-pattern feature
    let sourceFeatureId = '';
    for (let i = this.features.length - 1; i >= 0; i--) {
      const f = this.features[i];
      if (f && f.type !== SKETCH_FEATURE_TYPE &&
          f.type !== LINEAR_PATTERN_FEATURE_TYPE &&
          f.type !== MIRROR_FEATURE_TYPE) {
        sourceFeatureId = f.id;
        break;
      }
    }

    if (!sourceFeatureId) {
      eventBus.emit('ui:status', { message: 'No valid source feature to mirror' });
      return;
    }

    // Create a default YZ mirror plane
    const planeRef = createWorldPlaneRef('yz', 0);

    const feature = createMirrorFeature(
      sourceFeatureId,
      planeRef,
      `Mirror ${this.features.length + 1}`
    );

    this.features.push(feature);

    // Rebuild
    const result = this.rebuildAll();

    if (result.ok) {
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', { message: `Added ${feature.name}` });
    } else {
      const errorMsg = result.diagnostics.length > 0 ? result.diagnostics[0]?.message : 'Unknown error';
      eventBus.emit('ui:status', { message: `Mirror failed: ${errorMsg}` });
    }
  }

  /**
   * Add a duplicate feature from the last body-producing feature.
   */
  private addDuplicateFeature(): void {
    // Find the last body-producing feature
    if (this.rebuiltBodies.length === 0) {
      eventBus.emit('ui:status', { message: 'No bodies to duplicate - create a box or extrude first' });
      return;
    }

    // Find the last non-sketch, non-pattern feature
    let sourceFeatureId = '';
    for (let i = this.features.length - 1; i >= 0; i--) {
      const f = this.features[i];
      if (f && f.type !== SKETCH_FEATURE_TYPE &&
          f.type !== LINEAR_PATTERN_FEATURE_TYPE &&
          f.type !== MIRROR_FEATURE_TYPE &&
          f.type !== DUPLICATE_FEATURE_TYPE) {
        sourceFeatureId = f.id;
        break;
      }
    }

    if (!sourceFeatureId) {
      eventBus.emit('ui:status', { message: 'No valid source feature to duplicate' });
      return;
    }

    // Create duplicate with default translation offset
    const feature = createDuplicateFeature(
      sourceFeatureId,
      [12, 0, 0], // Default: 12 inches offset in X
      `Duplicate ${this.features.length + 1}`
    );

    this.features.push(feature);

    // Rebuild
    const result = this.rebuildAll();

    if (result.ok) {
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', { message: `Added ${feature.name}` });
    } else {
      const errorMsg = result.diagnostics.length > 0 ? result.diagnostics[0]?.message : 'Unknown error';
      eventBus.emit('ui:status', { message: `Duplicate failed: ${errorMsg}` });
    }
  }

  /**
   * Create a component from selected features.
   * Milestone 06: Assembly-lite
   */
  private createComponentFromSelection(): void {
    // Get selected feature IDs (for now, use the last feature if nothing selected)
    const selectedFeatureIds = Array.from(this.selection.selectedIds);

    // If no selection, use the last body-producing feature
    let featureIds = selectedFeatureIds;
    if (featureIds.length === 0) {
      // Find the last non-sketch, non-component feature
      for (let i = this.features.length - 1; i >= 0; i--) {
        const f = this.features[i];
        if (f && f.type !== SKETCH_FEATURE_TYPE &&
            f.type !== CREATE_COMPONENT_FEATURE_TYPE) {
          featureIds = [f.id];
          break;
        }
      }
    }

    if (featureIds.length === 0) {
      eventBus.emit('ui:status', { message: 'No features to group - create a box or extrude first' });
      return;
    }

    // Create the component
    const component = createComponent(
      `Component ${this.components.length + 1}`,
      featureIds,
      []
    );

    this.components.push(component);

    // Create the createComponent feature
    const feature = createComponentFeature({
      name: component.name,
      featureIds: featureIds,
    }, component.name);

    this.features.push(feature);

    // Rebuild
    this.rebuildAll();

    // Update assembly panel
    this.updateAssemblyPanel();

    eventBus.emit('component:created', { componentId: component.id, name: component.name });
    eventBus.emit('ui:status', { message: `Created component: ${component.name}` });

    log.info('Component created', { id: component.id, featureCount: featureIds.length });
  }

  /**
   * Add an instance of the selected component.
   * Milestone 06: Assembly-lite
   */
  private addInstanceFromSelectedComponent(): void {
    // Need at least one component
    if (this.components.length === 0) {
      eventBus.emit('ui:status', { message: 'No components - press Shift+G to create one first' });
      return;
    }

    // Use the last component if none selected
    const component = this.components[this.components.length - 1]!;

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
    this.rebuildAll();

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
  }

  /**
   * Handle constraint creation.
   */
  private handleConstraintCreated = (constraint: MateConstraint): void => {
    this.constraints.push(constraint);
    this.updateAssemblyPanel();

    // Run constraint solver (v1: just mark as satisfied for now)
    constraint.satisfied = true;
    eventBus.emit('constraint:solved', { constraintId: constraint.id, satisfied: true });

    log.info('Constraint created', { id: constraint.id, type: constraint.type });
  };

  /**
   * Exit sketch mode.
   */
  private exitSketchMode(): void {
    this.sketchModeController.exit();
    eventBus.emit('ui:status', { message: 'Exited sketch mode' });
  }

  /**
   * Update feature parameters and rebuild.
   */
  private updateFeatureParameters(
    featureId: string,
    parameters: Record<string, unknown>
  ): void {
    const feature = this.features.find((f) => f.id === featureId);
    if (!feature) return;

    // Update parameters
    feature.parameters = parameters;

    // Rebuild
    this.rebuildAll();
    eventBus.emit('ui:status', { message: `Updated ${feature.name}` });
  }

  /**
   * Rebuild all features and update the scene.
   */
  private rebuildAll(): { ok: boolean; diagnostics: Diagnostic[] } {
    const result = this.rebuildEngine.rebuild(this.features);

    if (result.ok) {
      // Store rebuilt bodies for face lookup
      this.rebuiltBodies = result.bodies;

      // Clear current scene objects
      for (const object of this.sceneObjects.values()) {
        this.viewport.remove(object);
      }
      this.sceneObjects.clear();
      this.meshCache.clear();

      // Create meshes from rebuilt bodies
      for (const body of result.bodies) {
        const mesh = this.meshCache.getOrCreateMesh(body);
        this.viewport.add(mesh);
        this.sceneObjects.set(body.id, mesh);
      }

      // Update document bodies
      this.syncDocumentBodies(result.bodies);

      // Update feature tree
      eventBus.emit('document:loaded', {
        features: this.features,
      });

      eventBus.emit('rebuild:complete', {
        diagnostics: result.diagnostics,
      });
    } else {
      eventBus.emit('rebuild:failed', {
        diagnostics: result.diagnostics,
      });

      eventBus.emit('ui:status', {
        message: `Rebuild failed: ${result.error}`,
      });
    }

    return result;
  }

  /**
   * Sync B-Rep bodies to document bodies.
   */
  private syncDocumentBodies(brepBodies: BRepBody[]): void {
    // Clear existing bodies
    const doc = this.documentManager.getDocument();
    for (const body of doc.bodies) {
      this.documentManager.removeBody(body.id);
    }

    // Add new bodies (simple representation for now)
    for (const body of brepBodies) {
      const docBody: Body = {
        id: body.id,
        name: body.name,
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
      this.documentManager.addBody(docBody);
    }
  }

  /**
   * Select a feature by ID.
   */
  private selectFeatureById(featureId: string): void {
    // Find the body created by this feature
    const feature = this.features.find((f) => f.id === featureId);
    if (feature && feature.refsOut.length > 0) {
      const bodyId = feature.refsOut[0];
      if (bodyId) {
        this.selection = clearSelection(this.selection);
        this.selection = select(this.selection, bodyId, false);
        this.updateSelectionVisuals();
      }
    }
  }

  private async saveDocument(): Promise<void> {
    const doc = this.documentManager.getDocument();

    // Include features in the document
    const fullDoc = {
      ...doc,
      features: this.features.map((f) => ({
        id: f.id,
        type: f.type,
        name: f.name,
        parameters: f.parameters,
        refsIn: f.refsIn,
        refsOut: f.refsOut,
        suppressed: f.suppressed,
      })),
    };

    const result = await saveToFile(fullDoc as unknown as Document, `${doc.metadata.name}.json`);

    if (result.ok) {
      eventBus.emit('ui:status', { message: `Saved: ${result.path}` });
    } else if (result.error !== 'Save cancelled') {
      eventBus.emit('ui:status', { message: `Save failed: ${result.error}` });
    }
  }

  private async openDocument(): Promise<void> {
    const result = await loadFromFile();

    if (result.ok) {
      this.loadDocument(result.document);
      eventBus.emit('ui:status', { message: `Opened: ${result.path}` });
    } else if (result.error !== 'Open cancelled') {
      eventBus.emit('ui:status', { message: `Open failed: ${result.error}` });
    }
  }

  private newDocument(): void {
    // Clear scene
    for (const object of this.sceneObjects.values()) {
      this.viewport.remove(object);
    }
    this.sceneObjects.clear();
    this.meshCache.clear();

    // Reset features
    this.features = [];

    // Reset document
    this.documentManager.new();

    // Reset selection
    this.selection = clearSelection(this.selection);

    // Update UI
    this.featureTreePanel.setFeatures([]);
    this.propertyInspector.clear();
    this.diagnosticsPanel.clear();

    eventBus.emit('ui:status', { message: 'New document created' });
  }

  private loadDocument(doc: Document): void {
    // Clear current scene
    for (const object of this.sceneObjects.values()) {
      this.viewport.remove(object);
    }
    this.sceneObjects.clear();
    this.meshCache.clear();

    // Load document
    this.documentManager.load(doc);

    // Load features from document
    const docWithFeatures = doc as Document & { features?: FeatureRecord[] };
    if (docWithFeatures.features && Array.isArray(docWithFeatures.features)) {
      this.features = docWithFeatures.features;
    } else {
      this.features = [];
    }

    // Rebuild from features
    if (this.features.length > 0) {
      this.rebuildAll();
    } else {
      // Legacy: create meshes from bodies directly
      for (const body of doc.bodies) {
        const mesh = this.createLegacyBoxMesh(body);
        this.viewport.add(mesh);
        this.sceneObjects.set(body.id, mesh);
      }
    }

    // Update UI
    this.featureTreePanel.setFeatures(this.features);

    // Reset selection
    this.selection = clearSelection(this.selection);
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
  }

  /**
   * Get sketch data from a feature ID.
   */
  private getSketchFromFeatureId(featureId: string): Sketch | null {
    const feature = this.features.find(f => f.id === featureId);
    if (!feature || feature.type !== SKETCH_FEATURE_TYPE) return null;

    const params = feature.parameters as {
      planeRef: PlaneRef;
      entities: SketchEntity[];
      dimensions: SketchDimension[];
    };

    return {
      id: feature.id,
      name: feature.name,
      planeRef: params.planeRef,
      entities: params.entities,
      dimensions: params.dimensions,
    };
  }

  /**
   * Enter push/pull mode for face selection.
   * Milestone 03: Push/Pull as a Feature
   */
  private enterPushPullMode(): void {
    if (this.pushPullMode) {
      this.exitPushPullMode();
      return;
    }

    // Check if we have bodies to push/pull
    if (this.rebuiltBodies.length === 0) {
      eventBus.emit('ui:status', { message: 'No bodies available - create a box or extrude first' });
      return;
    }

    this.pushPullMode = true;

    // Initialize face highlight if needed
    if (!this.faceHighlight) {
      this.faceHighlight = new FaceHighlight();
      this.faceHighlight.attachToScene(this.viewport.getScene());
    }

    // Initialize push/pull gizmo if needed
    if (!this.pushPullGizmo) {
      this.pushPullGizmo = new PushPullGizmo({ snapSettings: this.snapSettings });
      this.pushPullGizmo.attach(
        this.viewport.getScene(),
        this.viewport.getCameraControls().camera,
        this.layout.getViewport()
      );
    }

    // Listen for face selection in push/pull mode
    eventBus.on('face:selected', this.handlePushPullFaceSelected);

    eventBus.emit('ui:status', { message: 'Push/Pull mode - click a face to offset' });
    log.info('Entered push/pull mode');
  }

  /**
   * Exit push/pull mode.
   */
  private exitPushPullMode(): void {
    this.pushPullMode = false;

    // Clear face highlight
    if (this.faceHighlight) {
      this.faceHighlight.clearHighlight();
    }

    // Hide gizmo
    if (this.pushPullGizmo) {
      this.pushPullGizmo.hide();
    }

    // Remove event listener
    eventBus.off('face:selected', this.handlePushPullFaceSelected);

    this.selectedFace = null;
    eventBus.emit('ui:status', { message: 'Exited push/pull mode' });
    log.info('Exited push/pull mode');
  }

  /**
   * Handle face selection in push/pull mode.
   */
  private handlePushPullFaceSelected = ({ faceId, bodyId }: { faceId: string; bodyId: string }): void => {
    if (!this.pushPullMode) return;

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
    if (this.faceHighlight) {
      this.faceHighlight.setHighlightedFace(body, faceId);
    }

    // Calculate face center for gizmo position
    let center: [number, number, number] = plane.origin;
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

    // Find the feature that created this body
    // For now, use the last feature (simplification for MVP)
    const lastFeature = this.features[this.features.length - 1];
    const featureId = lastFeature?.id ?? '';

    // Create face reference
    const faceRef = createFaceRef(faceId, bodyId, featureId);

    // Show push/pull gizmo
    if (this.pushPullGizmo) {
      this.pushPullGizmo.show(faceRef, center, plane.normal);
    }

    eventBus.emit('ui:status', { message: `Face selected - drag to push/pull or type distance` });
  };

  /**
   * Toggle grid snap.
   */
  private toggleGridSnap(): void {
    this.snapSettings = toggleSnap(this.snapSettings);
    eventBus.emit('ui:status', {
      message: `Grid snap ${this.snapSettings.enabled ? 'enabled' : 'disabled'}`,
    });
  }

  /**
   * Commit a push/pull operation.
   */
  private commitPushPull(faceRef: FaceRef, distance: number): void {
    // Create offset face feature
    const feature = createOffsetFaceFeature(faceRef, distance, `Push/Pull ${this.features.length + 1}`);
    this.features.push(feature);

    // Rebuild
    const result = this.rebuildAll();

    if (result.ok) {
      this.featureTreePanel.selectFeature(feature.id);
      eventBus.emit('ui:status', { message: `Created ${feature.name} with distance ${distance.toFixed(3)}` });
    }

    // Exit push/pull mode
    this.exitPushPullMode();
  }

  dispose(): void {
    this.viewport.dispose();
    this.picking.dispose();
    this.meshCache.dispose();
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
    this.keyboardShortcutsPanel.dispose();
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
}
