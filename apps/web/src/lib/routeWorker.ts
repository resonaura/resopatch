/**
 * Web Worker entry: full netlist routing OFF the UI thread.
 *
 * Puppeteer showed processTransaction (libavoid) can hang >8s on a 41-edge stage with no
 * reply. Legacy A* finishes ~2s and is fine *here* (worker), but freezes the tab on main.
 *
 * Strategy:
 *  - small nets: try libavoid, fall back to legacy
 *  - larger nets: legacy only (reliable, off-thread)
 */

import { computeRoutesLegacy, finalizeRoutes } from './edgeRouting';
import { routeWithLibavoid } from './libavoidRouter';
import type { EdgeRouteSpec, Point, RectObstacle } from './routingTypes';

export type RouteWorkerRequest = {
  id: number;
  obstacles: RectObstacle[];
  edges: EdgeRouteSpec[];
};

export type RouteWorkerResponse =
  | { id: number; ok: true; routes: [string, Point[]][]; engine: 'libavoid' | 'legacy' }
  | { id: number; ok: false; error: string };

const LIBAVOID_MAX_EDGES = 12;

self.onmessage = (event: MessageEvent<RouteWorkerRequest>) => {
  const { id, obstacles, edges } = event.data;
  const t0 = Date.now();
  try {
    let raw: Map<string, Point[]>;
    let engine: 'libavoid' | 'legacy' = 'legacy';

    if (edges.length > 0 && edges.length <= LIBAVOID_MAX_EDGES) {
      try {
        raw = routeWithLibavoid(obstacles, edges);
        engine = 'libavoid';
      } catch {
        raw = computeRoutesLegacy(obstacles, edges);
        engine = 'legacy';
      }
    } else {
      // Dense stage graphs: libavoid 0.1.x can stall processTransaction indefinitely.
      raw = computeRoutesLegacy(obstacles, edges);
      engine = 'legacy';
    }

    const finished = finalizeRoutes(obstacles, edges, raw);
    const routes: [string, Point[]][] = [];
    for (const [edgeId, pts] of finished) routes.push([edgeId, pts]);

    const response: RouteWorkerResponse = { id, ok: true, routes, engine };
    self.postMessage(response);
    // eslint-disable-next-line no-console
    console.log(`[routeWorker] id=${id} engine=${engine} edges=${edges.length} ms=${Date.now() - t0}`);
  } catch (err) {
    const response: RouteWorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
