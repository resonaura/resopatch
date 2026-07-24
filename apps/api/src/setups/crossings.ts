/** Crossing-minimization utilities for auto-layout.
 *
 *  The core idea: given a set of cables (pairs of node IDs) and a map of node
 *  centre positions, two cables cross if their line segments intersect. We use
 *  this count as a cost function and drive it down with a greedy-swap pass.
 */

export interface Pt { x: number; y: number }

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Signed area of triangle (O, A, B). Positive = CCW. */
function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** True if point P lies on segment AB (collinear case). */
function onSegment(a: Pt, b: Pt, p: Pt): boolean {
  return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
}

/**
 * Returns true if segment AB properly intersects segment CD.
 * Segments that share an endpoint are NOT counted as intersecting
 * (they share a node — that's expected).
 */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // Collinear cases
  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Cost function
// ---------------------------------------------------------------------------

/**
 * Counts the number of crossing pairs among the given cables.
 * Self-loops (same source and target node) are ignored.
 * Cables sharing a node are ignored (they necessarily meet at a point).
 *
 * @param edges  Each entry is [sourceNodeId, targetNodeId].
 * @param center Map from nodeId → centre position.
 */
export function countCrossings(
  edges: ReadonlyArray<readonly [string, string]>,
  center: ReadonlyMap<string, Pt>,
): number {
  // Filter out edges where we don't have positions for both endpoints
  const valid = edges.filter(([s, t]) => s !== t && center.has(s) && center.has(t));

  let count = 0;
  for (let i = 0; i < valid.length; i++) {
    const [s1, t1] = valid[i];
    const a = center.get(s1)!;
    const b = center.get(t1)!;

    for (let j = i + 1; j < valid.length; j++) {
      const [s2, t2] = valid[j];
      // Cables sharing a node endpoint can never cross — skip
      if (s1 === s2 || s1 === t2 || t1 === s2 || t1 === t2) continue;

      const c = center.get(s2)!;
      const d = center.get(t2)!;

      if (segmentsIntersect(a, b, c, d)) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

/** Returns the centre of a node given its top-left position and size. */
function nodeCenter(pos: Pt, size: { width: number; height: number }): Pt {
  return { x: pos.x + size.width / 2, y: pos.y + size.height / 2 };
}

/** Build a centre-map from position map + size map. */
export function buildCenterMap(
  positions: ReadonlyMap<string, Pt>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  fallbackSize: { width: number; height: number } = { width: 260, height: 240 },
): Map<string, Pt> {
  const centers = new Map<string, Pt>();
  for (const [id, pos] of positions) {
    const size = sizes.get(id) ?? fallbackSize;
    centers.set(id, nodeCenter(pos, size));
  }
  return centers;
}

// ---------------------------------------------------------------------------
// Greedy-swap optimiser
// ---------------------------------------------------------------------------

/**
 * Minimises cable crossings within a set of nodes by repeatedly trying all
 * pairwise position swaps and accepting any swap that reduces the crossing
 * count. Repeats until no improvement or `maxPasses` is reached.
 *
 * This only swaps positions — it does not change which nodes are in the set.
 *
 * @param nodeIds   IDs of nodes to optimise (only positions of these nodes are swapped).
 * @param edges     Cables as [sourceNodeId, targetNodeId] pairs (may include nodes outside nodeIds — they contribute to crossings too).
 * @param positions Full position map (read + written for the subset in nodeIds).
 * @param sizes     Node sizes (used to compute centres).
 * @param maxPasses Stop after this many full passes without improvement (default 8).
 * @returns         New position map (same object mutated, also returned for convenience).
 */
export function greedySwapMinimize(
  nodeIds: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
  positions: Map<string, Pt>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  maxPasses = 8,
): Map<string, Pt> {
  if (nodeIds.length < 2 || edges.length === 0) return positions;

  // Filter edges to those that have both endpoints in the position map
  const relevantEdges = edges.filter(([s, t]) => positions.has(s) && positions.has(t));
  if (relevantEdges.length === 0) return positions;

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const idA = nodeIds[i];
        const idB = nodeIds[j];

        const posA = positions.get(idA);
        const posB = positions.get(idB);
        if (!posA || !posB) continue;

        // Cost before swap
        const centersBefore = buildCenterMap(positions, sizes);
        const before = countCrossings(relevantEdges, centersBefore);

        // Swap
        positions.set(idA, posB);
        positions.set(idB, posA);

        // Cost after swap
        const centersAfter = buildCenterMap(positions, sizes);
        const after = countCrossings(relevantEdges, centersAfter);

        if (after < before) {
          // Keep the swap
          improved = true;
        } else {
          // Revert
          positions.set(idA, posA);
          positions.set(idB, posB);
        }
      }
    }

    if (!improved) break;
  }

  return positions;
}
