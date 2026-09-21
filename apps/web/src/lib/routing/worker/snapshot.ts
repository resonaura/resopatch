import type { Edge } from '@xyflow/react';

/** Minimal route shape exposed by avoid-nodes-edge's shared worker store. */
export interface WorkerRoute {
  path: string;
}

/**
 * A worker result is publishable only when it contains a non-empty path for every visible edge.
 * The router replaces its global store as a single snapshot, so accepting a partial result would
 * briefly mix routed cables with React Flow's unfinished fallback geometry.
 */
export function hasCompleteRouteSnapshot(
  edges: readonly Pick<Edge, 'id'>[],
  routes: Readonly<Record<string, WorkerRoute | undefined>>,
): boolean {
  return edges.every((edge) => routes[edge.id]?.path.trim());
}
