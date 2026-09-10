import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { FeatureRecord, Diagnostic } from '../features';
import {
  migrateSketchParams,
  type NormalizedSketchParams,
} from '../features/sketch/SketchFeature';
import type { BoxParams } from '../features/primitives';
import type {
  SketchParams,
  ExtrudeParams,
  ExtrudeCutParams,
  LinearPatternParams,
  MirrorParams,
  DuplicateParams,
  MoveCopyParams,
  RotateBodyParams,
  JoinBodiesParams,
  MiterCutParams,
  WoodJointParams,
  TransformBodiesParams,
  ResizeBodyParams,
  FilletParams,
} from '../features';
import type { MoveVertexParams } from '../features/vertex';
import {
  extractProfiles,
  solveSketchConstraints,
  type PlaneRef,
  type SketchEntity,
  type RectangleEntity,
  type LineEntity,
} from '../sketch';
import { parseNumericInput, resolveNumericInput } from '../interaction/NumericInput';

const log = createModuleLogger('PropertyInspector');
let propertyFieldId = 0;

/**
 * Options for the PropertyInspector.
 */
export interface PropertyInspectorOptions {
  container: HTMLElement;
  units?: 'inch' | 'mm';
}

interface NumberInputOptions {
  useDocumentUnits?: boolean;
}

/**
 * Panel for editing feature parameters.
 */
export class PropertyInspector {
  private container: HTMLElement;
  private contentElement: HTMLElement;
  private currentFeature: FeatureRecord | null = null;
  private knownFeatures: FeatureRecord[] = [];
  private diagnostics: Diagnostic[] = [];
  private isDirty = false;
  private documentUnits: 'inch' | 'mm';
  private quickBoxDraft: BoxParams = {
    width: 4,
    depth: 4,
    height: 8,
    anchorMode: 'corner',
    origin: [0, 0, 0],
  };

  constructor(options: PropertyInspectorOptions) {
    this.container = options.container;
    this.documentUnits = options.units ?? 'inch';
    this.contentElement = this.createContentElement();
    this.container.appendChild(this.contentElement);
    this.setupEventListeners();
    this.renderEmpty();
    log.debug('PropertyInspector initialized');
  }

  setUnitContext(units: 'inch' | 'mm'): void {
    if (this.documentUnits === units) return;
    this.documentUnits = units;
    this.render();
  }

  /** Flush pending field edits before a parent ToolSession commits. */
  applyPendingChanges(): boolean {
    if (!this.currentFeature || !this.isDirty) return false;
    this.applyChanges();
    return true;
  }

  private createContentElement(): HTMLElement {
    const content = document.createElement('div');
    content.className = 'property-inspector';
    content.style.cssText = `
      display: flex;
      flex-direction: column;
      padding: 8px;
      gap: 8px;
      overflow-y: auto;
      flex: 1;
    `;
    return content;
  }

  private setupEventListeners(): void {
    eventBus.on('ui:property-inspector', ({ feature }) => {
      this.setFeature(feature as unknown as FeatureRecord);
    });

    eventBus.on('ui:property-inspector:clear', () => {
      this.clear();
    });

    eventBus.on('feature:diagnostics', ({ diagnostics }) => {
      this.setDiagnostics(diagnostics as Diagnostic[]);
    });

    eventBus.on('document:loaded', ({ features }) => {
      this.knownFeatures = features as unknown as FeatureRecord[];
      if (!this.currentFeature) {
        this.renderEmpty();
      }
    });
  }

  /**
   * Set the feature to edit.
   */
  setFeature(feature: FeatureRecord): void {
    this.currentFeature = feature;
    this.isDirty = false;
    this.render();
    log.debug('Feature set for editing', { id: feature.id, type: feature.type });
  }

  /**
   * Set diagnostics for the current feature.
   */
  setDiagnostics(diagnostics: Diagnostic[]): void {
    this.diagnostics = diagnostics;
    this.render();
  }

  /**
   * Clear the inspector.
   */
  clear(): void {
    this.currentFeature = null;
    this.diagnostics = [];
    this.isDirty = false;
    this.renderEmpty();
  }

  /**
   * Render the inspector content.
   */
  private render(): void {
    this.contentElement.innerHTML = '';

    if (!this.currentFeature) {
      this.renderEmpty();
      return;
    }

    // Feature header
    const header = this.renderHeader();
    this.contentElement.appendChild(header);

    // Parameters section
    const params = this.renderParameters();
    this.contentElement.appendChild(params);

    // Actions section
    const actions = this.renderActions();
    this.contentElement.appendChild(actions);

    // Diagnostics
    if (this.diagnostics.length > 0) {
      const diagnosticsEl = this.renderDiagnostics();
      this.contentElement.appendChild(diagnosticsEl);
    }
  }

  /**
   * Render empty state.
   */
  private renderEmpty(): void {
    this.contentElement.innerHTML = '';

    if (this.knownFeatures.length === 0) {
      this.contentElement.appendChild(this.renderQuickBoxEmptyState());
      return;
    }

    const empty = document.createElement('div');
    empty.textContent = 'Select a feature to edit';
    empty.style.cssText = 'color: #666; padding: 16px; text-align: center;';
    this.contentElement.appendChild(empty);
  }

  private renderQuickBoxEmptyState(): HTMLElement {
    const card = document.createElement('div');
    card.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
      border: 1px solid #333;
      border-radius: 8px;
      background: #1f1f1f;
    `;

    const title = document.createElement('div');
    title.textContent = 'Create a box';
    title.style.cssText = 'font-size: 15px; font-weight: 700; color: #fff;';
    card.appendChild(title);

    const description = document.createElement('p');
    description.textContent =
      'Enter width, height, and depth, then create your first prism. Keep width and height equal for a square prism.';
    description.style.cssText = 'margin: 0; font-size: 12px; line-height: 1.5; color: #b7b7b7;';
    card.appendChild(description);

    card.appendChild(
      this.createNumberInput('Width (X)', this.quickBoxDraft.width, (value) => {
        this.quickBoxDraft = { ...this.quickBoxDraft, width: value };
      })
    );
    card.appendChild(
      this.createNumberInput('Height (Y)', this.quickBoxDraft.depth, (value) => {
        this.quickBoxDraft = { ...this.quickBoxDraft, depth: value };
      })
    );
    card.appendChild(
      this.createNumberInput('Depth (Z)', this.quickBoxDraft.height, (value) => {
        this.quickBoxDraft = { ...this.quickBoxDraft, height: value };
      })
    );

    const helper = document.createElement('div');
    helper.textContent = 'You can fine-tune the dimensions immediately after creation.';
    helper.style.cssText = 'font-size: 11px; color: #888;';
    card.appendChild(helper);

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.textContent = 'Create box';
    createButton.style.cssText = `
      padding: 10px 12px;
      border: none;
      border-radius: 6px;
      background: #1a5fb4;
      color: #fff;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    `;
    createButton.addEventListener('click', () => {
      if (
        this.quickBoxDraft.width <= 0 ||
        this.quickBoxDraft.depth <= 0 ||
        this.quickBoxDraft.height <= 0
      ) {
        eventBus.emit('ui:status', {
          message: 'Width, height, and depth must be greater than 0',
        });
        return;
      }

      eventBus.emit('feature:create-box', {
        parameters: {
          width: this.quickBoxDraft.width,
          depth: this.quickBoxDraft.depth,
          height: this.quickBoxDraft.height,
          anchorMode: this.quickBoxDraft.anchorMode,
          origin: [...this.quickBoxDraft.origin] as [number, number, number],
        },
      });
    });
    card.appendChild(createButton);

    return card;
  }

  /**
   * Render feature header.
   */
  private renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 8px 0;
      border-bottom: 1px solid #333;
      margin-bottom: 8px;
    `;

    const title = document.createElement('div');
    title.textContent = this.currentFeature?.name ?? '';
    title.style.cssText = 'font-size: 14px; font-weight: bold;';
    header.appendChild(title);

    const type = document.createElement('div');
    type.textContent = `Type: ${this.currentFeature?.type ?? ''}`;
    type.style.cssText = 'font-size: 11px; color: #888;';
    header.appendChild(type);

    return header;
  }

  /**
   * Render parameter editors based on feature type.
   */
  private renderParameters(): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    if (!this.currentFeature) return container;

    if (this.currentFeature.type === 'box') {
      return this.renderBoxParameters(container);
    }

    if (this.currentFeature.type === 'resizeBody') {
      return this.renderResizeBodyParameters(container);
    }

    if (this.currentFeature.type === 'sketch') {
      return this.renderSketchParameters(container);
    }

    if (this.currentFeature.type === 'extrude') {
      return this.renderExtrudeParameters(container);
    }

    if (this.currentFeature.type === 'extrudeCut') {
      return this.renderExtrudeCutParameters(container);
    }

    if (this.currentFeature.type === 'miterCut') {
      return this.renderMiterCutParameters(container);
    }

    if (this.currentFeature.type === 'linearPattern') {
      return this.renderLinearPatternParameters(container);
    }

    if (this.currentFeature.type === 'mirror') {
      return this.renderMirrorParameters(container);
    }

    if (this.currentFeature.type === 'fillet') {
      return this.renderFilletParameters(container);
    }

    if (this.currentFeature.type === 'createComponent') {
      return this.renderCreateComponentParameters(container);
    }

    if (this.currentFeature.type === 'moveVertex') {
      return this.renderMoveVertexParameters(container);
    }

    if (this.currentFeature.type === 'duplicate') {
      return this.renderDuplicateParameters(container);
    }

    if (this.currentFeature.type === 'moveCopy') {
      return this.renderMoveCopyParameters(container);
    }

    if (this.currentFeature.type === 'transformBodies') {
      return this.renderTransformBodiesParameters(container);
    }

    if (this.currentFeature.type === 'rotateBody') {
      return this.renderRotateBodyParameters(container);
    }

    if (this.currentFeature.type === 'joinBodies') {
      return this.renderJoinBodiesParameters(container);
    }

    if (this.currentFeature.type === 'woodJoint') {
      return this.renderWoodJointParameters(container);
    }

    const message = document.createElement('p');
    message.className = 'property-inspector__empty-editor';
    message.textContent = 'This feature has no editable controls yet.';
    container.appendChild(message);
    container.appendChild(this.createTechnicalDetailsDisclosure(this.currentFeature.parameters));

    return container;
  }

  /**
   * Render box-specific parameters.
   */
  private renderBoxParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as BoxParams;

    // Width
    container.appendChild(
      this.createNumberInput('Width (X)', params.width, (val) => {
        this.updateParameter('width', val);
      })
    );

    // Legacy storage calls world Y "depth"; the Y-up UI presents it as height.
    container.appendChild(
      this.createNumberInput('Height (Y)', params.depth, (val) => {
        this.updateParameter('depth', val);
      })
    );

    // Legacy storage calls world Z "height"; the Y-up UI presents it as depth.
    container.appendChild(
      this.createNumberInput('Depth (Z)', params.height, (val) => {
        this.updateParameter('height', val);
      })
    );

    // Origin
    container.appendChild(this.createSectionLabel('Origin'));
    container.appendChild(
      this.createNumberInput('X', params.origin[0] ?? 0, (val) => {
        this.updateOrigin(0, val);
      })
    );
    container.appendChild(
      this.createNumberInput('Y', params.origin[1] ?? 0, (val) => {
        this.updateOrigin(1, val);
      })
    );
    container.appendChild(
      this.createNumberInput('Z', params.origin[2] ?? 0, (val) => {
        this.updateOrigin(2, val);
      })
    );

    // Anchor mode
    container.appendChild(
      this.createSelectInput(
        'Anchor',
        ['corner', 'center'],
        params.anchorMode ?? 'corner',
        (val) => {
          this.updateParameter('anchorMode', val);
        }
      )
    );

    return container;
  }

  /** Render the dedicated, dimensions-only direct resize feature. */
  private renderResizeBodyParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;
    const params = this.currentFeature.parameters as unknown as ResizeBodyParams;
    container.appendChild(this.createNumberInput('Width (X)', params.width, (value) => {
      this.updateParameter('width', value);
    }));
    container.appendChild(this.createNumberInput('Height (Y)', params.height, (value) => {
      this.updateParameter('height', value);
    }));
    container.appendChild(this.createNumberInput('Depth (Z)', params.depth, (value) => {
      this.updateParameter('depth', value);
    }));
    return container;
  }

  /**
   * Render sketch-specific parameters.
   */
  private renderSketchParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = migrateSketchParams(
      this.currentFeature.parameters as unknown as SketchParams
    );
    const planeRef = params.planeRef;
    const rectangleCount = params.entities.filter((entity) => entity.type === 'rectangle').length;
    const lineCount = params.entities.filter((entity) => entity.type === 'line').length;
    const otherCount = Math.max(0, params.entities.length - rectangleCount - lineCount);
    const profileCount = extractProfiles({
      id: this.currentFeature.id,
      name: this.currentFeature.name,
      planeRef: params.planeRef,
      entities: params.entities,
      dimensions: params.dimensions,
    }).length;

    container.appendChild(this.createSectionLabel('Sketch Plane'));
    if (planeRef.type === 'world') {
      container.appendChild(
        this.createMappedSelectInput(
          'World Plane',
          [
            { value: 'xy', label: 'XY' },
            { value: 'xz', label: 'XZ' },
            { value: 'yz', label: 'YZ' },
          ],
          planeRef.worldPlane ?? 'xy',
          (value) => this.updateSketchPlaneRef({ worldPlane: value })
        )
      );
      container.appendChild(
        this.createNumberInput('Plane Offset', planeRef.offset ?? 0, (value) => {
          this.updateSketchPlaneRef({ offset: value });
        })
      );

      const planeHint = document.createElement('div');
      planeHint.style.cssText = 'font-size: 11px; color: #888; margin-top: -4px;';
      planeHint.textContent = 'World-plane sketches can be reassigned without leaving the feature.';
      container.appendChild(planeHint);
    } else {
      container.appendChild(
        this.createReadOnlyDetail('Source Face', planeRef.faceId ?? 'unknown')
      );
      container.appendChild(
        this.createReadOnlyDetail('Source Body', planeRef.bodyId ?? 'unknown')
      );

      const planeInfo = document.createElement('div');
      planeInfo.style.cssText = 'font-size: 11px; color: #888; margin-top: -4px;';
      planeInfo.textContent = 'Face-based sketch planes are read-only in the inspector.';
      container.appendChild(planeInfo);
    }

    container.appendChild(this.createSectionLabel('Entities'));
    const entitiesInfo = document.createElement('div');
    entitiesInfo.style.cssText = 'font-size: 12px; color: #aaa;';
    const summaryParts = [
      `${params.entities.length} total`,
      `${rectangleCount} rectangle${rectangleCount === 1 ? '' : 's'}`,
      `${lineCount} line${lineCount === 1 ? '' : 's'}`,
      `${profileCount} closed profile${profileCount === 1 ? '' : 's'}`,
    ];
    if (otherCount > 0) {
      summaryParts.push(`${otherCount} other`);
    }
    entitiesInfo.textContent = summaryParts.join(' • ');
    entitiesInfo.textContent = summaryParts.join(' • ');
    entitiesInfo.textContent = summaryParts.join(' / ');
    container.appendChild(entitiesInfo);

    if (params.entities.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.style.cssText = 'font-size: 12px; color: #888; padding: 8px 0;';
      emptyState.textContent = 'No sketch entities yet.';
      container.appendChild(emptyState);
    } else {
      params.entities.forEach((entity, index) => {
        container.appendChild(this.createSketchEntityCard(entity, index + 1));
      });
    }

    if (params.drivingDimensions.length > 0) {
      container.appendChild(this.createSectionLabel('Dimensions'));
      for (const dimension of params.drivingDimensions) {
        container.appendChild(
          this.createNumberInput(
            dimension.name ?? 'Distance',
            dimension.value,
            (value) => this.updateSketchDrivingDimension(params, dimension.id, value),
            { useDocumentUnits: true }
          )
        );
      }
    }

    if (params.dimensions.some((dimension) => dimension.type === 'angle')) {
      container.appendChild(this.createReadOnlyDetail(
        'Angular dimensions',
        'Not editable in this version'
      ));
    }

    return container;
  }

  /**
   * Render extrude-specific parameters.
   */
  private renderExtrudeParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as ExtrudeParams;

    // Sketch reference
    container.appendChild(this.createSectionLabel('Sketch Reference'));
    const sketchInfo = document.createElement('div');
    sketchInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    sketchInfo.textContent = `Sketch ID: ${params.sketchId ?? 'none'}`;
    container.appendChild(sketchInfo);

    // Profile index
    container.appendChild(
      this.createNumberInput('Profile Index', params.profileIndex ?? 0, (val) => {
        this.updateParameter('profileIndex', Math.floor(val));
      })
    );

    const extent = {
      direction: params.extent?.direction ?? 'OneSided',
      limit: params.extent?.limit ?? 'Distance',
      ...(params.extent?.distance !== undefined || params.distance !== undefined
        ? { distance: params.extent?.distance ?? params.distance }
        : {}),
      ...(params.extent?.upToFaceRef ? { upToFaceRef: params.extent.upToFaceRef } : {}),
    };

    container.appendChild(this.createSectionLabel('Operation'));
    container.appendChild(
      this.createMappedSelectInput(
        'Result',
        [
          { value: 'New', label: 'New Body' },
          { value: 'Add', label: 'Add / Union' },
          { value: 'Cut', label: 'Cut / Difference' },
        ],
        params.operation ?? 'New',
        (operation) => this.updateParameter('operation', operation)
      )
    );

    container.appendChild(this.createSectionLabel('Extent'));
    container.appendChild(
      this.createMappedSelectInput(
        'Direction',
        [
          { value: 'OneSided', label: 'One Sided' },
          { value: 'Symmetric', label: 'Symmetric' },
        ],
        extent.direction,
        (direction) => this.updateExtrudeExtent({ direction })
      )
    );
    container.appendChild(
      this.createMappedSelectInput(
        'Limit',
        [
          { value: 'Distance', label: 'Distance' },
          { value: 'UpToFace', label: 'Up to Face' },
          { value: 'ThroughAll', label: 'Through All' },
        ],
        extent.limit,
        (limit) => this.updateExtrudeExtent({ limit })
      )
    );
    if (extent.limit === 'Distance') {
      container.appendChild(
        this.createNumberInput('Distance', extent.distance ?? params.distance ?? 1, (val) => {
          this.updateParameters({
            distance: val,
            extent: { ...extent, distance: val },
          });
        })
      );
    } else if (extent.limit === 'UpToFace') {
      container.appendChild(this.createReadOnlyDetail(
        'Face',
        extent.upToFaceRef?.faceId ?? 'Select a parallel face before applying'
      ));
    }

    // Flip direction
    container.appendChild(this.createSectionLabel('Direction'));
    const flipContainer = document.createElement('div');
    flipContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const flipCheckbox = document.createElement('input');
    flipCheckbox.type = 'checkbox';
    flipCheckbox.checked = params.flip ?? false;
    flipCheckbox.style.cssText = 'width: 16px; height: 16px;';
    flipCheckbox.addEventListener('change', () => {
      this.updateParameter('flip', flipCheckbox.checked);
    });

    const flipLabel = document.createElement('label');
    flipLabel.textContent = 'Flip Direction';
    flipLabel.style.cssText = 'font-size: 12px;';
    flipCheckbox.id = this.createFieldId('flip-direction');
    flipLabel.htmlFor = flipCheckbox.id;

    flipContainer.appendChild(flipCheckbox);
    flipContainer.appendChild(flipLabel);
    container.appendChild(flipContainer);

    return container;
  }

  /**
   * Render extrude cut-specific parameters.
   */
  private renderExtrudeCutParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as ExtrudeCutParams;

    // Target body reference (read-only)
    container.appendChild(this.createSectionLabel('Target Body'));
    const targetInfo = document.createElement('div');
    targetInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    targetInfo.textContent = `Body: ${params.targetBodyRef?.bodyId ?? 'none'}`;
    container.appendChild(targetInfo);

    // Sketch reference
    container.appendChild(this.createSectionLabel('Sketch Reference'));
    const sketchInfo = document.createElement('div');
    sketchInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    sketchInfo.textContent = `Sketch ID: ${params.sketchId ?? 'none'}`;
    container.appendChild(sketchInfo);

    // Profile index
    container.appendChild(
      this.createNumberInput('Profile Index', params.profileIndex ?? 0, (val) => {
        this.updateParameter('profileIndex', Math.floor(val));
      })
    );

    const extent = {
      direction: params.extent?.direction ?? 'OneSided',
      limit: params.extent?.limit ?? (params.mode === 'through' ? 'ThroughAll' : 'Distance'),
      ...(params.extent?.distance !== undefined || params.distance !== undefined
        ? { distance: params.extent?.distance ?? params.distance }
        : {}),
      ...(params.extent?.upToFaceRef ? { upToFaceRef: params.extent.upToFaceRef } : {}),
    };
    container.appendChild(this.createSectionLabel('Extent'));
    container.appendChild(
      this.createMappedSelectInput(
        'Direction',
        [
          { value: 'OneSided', label: 'One Sided' },
          { value: 'Symmetric', label: 'Symmetric' },
        ],
        extent.direction,
        (direction) => this.updateExtrudeExtent({ direction })
      )
    );
    container.appendChild(
      this.createMappedSelectInput(
        'Limit',
        [
          { value: 'Distance', label: 'Distance' },
          { value: 'UpToFace', label: 'Up to Face' },
          { value: 'ThroughAll', label: 'Through All' },
        ],
        extent.limit,
        (limit) => this.updateExtrudeExtent({ limit }, true)
      )
    );

    if (extent.limit === 'Distance') {
      container.appendChild(
        this.createNumberInput('Distance', extent.distance ?? params.distance ?? 0.5, (val) => {
          this.updateParameters({
            mode: 'distance',
            distance: val,
            extent: { ...extent, distance: val },
          });
        })
      );
    } else if (extent.limit === 'UpToFace') {
      container.appendChild(this.createReadOnlyDetail(
        'Face',
        extent.upToFaceRef?.faceId ?? 'Select a parallel face before applying'
      ));
    }

    // Flip direction
    container.appendChild(this.createSectionLabel('Direction'));
    const flipContainer = document.createElement('div');
    flipContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const flipCheckbox = document.createElement('input');
    flipCheckbox.type = 'checkbox';
    flipCheckbox.checked = params.flip ?? false;
    flipCheckbox.style.cssText = 'width: 16px; height: 16px;';
    flipCheckbox.addEventListener('change', () => {
      this.updateParameter('flip', flipCheckbox.checked);
    });

    const flipLabel = document.createElement('label');
    flipLabel.textContent = 'Flip Direction';
    flipLabel.style.cssText = 'font-size: 12px;';
    flipCheckbox.id = this.createFieldId('flip-direction');
    flipLabel.htmlFor = flipCheckbox.id;

    flipContainer.appendChild(flipCheckbox);
    flipContainer.appendChild(flipLabel);
    container.appendChild(flipContainer);

    return container;
  }

  /**
   * Render linear pattern-specific parameters.
   */
  private renderLinearPatternParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as LinearPatternParams;

    // Source feature reference (read-only)
    container.appendChild(this.createSectionLabel('Source Feature'));
    const sourceInfo = document.createElement('div');
    sourceInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    sourceInfo.textContent = `Feature ID: ${params.sourceFeatureId ?? 'none'}`;
    container.appendChild(sourceInfo);

    // Count
    container.appendChild(
      this.createNumberInput('Count', params.count ?? 3, (val) => {
        this.updateParameter('count', Math.max(2, Math.floor(val)));
      })
    );

    // Spacing
    container.appendChild(
      this.createNumberInput('Spacing', params.spacing ?? 1, (val) => {
        this.updateParameter('spacing', Math.max(0.01, val));
      })
    );

    // Direction
    container.appendChild(this.createSectionLabel('Direction'));
    const dir = params.direction ?? [1, 0, 0];
    container.appendChild(
      this.createNumberInput('X', dir[0] ?? 1, (val) => {
        this.updateDirection(0, val);
      })
    );
    container.appendChild(
      this.createNumberInput('Y', dir[1] ?? 0, (val) => {
        this.updateDirection(1, val);
      })
    );
    container.appendChild(
      this.createNumberInput('Z', dir[2] ?? 0, (val) => {
        this.updateDirection(2, val);
      })
    );

    // Symmetric toggle
    container.appendChild(this.createSectionLabel('Options'));
    const symmetricContainer = document.createElement('div');
    symmetricContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const symmetricCheckbox = document.createElement('input');
    symmetricCheckbox.type = 'checkbox';
    symmetricCheckbox.checked = params.symmetric ?? false;
    symmetricCheckbox.style.cssText = 'width: 16px; height: 16px;';
    symmetricCheckbox.addEventListener('change', () => {
      this.updateParameter('symmetric', symmetricCheckbox.checked);
    });

    const symmetricLabel = document.createElement('label');
    symmetricLabel.textContent = 'Symmetric';
    symmetricLabel.style.cssText = 'font-size: 12px;';
    symmetricCheckbox.id = this.createFieldId('symmetric');
    symmetricLabel.htmlFor = symmetricCheckbox.id;

    symmetricContainer.appendChild(symmetricCheckbox);
    symmetricContainer.appendChild(symmetricLabel);
    container.appendChild(symmetricContainer);

    return container;
  }

  private renderMiterCutParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;
    const params = this.currentFeature.parameters as unknown as MiterCutParams;
    const cutStyle = params.cutStyle ?? 'single';

    container.appendChild(this.createReadOnlyDetail('Body', params.sourceBodyRef?.bodyId ?? 'missing'));
    container.appendChild(this.createReadOnlyDetail('Reference face', params.faceRef?.faceId ?? 'missing'));
    container.appendChild(
      this.createMappedSelectInput(
        'Cut type',
        [
          { value: 'single', label: 'Single miter' },
          { value: 'threeWay', label: 'Three-way end' },
        ],
        cutStyle,
        (nextCutStyle) => {
          this.updateParameter('cutStyle', nextCutStyle);
          this.render();
        }
      )
    );
    container.appendChild(
      this.createMappedSelectInput(
        'Result',
        [
          {
            value: 'split',
            label: cutStyle === 'threeWay' ? 'Keep all pieces' : 'Keep both pieces',
          },
          { value: 'trim', label: 'Trim end' },
        ],
        params.resultMode ?? 'split',
        (resultMode) => this.updateParameter('resultMode', resultMode)
      )
    );
    if (cutStyle === 'threeWay') {
      container.appendChild(
        this.createMappedSelectInput(
          'Joint corner',
          [0, 1, 2, 3].map((index) => ({
            value: `corner${index}`,
            label: `Corner ${index + 1}`,
          })),
          params.threeWayCorner ?? 'corner0',
          (corner) => this.updateParameter('threeWayCorner', corner)
        )
      );
      container.appendChild(this.createReadOnlyDetail('Angles', '45\u00b0 + 45\u00b0'));
    } else {
      container.appendChild(
        this.createNumberInput('Angle (deg)', params.angleDegrees ?? 45, (angleDegrees) => {
          this.updateParameter('angleDegrees', angleDegrees);
        })
      );
    }
    container.appendChild(
      this.createNumberInput('Inset', params.inset ?? 0, (inset) => {
        this.updateParameter('inset', inset);
      }, { useDocumentUnits: true })
    );
    if (cutStyle === 'single') {
      container.appendChild(
        this.createMappedSelectInput(
          'Angle across',
          [
            { value: 'u', label: 'Face U' },
            { value: 'v', label: 'Face V' },
          ],
          params.tiltAxis ?? 'u',
          (tiltAxis) => this.updateParameter('tiltAxis', tiltAxis)
        )
      );
    }
    return container;
  }

  /**
   * Render mirror-specific parameters.
   */
  private renderMirrorParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as MirrorParams;

    // Source feature reference (read-only)
    container.appendChild(this.createSectionLabel('Source Feature'));
    const sourceInfo = document.createElement('div');
    sourceInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    sourceInfo.textContent = `Feature ID: ${params.sourceFeatureId ?? 'none'}`;
    container.appendChild(sourceInfo);

    // World-plane mirrors remain fully editable during the preview session.
    container.appendChild(this.createSectionLabel('Mirror Plane'));
    if (params.planeRef?.type === 'world') {
      container.appendChild(
        this.createMappedSelectInput(
          'Plane',
          [
            { value: 'xy', label: 'XY' },
            { value: 'xz', label: 'XZ' },
            { value: 'yz', label: 'YZ' },
          ],
          params.planeRef.worldPlane ?? 'yz',
          (worldPlane) => this.updateParameter('planeRef', {
            ...params.planeRef,
            type: 'world',
            worldPlane,
          })
        )
      );
      container.appendChild(
        this.createNumberInput('Offset', params.planeRef.offset ?? 0, (offset) => {
          this.updateParameter('planeRef', { ...params.planeRef, offset });
        })
      );
    } else {
      container.appendChild(this.createReadOnlyDetail(
        'Face Plane',
        params.planeRef?.faceId ?? 'unknown'
      ));
    }

    return container;
  }

  /**
   * Render createComponent-specific parameters.
   */
  private renderCreateComponentParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as { name: string; featureIds: string[] };

    // Component name
    container.appendChild(
      this.createTextInput('Name', params.name ?? '', (val) => {
        this.updateParameter('name', val);
      })
    );

    // Feature count
    container.appendChild(this.createSectionLabel('Features'));
    const featureInfo = document.createElement('div');
    featureInfo.style.cssText = 'font-size: 12px; color: #aaa;';
    featureInfo.textContent = `${params.featureIds?.length ?? 0} features in this component`;
    container.appendChild(featureInfo);

    // Feature IDs list
    if (params.featureIds && params.featureIds.length > 0) {
      const featureList = document.createElement('div');
      featureList.style.cssText = 'margin-top: 8px; padding: 8px; background: #2a2a2a; border-radius: 4px; max-height: 150px; overflow-y: auto;';
      for (const featureId of params.featureIds) {
        const item = document.createElement('div');
        item.style.cssText = 'font-size: 11px; color: #888; padding: 2px 0;';
        item.textContent = `- ${featureId}`;
        featureList.appendChild(item);
      }
      container.appendChild(featureList);
    }

    return container;
  }

  /**
   * Render moveVertex-specific parameters.
   */
  private renderMoveVertexParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as MoveVertexParams;

    // Vertex reference (read-only)
    container.appendChild(this.createSectionLabel('Vertex Reference'));
    const vertexInfo = document.createElement('div');
    vertexInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    vertexInfo.textContent = `Vertex: ${params.vertexRef?.vertexId ?? 'none'}`;
    container.appendChild(vertexInfo);

    const bodyInfo = document.createElement('div');
    bodyInfo.style.cssText = 'font-size: 11px; color: #888;';
    bodyInfo.textContent = `Body: ${params.vertexRef?.bodyId ?? 'unknown'}`;
    container.appendChild(bodyInfo);

    // Translation
    container.appendChild(this.createSectionLabel('Translation'));
    const translation = params.translation ?? [0, 0, 0];
    container.appendChild(
      this.createNumberInput('dX', translation[0] ?? 0, (val) => {
        this.updateTranslation(0, val);
      })
    );
    container.appendChild(
      this.createNumberInput('dY', translation[1] ?? 0, (val) => {
        this.updateTranslation(1, val);
      })
    );
    container.appendChild(
      this.createNumberInput('dZ', translation[2] ?? 0, (val) => {
        this.updateTranslation(2, val);
      })
    );

    // Constrain axis
    container.appendChild(this.createSectionLabel('Constrain Axis'));
    const axisContainer = document.createElement('div');
    axisContainer.style.cssText = 'display: flex; gap: 8px;';

    const axes: ('x' | 'y' | 'z' | undefined)[] = ['x', 'y', 'z', undefined];
    const axisLabels = ['X', 'Y', 'Z', 'None'];

    for (let i = 0; i < axes.length; i++) {
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'constrainAxis';
      radio.value = axes[i] ?? 'none';
      radio.checked = params.constrainAxis === axes[i];
      radio.style.cssText = 'width: 14px; height: 14px;';
      radio.addEventListener('change', () => {
        if (radio.checked) {
          this.updateParameter('constrainAxis', axes[i]);
        }
      });

      const label = document.createElement('span');
      label.textContent = axisLabels[i] ?? 'None';
      label.style.cssText = 'font-size: 12px; margin-right: 8px;';

      const wrapper = document.createElement('label');
      wrapper.style.cssText = 'display: flex; align-items: center; gap: 4px;';
      wrapper.appendChild(radio);
      wrapper.appendChild(label);
      axisContainer.appendChild(wrapper);
    }

    container.appendChild(axisContainer);

    return container;
  }

  /**
   * Render fillet-specific parameters.
   */
  private renderFilletParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as FilletParams;

    // Source feature reference (read-only)
    container.appendChild(this.createSectionLabel('Source Feature'));
    const sourceInfo = document.createElement('div');
    sourceInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    sourceInfo.textContent = `Feature ID: ${params.sourceFeatureId ?? 'none'}`;
    container.appendChild(sourceInfo);

    // Radius
    container.appendChild(
      this.createNumberInput('Radius', params.radius ?? 5, (val) => {
        this.updateParameter('radius', Math.max(0.01, val));
      })
    );

    // Edge selection note
    container.appendChild(this.createSectionLabel('Edge Selection'));
    const edgeInfo = document.createElement('div');
    edgeInfo.style.cssText = 'font-size: 12px; color: #888; margin-bottom: 8px;';
    edgeInfo.textContent = params.edgeIds?.length ? `Select edges in the viewport. ${params.edgeIds.length} edge(s) selected.`
      : 'Select edges in the viewport to fillet.';
    container.appendChild(edgeInfo);

    return container;
  }

  /**
   * Render duplicate-specific parameters.
   */
  private renderDuplicateParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as DuplicateParams;

    // Source feature reference (read-only)
    container.appendChild(this.createSectionLabel('Source Feature'));
    const sourceInfo = document.createElement('div');
    sourceInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    sourceInfo.textContent = `Feature ID: ${params.sourceFeatureId ?? 'none'}`;
    container.appendChild(sourceInfo);

    // Translation
    container.appendChild(this.createSectionLabel('Translation Offset'));
    const translation = params.translation ?? [0, 0, 0];
    container.appendChild(
      this.createNumberInput('X', translation[0] ?? 0, (val) => {
        this.updateDuplicateTranslation(0, val);
      })
    );
    container.appendChild(
      this.createNumberInput('Y', translation[1] ?? 0, (val) => {
        this.updateDuplicateTranslation(1, val);
      })
    );
    container.appendChild(
      this.createNumberInput('Z', translation[2] ?? 0, (val) => {
        this.updateDuplicateTranslation(2, val);
      })
    );

    return container;
  }

  private renderMoveCopyParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;
    const params = this.currentFeature.parameters as unknown as MoveCopyParams;

    container.appendChild(this.createSectionLabel('Source'));
    container.appendChild(this.createReadOnlyDetail('Body', params.sourceBodyRef?.bodyId ?? 'none'));
    container.appendChild(
      this.createMappedSelectInput(
        'Operation',
        [
          { value: 'move', label: 'Move' },
          { value: 'copy', label: 'Copy' },
        ],
        params.mode ?? 'copy',
        (mode) => this.updateParameter('mode', mode)
      )
    );

    container.appendChild(this.createSectionLabel('Exact Displacement'));
    const translation = params.translation ?? [0, 0, 0];
    for (const [index, label] of ['X', 'Y', 'Z'].entries()) {
      container.appendChild(
        this.createNumberInput(label, translation[index] ?? 0, (value) => {
          const next = [...translation] as [number, number, number];
          next[index] = value;
          this.updateParameter('translation', next);
        })
      );
    }
    return container;
  }

  private renderTransformBodiesParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;
    const params = this.currentFeature.parameters as unknown as TransformBodiesParams;
    const placement = params.placement;

    container.appendChild(this.createSectionLabel('Placement'));
    container.appendChild(this.createReadOnlyDetail(
      'Bodies',
      `${params.bodyRefs?.length ?? 0} selected`,
    ));
    container.appendChild(this.createReadOnlyDetail(
      'Method',
      placement?.type ?? 'Unknown',
    ));

    if (placement?.type === 'Free') {
      container.appendChild(this.createSectionLabel('Translation'));
      for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
        container.appendChild(this.createNumberInput(`${axis} displacement`, placement.translation[index] ?? 0, (value) => {
          this.updateTransformPlacement((current) => {
            if (current.type !== 'Free') return current;
            const translation = [...current.translation] as [number, number, number];
            translation[index] = value;
            return { ...current, translation };
          });
        }));
      }
      container.appendChild(this.createSectionLabel('Rotation'));
      for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
        container.appendChild(this.createNumberInput(`${axis} rotation`, placement.rotationDegrees[index] ?? 0, (value) => {
          this.updateTransformPlacement((current) => {
            if (current.type !== 'Free') return current;
            const rotationDegrees = [...current.rotationDegrees] as [number, number, number];
            rotationDegrees[index] = value;
            return { ...current, rotationDegrees };
          });
        }, { useDocumentUnits: false }));
      }
      return container;
    }

    if (placement?.type === 'PointToPoint') {
      container.appendChild(this.createSectionLabel('World Offset'));
      const offset = placement.offset ?? [0, 0, 0];
      for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
        container.appendChild(this.createNumberInput(`${axis} offset`, offset[index] ?? 0, (value) => {
          this.updateTransformPlacement((current) => {
            if (current.type !== 'PointToPoint') return current;
            const next = [...(current.offset ?? [0, 0, 0])] as [number, number, number];
            next[index] = value;
            return { ...current, offset: next };
          });
        }));
      }
      return container;
    }

    if (placement?.type === 'Align') {
      container.appendChild(this.createNumberInput('Signed gap', placement.gap ?? 0, (value) => {
        this.updateTransformPlacement((current) => current.type === 'Align'
          ? { ...current, gap: value }
          : current);
      }));
      container.appendChild(this.createNumberInput('Quarter turns', placement.quarterTurns ?? 0, (value) => {
        this.updateTransformPlacement((current) => current.type === 'Align'
          ? { ...current, quarterTurns: Math.round(value) }
          : current);
      }, { useDocumentUnits: false }));
      container.appendChild(this.createCheckboxInput('Oppose face normals', placement.opposed ?? false, (value) => {
        this.updateTransformPlacement((current) => current.type === 'Align'
          ? { ...current, opposed: value }
          : current);
      }));
      return container;
    }

    if (placement?.type === 'AxisAngle') {
      container.appendChild(this.createNumberInput('Angle', placement.angleDegrees, (value) => {
        this.updateTransformPlacement((current) => current.type === 'AxisAngle'
          ? { ...current, angleDegrees: value }
          : current);
      }, { useDocumentUnits: false }));
      return container;
    }

    const note = document.createElement('p');
    note.className = 'property-inspector__empty-editor';
    note.textContent = 'This fixed placement is read-only. Use Move or Align to create an editable placement.';
    container.appendChild(note);
    return container;
  }

  private renderRotateBodyParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as RotateBodyParams;
    const rotation = params.rotationDegrees ?? [0, 0, 0];

    container.appendChild(this.createSectionLabel('Target Body'));
    container.appendChild(
      this.createReadOnlyDetail('Body', params.bodyRef?.bodyId ?? 'unknown')
    );

    container.appendChild(this.createSectionLabel('Rotation (Degrees)'));
    container.appendChild(
      this.createNumberInput('X', rotation[0] ?? 0, (val) => this.updateRotateDegrees(0, val))
    );
    container.appendChild(
      this.createNumberInput('Y', rotation[1] ?? 0, (val) => this.updateRotateDegrees(1, val))
    );
    container.appendChild(
      this.createNumberInput('Z', rotation[2] ?? 0, (val) => this.updateRotateDegrees(2, val))
    );

    container.appendChild(this.createSectionLabel('Pivot'));
    container.appendChild(
      this.createMappedSelectInput(
        'Pivot',
        [
          { value: 'bodyCenter', label: 'Body Center' },
          { value: 'worldOrigin', label: 'World Origin' },
        ],
        params.pivot ?? 'bodyCenter',
        (value) => this.updateParameter('pivot', value)
      )
    );

    return container;
  }

  private renderJoinBodiesParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as JoinBodiesParams;
    container.appendChild(this.createSectionLabel('Compound Bodies'));

    const summary = document.createElement('div');
    summary.style.cssText = 'font-size: 12px; color: #aaa;';
    summary.textContent = `${params.bodyRefs?.length ?? 0} solids grouped into one editable result`;
    container.appendChild(summary);

    const note = document.createElement('div');
    note.style.cssText = 'font-size: 11px; color: #888; margin-top: 8px;';
    note.textContent = 'Compound keeps solids together without performing a material union.';
    container.appendChild(note);
    container.appendChild(this.createTechnicalDetailsDisclosure({
      bodyReferences: params.bodyRefs ?? [],
    }));

    return container;
  }

  private renderWoodJointParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;
    const params = this.currentFeature.parameters as unknown as WoodJointParams;
    const labels: Record<WoodJointParams['kind'], string> = {
      mortiseTenon: 'Mortise & tenon',
      dado: 'Dado',
      groove: 'Groove',
      rabbet: 'Rabbet',
      crossLap: 'Cross-lap',
      endLap: 'End-lap',
      halfLap: 'Half-lap',
      bridle: 'Bridle',
      notch: 'Notch',
      sawCut: 'Saw cut',
      chamfer: 'Chamfer',
      threeWayMiter: 'Three-way miter',
    };

    container.appendChild(this.createReadOnlyDetail('Joint', labels[params.kind] ?? params.kind));
    container.appendChild(this.createSectionLabel('Fit'));
    container.appendChild(this.createNumberInput(
      'Side clearance',
      params.sideClearance,
      (value) => this.updateParameter('sideClearance', value)
    ));
    container.appendChild(this.createNumberInput(
      'End clearance',
      params.endClearance,
      (value) => this.updateParameter('endClearance', value)
    ));

    container.appendChild(this.createSectionLabel('Dimensions'));
    for (const [key, label] of [
      ['width', 'Width'],
      ['depth', 'Depth'],
      ['length', 'Length'],
      ['offset', 'Offset'],
      ['kerf', 'Kerf'],
      ['chamferWidth', 'Chamfer width'],
    ] as const) {
      const value = params[key];
      if (value === undefined) {
        container.appendChild(this.createReadOnlyDetail(label, 'Automatic from stock'));
      } else {
        container.appendChild(this.createNumberInput(
          label,
          value,
          (next) => this.updateParameter(key, next)
        ));
      }
    }

    if (params.kind === 'sawCut') {
      container.appendChild(this.createSelectInput(
        'Keep',
        ['both', 'datumSide', 'oppositeSide'],
        params.keep ?? 'both',
        (value) => this.updateParameter('keep', value)
      ));
    }
    if (params.kind === 'threeWayMiter') {
      container.appendChild(this.createSelectInput(
        'Result',
        ['trim', 'split'],
        params.resultMode ?? 'trim',
        (value) => this.updateParameter('resultMode', value)
      ));
    }

    container.appendChild(this.createSectionLabel('Members'));
    params.members.forEach((member, index) => {
      container.appendChild(this.createReadOnlyDetail(
        `Member ${index + 1}`,
        `${member.datumRef.kind} datum`
      ));
    });
    container.appendChild(this.createTechnicalDetailsDisclosure({
      members: params.members,
    }));
    return container;
  }

  private createTechnicalDetailsDisclosure(
    details: Record<string, unknown>
  ): HTMLDetailsElement {
    const disclosure = document.createElement('details');
    disclosure.className = 'property-inspector__technical-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Technical Details';
    disclosure.appendChild(summary);
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(details, null, 2);
    disclosure.appendChild(pre);
    return disclosure;
  }

  /**
   * Update duplicate translation at specific index.
   */
  private updateDuplicateTranslation(index: number, value: number): void {
    if (!this.currentFeature) return;
    const params = this.currentFeature.parameters as unknown as DuplicateParams;
    const translation = [...(params.translation ?? [0, 0, 0])] as [number, number, number];
    translation[index] = value;
    this.updateParameter('translation', translation);
  }

  private updateRotateDegrees(index: number, value: number): void {
    if (!this.currentFeature) return;
    const params = this.currentFeature.parameters as unknown as RotateBodyParams;
    const rotationDegrees = [...(params.rotationDegrees ?? [0, 0, 0])] as [number, number, number];
    rotationDegrees[index] = value;
    this.updateParameter('rotationDegrees', rotationDegrees);
  }

  /**
   * Update direction vector at specific index.
   */
  private updateDirection(index: number, value: number): void {
    if (!this.currentFeature) return;
    const params = this.currentFeature.parameters as unknown as LinearPatternParams;
    const direction = [...(params.direction ?? [1, 0, 0])] as [number, number, number];
    direction[index] = value;
    // Normalize the direction
    const length = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
    if (length > 0) {
      direction[0] /= length;
      direction[1] /= length;
      direction[2] /= length;
    }
    this.updateParameter('direction', direction);
  }

  /**
   * Update translation at specific index.
   */
  private updateTranslation(index: number, value: number): void {
    if (!this.currentFeature) return;
    const params = this.currentFeature.parameters as unknown as MoveVertexParams;
    const translation = [...(params.translation ?? [0, 0, 0])] as [number, number, number];
    translation[index] = value;
    this.updateParameter('translation', translation);
  }

  /**
   * Create a section label.
   */
  private createSectionLabel(text: string): HTMLElement {
    const label = document.createElement('div');
    label.textContent = text;
    label.style.cssText = `
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
      margin-top: 8px;
    `;
    return label;
  }

  /**
   * Create a number input field.
   */
  private createCheckboxInput(
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';
    const input = document.createElement('input');
    input.id = this.createFieldId(label);
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const labelEl = document.createElement('label');
    labelEl.htmlFor = input.id;
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size: 12px;';
    row.append(input, labelEl);
    return row;
  }

  private createNumberInput(
    label: string,
    value: number,
    onChange: (val: number) => void,
    options: NumberInputOptions = {}
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const labelEl = document.createElement('label');
    const unitLabel = this.documentUnits === 'mm' ? 'mm' : 'in';
    labelEl.textContent = options.useDocumentUnits ? `${label} (${unitLabel})` : label;
    labelEl.style.cssText = 'flex: 1; font-size: 12px;';
    row.appendChild(labelEl);

    const input = document.createElement('input');
    input.id = this.createFieldId(label);
    input.type = 'text';
    input.inputMode = 'decimal';
    input.dataset.numericInput = 'true';
    input.dataset.numericLabel = label;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.title = 'Enter a number, fraction, arithmetic expression, unit, or relative value';
    input.dataset.unit = options.useDocumentUnits ? unitLabel : 'in';
    input.value = String(
      options.useDocumentUnits && this.documentUnits === 'mm'
        ? this.roundForInput(value * 25.4)
        : value
    );
    input.style.cssText = `
      width: 80px;
      padding: 4px 8px;
      background: #333;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
      font-size: 12px;
    `;
    labelEl.htmlFor = input.id;

    const feedback = document.createElement('span');
    feedback.id = `${input.id}-error`;
    feedback.dataset.numericError = 'true';
    feedback.setAttribute('role', 'alert');
    feedback.style.cssText = 'display: none; color: #ff8c8c; font-size: 10px; line-height: 1.2;';
    input.setAttribute('aria-describedby', feedback.id);

    const field = document.createElement('div');
    field.style.cssText = 'width: 98px; display: flex; flex-direction: column; gap: 2px;';

    input.addEventListener('input', () => {
      const parsed = parseNumericInput(input.value, {
        defaultUnit: options.useDocumentUnits && this.documentUnits === 'mm' ? 'mm' : 'in',
      });
      if (!parsed.ok) {
        input.setAttribute('aria-invalid', 'true');
        input.setCustomValidity(parsed.error);
        input.style.borderColor = '#c94b4b';
        feedback.textContent = parsed.error;
        feedback.style.display = 'block';
        return;
      }

      input.removeAttribute('aria-invalid');
      input.setCustomValidity('');
      input.style.borderColor = '#444';
      feedback.textContent = '';
      feedback.style.display = 'none';
      onChange(resolveNumericInput(value, parsed));
    });

    field.appendChild(input);
    field.appendChild(feedback);
    row.appendChild(field);
    return row;
  }

  private roundForInput(value: number): number {
    return Number.parseFloat(value.toFixed(6));
  }

  /**
   * Create a text input field.
   */
  private createTextInput(
    label: string,
    value: string,
    onChange: (val: string) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'flex: 1; font-size: 12px;';
    row.appendChild(labelEl);

    const input = document.createElement('input');
    input.id = this.createFieldId(label);
    input.type = 'text';
    input.value = value;
    input.style.cssText = `
      width: 120px;
      padding: 4px 8px;
      background: #333;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
      font-size: 12px;
    `;
    labelEl.htmlFor = input.id;

    input.addEventListener('input', () => {
      onChange(input.value);
    });

    row.appendChild(input);
    return row;
  }

  /**
   * Create a select input.
   */
  private createSelectInput(
    label: string,
    options: string[],
    value: string,
    onChange: (val: string) => void
  ): HTMLElement {
    const field = document.createElement('label');
    field.textContent = label;
    field.style.cssText = 'display: flex; flex-direction: column; gap: 4px; font-size: 12px;';

    const select = document.createElement('select');
    select.id = this.createFieldId(label);
    select.style.cssText = `
      width: 100%;
      padding: 6px;
      background: #333;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
      font-size: 12px;
    `;

    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === value) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      onChange(select.value);
    });

    field.htmlFor = select.id;
    field.appendChild(select);
    return field;
  }

  /**
   * Create a labeled mapped select input.
   */
  private createMappedSelectInput<T extends string>(
    label: string,
    options: Array<{ value: T; label: string }>,
    value: T,
    onChange: (val: T) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'flex: 1; font-size: 12px;';
    row.appendChild(labelEl);

    const select = document.createElement('select');
    select.id = this.createFieldId(label);
    select.style.cssText = `
      width: 100px;
      padding: 6px;
      background: #333;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
      font-size: 12px;
    `;

    for (const optionData of options) {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.label;
      option.selected = optionData.value === value;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      onChange(select.value as T);
    });

    labelEl.htmlFor = select.id;
    row.appendChild(select);
    return row;
  }

  private createFieldId(label: string): string {
    propertyFieldId += 1;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `property-${slug || 'field'}-${propertyFieldId}`;
  }

  /**
   * Create a read-only detail row.
   */
  private createReadOnlyDetail(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.cssText = 'flex: 1; font-size: 12px;';
    row.appendChild(labelEl);

    const valueEl = document.createElement('span');
    valueEl.textContent = value;
    valueEl.style.cssText = 'font-size: 12px; color: #aaa;';
    row.appendChild(valueEl);

    return row;
  }

  /**
   * Create a summary card for a sketch entity.
   */
  private createSketchEntityCard(entity: SketchEntity, index: number): HTMLElement {
    const card = document.createElement('div');
    card.style.cssText = `
      margin-top: 8px;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      border: 1px solid #333;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size: 12px; font-weight: bold; color: #ddd;';

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size: 11px; color: #888;';
    meta.textContent = entity.id;

    if (entity.type === 'rectangle') {
      const rectangle = entity as RectangleEntity;
      title.textContent = `Rectangle ${index}`;
      header.appendChild(title);
      header.appendChild(meta);
      card.appendChild(header);
      card.appendChild(
        this.createReadOnlyDetail(
          'Origin',
          this.formatPoint2D(rectangle.origin)
        )
      );
      card.appendChild(
        this.createReadOnlyDetail(
          'Size',
          `${this.formatNumber(rectangle.width)} × ${this.formatNumber(rectangle.height)}`
        )
      );
      card.appendChild(
        this.createReadOnlyDetail(
          'Rotation',
          `${this.formatNumber((rectangle.rotation * 180) / Math.PI, 1)}°`
        )
      );
      return card;
    }

    if (entity.type === 'line') {
      const line = entity as LineEntity;
      const dx = (line.end[0] ?? 0) - (line.start[0] ?? 0);
      const dy = (line.end[1] ?? 0) - (line.start[1] ?? 0);
      const length = Math.sqrt(dx * dx + dy * dy);
      title.textContent = `Line ${index}`;
      header.appendChild(title);
      header.appendChild(meta);
      card.appendChild(header);
      card.appendChild(this.createReadOnlyDetail('Start', this.formatPoint2D(line.start)));
      card.appendChild(this.createReadOnlyDetail('End', this.formatPoint2D(line.end)));
      card.appendChild(this.createReadOnlyDetail('Length', this.formatNumber(length)));
      return card;
    }

    title.textContent = `Entity ${index}`;
    header.appendChild(title);
    header.appendChild(meta);
    card.appendChild(header);
    card.appendChild(this.createReadOnlyDetail('Type', (entity as { type: string }).type));
    return card;
  }

  /**
   * Render action buttons.
   */
  private renderActions(): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      gap: 8px;
      margin-top: 16px;
      padding-top: 8px;
      border-top: 1px solid #333;
    `;

    // Apply button
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.disabled = !this.isDirty;
    applyBtn.style.cssText = `
      flex: 1;
      padding: 8px;
      background: ${this.isDirty ? '#1a5fb4' : '#333'};
      border: none;
      border-radius: 4px;
      color: ${this.isDirty ? '#fff' : '#666'};
      cursor: ${this.isDirty ? 'pointer' : 'not-allowed'};
      font-size: 12px;
    `;
    applyBtn.addEventListener('click', () => {
      this.applyChanges();
    });
    container.appendChild(applyBtn);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = `
      flex: 1;
      padding: 8px;
      background: #333;
      border: none;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      font-size: 12px;
    `;
    resetBtn.addEventListener('click', () => {
      if (this.currentFeature) {
        this.setFeature(this.currentFeature);
      }
    });
    container.appendChild(resetBtn);

    return container;
  }

  /**
   * Render diagnostics section.
   */
  private renderDiagnostics(): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = `
      margin-top: 16px;
      padding: 8px;
      background: #2a1a1a;
      border-radius: 4px;
      border: 1px solid #4a2a2a;
    `;

    const title = document.createElement('div');
    title.textContent = 'Issues';
    title.style.cssText = 'font-size: 12px; font-weight: bold; color: #ff6b6b; margin-bottom: 8px;';
    container.appendChild(title);

    for (const d of this.diagnostics) {
      const item = document.createElement('div');
      item.textContent = `${d.code}: ${d.message}`;
      item.style.cssText = `
        font-size: 11px;
        color: ${d.severity === 'error' ? '#ff6b6b' : '#feca57'};
        margin-bottom: 4px;
      `;
      container.appendChild(item);
    }

    return container;
  }

  /**
   * Update a parameter value.
   */
  private updateParameters(updates: Record<string, unknown>): void {
    if (!this.currentFeature) return;
    this.currentFeature = {
      ...this.currentFeature,
      parameters: {
        ...this.currentFeature.parameters,
        ...updates,
      },
    };
    this.isDirty = true;
    this.updateApplyButton();
  }

  private updateExtrudeExtent(
    updates: {
      direction?: 'OneSided' | 'Symmetric';
      limit?: 'Distance' | 'UpToFace' | 'ThroughAll';
    },
    legacyCut = false
  ): void {
    if (!this.currentFeature) return;
    const params = this.currentFeature.parameters as unknown as ExtrudeParams | ExtrudeCutParams;
    const currentExtent = params.extent ?? {
      direction: 'OneSided',
      limit: 'Distance',
      ...(params.distance !== undefined ? { distance: params.distance } : {}),
    };
    const extent = { ...currentExtent, ...updates };
    this.updateParameters({
      extent,
      ...(legacyCut && updates.limit
        ? { mode: updates.limit === 'ThroughAll' ? 'through' : 'distance' }
        : {}),
    });
  }

  private updateParameter(key: string, value: unknown): void {
    this.updateParameters({ [key]: value });
  }

  private updateTransformPlacement(
    update: (placement: TransformBodiesParams['placement']) => TransformBodiesParams['placement'],
  ): void {
    if (!this.currentFeature) return;
    const params = this.currentFeature.parameters as unknown as TransformBodiesParams;
    this.updateParameter('placement', update(params.placement));
  }

  /**
   * Update origin at specific index.
   */
  private updateOrigin(index: number, value: number): void {
    if (!this.currentFeature) return;
    const params = this.currentFeature.parameters as unknown as BoxParams;
    const origin = [...(params.origin ?? [0, 0, 0])] as [number, number, number];
    origin[index] = value;
    this.updateParameter('origin', origin);
  }

  /**
   * Update sketch plane reference properties for world-plane sketches.
   */
  private updateSketchPlaneRef(updates: Partial<PlaneRef>): void {
    if (!this.currentFeature) return;
    const params = this.currentFeature.parameters as unknown as SketchParams;
    if (params.planeRef.type !== 'world') {
      return;
    }

    this.updateParameter('planeRef', {
      ...params.planeRef,
      ...updates,
      type: 'world',
    });
  }

  /** Update a normalized driving dimension without invalidating its legacy cache. */
  private updateSketchDrivingDimension(
    params: NormalizedSketchParams,
    dimensionId: string,
    value: number
  ): void {
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }

    const drivingDimensions = params.drivingDimensions.map((dimension) =>
      dimension.id === dimensionId ? { ...dimension, value } : { ...dimension }
    );
    if (!drivingDimensions.some((dimension) => dimension.id === dimensionId)) {
      return;
    }

    const solved = solveSketchConstraints(params.geometry, [
      ...params.relations,
      ...drivingDimensions,
    ]);
    if (!solved.ok) {
      return;
    }

    const dimensions = params.dimensions.map((dimension) =>
      dimension.id === dimensionId ? { ...dimension, value } : { ...dimension }
    );
    const {
      legacySourceSignature: _legacySourceSignature,
      ...paramsWithoutLegacySignature
    } = params;
    const nextParams = migrateSketchParams({
      ...paramsWithoutLegacySignature,
      dimensions,
      geometry: solved.geometry,
      relations: params.relations.map((relation) => ({ ...relation })),
      drivingDimensions,
    });

    this.currentFeature = {
      ...this.currentFeature!,
      parameters: nextParams as unknown as Record<string, unknown>,
    };
    this.isDirty = true;
    this.updateApplyButton();
  }

  /**
   * Format a number for compact inspector display.
   */
  private formatNumber(value: number, digits = 2): string {
    return Number.isFinite(value) ? value.toFixed(digits) : '0.00';
  }

  /**
   * Format a 2D sketch point.
   */
  private formatPoint2D(point: [number, number]): string {
    return `(${this.formatNumber(point[0] ?? 0)}, ${this.formatNumber(point[1] ?? 0)})`;
  }

  /**
   * Update apply button state.
   */
  private updateApplyButton(): void {
    const applyBtn = this.contentElement.querySelector('button');
    if (applyBtn) {
      applyBtn.textContent = 'Apply';
      applyBtn.disabled = !this.isDirty;
      applyBtn.style.background = this.isDirty ? '#1a5fb4' : '#333';
      applyBtn.style.color = this.isDirty ? '#fff' : '#666';
      applyBtn.style.cursor = this.isDirty ? 'pointer' : 'not-allowed';
    }
  }

  /**
   * Apply parameter changes.
   */
  private applyChanges(): void {
    if (!this.currentFeature || !this.isDirty) return;

    eventBus.emit('feature:update', {
      featureId: this.currentFeature.id,
      parameters: this.currentFeature.parameters,
    });

    this.isDirty = false;
    this.updateApplyButton();
    log.debug('Applied feature changes', { id: this.currentFeature.id });
  }

  /**
   * Dispose the inspector.
   */
  dispose(): void {
    this.container.removeChild(this.contentElement);
    log.debug('PropertyInspector disposed');
  }
}
