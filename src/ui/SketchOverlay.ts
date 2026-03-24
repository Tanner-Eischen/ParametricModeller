import { createModuleLogger } from '../core/logger';
import type { Sketch, RectangleEntity, SketchDimension, Point2D } from '../sketch';
import type { ConstructionPlane } from '../geometry';

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
}

const DEFAULT_OPTIONS: Required<Omit<SketchOverlayOptions, 'container'>> = {
  backgroundColor: 'rgba(0, 0, 0, 0.0)',
  gridColor: 'rgba(100, 100, 100, 0.3)',
  entityColor: '#4a9eff',
  selectedColor: '#ffd700',
  dimensionColor: '#ffffff',
  axisColor: '#666666',
};

/**
 * 2D overlay for sketch editing mode.
 * Renders sketch entities, dimensions, and UI elements using a 2D canvas.
 */
export class SketchOverlay {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: Required<Omit<SketchOverlayOptions, 'container'>>;
  private currentSketch: Sketch | null = null;
  private currentPlane: ConstructionPlane | null = null;
  private selectedEntityId: string | null = null;
  private visible = false;

  // Event handlers
  private clickHandler: ((entityId: string) => void) | null = null;
  private resizeObserver: ResizeObserver;

  constructor(options: SketchOverlayOptions) {
    this.container = options.container;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Create canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
    `;
    this.canvas.id = 'sketch-overlay';

    // Get 2D context
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D canvas context');
    }
    this.ctx = ctx;

    // Set up resize observer
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // Initially hidden
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

  /**
   * Register click handler for entity selection.
   */
  onEntityClick(handler: (entityId: string) => void): void {
    this.clickHandler = handler;
    this.canvas.addEventListener('click', this.handleClick);
  }

  /**
   * Render the sketch overlay.
   */
  render(): void {
    if (!this.currentSketch || !this.currentPlane) return;

    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    // Draw background status bar
    this.drawStatusBar(width, height);

    // Draw coordinate axes indicator
    this.drawAxesIndicator(width, height);

    // Draw sketch entities
    for (const entity of this.currentSketch.entities) {
      if (entity.type === 'rectangle') {
        this.drawRectangle(entity as RectangleEntity);
      }
    }

    // Draw dimensions
    for (const dim of this.currentSketch.dimensions) {
      this.drawDimension(dim, height);
    }

    log.debug('SketchOverlay rendered');
  }

  /**
   * Draw a rectangle entity.
   */
  private drawRectangle(rect: RectangleEntity): void {
    const isSelected = rect.id === this.selectedEntityId;
    const color = isSelected ? this.options.selectedColor : this.options.entityColor;

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = isSelected ? 3 : 2;
    this.ctx.fillStyle = isSelected ? 'rgba(255, 215, 0, 0.1)' : 'rgba(74, 158, 255, 0.1)';

    // Convert sketch coordinates to screen coordinates
    const screenPos = this.sketchToScreen(rect.origin);
    const screenSize = this.sketchSizeToScreen(rect.width, rect.height);

    // Draw filled rectangle
    this.ctx.beginPath();
    this.ctx.rect(screenPos.x, screenPos.y - screenSize.h, screenSize.w, screenSize.h);
    this.ctx.fill();
    this.ctx.stroke();

    // Draw center point
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(screenPos.x, screenPos.y, 4, 0, Math.PI * 2);
    this.ctx.fill();
  }

  /**
   * Draw a dimension annotation.
   */
  private drawDimension(dim: SketchDimension, _height: number): void {
    // For now, just show dimension near the entity
    // This would need proper positioning based on the dimension's entity references

    this.ctx.font = '12px monospace';
    this.ctx.fillStyle = this.options.dimensionColor;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    const text = `${dim.name}: ${dim.value.toFixed(2)}`;
    this.ctx.fillText(text, 10, 60 + this.currentSketch!.dimensions.indexOf(dim) * 20);
  }

  /**
   * Draw the status bar at the top.
   */
  private drawStatusBar(width: number, _height: number): void {
    // Status bar background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(0, 0, width, 30);

    // Status text
    this.ctx.font = '14px sans-serif';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('✏ Sketch Mode - Press ESC to exit', 10, 15);

    // Sketch name
    this.ctx.textAlign = 'right';
    this.ctx.fillText(this.currentSketch?.name ?? 'Sketch', width - 10, 15);
  }

  /**
   * Draw coordinate axes indicator in the corner.
   */
  private drawAxesIndicator(_width: number, height: number): void {
    const originX = 60;
    const originY = height - 60;
    const axisLength = 40;

    // Background circle
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.beginPath();
    this.ctx.arc(originX, originY, 50, 0, Math.PI * 2);
    this.ctx.fill();

    // X axis (red)
    this.ctx.strokeStyle = '#ff4444';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(originX + axisLength, originY);
    this.ctx.stroke();

    // X label
    this.ctx.fillStyle = '#ff4444';
    this.ctx.font = 'bold 12px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('X', originX + axisLength + 10, originY);

    // Y axis (green) - Y is up in screen coords (inverted)
    this.ctx.strokeStyle = '#44ff44';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY);
    this.ctx.lineTo(originX, originY - axisLength);
    this.ctx.stroke();

    // Y label
    this.ctx.fillStyle = '#44ff44';
    this.ctx.fillText('Y', originX, originY - axisLength - 10);
  }

  /**
   * Convert 2D sketch coordinates to screen coordinates.
   */
  private sketchToScreen(point: Point2D): { x: number; y: number } {
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Simple orthographic projection centered on screen
    // Scale: 50 pixels per unit
    const scale = 50;

    // Center of canvas
    const centerX = width / 2;
    const centerY = height / 2;

    // Convert to screen coords (Y is inverted in screen space)
    return {
      x: centerX + point[0] * scale,
      y: centerY - point[1] * scale,
    };
  }

  /**
   * Convert sketch size to screen size.
   */
  private sketchSizeToScreen(w: number, h: number): { w: number; h: number } {
    const scale = 50;
    return {
      w: w * scale,
      h: h * scale,
    };
  }

  /**
   * Handle canvas click for entity selection.
   */
  private handleClick = (event: MouseEvent): void => {
    if (!this.currentSketch || !this.clickHandler) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if click is on any entity
    for (const entity of this.currentSketch.entities) {
      if (entity.type === 'rectangle') {
        const rectEntity = entity as RectangleEntity;
        const screenPos = this.sketchToScreen(rectEntity.origin);
        const screenSize = this.sketchSizeToScreen(rectEntity.width, rectEntity.height);

        // Check if click is inside rectangle (with some tolerance)
        const tolerance = 10;
        if (
          x >= screenPos.x - tolerance &&
          x <= screenPos.x + screenSize.w + tolerance &&
          y >= screenPos.y - screenSize.h - tolerance &&
          y <= screenPos.y + tolerance
        ) {
          this.clickHandler(entity.id);
          return;
        }
      }
    }
  };

  /**
   * Handle resize.
   */
  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.ctx.scale(dpr, dpr);

    if (this.visible) {
      this.render();
    }

    log.debug('SketchOverlay resized', { width: rect.width, height: rect.height });
  }

  /**
   * Dispose of the overlay.
   */
  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('click', this.handleClick);
    this.container.removeChild(this.canvas);
    log.debug('SketchOverlay disposed');
  }
}
