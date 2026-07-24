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
 * Separates overlapping axis-aligned boxes by pushing them apart along the
 * smaller penetration axis. Runs until stable or maxPasses. Essential after
 * greedy swaps and special-case pinning which can stack nodes on top of each other.
 */
export function resolveNodeOverlaps(
  nodeIds: readonly string[],
  positions: Map<string, Pt>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  gap = 48,
  maxPasses = 24,
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

        // Push the lower-right node away so stacking tends downward/rightward
        // (matches zone flow) rather than scattering upward off-canvas.
        const aCx = a.x + sa.width / 2;
        const aCy = a.y + sa.height / 2;
        const bCx = b.x + sb.width / 2;
        const bCy = b.y + sb.height / 2;

        if (overlapX < overlapY) {
          const push = overlapX / 2 + 1;
          if (aCx <= bCx) {
            positions.set(idA, { x: a.x - push, y: a.y });
            positions.set(idB, { x: b.x + push, y: b.y });
          } else {
            positions.set(idA, { x: a.x + push, y: a.y });
            positions.set(idB, { x: b.x - push, y: b.y });
          }
        } else {
          const push = overlapY / 2 + 1;
          if (aCy <= bCy) {
            positions.set(idA, { x: a.x, y: a.y - push });
            positions.set(idB, { x: b.x, y: b.y + push });
          } else {
            positions.set(idA, { x: a.x, y: a.y + push });
            positions.set(idB, { x: b.x, y: b.y - push });
          }
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}
