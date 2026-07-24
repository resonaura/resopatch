/**
 * Main-thread client for the routing worker.
 * Never runs A* / libavoid on the UI thread.
 */

import type { EdgeRouteSpec, Point, RectObstacle } from './routingTypes';

type RouteWorkerRequest = {
  id: number;
  obstacles: RectObstacle[];
  edges: EdgeRouteSpec[];
};

type RouteWorkerResponse =
  | { id: number; ok: true; routes: [string, Point[]][]; engine?: string }
  | { id: number; ok: false; error: string };

type Pending = {
  resolve: (routes: Map<string, Point[]>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function disposeWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error('routing worker restarted'));
  }
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./routeWorker.ts', import.meta.url), { type: 'module' });

  worker.onmessage = (event: MessageEvent<RouteWorkerResponse>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) {
      p.resolve(new Map(msg.routes));
    } else {
      p.reject(new Error(msg.error || 'routing failed'));
    }
  };

  worker.onerror = (event) => {
    const err = new Error(event.message || 'routing worker error');
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
      pending.delete(id);
    }
    worker = null;
  };

  return worker;
}

/**
 * Route the full netlist in a Web Worker.
 * On timeout the worker is killed; callers should KEEP existing/stub routes — never re-run
 * computeRoutesLegacy on the main thread (Puppeteer: that was a ~2s longtask).
 */
export function routeInWorker(
  obstacles: RectObstacle[],
  edges: EdgeRouteSpec[],
  timeoutMs = 20000,
): Promise<Map<string, Point[]>> {
  if (edges.length === 0) return Promise.resolve(new Map());

  const id = nextId++;
  const w = ensureWorker();

  return new Promise<Map<string, Point[]>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // Kill only this hung worker; next call spawns a fresh one.
      disposeWorker();
      reject(new Error(`routing timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });
    const payload: RouteWorkerRequest = { id, obstacles, edges };
    w.postMessage(payload);
  });
}

export function cancelAllRoutingJobs(): void {
  disposeWorker();
}
