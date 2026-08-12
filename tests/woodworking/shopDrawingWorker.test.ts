import { describe, expect, it } from 'vitest';
import { createBoxBody } from '../../src/features/primitives/BoxFeature';
import {
  buildShopDrawingAsync,
  createShopDrawing,
  installShopDrawingWorkerHandler,
  type ShopDrawingWorkerLike,
  type ShopDrawingWorkerRequest,
  type ShopDrawingWorkerResponse,
  type ShopDrawingWorkerScope,
} from '../../src/woodworking';

describe('shop drawing worker helper', () => {
  const body = createBoxBody({
    width: 12,
    depth: 6,
    height: 0.75,
    anchorMode: 'corner',
    origin: [0, 0, 0],
  }, 'worker-panel');
  const drawingOptions = { title: 'Worker panel', views: ['top'] as const };

  it('uses the deterministic same-thread fallback when Worker is unavailable', async () => {
    const result = await buildShopDrawingAsync(body, drawingOptions, {
      workerFactory: () => null,
    });
    expect(result).toEqual(createShopDrawing(body, drawingOptions));
  });

  it('renders pinned measurement annotations into the requested drawing view', () => {
    const drawing = createShopDrawing(body, {
      ...drawingOptions,
      annotationMarks: [{
        id: 'dimension:overall-width',
        view: 'top',
        position: [0.5, 0.2],
        label: '12 in',
      }],
    });
    expect(drawing.entities).toContainEqual(expect.objectContaining({
      id: 'top:annotation:dimension:overall-width',
      layer: 'DIMENSION',
      view: 'top',
      value: '12 in',
    }));
  });

  it('routes build results through the cancelable worker protocol', async () => {
    const expected = createShopDrawing(body, drawingOptions);
    const messages: ShopDrawingWorkerRequest[] = [];
    let terminated = false;
    const worker: ShopDrawingWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        messages.push(message);
        if (message.type !== 'build') return;
        queueMicrotask(() => worker.onmessage?.({
          data: {
            type: 'result',
            requestId: message.requestId,
            drawing: expected,
          },
        } as MessageEvent<ShopDrawingWorkerResponse>));
      },
      terminate() {
        terminated = true;
      },
    };

    await expect(buildShopDrawingAsync(body, drawingOptions, {
      requestId: 'request:stable',
      workerFactory: () => worker,
    })).resolves.toEqual(expected);
    expect(messages).toMatchObject([{
      type: 'build',
      requestId: 'request:stable',
    }]);
    expect(terminated).toBe(true);
  });

  it('posts cancellation and rejects immediately when aborted', async () => {
    const messages: ShopDrawingWorkerRequest[] = [];
    let terminated = false;
    const worker: ShopDrawingWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        messages.push(message);
      },
      terminate() {
        terminated = true;
      },
    };
    const controller = new AbortController();
    const promise = buildShopDrawingAsync(body, drawingOptions, {
      requestId: 'request:cancel',
      signal: controller.signal,
      workerFactory: () => worker,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(messages.map((message) => message.type)).toEqual(['build', 'cancel']);
    expect(terminated).toBe(true);
  });

  it('installs a deterministic build/cancel worker message handler', () => {
    const responses: ShopDrawingWorkerResponse[] = [];
    const scope: ShopDrawingWorkerScope = {
      onmessage: null,
      postMessage(message) {
        responses.push(message);
      },
    };
    installShopDrawingWorkerHandler(scope);
    scope.onmessage?.({
      data: { type: 'cancel', requestId: 'cancelled' },
    } as unknown as MessageEvent<ShopDrawingWorkerRequest>);
    scope.onmessage?.({
      data: {
        type: 'build',
        requestId: 'cancelled',
        bodies: body,
        options: drawingOptions,
      },
    } as unknown as MessageEvent<ShopDrawingWorkerRequest>);
    scope.onmessage?.({
      data: {
        type: 'build',
        requestId: 'built',
        bodies: body,
        options: drawingOptions,
      },
    } as unknown as MessageEvent<ShopDrawingWorkerRequest>);

    expect(responses[0]).toEqual({
      type: 'cancelled',
      requestId: 'cancelled',
    });
    expect(responses[1]).toMatchObject({
      type: 'result',
      requestId: 'built',
      drawing: { title: 'Worker panel' },
    });
  });
});
