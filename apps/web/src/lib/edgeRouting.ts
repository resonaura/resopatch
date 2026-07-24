/**
 * Grid-based orthogonal cable router, in two independent stages:
 *
 *  1. `findPath` — plain obstacle-avoiding A* per cable: shortest path, fewest turns, never
 *     crosses a *different* device's box. No notion of other cables at all.
 *  2. `resolveOverlaps` — a separate geometry pass over the finished paths: wherever two cables'
 *     straight runs exactly coincide (same line, overlapping range), nudge them apart into
 *     parallel lanes. Runs *after* pathfinding and only ever moves a route by a few pixels, with
 *     every offset re-verified against every obstacle afterwards — an offset that would introduce
 *     a new crossing is reverted for that one route rather than applied.
 *
 * Keeping these separate (instead of one shared cost function trying to do both) is what makes
 * each half testable and tunable on its own — see edgeRouting.test.ts.
 */

export interface RectObstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeRouteSpec {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  sourceDir?: 'left' | 'right';
  targetDir?: 'left' | 'right';
  isPowerAdapter?: boolean;
}

export type Point = { x: number; y: number };

// Keep-out margin around every device box. Wide enough that a cable passing "near" a cluster of
// unrelated nodes reads as routed around them, not hugging their edges — the difference between
// looking deliberate and looking like it's cutting through the pile.
const OBSTACLE_PADDING = 16;
// How far a cable travels straight out from its own port before the router allows the first turn.
// Long enough that when a cable's target sits behind its fixed exit side (forcing a reversal —
// e.g. two devices stacked directly on top of each other, connected port-to-port) the loop that
// buys the U-turn reads as a deliberate wide arc clearing both cards, not a knot cinched tight
// against the corner — and, in the common case, long enough that the first bend clears the
// connector and its own device card before it happens, instead of turning right on top of them.
const STUB = 64;
const TURN_PENALTY = 8;
const MAX_EXPANSIONS = 40000;
// Gap between adjacent lanes when parallel runs get separated. Wide enough that two cables are
// still visibly two cables (not one fused line) after zooming out to fit a whole stage on screen.
const LANE_GAP = 11;

/** Grid resolution scales with how far apart a cable's ends are: a fine 16px grid keeps routing
 *  precise in crowded local clusters, but the same resolution applied to a cable spanning most of
 *  the canvas (e.g. stage-left to stage-right) blows the search space past MAX_EXPANSIONS well
 *  before it ever finds the goal. Coarsening the grid for long hauls keeps the state space bounded
 *  regardless of canvas size, at the cost of precision those distances don't need anyway. */
function pickCellSize(dx: number, dy: number): number {
  const span = Math.max(dx, dy);
  if (span < 900) return 16;
  if (span < 2200) return 28;
  return 44;
}

const cellKey = (cx: number, cy: number) => `${cx},${cy}`;

class MinHeap<T> {
  private items: { priority: number; value: T }[] = [];

  get size() {
    return this.items.length;
  }

  push(priority: number, value: T) {
    this.items.push({ priority, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (l < this.items.length && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < this.items.length && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top.value;
  }
}

interface GridBounds {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

function astar(
  startCell: [number, number],
  endCell: [number, number],
  isBlocked: (cx: number, cy: number) => boolean,
  bounds: GridBounds,
): [number, number][] | null {
  const [sx, sy] = startCell;
  const [ex, ey] = endCell;

  const stateKey = (cx: number, cy: number, dir: number) => `${cx},${cy},${dir}`;
  const heuristic = (cx: number, cy: number) => Math.abs(cx - ex) + Math.abs(cy - ey);

  const DIRS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  const heap = new MinHeap<{ cx: number; cy: number; dir: number }>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();

  for (let d = 0; d < 4; d++) {
    const k = stateKey(sx, sy, d);
    gScore.set(k, 0);
    heap.push(heuristic(sx, sy), { cx: sx, cy: sy, dir: d });
  }

  let steps = 0;
  while (heap.size > 0 && steps++ < MAX_EXPANSIONS) {
    const current = heap.pop()!;
    if (current.cx === ex && current.cy === ey) {
      const path: [number, number][] = [];
      let k: string | undefined = stateKey(current.cx, current.cy, current.dir);
      while (k) {
        const parts = k.split(',');
        path.push([Number(parts[0]), Number(parts[1])]);
        k = cameFrom.get(k);
      }
      path.reverse();
      return path;
    }

    const curKey = stateKey(current.cx, current.cy, current.dir);
    const curG = gScore.get(curKey)!;

    for (let d = 0; d < DIRS.length; d++) {
      const { dx, dy } = DIRS[d];
      const ncx = current.cx + dx;
      const ncy = current.cy + dy;
      if (ncx < bounds.minCx || ncx > bounds.maxCx || ncy < bounds.minCy || ncy > bounds.maxCy) continue;
      if (isBlocked(ncx, ncy)) continue;
      const turnCost = d === current.dir ? 0 : TURN_PENALTY;
      const tentativeG = curG + turnCost + 1;
      const nKey = stateKey(ncx, ncy, d);
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentativeG);
        cameFrom.set(nKey, curKey);
        heap.push(tentativeG + heuristic(ncx, ncy), { cx: ncx, cy: ncy, dir: d });
      }
    }
  }
  return null;
}

export function simplifyColinear(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const collinear = (curr.x - prev.x) * (next.y - curr.y) === (curr.y - prev.y) * (next.x - curr.x);
    if (!collinear) result.push(curr);
  }
  result.push(points[points.length - 1]);
  return result;
}

export function segmentCrossesRect(p1: Point, p2: Point, rect: RectObstacle, padding: number): boolean {
  const rx0 = rect.x - padding;
  const ry0 = rect.y - padding;
  const rx1 = rect.x + rect.width + padding;
  const ry1 = rect.y + rect.height + padding;
  if (p1.y === p2.y) {
    if (p1.y <= ry0 || p1.y >= ry1) return false;
    const x0 = Math.min(p1.x, p2.x);
    const x1 = Math.max(p1.x, p2.x);
    return x1 > rx0 && x0 < rx1;
  }
  if (p1.x === p2.x) {
    if (p1.x <= rx0 || p1.x >= rx1) return false;
    const y0 = Math.min(p1.y, p2.y);
    const y1 = Math.max(p1.y, p2.y);
    return y1 > ry0 && y0 < ry1;
  }
  return true; // a diagonal segment isn't a shape this router should ever produce — treat as unsafe
}

/** Stage 1: one cable's obstacle-avoiding path, entirely independent of every other cable. */
export function findPath(spec: EdgeRouteSpec, obstacles: RectObstacle[]): Point[] {
  const { start, end } = spec;

  const sSign = spec.sourceDir === 'left' ? -1 : 1;
  const tSign = spec.targetDir === 'right' ? 1 : -1;

  const otherObstacles = obstacles.filter((o) => o.id !== spec.sourceNodeId && o.id !== spec.targetNodeId);
  const clearOfOthers = (p1: Point, p2: Point) => otherObstacles.every((o) => !segmentCrossesRect(p1, p2, o, OBSTACLE_PADDING));
  if (start.y === end.y || start.x === end.x) {
    if (clearOfOthers(start, end)) return [start, end];
  }

  const cell = pickCellSize(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const cellOf = (v: number) => Math.round(v / cell);

  const globalObstacles = new Set<string>();
  for (const rect of obstacles) {
    const x0 = cellOf(rect.x - OBSTACLE_PADDING);
    const x1 = cellOf(rect.x + rect.width + OBSTACLE_PADDING);
    const y0 = cellOf(rect.y - OBSTACLE_PADDING);
    const y1 = cellOf(rect.y + rect.height + OBSTACLE_PADDING);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) globalObstacles.add(cellKey(cx, cy));
    }
  }

  const startCellX = cellOf(start.x + sSign * STUB);
  const startCellY = cellOf(start.y);
  const endCellX = cellOf(end.x + tSign * STUB);
  const endCellY = cellOf(end.y);
  const stubStart = { x: startCellX * cell, y: startCellY * cell };
  const stubEnd = { x: endCellX * cell, y: endCellY * cell };

  const corridor = new Set<string>();
  const carveHorizontal = (cxa: number, cxb: number, cy: number) => {
    const cx0 = Math.min(cxa, cxb);
    const cx1 = Math.max(cxa, cxb);
    for (let cx = cx0; cx <= cx1; cx++) corridor.add(cellKey(cx, cy));
  };
  carveHorizontal(cellOf(start.x), startCellX, startCellY);
  carveHorizontal(endCellX, cellOf(end.x), endCellY);

  const isBlocked = (cx: number, cy: number) => {
    const k = cellKey(cx, cy);
    if (corridor.has(k)) return false;
    return globalObstacles.has(k);
  };

  let found: [number, number][] | null = null;
  let margin = Math.max(260, cell * 8);
  for (let attempt = 0; attempt < 4 && !found; attempt++, margin *= 2.5) {
    const minX = Math.min(start.x, end.x) - margin;
    const maxX = Math.max(start.x, end.x) + margin;
    const minY = Math.min(start.y, end.y) - margin;
    const maxY = Math.max(start.y, end.y) + margin;
    const bounds: GridBounds = { minCx: cellOf(minX), maxCx: cellOf(maxX), minCy: cellOf(minY), maxCy: cellOf(maxY) };
    found = astar([startCellX, startCellY], [endCellX, endCellY], isBlocked, bounds);
  }

  if (found) {
    const cellPoints = found.slice(1, -1).map(([cx, cy]) => ({ x: cx * cell, y: cy * cell }));
    const sPortClearance = start.x + sSign * 24;
    const tPortClearance = end.x + tSign * 24;
    return simplifyColinear([
      start,
      { x: sPortClearance, y: start.y },
      { x: sPortClearance, y: stubStart.y },
      stubStart,
      ...cellPoints,
      stubEnd,
      { x: tPortClearance, y: stubEnd.y },
      { x: tPortClearance, y: end.y },
      end,
    ]);
  }

  // Genuinely no path found even at the coarsest, widest-margin attempt (pathologically boxed
  // in) — fall back to a plain elbow rather than drawing nothing, picking whichever of the two
  // possible elbow shapes clears every *other* obstacle if one of them does.
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const viaMidX = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  const viaMidY = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  const clear = (pts: Point[]) => pts.slice(0, -1).every((p, i) => clearOfOthers(p, pts[i + 1]));
  return simplifyColinear(clear(viaMidX) ? viaMidX : clear(viaMidY) ? viaMidY : viaMidX);
}

interface SegmentRef {
  edgeId: string;
  i: number;
  orientation: 'h' | 'v';
  fixed: number;
  lo: number;
  hi: number;
  /** Cross-axis coordinate of whichever real port anchor (the spec's exact `start`/`end`, not the
   *  grid-rounded path point) this segment sits next to, used to order lanes so two routes whose
   *  grid-rounded approach rows happen to collide still get offset in the direction their real,
   *  unrounded ports actually diverge in — see the crossing-stubs case in resolveOverlaps below. */
  anchor: number;
}

/** Stage 2: nudge coincident parallel runs apart into separate lanes. */
export function resolveOverlaps(routes: Map<string, Point[]>, obstacles: RectObstacle[], edges: EdgeRouteSpec[]): Map<string, Point[]> {
  const working = new Map(Array.from(routes, ([id, pts]) => [id, pts.map((p) => ({ ...p }))] as const));
  const specById = new Map(edges.map((e) => [e.id, e] as const));

  const segments: SegmentRef[] = [];
  for (const [edgeId, pts] of working) {
    if (pts.length < 3) continue;
    const spec = specById.get(edgeId);
    const startIdx = pts.length >= 7 ? 2 : 1;
    const endIdx = pts.length >= 7 ? pts.length - 3 : pts.length - 2;
    const nearStartIdx = startIdx;
    const nearEndIdx = endIdx - 1;
    for (let i = startIdx; i < endIdx; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      let orientation: 'h' | 'v' | undefined;
      let fixed: number;
      let lo: number;
      let hi: number;
      if (a.y === b.y) {
        orientation = 'h';
        fixed = a.y;
        lo = Math.min(a.x, b.x);
        hi = Math.max(a.x, b.x);
      } else if (a.x === b.x) {
        orientation = 'v';
        fixed = a.x;
        lo = Math.min(a.y, b.y);
        hi = Math.max(a.y, b.y);
      } else {
        continue;
      }
      // Default anchor: the segment's own (grid-rounded) position — i.e. no particular pull
      // either way, so lane order falls back to plain left-to-right packing. Segments adjacent to
      // a real port get pulled toward that port's *exact* coordinate instead (see field doc).
      let anchor = fixed;
      if (spec) {
        const nearStart = i === nearStartIdx;
        const nearEnd = i === nearEndIdx;
        if (nearEnd) anchor = orientation === 'h' ? spec.end.y : spec.end.x;
        else if (nearStart) anchor = orientation === 'h' ? spec.start.y : spec.start.x;
      }
      segments.push({ edgeId, i, orientation, fixed, lo, hi, anchor });
    }
  }

  const groups = new Map<string, SegmentRef[]>();
  for (const seg of segments) {
    // Rounding the grouping key coarsely catches "practically the same line" even when two
    // cables' paths were computed at different grid resolutions (see pickCellSize).
    const key = `${seg.orientation}:${Math.round(seg.fixed / 4) * 4}`;
    const list = groups.get(key);
    if (list) list.push(seg);
    else groups.set(key, [seg]);
  }

  const touchedEdges = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Ordering by each segment's real anchor (rather than its grid-rounded `lo`) keeps lane order
    // consistent with where each route actually needs to end up, so routes whose approach rows
    // happened to round to the same grid line don't get offset in a way that makes their final
    // port-facing stubs cross one another.
    const sorted = [...group].sort((a, b) => a.anchor - b.anchor || a.lo - b.lo || a.edgeId.localeCompare(b.edgeId));
    const laneEnds: number[] = [];
    const laneOf = new Map<SegmentRef, number>();
    for (const seg of sorted) {
      let lane = laneEnds.findIndex((end) => end <= seg.lo);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(seg.hi);
      } else {
        laneEnds[lane] = seg.hi;
      }
      laneOf.set(seg, lane);
    }
    const laneCount = laneEnds.length;
    const isPowerAdapterGroup = group.some((s) => specById.get(s.edgeId)?.isPowerAdapter);
    const groupLaneGap = isPowerAdapterGroup ? 28 : LANE_GAP;
    for (const seg of group) {
      const lane = laneOf.get(seg)!;
      const offset = (lane - (laneCount - 1) / 2) * groupLaneGap;
      if (offset === 0) continue;
      const pts = working.get(seg.edgeId)!;
      if (seg.orientation === 'h') {
        pts[seg.i].y += offset;
        pts[seg.i + 1].y += offset;
      } else {
        pts[seg.i].x += offset;
        pts[seg.i + 1].x += offset;
      }
      touchedEdges.add(seg.edgeId);
    }
  }

  // Safety net: an offset is only ever cosmetic, never load-bearing for correctness — if nudging
  // a route into a lane happened to clip an obstacle it previously cleared, that one route reverts
  // to its pre-offset path rather than shipping a cable that cuts through a device.
  //
  // A cable's own source/target device is checked at true-box precision (padding 0) instead of
  // the usual padded margin: the last leg of every route legitimately sits inside its own device's
  // *padding* zone (that's how it reaches its own port at all), so padding it here would flag that
  // normal approach as a violation on every single offset and silently revert lane separation back
  // to fully-overlapping cables — which is exactly the bug this fixes. Padding 0 still catches an
  // offset that actually cuts across the device's body (e.g. a different port row on the same
  // multi-port card), just not one that merely grazes the buffer around it.
  for (const edgeId of touchedEdges) {
    const pts = working.get(edgeId)!;
    const original = routes.get(edgeId)!;
    const spec = specById.get(edgeId);
    const hitsAnything = pts.slice(0, -1).some((p, i) =>
      obstacles.some((o) => {
        const isOwnDevice = spec != null && (o.id === spec.sourceNodeId || o.id === spec.targetNodeId);
        return segmentCrossesRect(p, pts[i + 1], o, isOwnDevice ? 0 : 2);
      }),
    );
    if (hitsAnything) working.set(edgeId, original.map((p) => ({ ...p })));
  }

  return working;
}

/** A dead-straight 2-point cable (the `findPath` direct-line fast path) is only ever verified
 *  clear along that exact line — `resolveOverlaps` skips it entirely (needs >= 3 points), so
 *  without this pass two different straight cables sharing a row/column would render as one fused
 *  line. This adds a small decorative curve so they read as distinct, but only ever accepts a
 *  candidate shape after checking it against every device — a dip/jog that isn't verified clear
 *  would risk swinging straight through whatever card happens to sit in that space, which is
 *  exactly the "cable renders under a node" bug this exists to avoid. Falls back to the plain
 *  straight line (already known clear) whenever no curved candidate clears.
 *
 *  The straight 2-point line itself is always safe with respect to its *own* source/target device
 *  — a port handle sits exactly on its card's edge, so the direct line runs tangent to that edge,
 *  never through the interior. But the whole point of this bend is to swing the line *off* that
 *  edge into what's assumed to be open corridor space — and on a tall multi-row card, that offset
 *  can just as easily land back inside its own card, slicing across a different port row. So this
 *  checks the bent candidate against every device including its own, at padding 0 (a bend may
 *  still graze/touch its own edge to leave the port — only a genuine cut through the interior
 *  disqualifies it), the same own-device-at-zero-padding rule `resolveOverlaps`'s safety net uses. */
function addCosmeticCurve(edgeId: string, points: Point[], spec: EdgeRouteSpec | undefined, obstacles: RectObstacle[]): Point[] {
  if (points.length !== 2) return points;
  const [p1, p2] = points;
  const clear = (pts: Point[]) =>
    pts.slice(0, -1).every((p, i) =>
      obstacles.every((o) => {
        const isOwnDevice = spec != null && (o.id === spec.sourceNodeId || o.id === spec.targetNodeId);
        return !segmentCrossesRect(p, pts[i + 1], o, isOwnDevice ? 0 : OBSTACLE_PADDING);
      }),
    );

  const hash = edgeId.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0);
  const absHash = Math.abs(hash);

  if (Math.abs(p1.y - p2.y) < 1 && Math.abs(p1.x - p2.x) > 20) {
    // Same-row cable — try dipping below the row first, then above, before giving up.
    const stub = 24 + (absHash % 10);
    const sx = p1.x < p2.x ? p1.x + stub : p1.x - stub;
    const tx = p1.x < p2.x ? p2.x - stub : p2.x + stub;
    for (const sign of [1, -1]) {
      const dipY = p1.y + sign * (28 + (absHash % 16));
      const bent = [p1, { x: sx, y: p1.y }, { x: sx, y: dipY }, { x: tx, y: dipY }, { x: tx, y: p2.y }, p2];
      if (clear(bent)) return bent;
    }
    return points;
  }
  if (Math.abs(p1.x - p2.x) < 1 && Math.abs(p1.y - p2.y) > 20) {
    // Same-column cable — try the hash-preferred side first, then the opposite side.
    const jog = 28 + (absHash % 20);
    const preferredDir = hash % 2 === 0 ? 1 : -1;
    for (const dir of [preferredDir, -preferredDir]) {
      const sideX = p1.x + dir * jog;
      const bent = [p1, { x: sideX, y: p1.y }, { x: sideX, y: p2.y }, p2];
      if (clear(bent)) return bent;
    }
    return points;
  }
  return points;
}

/** Runs both stages for a full graph: pathfind every cable independently, then separate any
 *  coincident parallel runs into lanes. Automatically registers micro-node card obstacles for
 *  power adapter cables so other cables route cleanly around them. */
export function computeRoutes(obstacles: RectObstacle[], edges: EdgeRouteSpec[]): Map<string, Point[]> {
  const routes = new Map<string, Point[]>();
  const ordered = [...edges].sort((a, b) => a.id.localeCompare(b.id));
  const specById = new Map(ordered.map((s) => [s.id, s] as const));

  // Pass 1: Initial pathfinding for all edges
  for (const spec of ordered) {
    routes.set(spec.id, findPath(spec, obstacles));
  }
  const pass1Routes = resolveOverlaps(routes, obstacles, ordered);

  // Pass 2: Identify adapter micro-node card obstacles
  const adapterObstacles: RectObstacle[] = [];
  for (const spec of ordered) {
    if (!spec.isPowerAdapter) continue;
    const pts = pass1Routes.get(spec.id);
    if (!pts || pts.length < 2) continue;

    // Find midpoint of longest straight interior segment
    let maxDist = -1;
    let bestMid = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
    const startIdx = pts.length >= 4 ? 1 : 0;
    const endIdx = pts.length >= 4 ? pts.length - 2 : pts.length - 1;

    for (let i = startIdx; i < endIdx; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (dist > maxDist) {
        maxDist = dist;
        bestMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      }
    }

    // Register a 130x36px obstacle for this micro-node card
    adapterObstacles.push({
      id: `adapter-card-${spec.id}`,
      x: bestMid.x - 65,
      y: bestMid.y - 18,
      width: 130,
      height: 36,
    });
  }

  // Pass 3: If we have micro-node card obstacles, re-route non-adapter cables around them
  let finalRoutes = pass1Routes;
  let finalObstacles = obstacles;
  if (adapterObstacles.length > 0) {
    const combinedObstacles = [...obstacles, ...adapterObstacles];
    const pass2Routes = new Map<string, Point[]>();
    for (const spec of ordered) {
      if (spec.isPowerAdapter) {
        pass2Routes.set(spec.id, pass1Routes.get(spec.id)!);
      } else {
        pass2Routes.set(spec.id, findPath(spec, combinedObstacles));
      }
    }
    finalRoutes = resolveOverlaps(pass2Routes, combinedObstacles, ordered);
    finalObstacles = combinedObstacles;
  }

  const curvedRoutes = new Map<string, Point[]>();
  for (const [id, pts] of finalRoutes) {
    curvedRoutes.set(id, addCosmeticCurve(id, pts, specById.get(id), finalObstacles));
  }
  return curvedRoutes;
}

/** Same corner-rounding technique `smoothstep` uses internally: cut each straight run short by
 *  `radius` before a bend and join the gap with a quadratic curve through the corner point. */
export function roundedPathFromPoints(points: Point[], radius: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    const r = Math.max(0, Math.min(radius, len1 / 2, len2 / 2));
    const p1 = len1 > 0 ? { x: curr.x - (v1.x / len1) * r, y: curr.y - (v1.y / len1) * r } : curr;
    const p2 = len2 > 0 ? { x: curr.x + (v2.x / len2) * r, y: curr.y + (v2.y / len2) * r } : curr;
    d += ` L ${p1.x} ${p1.y} Q ${curr.x} ${curr.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export interface PathSample {
  x: number;
  y: number;
  /** Direction of travel at this point, in radians (`Math.atan2` convention). */
  angle: number;
  /** Arc length from the start of the path to this sample. */
  dist: number;
}

/** Flattens the exact same straight-run + quadratic-corner shape `roundedPathFromPoints` draws
 *  into a dense polyline, subdividing each corner curve — the shared geometry both functions walk,
 *  so anything sampled off of it (e.g. texture tiles) stays pixel-aligned with the rendered path. */
function flattenRoundedPath(points: Point[], radius: number, curveSteps = 8): Point[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));

  const flat: Point[] = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    const r = Math.max(0, Math.min(radius, len1 / 2, len2 / 2));
    const p1 = len1 > 0 ? { x: curr.x - (v1.x / len1) * r, y: curr.y - (v1.y / len1) * r } : curr;
    const p2 = len2 > 0 ? { x: curr.x + (v2.x / len2) * r, y: curr.y + (v2.y / len2) * r } : curr;
    flat.push(p1);
    for (let s = 1; s <= curveSteps; s++) {
      const t = s / curveSteps;
      const mt = 1 - t;
      flat.push({
        x: mt * mt * p1.x + 2 * mt * t * curr.x + t * t * p2.x,
        y: mt * mt * p1.y + 2 * mt * t * curr.y + t * t * p2.y,
      });
    }
  }
  flat.push({ ...points[points.length - 1] });
  return flat;
}

/** Samples position + direction of travel at fixed arc-length steps along the same visual path
 *  `roundedPathFromPoints` renders, curved corners included. Used to stamp texture tiles that
 *  rotate to follow the cable through every bend instead of ever being drawn straight through a
 *  turn. Always includes a final sample at the exact path end regardless of step spacing. */
export function sampleAlongPath(points: Point[], radius: number, step: number): { samples: PathSample[]; length: number } {
  const flat = flattenRoundedPath(points, radius);
  if (flat.length < 2) return { samples: [], length: 0 };

  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < flat.length - 1; i++) {
    const d = Math.hypot(flat[i + 1].x - flat[i].x, flat[i + 1].y - flat[i].y);
    segLengths.push(d);
    total += d;
  }

  const pointAt = (dist: number): PathSample => {
    let segStart = 0;
    for (let i = 0; i < segLengths.length; i++) {
      const segLen = segLengths[i];
      if (dist <= segStart + segLen || i === segLengths.length - 1) {
        const t = segLen > 0 ? Math.max(0, Math.min(1, (dist - segStart) / segLen)) : 0;
        const a = flat[i];
        const b = flat[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x), dist };
      }
      segStart += segLen;
    }
    const last = flat[flat.length - 1];
    return { x: last.x, y: last.y, angle: 0, dist };
  };

  const samples: PathSample[] = [];
  const stepCount = Math.max(1, Math.floor(total / step));
  for (let i = 0; i <= stepCount; i++) {
    samples.push(pointAt(Math.min(i * step, total)));
  }
  if (samples.length === 0 || samples[samples.length - 1].x !== flat[flat.length - 1].x || samples[samples.length - 1].y !== flat[flat.length - 1].y) {
    samples.push(pointAt(total));
  }
  return { samples, length: total };
}
