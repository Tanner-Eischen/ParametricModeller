import { createModuleLogger } from '../core/logger';
import {
  getRectangleCorners,
  createCenterRectangle,
  createRegularPolygon,
  findSketchInferences,
  type Sketch,
  type RectangleEntity,
  type LineEntity,
  type SketchDimension,
  type Point2D,
  type InferenceSegment,
  type SketchInferenceCandidate,
  type SketchPrimitiveResult,
  type NormalizedSketchGeometry,
  type SketchConstraint,
  type DrivingDistanceDimension,
} from '../sketch';
import { analyzeSketchProfiles, type ProfileAnalysis } from '../sketch/ProfileAnalyzer';
import type { ConstructionPlane } from '../geometry';
import { Vector3, type Camera } from 'three';
import {
  ConstructionPlaneProjector,
  SKETCH_CAMERA_CHANGE_EVENT,
  createFallbackSketchCamera,
  getRegisteredSketchCamera,
  type ScreenPoint,
} from '../rendering/SketchProjector';

const log = createModuleLogger('SketchOverlay');

export interface SketchOverlayOptions {
  /** Container element to attach overlay to */
  container: HTMLElement;
  /** Background color of the overlay */
  backgroundColor?: string;
  /** Grid color */
  gridColor?: string;
  /** Entity stroke color */
  entityColor?: string;
  /** Selected entity color */
  selectedColor?: string;
  /** Dimension label color */
  dimensionColor?: string;
  /** Axis color */
  axisColor?: string;
  /** Optional explicit camera for embedded/standalone overlays. */
  camera?: Camera;
}

export type SketchOverlayTool = 'select' | 'rectangle' | 'line';

type ResolvedSketchOverlayOptions = Required<Omit<SketchOverlayOptions, 'container' | 'camera'>>;

const DEFAULT_OPTIONS: ResolvedSketchOverlayOptions = {
  backgroundColor: 'rgba(0, 0, 0, 0.0)',
  gridColor: 'rgba(100, 100, 100, 0.3)',
  entityColor: '#4a9eff',
  selectedColor: '#ffd700',
  dimensionColor: '#ffffff',
  axisColor: '#666666',
};

export interface SketchEditableHandle {
  id: string;
  entityId: string;
  kind: 'endpoint' | 'vertex';
  point: Point2D;
  /** Stable shared-point reference when normalized sketch geometry is active. */
  pointId?: string;
}

/** Coordinates supplied for a primary-button click that misses sketch geometry. */
export interface SketchBlankPick {
  sketchPoint: Point2D;
  client: ScreenPoint;
  canvas: ScreenPoint;
}

/** A normalized or legacy line-segment pick with the exact clicked sketch point. */
export interface SketchSegmentPick extends SketchBlankPick {
  segmentId: string;
}

export type SketchDisplayUnit = 'in' | 'mm';

/** Presentation-only normalized sketch state supplied by the application. */
export interface NormalizedSketchOverlayContext {
  geometry: NormalizedSketchGeometry;
  relations: readonly SketchConstraint[];
  drivingDimensions: readonly DrivingDistanceDimension[];
  displayUnit?: SketchDisplayUnit;
}

export type SketchPreviewKind = 'center-rectangle' | 'polygon' | 'trim' | 'extend' | 'project';

export interface SketchOperationPreview {
  kind: SketchPreviewKind;
  points: Point2D[];
  closed: boolean;
  message: string;
}

/**
 * 2D overlay for sketch editing mode.
 * Renders sketch entities, dimensions, and workflow hints using a 2D canvas.
 */
export class SketchOverlay {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: ResolvedSketchOverlayOptions;
  private cameraOverride: Camera | null;
  private projector: ConstructionPlaneProjector | null = null;
  private currentSketch: Sketch | null = null;
  private currentPlane: ConstructionPlane | null = null;
  private selectedEntityId: string | null = null;
  private visible = false;
  private activeTool: SketchOverlayTool = 'select';
  private rectangleDraftStart: Point2D | null = null;
  private rectangleDraftEnd: Point2D | null = null;
  private lineDraftAnchor: Point2D | null = null;
  private lineDraftCursor: Point2D | null = null;
  private activeInference: SketchInferenceCandidate | null = null;
  private operationPreview: SketchOperationPreview | null = null;
  private normalizedContext: NormalizedSketchOverlayContext | null = null;

  private clickHandler: ((entityId: string) => void) | null = null;
  private rectangleCreateHandler: ((start: Point2D, end: Point2D) => void) | null = null;
  private linePointHandler: ((point: Point2D) => void) | null = null;
  private handleClickHandler: ((handle: SketchEditableHandle) => void) | null = null;
  private pointClickHandler: ((pointId: string) => void) | null = null;
  private segmentClickHandler: ((segmentId: string) => void) | null = null;
  private blankPickHandler: ((pick: SketchBlankPick) => void) | null = null;
  private segmentPickHandler: ((pick: SketchSegmentPick) => void) | null = null;
  private resizeObserver: ResizeObserver;

  constructor(options: SketchOverlayOptions) {
    this.container = options.container;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cameraOverride = options.camera ?? null;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
    `;
    this.canvas.id = 'sketch-overlay';
    this.canvas.dataset.testid = 'sketch-canvas';
    this.canvas.setAttribute('aria-label', 'Sketch drawing canvas');

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context');
    }
    this.ctx = ctx;

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    this.canvas.addEventListener('pointerdown', this.handleDrawingPointerEvent);
    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.container.addEventListener(SKETCH_CAMERA_CHANGE_EVENT, this.handleCameraChange);

    this.canvas.style.display = 'none';
    this.container.appendChild(this.canvas);

    log.debug('SketchOverlay created');
  }

  /**
   * Show the overlay for a specific sketch.
   */
  show(sketch: Sketch, plane: ConstructionPlane): void {
    this.currentSketch = sketch;
    this.currentPlane = plane;
    this.visible = true;
    this.canvas.style.display = 'block';
    this.canvas.style.pointerEvents = 'auto';
    this.refreshProjector();
    this.handleResize();
    this.render();
    log.info('SketchOverlay shown', { sketchId: sketch.id });
  }

  /**
   * Hide the overlay.
   */
  hide(): void {
    this.visible = false;
    this.canvas.style.display = 'none';
    this.canvas.style.pointerEvents = 'none';
    this.currentSketch = null;
    this.currentPlane = null;
    this.rectangleDraftStart = null;
    this.rectangleDraftEnd = null;
    this.lineDraftCursor = null;
    this.activeInference = null;
    this.operationPreview = null;
    this.normalizedContext = null;
    log.info('SketchOverlay hidden');
  }

  /**
   * Check if overlay is visible.
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Set the selected entity.
   */
  setSelectedEntity(entityId: string | null): void {
    this.selectedEntityId = entityId;
    this.render();
  }

  setTool(tool: SketchOverlayTool): void {
    this.activeTool = tool;
    if (tool !== 'rectangle') {
      this.rectangleDraftStart = null;
      this.rectangleDraftEnd = null;
    }
    if (tool !== 'line') {
      this.lineDraftCursor = null;
    }
    this.render();
  }

  setLineDraftAnchor(point: Point2D | null): void {
    this.lineDraftAnchor = point ? [...point] : null;
    if (!point) {
      this.lineDraftCursor = null;
    }
    this.render();
  }

  /**
   * Register click handler for entity selection.
   */
  onEntityClick(handler: (entityId: string) => void): void {
    this.clickHandler = handler;
  }

  onRectangleCreate(handler: (start: Point2D, end: Point2D) => void): void {
    this.rectangleCreateHandler = handler;
  }

  onLinePoint(handler: (point: Point2D) => void): void {
    this.linePointHandler = handler;
  }

  onHandleClick(handler: (handle: SketchEditableHandle) => void): void {
    this.handleClickHandler = handler;
  }

  /** Register selection of a normalized shared point by its stable ID. */
  onPointClick(handler: (pointId: string) => void): void {
    this.pointClickHandler = handler;
  }

  /** Register selection of a normalized segment by its stable ID. */
  onSegmentClick(handler: (segmentId: string) => void): void {
    this.segmentClickHandler = handler;
  }

  /** Register a primary-button click that misses every sketch handle and entity. */
  onBlankPick(handler: (pick: SketchBlankPick) => void): void {
    this.blankPickHandler = handler;
  }

  /** Register a primary-button line-segment click with its clicked sketch position. */
  onSegmentPick(handler: (pick: SketchSegmentPick) => void): void {
    this.segmentPickHandler = handler;
  }

  /**
   * Set presentation-only normalized geometry and annotations.
   * Input is copied so overlay previews and selection cannot mutate document state.
   */
  setNormalizedContext(context: NormalizedSketchOverlayContext | null): void {
    this.normalizedContext = context ? cloneNormalizedOverlayContext(context) : null;
    this.render();
  }

  setCamera(camera: Camera | null): void {
    this.cameraOverride = camera;
    this.refreshProjector();
    this.render();
  }

  getEditableHandles(): SketchEditableHandle[] {
    if (this.normalizedContext) {
      return this.normalizedContext.geometry.points.map((point) => ({
        id: point.id,
        entityId: point.id,
        kind: 'vertex',
        point: [...point.position],
        pointId: point.id,
      }));
    }
    if (!this.currentSketch) return [];
    const handles: SketchEditableHandle[] = [];
    for (const entity of this.currentSketch.entities) {
      if (entity.type === 'line') {
        handles.push(
          { id: `${entity.id}:start`, entityId: entity.id, kind: 'endpoint', point: [...entity.start] },
          { id: `${entity.id}:end`, entityId: entity.id, kind: 'endpoint', point: [...entity.end] }
        );
        continue;
      }
      getRectangleCorners(entity).forEach((point, index) => handles.push({
        id: `${entity.id}:vertex:${index}`,
        entityId: entity.id,
        kind: 'vertex',
        point: [...point],
      }));
    }
    return handles;
  }

  hitTestHandle(x: number, y: number, tolerance = 8): SketchEditableHandle | null {
    return this.getEditableHandles().find((handle) => {
      const screen = this.projectPoint(handle.point);
      return screen ? Math.hypot(screen.x - x, screen.y - y) <= tolerance : false;
    }) ?? null;
  }

  getActiveInference(): SketchInferenceCandidate | null {
    return this.activeInference ? { ...this.activeInference, point: [...this.activeInference.point] } : null;
  }

  getProfileFeedback(): ProfileAnalysis {
    return this.currentSketch
      ? analyzeSketchProfiles(this.currentSketch)
      : { profiles: [], issues: [] };
  }

  getOperationPreview(): SketchOperationPreview | null {
    return this.operationPreview
      ? { ...this.operationPreview, points: this.operationPreview.points.map((point) => [...point]) }
      : null;
  }

  previewCenterRectangle(center: Point2D, corner: Point2D): SketchPrimitiveResult {
    const result = createCenterRectangle(center, corner);
    this.setPrimitivePreview('center-rectangle', result, 'Center rectangle preview');
    return result;
  }

  previewRegularPolygon(center: Point2D, vertex: Point2D, sides: number): SketchPrimitiveResult {
    const result = createRegularPolygon(center, vertex, sides);
    this.setPrimitivePreview('polygon', result, `${sides}-sided polygon preview`);
    return result;
  }

  previewTrim(points: readonly Point2D[], message = 'Trim preview'): void {
    this.setPathPreview('trim', points, false, message);
  }

  previewExtend(points: readonly Point2D[], message = 'Extend preview'): void {
    this.setPathPreview('extend', points, false, message);
  }

  previewProject(points: readonly Point2D[], closed = false, message = 'Projected geometry preview'): void {
    this.setPathPreview('project', points, closed, message);
  }

  clearOperationPreview(): void {
    this.operationPreview = null;
    this.render();
  }

  projectPoint(point: Point2D): ScreenPoint | null {
    const { width, height } = this.getViewportSize();
    return this.projector?.sketchToScreen(point, width, height) ?? null;
  }

  unprojectPoint(x: number, y: number): Point2D | null {
    const { width, height } = this.getViewportSize();
    return this.projector?.screenToSketch(x, y, width, height) ?? null;
  }

  /**
   * Render the sketch overlay.
   */
  render(): void {
    if (!this.currentSketch || !this.currentPlane) {
      return;
    }

    this.refreshProjector();

    const { width, height } = this.getViewportSize();

    this.ctx.clearRect(0, 0, width, height);
    this.drawStatusBar(width);
    this.drawAxesIndicator(height);

    if (this.normalizedContext) {
      this.drawNormalizedGeometry();
    } else {
      for (const entity of this.currentSketch.entities) {
        if (entity.type === 'rectangle') {
          this.drawRectangle(entity);
        } else if (entity.type === 'line') {
          this.drawLine(entity);
        }
      }
    }

    this.drawEditableHandles();
    this.drawNormalizedRelations();
    this.drawNormalizedDimensions();

    if (this.rectangleDraftStart && this.rectangleDraftEnd) {
      this.drawRectanglePreview(this.rectangleDraftStart, this.rectangleDraftEnd);
    }

    if (this.lineDraftAnchor && this.lineDraftCursor) {
      this.drawLinePreview(this.lineDraftAnchor, this.lineDraftCursor);
    }

    this.drawOperationPreview();
    this.drawInference();
    this.drawProfileIssues();

    if (!this.normalizedContext) {
      for (const [index, dimension] of this.currentSketch.dimensions.entries()) {
        this.drawDimension(dimension, index);
      }
    }

    log.debug('SketchOverlay rendered');
  }

  private drawRectangle(rect: RectangleEntity): void {
    const isSelected = rect.id === this.selectedEntityId;
    const color = isSelected ? this.options.selectedColor : this.options.entityColor;
    const corners = getRectangleCorners(rect).map((corner) => this.sketchToScreen(corner));

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = isSelected ? 3 : 2;
    this.ctx.fillStyle = isSelected ? 'rgba(255, 215, 0, 0.12)' : 'rgba(74, 158, 255, 0.1)';

    this.ctx.beginPath();
    this.ctx.moveTo(corners[0]!.x, corners[0]!.y);
    for (let i = 1; i < corners.length; i++) {
      this.ctx.lineTo(corners[i]!.x, corners[i]!.y);
    }
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    const origin = this.sketchToScreen(rect.origin);
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawLine(line: LineEntity): void {
    const isSelected = line.id === this.selectedEntityId;
    const color = isSelected ? this.options.selectedColor : this.options.entityColor;
    const start = this.sketchToScreen(line.start);
    const end = this.sketchToScreen(line.end);

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = isSelected ? 3 : 2;
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.lineTo(end.x, end.y);
    this.ctx.stroke();

    this.ctx.fillStyle = color;
    for (const point of [start, end]) {
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, isSelected ? 4 : 3, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawNormalizedGeometry(): void {
    const context = this.normalizedContext;
    if (!context) return;
    const points = this.getNormalizedPointMap();

    for (const segment of context.geometry.segments) {
      const startPoint = points.get(segment.startPointId);
      const endPoint = points.get(segment.endPointId);
      if (!startPoint || !endPoint) continue;
      const start = this.projectPoint(startPoint);
      const end = this.projectPoint(endPoint);
      if (!start || !end) continue;

      const isSelected = segment.id === this.selectedEntityId;
      this.ctx.strokeStyle = isSelected ? this.options.selectedColor : this.options.entityColor;
      this.ctx.lineWidth = isSelected ? 3 : 2;
      if (segment.construction) this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
      if (segment.construction) this.ctx.setLineDash([]);
    }
  }

  private drawNormalizedRelations(): void {
    const context = this.normalizedContext;
    if (!context) return;

    for (const relation of context.relations) {
      if (relation.suppressed) continue;
      const position = this.getRelationPosition(relation);
      if (!position) continue;
      const screen = this.projectPoint(position);
      if (!screen) continue;

      this.ctx.fillStyle = '#52f2a8';
      this.ctx.font = 'bold 12px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(getRelationGlyph(relation), screen.x + 9, screen.y - 9);
    }
  }

  private drawNormalizedDimensions(): void {
    const context = this.normalizedContext;
    if (!context) return;
    const points = this.getNormalizedPointMap();

    for (const dimension of context.drivingDimensions) {
      if (dimension.suppressed) continue;
      const pointA = points.get(dimension.pointAId);
      const pointB = points.get(dimension.pointBId);
      if (!pointA || !pointB) continue;
      const start = this.projectPoint(pointA);
      const end = this.projectPoint(pointB);
      if (!start || !end) continue;

      this.ctx.strokeStyle = this.options.dimensionColor;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([3, 3]);
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      this.ctx.fillStyle = this.options.dimensionColor;
      this.ctx.font = '12px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'bottom';
      const label = `${dimension.name ?? 'Distance'}: ${formatDrivingDistance(
        dimension.value,
        context.displayUnit ?? 'in'
      )}`;
      this.ctx.fillText(label, (start.x + end.x) / 2, (start.y + end.y) / 2 - 7);
    }
  }

  private drawRectanglePreview(start: Point2D, end: Point2D): void {
    const minX = Math.min(start[0], end[0]);
    const minY = Math.min(start[1], end[1]);
    const maxX = Math.max(start[0], end[0]);
    const maxY = Math.max(start[1], end[1]);
    const corners = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ].map((corner) => this.sketchToScreen(corner as Point2D));

    this.ctx.strokeStyle = '#8cd6ff';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 4]);
    this.ctx.fillStyle = 'rgba(140, 214, 255, 0.12)';
    this.ctx.beginPath();
    this.ctx.moveTo(corners[0]!.x, corners[0]!.y);
    for (let i = 1; i < corners.length; i++) {
      this.ctx.lineTo(corners[i]!.x, corners[i]!.y);
    }
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private drawLinePreview(start: Point2D, end: Point2D): void {
    const startPoint = this.sketchToScreen(start);
    const endPoint = this.sketchToScreen(end);

    this.ctx.strokeStyle = '#8cd6ff';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(startPoint.x, startPoint.y);
    this.ctx.lineTo(endPoint.x, endPoint.y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private drawEditableHandles(): void {
    for (const handle of this.getEditableHandles()) {
      const screen = this.projectPoint(handle.point);
      if (!screen) continue;
      const selected = handle.entityId === this.selectedEntityId;
      this.ctx.fillStyle = selected ? this.options.selectedColor : '#d9ecff';
      this.ctx.strokeStyle = '#1d5f8f';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      if (handle.kind === 'endpoint') {
        this.ctx.arc(screen.x, screen.y, selected ? 5 : 4, 0, Math.PI * 2);
      } else {
        this.ctx.moveTo(screen.x - 4, screen.y - 4);
        this.ctx.lineTo(screen.x + 4, screen.y - 4);
        this.ctx.lineTo(screen.x + 4, screen.y + 4);
        this.ctx.lineTo(screen.x - 4, screen.y + 4);
        this.ctx.closePath();
      }
      this.ctx.fill();
      this.ctx.stroke();
    }
  }

  private drawOperationPreview(): void {
    const preview = this.operationPreview;
    if (!preview || preview.points.length < 2) return;
    const points = preview.points.map((point) => this.projectPoint(point)).filter(isScreenPoint);
    if (points.length < 2) return;

    this.ctx.strokeStyle = preview.kind === 'trim' ? '#ff9f43' : '#c98cff';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(points[0]!.x, points[0]!.y);
    for (const point of points.slice(1)) this.ctx.lineTo(point.x, point.y);
    if (preview.closed) this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(preview.message, points[0]!.x + 10, points[0]!.y - 10);
  }

  private drawInference(): void {
    const inference = this.activeInference;
    if (!inference) return;
    const screen = this.projectPoint(inference.point);
    if (!screen) return;

    this.ctx.strokeStyle = '#52f2a8';
    this.ctx.fillStyle = '#52f2a8';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(inference.message, screen.x + 10, screen.y - 10);
  }

  private drawProfileIssues(): void {
    const issues = this.getProfileFeedback().issues;
    issues.forEach((issue, index) => {
      const point = issue.point ? this.projectPoint(issue.point) : null;
      if (point) {
        this.ctx.fillStyle = '#ff5c5c';
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 10px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('!', point.x, point.y + 0.5);
      }

      this.ctx.fillStyle = 'rgba(90, 16, 16, 0.9)';
      this.ctx.fillRect(12, 94 + index * 24, Math.min(520, this.getViewportSize().width - 24), 20);
      this.ctx.fillStyle = '#ffd6d6';
      this.ctx.font = '12px sans-serif';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(`${issue.code}: ${issue.message}`, 18, 108 + index * 24);
    });
  }

  private drawDimension(dimension: SketchDimension, index: number): void {
    this.ctx.font = '12px monospace';
    this.ctx.fillStyle = this.options.dimensionColor;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    const label = `${dimension.name ?? dimension.type}: ${dimension.value.toFixed(2)}`;
    this.ctx.fillText(label, 12, 64 + index * 18);
  }

  private drawStatusBar(width: number): void {
    const sketch = this.currentSketch;
    if (!sketch) {
      return;
    }

    const entityCount = this.normalizedContext?.geometry.segments.length ?? sketch.entities.length;
    const profileAnalysis = analyzeSketchProfiles(sketch);
    const profileCount = profileAnalysis.profiles.length;
    const prompt = this.getPrompt(profileCount, profileAnalysis.issues[0]?.message);

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    this.ctx.fillRect(0, 0, width, 56);

    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = 'left';
    this.ctx.font = '14px sans-serif';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(
      `Sketch Mode - ${this.getPlaneLabel()} - ${entityCount} entities`,
      12,
      18
    );

    this.ctx.font = '12px sans-serif';
    this.ctx.fillStyle = '#c8d0da';
    this.ctx.fillText(`${prompt}. Press Escape to exit sketch mode.`, 12, 39);

    this.ctx.textAlign = 'right';
    this.ctx.font = '14px sans-serif';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(sketch.name || 'Sketch', width - 12, 18);

    this.ctx.font = '12px sans-serif';
    this.ctx.fillStyle = this.getSelectedEntityLabel() ? this.options.selectedColor : '#c8d0da';
    this.ctx.fillText(
      this.getSelectedEntityLabel() ?? 'Click sketch geometry to select it',
      width - 12,
      39
    );
  }

  private drawAxesIndicator(height: number): void {
    const originX = 60;
    const originY = height - 60;
    const axisLength = 40;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.beginPath();
    this.ctx.arc(originX, originY, 50, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = '#ff4444';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(originX + axisLength, originY);
    this.ctx.stroke();

    this.ctx.fillStyle = '#ff4444';
    this.ctx.font = 'bold 12px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('X', originX + axisLength + 10, originY);

    this.ctx.strokeStyle = '#44ff44';
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(originX, originY - axisLength);
    this.ctx.stroke();

    this.ctx.fillStyle = '#44ff44';
    this.ctx.fillText('Y', originX, originY - axisLength - 10);
  }

  private sketchToScreen(point: Point2D): { x: number; y: number } {
    return this.projectPoint(point) ?? { x: Number.NaN, y: Number.NaN };
  }

  private handleClick = (event: MouseEvent): void => {
    if (!this.currentSketch || event.button !== 0) {
      return;
    }

    const point = this.eventToSketchPoint(event);
    if (!point) return;

    if (this.activeTool === 'line') {
      this.updateInference(point, this.lineDraftAnchor);
      this.linePointHandler?.(this.activeInference?.point ?? point);
      return;
    }

    if (
      !this.clickHandler
      && !this.handleClickHandler
      && !this.pointClickHandler
      && !this.segmentClickHandler
      && !this.blankPickHandler
      && !this.segmentPickHandler
    ) {
      return;
    }

    const canvasRect = this.canvas.getBoundingClientRect();
    const x = event.clientX - canvasRect.left;
    const y = event.clientY - canvasRect.top;
    const pick: SketchBlankPick = {
      sketchPoint: [...point],
      client: { x: event.clientX, y: event.clientY },
      canvas: { x, y },
    };
    const tolerance = 10;

    const handle = this.hitTestHandle(x, y, tolerance);
    if (handle) {
      this.handleClickHandler?.(handle);
      if (handle.pointId) {
        this.pointClickHandler?.(handle.pointId);
      }
      this.clickHandler?.(handle.entityId);
      return;
    }

    if (this.normalizedContext) {
      for (const segment of this.normalizedContext.geometry.segments) {
        if (this.hitTestNormalizedSegment(segment.id, x, y, tolerance)) {
          this.segmentClickHandler?.(segment.id);
          this.segmentPickHandler?.({
            ...pick,
            sketchPoint: [...pick.sketchPoint],
            client: { ...pick.client },
            canvas: { ...pick.canvas },
            segmentId: segment.id,
          });
          this.clickHandler?.(segment.id);
          return;
        }
      }
      this.blankPickHandler?.(pick);
      return;
    }

    for (const entity of this.currentSketch.entities) {
      if (entity.type === 'line' && this.hitTestLine(entity, x, y, tolerance)) {
        this.segmentPickHandler?.({
          ...pick,
          sketchPoint: [...pick.sketchPoint],
          client: { ...pick.client },
          canvas: { ...pick.canvas },
          segmentId: entity.id,
        });
        this.clickHandler?.(entity.id);
        return;
      }

      if (entity.type === 'rectangle' && this.hitTestRectangle(entity, x, y, tolerance)) {
        this.clickHandler?.(entity.id);
        return;
      }
    }
    this.blankPickHandler?.(pick);
  };

  private handleDrawingPointerEvent = (event: PointerEvent): void => {
    // The camera controls listen on the viewport container and capture primary
    // pointers that bubble from the overlay. Sketch selection is itself a
    // primary-pointer tool, so allowing Select-mode presses to bubble retargets
    // pointerup to the viewport and prevents the overlay click from firing.
    // Middle/right buttons still bubble so orbit and pan remain available.
    if (this.currentSketch && event.button === 0) {
      event.stopPropagation();
    }
  };

  private handleMouseDown = (event: MouseEvent): void => {
    if (!this.currentSketch || this.activeTool !== 'rectangle' || event.button !== 0) {
      return;
    }

    this.rectangleDraftStart = this.eventToSketchPoint(event);
    if (!this.rectangleDraftStart) return;
    this.rectangleDraftEnd = this.rectangleDraftStart;
    this.render();
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.currentSketch) {
      return;
    }

    const point = this.eventToSketchPoint(event);
    if (!point) return;
    const anchor = this.activeTool === 'rectangle' ? this.rectangleDraftStart : this.lineDraftAnchor;
    this.updateInference(point, anchor);
    const inferredPoint = this.activeInference?.point ?? point;
    if (this.activeTool === 'rectangle' && this.rectangleDraftStart) {
      this.rectangleDraftEnd = inferredPoint;
      this.render();
      return;
    }

    if (this.activeTool === 'line' && this.lineDraftAnchor) {
      this.lineDraftCursor = inferredPoint;
      this.render();
      return;
    }

    this.render();
  };

  private handleMouseUp = (event: MouseEvent): void => {
    if (
      !this.currentSketch
      || this.activeTool !== 'rectangle'
      || !this.rectangleDraftStart
      || event.button !== 0
    ) {
      return;
    }

    const start = this.rectangleDraftStart;
    const rawEnd = this.eventToSketchPoint(event);
    if (!rawEnd) return;
    this.updateInference(rawEnd, start);
    const end = this.activeInference?.point ?? rawEnd;
    this.rectangleDraftStart = null;
    this.rectangleDraftEnd = null;
    this.render();

    const width = Math.abs(end[0] - start[0]);
    const height = Math.abs(end[1] - start[1]);
    if (width < 0.05 || height < 0.05) {
      return;
    }

    this.rectangleCreateHandler?.(start, end);
  };

  private handleMouseLeave = (): void => {
    if (this.activeTool === 'rectangle' && this.rectangleDraftStart) {
      return;
    }

    if (this.lineDraftCursor) {
      this.lineDraftCursor = null;
    }
    this.activeInference = null;
    this.render();
  };

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.refreshProjector();

    if (this.visible) {
      this.render();
    }

    log.debug('SketchOverlay resized', { width: rect.width, height: rect.height });
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handleDrawingPointerEvent);
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.container.removeEventListener(SKETCH_CAMERA_CHANGE_EVENT, this.handleCameraChange);
    this.container.removeChild(this.canvas);
    log.debug('SketchOverlay disposed');
  }

  private getViewportSize(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      width: rect.width || this.canvas.clientWidth || this.canvas.width,
      height: rect.height || this.canvas.clientHeight || this.canvas.height,
    };
  }

  private getPlaneLabel(): string {
    if (!this.currentSketch) {
      return 'Unknown plane';
    }

    if (this.currentSketch.planeRef.type === 'world') {
      const plane = this.currentSketch.planeRef.worldPlane?.toUpperCase() ?? 'XY';
      const offset = this.currentSketch.planeRef.offset ?? 0;
      return offset === 0 ? `${plane} plane` : `${plane} plane @ ${offset.toFixed(2)}`;
    }

    return 'Selected face plane';
  }

  private getSelectedEntityLabel(): string | null {
    if (!this.currentSketch || !this.selectedEntityId) {
      return null;
    }

    if (this.normalizedContext) {
      if (this.normalizedContext.geometry.points.some((point) => point.id === this.selectedEntityId)) {
        return `Selected point ${this.selectedEntityId}`;
      }
      if (this.normalizedContext.geometry.segments.some((segment) => segment.id === this.selectedEntityId)) {
        return `Selected segment ${this.selectedEntityId}`;
      }
    }

    const entity = this.currentSketch.entities.find((candidate) => candidate.id === this.selectedEntityId);
    if (!entity) {
      return null;
    }

    return entity.type === 'rectangle'
      ? `Selected rectangle ${entity.id}`
      : `Selected line ${entity.id}`;
  }

  private hitTestRectangle(rect: RectangleEntity, x: number, y: number, tolerance: number): boolean {
    const corners = getRectangleCorners(rect).map((corner) => this.sketchToScreen(corner));
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);

    return (
      x >= Math.min(...xs) - tolerance &&
      x <= Math.max(...xs) + tolerance &&
      y >= Math.min(...ys) - tolerance &&
      y <= Math.max(...ys) + tolerance
    );
  }

  private hitTestLine(line: LineEntity, x: number, y: number, tolerance: number): boolean {
    const start = this.sketchToScreen(line.start);
    const end = this.sketchToScreen(line.end);
    return this.distanceToSegment({ x, y }, start, end) <= tolerance;
  }

  private hitTestNormalizedSegment(segmentId: string, x: number, y: number, tolerance: number): boolean {
    const segment = this.normalizedContext?.geometry.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) return false;
    const points = this.getNormalizedPointMap();
    const startPoint = points.get(segment.startPointId);
    const endPoint = points.get(segment.endPointId);
    if (!startPoint || !endPoint) return false;
    const start = this.projectPoint(startPoint);
    const end = this.projectPoint(endPoint);
    return start && end ? this.distanceToSegment({ x, y }, start, end) <= tolerance : false;
  }

  private getNormalizedPointMap(): Map<string, Point2D> {
    return new Map(
      this.normalizedContext?.geometry.points.map((point) => [point.id, point.position] as const) ?? []
    );
  }

  private getSegmentMidpoint(segmentId: string): Point2D | null {
    const segment = this.normalizedContext?.geometry.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) return null;
    const points = this.getNormalizedPointMap();
    const start = points.get(segment.startPointId);
    const end = points.get(segment.endPointId);
    return start && end ? midpoint(start, end) : null;
  }

  private getRelationPosition(relation: SketchConstraint): Point2D | null {
    const points = this.getNormalizedPointMap();
    switch (relation.type) {
      case 'coincident': {
        const pointA = points.get(relation.pointAId);
        const pointB = points.get(relation.pointBId);
        return pointA && pointB ? midpoint(pointA, pointB) : pointA ?? pointB ?? null;
      }
      case 'horizontal':
      case 'vertical':
        return this.getSegmentMidpoint(relation.segmentId);
      case 'parallel':
      case 'perpendicular':
      case 'equal': {
        const midpointA = this.getSegmentMidpoint(relation.segmentAId);
        const midpointB = this.getSegmentMidpoint(relation.segmentBId);
        return midpointA && midpointB ? midpoint(midpointA, midpointB) : midpointA ?? midpointB;
      }
      case 'fixed':
        return points.get(relation.pointId) ?? relation.position;
    }
  }

  private distanceToSegment(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return Math.hypot(point.x - start.x, point.y - start.y);
    }

    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    const projectionX = start.x + t * dx;
    const projectionY = start.y + t * dy;
    return Math.hypot(point.x - projectionX, point.y - projectionY);
  }

  private getPrompt(profileCount: number, issueMessage?: string): string {
    if (this.activeTool === 'rectangle') {
      return 'Drag in the viewport to draw a rectangle';
    }

    if (this.activeTool === 'line') {
      return this.lineDraftAnchor
        ? 'Click the next corner, or click near the first point to close the loop'
        : 'Click in the viewport to place the first corner of a line loop';
    }

    if (issueMessage) {
      return issueMessage;
    }

    return profileCount > 0
      ? `${profileCount} closed profile${profileCount === 1 ? '' : 's'} ready for extrude`
      : 'Choose Rectangle or Line, then draw a closed profile before extruding';
  }

  private eventToSketchPoint(event: MouseEvent): Point2D | null {
    const rect = this.canvas.getBoundingClientRect();
    return this.unprojectPoint(event.clientX - rect.left, event.clientY - rect.top);
  }

  private refreshProjector(): void {
    if (!this.currentPlane) {
      this.projector = null;
      return;
    }
    const { width, height } = this.getViewportSize();
    const registeredCamera = getRegisteredSketchCamera(this.container);
    const camera = this.cameraOverride
      ?? registeredCamera
      ?? createFallbackSketchCamera(width, height);
    if (!this.cameraOverride && !registeredCamera) {
      camera.position.set(...this.currentPlane.origin)
        .add(new Vector3(...this.currentPlane.normal).multiplyScalar(50));
      camera.up.set(...this.currentPlane.vAxis).normalize();
      camera.lookAt(...this.currentPlane.origin);
      camera.updateMatrixWorld(true);
    }
    this.projector = new ConstructionPlaneProjector(this.currentPlane, camera);
  }

  private updateInference(cursor: Point2D, anchor: Point2D | null): void {
    const projector = (point: Point2D): ScreenPoint =>
      this.projectPoint(point) ?? { x: Number.NaN, y: Number.NaN };
    this.activeInference = findSketchInferences(
      cursor,
      this.getInferenceSegments(),
      {
        projector,
        pixelTolerance: 10,
        ...(anchor ? { anchor } : {}),
      }
    )[0] ?? null;
  }

  private getInferenceSegments(): InferenceSegment[] {
    if (this.normalizedContext) {
      const points = this.getNormalizedPointMap();
      return this.normalizedContext.geometry.segments.flatMap((segment): InferenceSegment[] => {
        const start = points.get(segment.startPointId);
        const end = points.get(segment.endPointId);
        return start && end ? [{ id: segment.id, start, end }] : [];
      });
    }
    if (!this.currentSketch) return [];
    return this.currentSketch.entities.flatMap((entity) => {
      if (entity.type === 'line') {
        return [{ id: entity.id, start: entity.start, end: entity.end }];
      }
      const corners = getRectangleCorners(entity);
      return corners.map((start, index) => ({
        id: `${entity.id}:edge:${index}`,
        start,
        end: corners[(index + 1) % corners.length]!,
      }));
    });
  }

  private setPrimitivePreview(
    kind: 'center-rectangle' | 'polygon',
    result: SketchPrimitiveResult,
    message: string
  ): void {
    this.operationPreview = result.ok
      ? { kind, points: result.points.map((point) => [...point]), closed: true, message }
      : null;
    this.render();
  }

  private setPathPreview(
    kind: 'trim' | 'extend' | 'project',
    points: readonly Point2D[],
    closed: boolean,
    message: string
  ): void {
    this.operationPreview = {
      kind,
      points: points.map((point) => [point[0], point[1]]),
      closed,
      message,
    };
    this.render();
  }

  private handleCameraChange = (): void => {
    if (this.visible) this.render();
  };
}

function isScreenPoint(point: ScreenPoint | null): point is ScreenPoint {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function cloneNormalizedOverlayContext(
  context: NormalizedSketchOverlayContext
): NormalizedSketchOverlayContext {
  return {
    geometry: {
      schemaVersion: context.geometry.schemaVersion,
      points: context.geometry.points.map((point) => ({
        ...point,
        position: [...point.position],
      })),
      segments: context.geometry.segments.map((segment) => ({ ...segment })),
    },
    relations: context.relations.map((relation) => relation.type === 'fixed'
      ? { ...relation, position: [...relation.position] }
      : { ...relation }),
    drivingDimensions: context.drivingDimensions.map((dimension) => ({ ...dimension })),
    ...(context.displayUnit ? { displayUnit: context.displayUnit } : {}),
  };
}

function getRelationGlyph(relation: SketchConstraint): string {
  switch (relation.type) {
    case 'coincident': return '●';
    case 'horizontal': return 'H';
    case 'vertical': return 'V';
    case 'parallel': return '∥';
    case 'perpendicular': return '⊥';
    case 'equal': return '=';
    case 'fixed': return 'F';
  }
}

function formatDrivingDistance(valueInInches: number, unit: SketchDisplayUnit): string {
  const value = unit === 'mm' ? valueInInches * 25.4 : valueInInches;
  return `${Number(value.toFixed(3))} ${unit}`;
}

function midpoint(pointA: Point2D, pointB: Point2D): Point2D {
  return [(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2];
}
