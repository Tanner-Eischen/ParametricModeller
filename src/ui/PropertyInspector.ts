import { createModuleLogger } from '../core/logger';
import { eventBus } from '../core';
import type { FeatureRecord, Diagnostic } from '../features';
import type { BoxParams } from '../features/primitives';
import type { SketchParams, ExtrudeParams, ExtrudeCutParams, LinearPatternParams, MirrorParams, DuplicateParams } from '../features';
import type { MoveVertexParams } from '../features/vertex';

const log = createModuleLogger('PropertyInspector');

/**
 * Options for the PropertyInspector.
 */
export interface PropertyInspectorOptions {
  container: HTMLElement;
}

/**
 * Panel for editing feature parameters.
 */
export class PropertyInspector {
  private container: HTMLElement;
  private contentElement: HTMLElement;
  private currentFeature: FeatureRecord | null = null;
  private diagnostics: Diagnostic[] = [];
  private isDirty = false;

  constructor(options: PropertyInspectorOptions) {
    this.container = options.container;
    this.contentElement = this.createContentElement();
    this.container.appendChild(this.contentElement);
    this.setupEventListeners();
    log.debug('PropertyInspector initialized');
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

    eventBus.on('feature:diagnostics', ({ diagnostics }) => {
      this.setDiagnostics(diagnostics as Diagnostic[]);
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
    const empty = document.createElement('div');
    empty.textContent = 'Select a feature to edit';
    empty.style.cssText = 'color: #666; padding: 16px; text-align: center;';
    this.contentElement.appendChild(empty);
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

    if (this.currentFeature.type === 'sketch') {
      return this.renderSketchParameters(container);
    }

    if (this.currentFeature.type === 'extrude') {
      return this.renderExtrudeParameters(container);
    }

    if (this.currentFeature.type === 'extrudeCut') {
      return this.renderExtrudeCutParameters(container);
    }

    if (this.currentFeature.type === 'linearPattern') {
      return this.renderLinearPatternParameters(container);
    }

    if (this.currentFeature.type === 'mirror') {
      return this.renderMirrorParameters(container);
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

    // Generic parameter display for unknown types
    const params = this.currentFeature.parameters;
    for (const [key, value] of Object.entries(params)) {
      const row = this.createParamRow(key, String(value), () => {});
      container.appendChild(row);
    }

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

    // Depth
    container.appendChild(
      this.createNumberInput('Depth (Y)', params.depth, (val) => {
        this.updateParameter('depth', val);
      })
    );

    // Height
    container.appendChild(
      this.createNumberInput('Height (Z)', params.height, (val) => {
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
    container.appendChild(this.createSectionLabel('Anchor'));
    container.appendChild(
      this.createSelectInput(
        ['corner', 'center'],
        params.anchorMode ?? 'corner',
        (val) => {
          this.updateParameter('anchorMode', val);
        }
      )
    );

    return container;
  }

  /**
   * Render sketch-specific parameters.
   */
  private renderSketchParameters(container: HTMLElement): HTMLElement {
    if (!this.currentFeature) return container;

    const params = this.currentFeature.parameters as unknown as SketchParams;

    // Plane reference info
    container.appendChild(this.createSectionLabel('Plane Reference'));
    const planeInfo = document.createElement('div');
    planeInfo.style.cssText = 'font-size: 12px; color: #aaa; margin-bottom: 8px;';
    if (params.planeRef.type === 'world') {
      planeInfo.textContent = `World Plane: ${params.planeRef.worldPlane?.toUpperCase() ?? 'XY'} (offset: ${params.planeRef.offset ?? 0})`;
    } else {
      planeInfo.textContent = `Face: ${params.planeRef.faceId ?? 'unknown'} (body: ${params.planeRef.bodyId ?? 'unknown'})`;
    }
    container.appendChild(planeInfo);

    // Entities count
    container.appendChild(this.createSectionLabel('Entities'));
    const entitiesInfo = document.createElement('div');
    entitiesInfo.style.cssText = 'font-size: 12px; color: #aaa;';
    const rectCount = params.entities.filter(e => e.type === 'rectangle').length;
    entitiesInfo.textContent = `${params.entities.length} entities (${rectCount} rectangles)`;
    container.appendChild(entitiesInfo);

    // Show rectangle details if present
    for (const entity of params.entities) {
      if (entity.type === 'rectangle') {
        const rectDiv = document.createElement('div');
        rectDiv.style.cssText = 'margin-top: 8px; padding: 8px; background: #2a2a2a; border-radius: 4px;';
        rectDiv.innerHTML = `
          <div style="font-size: 11px; color: #888;">Rectangle: ${entity.id}</div>
          <div style="font-size: 12px; margin-top: 4px;">
            ${entity.width.toFixed(2)} x ${entity.height.toFixed(2)}
          </div>
        `;
        container.appendChild(rectDiv);
      }
    }

    // Dimensions
    if (params.dimensions.length > 0) {
      container.appendChild(this.createSectionLabel('Dimensions'));
      for (const dim of params.dimensions) {
        container.appendChild(
          this.createNumberInput(`${dim.type}`, dim.value, (val) => {
            // Update dimension value
            const newDimensions = params.dimensions.map(d =>
              d.id === dim.id ? { ...d, value: val } : d
            );
            this.updateParameter('dimensions', newDimensions);
          })
        );
      }
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

    // Distance
    container.appendChild(
      this.createNumberInput('Distance', params.distance ?? 1, (val) => {
        this.updateParameter('distance', val);
      })
    );

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

    const flipLabel = document.createElement('span');
    flipLabel.textContent = 'Flip Direction';
    flipLabel.style.cssText = 'font-size: 12px;';

    flipContainer.appendChild(flipCheckbox);
    flipContainer.appendChild(flipLabel);
    container.appendChild(flipContainer);

    // Mode
    container.appendChild(this.createSectionLabel('Mode'));
    const modeInfo = document.createElement('div');
    modeInfo.style.cssText = 'font-size: 12px; color: #aaa;';
    modeInfo.textContent = params.mode ?? 'newBody';
    container.appendChild(modeInfo);

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

    // Mode selector
    container.appendChild(this.createSectionLabel('Cut Mode'));
    const modeContainer = document.createElement('div');
    modeContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px;';

    const distanceRadio = document.createElement('input');
    distanceRadio.type = 'radio';
    distanceRadio.name = 'cutMode';
    distanceRadio.value = 'distance';
    distanceRadio.checked = params.mode !== 'through';
    distanceRadio.style.cssText = 'width: 16px; height: 16px;';
    distanceRadio.addEventListener('change', () => {
      if (distanceRadio.checked) {
        this.updateParameter('mode', 'distance');
      }
    });

    const distanceLabel = document.createElement('span');
    distanceLabel.textContent = 'Distance';
    distanceLabel.style.cssText = 'font-size: 12px; margin-right: 16px;';

    const throughRadio = document.createElement('input');
    throughRadio.type = 'radio';
    throughRadio.name = 'cutMode';
    throughRadio.value = 'through';
    throughRadio.checked = params.mode === 'through';
    throughRadio.style.cssText = 'width: 16px; height: 16px;';
    throughRadio.addEventListener('change', () => {
      if (throughRadio.checked) {
        this.updateParameter('mode', 'through');
      }
    });

    const throughLabel = document.createElement('span');
    throughLabel.textContent = 'Through All';
    throughLabel.style.cssText = 'font-size: 12px;';

    modeContainer.appendChild(distanceRadio);
    modeContainer.appendChild(distanceLabel);
    modeContainer.appendChild(throughRadio);
    modeContainer.appendChild(throughLabel);
    container.appendChild(modeContainer);

    // Distance (conditional on mode === 'distance')
    if (params.mode !== 'through') {
      container.appendChild(
        this.createNumberInput('Distance', params.distance ?? 0.5, (val) => {
          this.updateParameter('distance', val);
        })
      );
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

    const flipLabel = document.createElement('span');
    flipLabel.textContent = 'Flip Direction';
    flipLabel.style.cssText = 'font-size: 12px;';

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

    const symmetricLabel = document.createElement('span');
    symmetricLabel.textContent = 'Symmetric';
    symmetricLabel.style.cssText = 'font-size: 12px;';

    symmetricContainer.appendChild(symmetricCheckbox);
    symmetricContainer.appendChild(symmetricLabel);
    container.appendChild(symmetricContainer);

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

    // Mirror plane info (read-only for v1)
    container.appendChild(this.createSectionLabel('Mirror Plane'));
    const planeInfo = document.createElement('div');
    planeInfo.style.cssText = 'font-size: 12px; color: #aaa;';
    if (params.planeRef?.type === 'world') {
      planeInfo.textContent = `World Plane: ${params.planeRef.worldPlane?.toUpperCase() ?? 'YZ'} (offset: ${params.planeRef.offset ?? 0})`;
    } else {
      planeInfo.textContent = `Face Plane: ${params.planeRef?.faceId ?? 'unknown'}`;
    }
    container.appendChild(planeInfo);

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
      label.textContent = axisLabels[i];
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
  private createNumberInput(
    label: string,
    value: number,
    onChange: (val: number) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'flex: 1; font-size: 12px;';
    row.appendChild(labelEl);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.value = String(value);
    input.style.cssText = `
      width: 80px;
      padding: 4px 8px;
      background: #333;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
      font-size: 12px;
    `;

    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        onChange(val);
      }
    });

    row.appendChild(input);
    return row;
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
    options: string[],
    value: string,
    onChange: (val: string) => void
  ): HTMLElement {
    const select = document.createElement('select');
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

    return select;
  }

  /**
   * Create a generic parameter row.
   */
  private createParamRow(
    key: string,
    value: string,
    _onChange: (val: string) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const label = document.createElement('span');
    label.textContent = key;
    label.style.cssText = 'flex: 1; font-size: 12px;';
    row.appendChild(label);

    const val = document.createElement('span');
    val.textContent = value;
    val.style.cssText = 'font-size: 12px; color: #aaa;';
    row.appendChild(val);

    return row;
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
  private updateParameter(key: string, value: unknown): void {
    if (!this.currentFeature) return;
    this.currentFeature = {
      ...this.currentFeature,
      parameters: {
        ...this.currentFeature.parameters,
        [key]: value,
      },
    };
    this.isDirty = true;
    this.updateApplyButton();
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
