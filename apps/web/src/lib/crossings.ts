/** Crossing-minimization utilities for auto-layout.
 *
 *  The core idea: given a set of cables (pairs of node IDs) and a map of node
 *  centre positions, two cables cross if their line segments intersect. We use
 *  this count as a cost function and drive it down with a greedy-swap pass.
 */

export interface Pt {
  x: number;
  y: number;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(a: Pt, b: Pt, p: Pt): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
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

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;

  return false;
}

/**
 * Counts the number of crossing pairs among the given cables.
 * Self-loops (same source and target node) are ignored.
 * Cables sharing a node are ignored (they necessarily meet at a point).
 */
export function countCrossings(
  edges: ReadonlyArray<readonly [string, string]>,
  center: ReadonlyMap<string, Pt>,
): number {
  const valid = edges.filter(([s, t]) => s !== t && center.has(s) && center.has(t));

  let count = 0;
  for (let i = 0; i < valid.length; i++) {
    const [s1, t1] = valid[i];
    const a = center.get(s1)!;
    const b = center.get(t1)!;

    for (let j = i + 1; j < valid.length; j++) {
      const [s2, t2] = valid[j];
      if (s1 === s2 || s1 === t2 || t1 === s2 || t1 === t2) continue;

      const c = center.get(s2)!;
      const d = center.get(t2)!;

      if (segmentsIntersect(a, b, c, d)) count++;
    }
  }
  return count;
}

function nodeCenter(pos: Pt, size: { width: number; height: number }): Pt {
  return { x: pos.x + size.width / 2, y: pos.y + size.height / 2 };
}

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

/**
 * Minimises cable crossings within a set of nodes by repeatedly trying all
 * pairwise position swaps and accepting any swap that reduces the crossing
 * count. Repeats until no improvement or `maxPasses` is reached.
 *
 * Only swaps positions — does not change which nodes are in the set.
 * Note: swapping different-sized nodes can introduce AABB overlaps with
 * neighbours; callers should run a separate overlap-resolution pass afterwards.
 */
export function greedySwapMinimize(
  nodeIds: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
  positions: Map<string, Pt>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  maxPasses = 8,
): Map<string, Pt> {
  if (nodeIds.length < 2 || edges.length === 0) return positions;

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

        const centersBefore = buildCenterMap(positions, sizes);
        const before = countCrossings(relevantEdges, centersBefore);

        positions.set(idA, posB);
        positions.set(idB, posA);

        const centersAfter = buildCenterMap(positions, sizes);
        const after = countCrossings(relevantEdges, centersAfter);

        if (after < before) {
          improved = true;
        } else {
          positions.set(idA, posA);
          positions.set(idB, posB);
        }
      }
    }

    if (!improved) break;
  }

  return positions;
}

/**
 * Separates overlapping AABB boxes.
 *
 * Only the more bottom-right node moves (down or right) — never shove both
 * halves into a dense cluster. That was packing satellites into populated areas.
 */
export function resolveNodeOverlaps(
  nodeIds: readonly string[],
  positions: Map<string, Pt>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  gap = 48,
  maxPasses = 32,
  fallbackSize: { width: number; height: number } = { width: 260, height: 240 },
): void {
  if (nodeIds.length < 2) return;

  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const idA = nodeIds[i];
        const idB = nodeIds[j];
        const a = positions.get(idA);
        const b = positions.get(idB);
        if (!a || !b) continue;

        const sa = sizes.get(idA) ?? fallbackSize;
        const sb = sizes.get(idB) ?? fallbackSize;

        const aRight = a.x + sa.width + gap;
        const aBottom = a.y + sa.height + gap;
        const bRight = b.x + sb.width + gap;
        const bBottom = b.y + sb.height + gap;

        if (a.x >= bRight || b.x >= aRight || a.y >= bBottom || b.y >= aBottom) continue;

        const overlapX = Math.min(aRight, bRight) - Math.max(a.x, b.x);
        const overlapY = Math.min(aBottom, bBottom) - Math.max(a.y, b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;

        // Movable = further bottom-right; anchor stays put.
        const scoreA = a.x + a.y + sa.width * 0.01;
        const scoreB = b.x + b.y + sb.width * 0.01;
        const moveId = scoreA >= scoreB ? idA : idB;
        const otherId = moveId === idA ? idB : idA;
        const m = positions.get(moveId)!;
        const o = positions.get(otherId)!;
        const sm = sizes.get(moveId) ?? fallbackSize;
        const so = sizes.get(otherId) ?? fallbackSize;

        // Prefer the smaller push that lands fully outside the anchor's keep-out.
        if (overlapX <= overlapY) {
          positions.set(moveId, { x: o.x + so.width + gap, y: m.y });
        } else {
          positions.set(moveId, { x: m.x, y: o.y + so.height + gap });
        }
        // If still overlapping (rare after axis choice), push both ways from anchor.
        const m2 = positions.get(moveId)!;
        const stillX =
          m2.x < o.x + so.width + gap && m2.x + sm.width + gap > o.x;
        const stillY =
          m2.y < o.y + so.height + gap && m2.y + sm.height + gap > o.y;
        if (stillX && stillY) {
          positions.set(moveId, {
            x: o.x + so.width + gap,
            y: o.y + so.height + gap,
          });
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** True if rect at `pos` with `size` overlaps any other node (with gap). */
export function rectHitsAny(
  id: string,
  pos: Pt,
  size: { width: number; height: number },
  nodeIds: readonly string[],
  positions: ReadonlyMap<string, Pt>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  gap: number,
  fallbackSize: { width: number; height: number } = { width: 260, height: 240 },
): boolean {
  const aRight = pos.x + size.width + gap;
  const aBottom = pos.y + size.height + gap;
  for (const other of nodeIds) {
    if (other === id) continue;
    const b = positions.get(other);
    if (!b) continue;
    const sb = sizes.get(other) ?? fallbackSize;
    if (pos.x >= b.x + sb.width + gap || b.x >= aRight) continue;
    if (pos.y >= b.y + sb.height + gap || b.y >= aBottom) continue;
    return true;
  }
  return false;
}

/**
 * Find a free top-left near `preferred` that does not overlap any other node.
 * Tries a spiral of right/below offsets so pins never land in a dense cluster.
 */
export function findFreeSlot(
  id: string,
  preferred: Pt,
  size: { width: number; height: number },
  nodeIds: readonly string[],
  positions: ReadonlyMap<string, Pt>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  gap: number,
): Pt {
  if (!rectHitsAny(id, preferred, size, nodeIds, positions, sizes, gap)) {
    return preferred;
  }
  const steps = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
  for (const sy of steps) {
    for (const sx of steps) {
      if (sx === 0 && sy === 0) continue;
      const cand = {
        x: preferred.x + sx * (size.width * 0.35 + gap),
        y: preferred.y + sy * (size.height * 0.35 + gap),
      };
      if (!rectHitsAny(id, cand, size, nodeIds, positions, sizes, gap)) return cand;
    }
  }
  // Last resort: far below the bounding box of all others.
  let maxBottom = preferred.y;
  for (const other of nodeIds) {
    if (other === id) continue;
    const b = positions.get(other);
    if (!b) continue;
    const sb = sizes.get(other) ?? { width: 260, height: 240 };
    maxBottom = Math.max(maxBottom, b.y + sb.height);
  }
  return { x: preferred.x, y: maxBottom + gap };
}
