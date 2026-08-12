import type { Body } from '../geometry/Body';
import type { DrawingDocument } from './DrawingModel';
import { createShopDrawing, type ShopDrawingOptions } from './ShopDrawing';

export interface ShopDrawingBuildRequest {
  type: 'build';
  requestId: string;
  bodies: Body | readonly Body[];
  options: ShopDrawingOptions;
}

export interface ShopDrawingCancelRequest {
  type: 'cancel';
  requestId: string;
}

export type ShopDrawingWorkerRequest =
  | ShopDrawingBuildRequest
  | ShopDrawingCancelRequest;

export interface ShopDrawingBuildResult {
  type: 'result';
  requestId: string;
  drawing: DrawingDocument;
}

export interface ShopDrawingBuildFailure {
  type: 'error';
  requestId: string;
  error: string;
}

export interface ShopDrawingBuildCancelled {
  type: 'cancelled';
  requestId: string;
}

export type ShopDrawingWorkerResponse =
  | ShopDrawingBuildResult
  | ShopDrawingBuildFailure
  | ShopDrawingBuildCancelled;

export interface ShopDrawingWorkerLike {
  onmessage: ((event: MessageEvent<ShopDrawingWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ShopDrawingWorkerRequest): void;
  terminate(): void;
}

export interface ShopDrawingWorkerScope {
  onmessage: ((event: MessageEvent<ShopDrawingWorkerRequest>) => void) | null;
  postMessage(message: ShopDrawingWorkerResponse): void;
}

export interface ShopDrawingBuildAsyncOptions {
  signal?: AbortSignal;
  requestId?: string;
  /**
   * Return null to select the deterministic same-thread fallback.
   */
  workerFactory?: () => ShopDrawingWorkerLike | null;
}

let nextRequestId = 1;

/**
 * Build a drawing off-thread when Worker is available, with a same-thread
 * fallback for Node and restricted browser hosts.
 */
export async function buildShopDrawingAsync(
  bodies: Body | readonly Body[],
  drawingOptions: ShopDrawingOptions,
  options: ShopDrawingBuildAsyncOptions = {}
): Promise<DrawingDocument> {
  throwIfAborted(options.signal);
  const worker = (options.workerFactory ?? createDefaultShopDrawingWorker)();
  if (!worker) {
    await Promise.resolve();
    throwIfAborted(options.signal);
    return createShopDrawing(bodies, drawingOptions);
  }

  const requestId = options.requestId ?? `shop-drawing:${nextRequestId++}`;
  return new Promise<DrawingDocument>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = (): void => {
      worker.postMessage({ type: 'cancel', requestId });
      finish(() => reject(createAbortError()));
    };
    worker.onmessage = (event): void => {
      const response = event.data;
      if (response.requestId !== requestId) return;
      if (response.type === 'result') {
        finish(() => resolve(response.drawing));
      } else if (response.type === 'cancelled') {
        finish(() => reject(createAbortError()));
      } else {
        finish(() => reject(new Error(response.error)));
      }
    };
    worker.onerror = (event): void => {
      finish(() => reject(new Error(event.message || 'Shop drawing worker failed.')));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({
      type: 'build',
      requestId,
      bodies,
      options: drawingOptions,
    });
  });
}

export function createDefaultShopDrawingWorker(): ShopDrawingWorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(
    new URL('./ShopDrawingWorker.ts', import.meta.url),
    { type: 'module', name: 'shop-drawing-builder' }
  ) as unknown as ShopDrawingWorkerLike;
}

export function installShopDrawingWorkerHandler(
  scope: ShopDrawingWorkerScope
): void {
  const cancelled = new Set<string>();
  scope.onmessage = (event: MessageEvent<ShopDrawingWorkerRequest>): void => {
    const request = event.data;
    if (request.type === 'cancel') {
      cancelled.add(request.requestId);
      return;
    }
    if (cancelled.delete(request.requestId)) {
      scope.postMessage({
        type: 'cancelled',
        requestId: request.requestId,
      } satisfies ShopDrawingBuildCancelled);
      return;
    }
    try {
      const drawing = createShopDrawing(request.bodies, request.options);
      scope.postMessage({
        type: 'result',
        requestId: request.requestId,
        drawing,
      } satisfies ShopDrawingBuildResult);
    } catch (error) {
      scope.postMessage({
        type: 'error',
        requestId: request.requestId,
        error: error instanceof Error ? error.message : 'Shop drawing build failed.',
      } satisfies ShopDrawingBuildFailure);
    }
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError(): Error {
  const error = new Error('Shop drawing build cancelled.');
  error.name = 'AbortError';
  return error;
}

const workerScope = globalThis as typeof globalThis & {
  document?: unknown;
  postMessage?: (message: ShopDrawingWorkerResponse) => void;
  onmessage?: ((event: MessageEvent<ShopDrawingWorkerRequest>) => void) | null;
};
if (
  typeof workerScope.postMessage === 'function'
  && workerScope.document === undefined
) {
  installShopDrawingWorkerHandler(
    workerScope as unknown as ShopDrawingWorkerScope
  );
}
