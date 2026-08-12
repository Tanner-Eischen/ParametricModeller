/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SketchOverlay,
  type NormalizedSketchOverlayContext,
} from '../../src/ui/SketchOverlay';
import {
  createLineEntity,
  createRectangleEntity,
  createSketch,
  createWorldPlaneRef,
} from '../../src/sketch';

const mockContext = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  setTransform: vi.fn(),
  setLineDash: vi.fn(),
  font: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  textAlign: 'left' as CanvasTextAlign,
  textBaseline: 'top' as CanvasTextBaseline,
} satisfies Partial<CanvasRenderingContext2D>;

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
}

describe('SketchOverlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockContext as unknown as CanvasRenderingContext2D
    );
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  function createContainer(): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    return container;
  }

  function createPlane() {
    return {
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      uAxis: [1, 0, 0],
      vAxis: [0, 1, 0],
    };
  }

  function createNormalizedContext(): NormalizedSketchOverlayContext {
    return {
      geometry: {
        schemaVersion: 1,
        points: [
          { id: 'point-a', position: [0, 0] },
          { id: 'point-b', position: [4, 0] },
          { id: 'point-c', position: [4, 2] },
        ],
        segments: [
          {
            id: 'segment-a',
            type: 'line',
            startPointId: 'point-a',
            endPointId: 'point-b',
            construction: false,
          },
          {
            id: 'segment-b',
            type: 'line',
            startPointId: 'point-b',
            endPointId: 'point-c',
            construction: false,
          },
        ],
      },
      relations: [{ id: 'horizontal-a', type: 'horizontal', segmentId: 'segment-a' }],
      drivingDimensions: [{
        id: 'width-dimension',
        type: 'distance',
        pointAId: 'point-a',
        pointBId: 'point-b',
        value: 1,
        name: 'Width',
      }],
      displayUnit: 'mm',
    };
  }

  it('renders status text with sketch workflow hints', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const sketch = createSketch(createWorldPlaneRef('xy'), 'Sketch 1');
    sketch.entities.push(createRectangleEntity([0, 0], 1, 1));

    overlay.show(sketch, createPlane() as never);

    const renderedText = mockContext.fillText.mock.calls.map(([value]) => String(value));
    expect(renderedText.some((value) => value.includes('Sketch Mode - XY plane - 1 entities'))).toBe(true);
    expect(renderedText.some((value) => value.includes('closed profile ready for extrude'))).toBe(true);

    overlay.dispose();
  });

  it('invokes the click handler when a sketch line is clicked', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const onEntityClick = vi.fn();
    overlay.onEntityClick(onEntityClick);

    const sketch = createSketch(createWorldPlaneRef('xy'), 'Line Sketch');
    const line = createLineEntity([0, 0], [2, 0], 'line-1');
    sketch.entities.push(line);

    overlay.show(sketch, createPlane() as never);

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: 450,
      clientY: 300,
    }));

    expect(onEntityClick).toHaveBeenCalledWith('line-1');

    overlay.dispose();
  });

  it('creates a rectangle from a drag gesture when rectangle mode is active', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const onRectangleCreate = vi.fn();
    overlay.onRectangleCreate(onRectangleCreate);
    overlay.setTool('rectangle');

    const sketch = createSketch(createWorldPlaneRef('xy'), 'Rect Sketch');
    overlay.show(sketch, createPlane() as never);

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      clientX: 400,
      clientY: 300,
    }));
    canvas.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 500,
      clientY: 250,
    }));
    canvas.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      clientX: 500,
      clientY: 250,
    }));

    expect(onRectangleCreate).toHaveBeenCalledTimes(1);
    expect(onRectangleCreate).toHaveBeenCalledWith([0, 0], [2, 1]);

    overlay.dispose();
  });

  it('keeps drawing pointer starts from reaching viewport camera controls', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    overlay.setTool('rectangle');
    overlay.show(
      createSketch(createWorldPlaneRef('xy'), 'Rect Sketch'),
      createPlane() as never
    );
    const viewportPointerDown = vi.fn();
    container.addEventListener('pointerdown', viewportPointerDown);

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(viewportPointerDown).not.toHaveBeenCalled();

    overlay.dispose();
  });

  it('leaves middle and right navigation gestures unclaimed and never draws from them', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const onRectangleCreate = vi.fn();
    const viewportPointerDown = vi.fn();
    overlay.onRectangleCreate(onRectangleCreate);
    overlay.setTool('rectangle');
    overlay.show(
      createSketch(createWorldPlaneRef('xy'), 'Navigation-safe rectangle'),
      createPlane() as never
    );
    container.addEventListener('pointerdown', viewportPointerDown);

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    for (const button of [1, 2]) {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button }));
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button,
        clientX: 400,
        clientY: 300,
      }));
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        buttons: 1 << button,
        clientX: 500,
        clientY: 250,
      }));
      canvas.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        button,
        clientX: 500,
        clientY: 250,
      }));
    }

    expect(viewportPointerDown).toHaveBeenCalledTimes(2);
    expect(onRectangleCreate).not.toHaveBeenCalled();

    overlay.dispose();
  });

  it('ignores middle and right clicks for line placement and sketch selection', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const onLinePoint = vi.fn();
    const onEntityClick = vi.fn();
    const onBlankPick = vi.fn();
    const onSegmentPick = vi.fn();
    overlay.onLinePoint(onLinePoint);
    overlay.onEntityClick(onEntityClick);
    overlay.onBlankPick(onBlankPick);
    overlay.onSegmentPick(onSegmentPick);
    const sketch = createSketch(createWorldPlaneRef('xy'), 'Navigation-safe clicks');
    sketch.entities.push(createLineEntity([0, 0], [2, 0], 'line-1'));
    overlay.show(sketch, createPlane() as never);

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    for (const button of [1, 2]) {
      overlay.setTool('line');
      canvas.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        button,
        clientX: 450,
        clientY: 250,
      }));
      overlay.setTool('select');
      canvas.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        button,
        clientX: 450,
        clientY: 300,
      }));
    }

    expect(onLinePoint).not.toHaveBeenCalled();
    expect(onEntityClick).not.toHaveBeenCalled();
    expect(onBlankPick).not.toHaveBeenCalled();
    expect(onSegmentPick).not.toHaveBeenCalled();

    overlay.dispose();
  });

  it('emits clicked sketch points when line mode is active', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const onLinePoint = vi.fn();
    overlay.onLinePoint(onLinePoint);
    overlay.setTool('line');

    const sketch = createSketch(createWorldPlaneRef('xy'), 'Line Sketch');
    overlay.show(sketch, createPlane() as never);

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: 450,
      clientY: 250,
    }));

    expect(onLinePoint).toHaveBeenCalledWith([1, 1]);

    overlay.dispose();
  });

  it('hit-tests editable endpoints in screen pixels', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const sketch = createSketch(createWorldPlaneRef('xy'), 'Handles');
    sketch.entities.push(createLineEntity([1, 1], [3, 1], 'line-1'));
    overlay.show(sketch, createPlane() as never);

    const screen = overlay.projectPoint([1, 1]);
    expect(screen).not.toBeNull();
    expect(overlay.hitTestHandle(screen!.x + 4, screen!.y, 6)).toMatchObject({
      id: 'line-1:start',
      entityId: 'line-1',
      kind: 'endpoint',
    });

    overlay.dispose();
  });

  it('shows the best inference candidate at the live camera scale', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const sketch = createSketch(createWorldPlaneRef('xy'), 'Inference');
    sketch.entities.push(createLineEntity([2, 0], [4, 0], 'line-1'));
    overlay.setTool('line');
    overlay.setLineDraftAnchor([0, 0]);
    overlay.show(sketch, createPlane() as never);

    const nearEndpoint = overlay.projectPoint([2.05, 0])!;
    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    canvas.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: nearEndpoint.x,
      clientY: nearEndpoint.y,
    }));

    expect(overlay.getActiveInference()).toMatchObject({
      kind: 'coincident',
      point: [2, 0],
    });
    expect(mockContext.fillText.mock.calls.some(([value]) =>
      String(value).includes('Make endpoint coincident')
    )).toBe(true);

    overlay.dispose();
  });

  it('renders actionable invalid-profile explanations at issue points', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const sketch = createSketch(createWorldPlaneRef('xy'), 'Open Profile');
    sketch.entities.push(createLineEntity([0, 0], [2, 0], 'open-line'));
    overlay.show(sketch, createPlane() as never);

    expect(overlay.getProfileFeedback().issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OPEN_ENDPOINT', point: [0, 0] }),
    ]));
    expect(mockContext.fillText.mock.calls.some(([value]) =>
      String(value).includes('OPEN_ENDPOINT: This endpoint is open')
    )).toBe(true);

    overlay.dispose();
  });

  it('keeps operation previews out of persisted sketch state', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const sketch = createSketch(createWorldPlaneRef('xy'), 'Preview');
    const before = JSON.stringify(sketch);
    overlay.show(sketch, createPlane() as never);

    expect(overlay.previewCenterRectangle([0, 0], [2, 1]).ok).toBe(true);
    expect(overlay.getOperationPreview()).toMatchObject({ kind: 'center-rectangle', closed: true });
    expect(overlay.previewRegularPolygon([0, 0], [2, 0], 6).ok).toBe(true);
    overlay.previewTrim([[0, 0], [1, 0]]);
    overlay.previewExtend([[1, 0], [2, 0]]);
    overlay.previewProject([[0, 0], [0, 2]], false);

    expect(JSON.stringify(sketch)).toBe(before);
    expect(overlay.getOperationPreview()).toMatchObject({ kind: 'project', closed: false });

    overlay.dispose();
  });

  it('exposes one editable handle per stable shared point without mutating input state', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    overlay.show(createSketch(createWorldPlaneRef('xy'), 'Normalized'), createPlane() as never);
    const context = createNormalizedContext();

    overlay.setNormalizedContext(context);

    expect(overlay.getEditableHandles()).toEqual([
      expect.objectContaining({ id: 'point-a', entityId: 'point-a', pointId: 'point-a', point: [0, 0] }),
      expect.objectContaining({ id: 'point-b', entityId: 'point-b', pointId: 'point-b', point: [4, 0] }),
      expect.objectContaining({ id: 'point-c', entityId: 'point-c', pointId: 'point-c', point: [4, 2] }),
    ]);

    context.geometry.points[0]!.position[0] = 99;
    expect(overlay.getEditableHandles()[0]!.point).toEqual([0, 0]);

    overlay.dispose();
  });

  it('renders normalized driving dimensions with units and relation glyphs', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    overlay.show(createSketch(createWorldPlaneRef('xy'), 'Normalized'), createPlane() as never);

    overlay.setNormalizedContext(createNormalizedContext());

    const renderedText = mockContext.fillText.mock.calls.map(([value]) => String(value));
    expect(renderedText).toContain('H');
    expect(renderedText).toContain('Width: 25.4 mm');

    overlay.dispose();
  });

  it('reports normalized point and segment selections by stable ID', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const onPointClick = vi.fn();
    const onSegmentClick = vi.fn();
    overlay.onPointClick(onPointClick);
    overlay.onSegmentClick(onSegmentClick);
    overlay.show(createSketch(createWorldPlaneRef('xy'), 'Normalized'), createPlane() as never);
    overlay.setNormalizedContext(createNormalizedContext());

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    const point = overlay.projectPoint([0, 0])!;
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: point.x, clientY: point.y }));
    const segmentMidpoint = overlay.projectPoint([2, 0])!;
    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: segmentMidpoint.x,
      clientY: segmentMidpoint.y,
    }));

    expect(onPointClick).toHaveBeenCalledWith('point-a');
    expect(onSegmentClick).toHaveBeenCalledWith('segment-a');

    overlay.dispose();
  });

  it('reports a segment pick with its clicked sketch point and screen coordinates', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const onSegmentClick = vi.fn();
    const onSegmentPick = vi.fn();
    overlay.onSegmentClick(onSegmentClick);
    overlay.onSegmentPick(onSegmentPick);
    overlay.show(createSketch(createWorldPlaneRef('xy'), 'Normalized'), createPlane() as never);
    overlay.setNormalizedContext(createNormalizedContext());

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    const segmentMidpoint = overlay.projectPoint([2, 0])!;
    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      button: 0,
      clientX: segmentMidpoint.x,
      clientY: segmentMidpoint.y,
    }));

    expect(onSegmentClick).toHaveBeenCalledWith('segment-a');
    expect(onSegmentPick).toHaveBeenCalledWith({
      segmentId: 'segment-a',
      sketchPoint: [2, 0],
      client: segmentMidpoint,
      canvas: segmentMidpoint,
    });

    overlay.dispose();
  });

  it('reports a blank pick with sketch, client, and canvas coordinates', () => {
    const container = createContainer();
    const overlay = new SketchOverlay({ container });
    const onBlankPick = vi.fn();
    const onSegmentPick = vi.fn();
    overlay.onBlankPick(onBlankPick);
    overlay.onSegmentPick(onSegmentPick);
    overlay.show(createSketch(createWorldPlaneRef('xy'), 'Normalized'), createPlane() as never);
    overlay.setNormalizedContext(createNormalizedContext());

    const canvas = container.querySelector('#sketch-overlay') as HTMLCanvasElement;
    const blank = overlay.projectPoint([8, 6])!;
    canvas.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      button: 0,
      clientX: blank.x,
      clientY: blank.y,
    }));

    expect(onBlankPick).toHaveBeenCalledWith({
      sketchPoint: [8, 6],
      client: blank,
      canvas: blank,
    });
    expect(onSegmentPick).not.toHaveBeenCalled();

    overlay.dispose();
  });
});
