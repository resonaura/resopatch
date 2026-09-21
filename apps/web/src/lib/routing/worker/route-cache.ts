import type { Point } from '../types';

/**
 * Keeps the last complete route for temporarily hidden edges.
 *
 * Filters remove edges from the current routing request, but they do not invalidate geometry.
 * Retaining those routes lets a restored edge render immediately while its fresh worker result is
 * still being calculated.
 */
export function mergeRouteCache(
  cachedRoutes: ReadonlyMap<string, Point[]>,
  currentRoutes: ReadonlyMap<string, Point[]>,
): Map<string, Point[]> {
  const merged = new Map(cachedRoutes);
  for (const [edgeId, points] of currentRoutes) merged.set(edgeId, points);
  return merged;
}
