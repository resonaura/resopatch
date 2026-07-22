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
const TURN_PENALTY = 26;
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

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

interface GridBounds {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

function astar(
  start: [number, number],
  end: [number, number],
  isBlocked: (cx: number, cy: number) => boolean,
  bounds: GridBounds,
): [number, number][] | null {
  const heuristic = (cx: number, cy: number) => Math.abs(cx - end[0]) + Math.abs(cy - end[1]);
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const heap = new MinHeap<{ cx: number; cy: number; dir: number }>();
  const stateKey = (cx: number, cy: number, dir: number) => `${cx},${cy},${dir}`;

  for (let d = 0; d < DIRS.length; d++) {
    const k = stateKey(start[0], start[1], d);
    gScore.set(k, 0);
    heap.push(heuristic(start[0], start[1]), { cx: start[0], cy: start[1], dir: d });
  }

  let expansions = 0;
  while (heap.size > 0) {
    if (expansions++ > MAX_EXPANSIONS) return null;
    const current = heap.pop()!;
    const curKey = stateKey(current.cx, current.cy, current.dir);
    const curG = gScore.get(curKey);
    if (curG === undefined) continue;

    if (current.cx === end[0] && current.cy === end[1]) {
      const path: [number, number][] = [];
      let k: string | undefined = curKey;
      while (k) {
        const parts = k.split(',');
        path.push([Number(parts[0]), Number(parts[1])]);
        k = cameFrom.get(k);
      }
      path.reverse();
      return path;
    }

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

  // Fast path: source and target already share a row or column, and nothing else sits between
  // them — skip the grid machinery entirely rather than route it through A* just to have the
  // stub-to-grid-line snap (see below) introduce a purely cosmetic jitter into what should be a
  // single dead-straight run. This is also the single most common shape (two devices roughly
  // level with each other), so it's worth short-circuiting even ignoring the jitter.
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

  // The stub anchors are snapped to whichever grid cell the A* search actually starts/ends from
  // — not the raw unrounded pixel a fixed-length offset would land on. Those two are subtly
  // different pixels (ports don't generally sit on a multiple of the cell size); stitching them
  // together naively produces a short genuinely-diagonal segment. Snapping the stub itself means
  // that never happens — the only unavoidable rounding is a short vertical hop from the port's
  // exact row onto its grid row, isolated to the very first/last segment where it reads as part
  // of the connector, not a stray kink mid-route.
  const startCellX = cellOf(start.x + STUB);
  const startCellY = cellOf(start.y);
  const endCellX = cellOf(end.x - STUB);
  const endCellY = cellOf(end.y);
  const stubStart = { x: startCellX * cell, y: startCellY * cell };
  const stubEnd = { x: endCellX * cell, y: endCellY * cell };

  // A cable is only ever allowed to touch its own source/target device along the exact row it
  // exits/enters on (the straight stub segment right at its own port) — never anywhere else on
  // that card. Excluding the *whole* device footprint would let every cable on a multi-port card
  // (e.g. an 8-outlet power strip) cut straight across its neighbours' rows on the same card.
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
    // found[0] and found[last] are exactly stubStart/stubEnd (same cell, by construction) — skip
    // the duplicates and thread the short exact-pixel-to-grid hop in as its own clean segment.
    //
    // That hop is deliberately kept glued to the port (not moved further out along the exit row)
    // even though that reads slightly less smooth up close: it's what keeps this segment pinned to
    // the *exact* port pixel and excluded from lane offsetting (resolveOverlaps never touches the
    // first/last segment). Moving it further out was tried and reverted — it turns this into an
    // *eligible* segment keyed by the device's edge x, which is identical for every cable landing
    // on that device from the same side, so any two cables sharing a target row collide here in a
    // way resolveOverlaps can never fix. STUB and the corner radius (see RoutedEdge.tsx) are the
    // actual knobs for "turn happens further from the port, with a smoother bend".
    const cellPoints = found.slice(1, -1).map(([cx, cy]) => ({ x: cx * cell, y: cy * cell }));
    return simplifyColinear([start, { x: start.x, y: stubStart.y }, stubStart, ...cellPoints, stubEnd, { x: end.x, y: stubEnd.y }, end]);
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

/** Stage 2: nudge coincident parallel runs apart into separate lanes. Only ever touches interior
 *  segments (never the first/last, which are anchored exactly to a port) and only ever moves a
 *  segment perpendicular to its own direction — the neighbouring perpendicular segments simply
 *  get longer or shorter to absorb the shift, so no new corners are needed to stay connected.
 *
 *  `edges` is only consulted for the safety-net revert check below — it's what lets that check
 *  tell "this cable's own source/target device" apart from every other obstacle. */
export function resolveOverlaps(routes: Map<string, Point[]>, obstacles: RectObstacle[], edges: EdgeRouteSpec[]): Map<string, Point[]> {
  const working = new Map(Array.from(routes, ([id, pts]) => [id, pts.map((p) => ({ ...p }))] as const));
  const specById = new Map(edges.map((e) => [e.id, e] as const));

  const segments: SegmentRef[] = [];
  for (const [edgeId, pts] of working) {
    const spec = specById.get(edgeId);
    const nearStartIdx = 1;
    const nearEndIdx = pts.length - 3;
    for (let i = 1; i < pts.length - 2; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      let orientation: 'h' | 'v' | undefined;
      let fixed = 0;
      let lo = 0;
      let hi = 0;
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
    if (laneCount < 2) continue;
    for (const seg of group) {
      const lane = laneOf.get(seg)!;
      const offset = (lane - (laneCount - 1) / 2) * LANE_GAP;
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
        return segmentCrossesRect(p, pts[i + 1], o, isOwnDevice ? 0 : OBSTACLE_PADDING);
      }),
    );
    if (hitsAnything) working.set(edgeId, original.map((p) => ({ ...p })));
  }

  return working;
}

/** Runs both stages for a full graph: pathfind every cable independently, then separate any
 *  coincident parallel runs into lanes. */
export function computeRoutes(obstacles: RectObstacle[], edges: EdgeRouteSpec[]): Map<string, Point[]> {
  const routes = new Map<string, Point[]>();
  const ordered = [...edges].sort((a, b) => a.id.localeCompare(b.id));
  for (const spec of ordered) routes.set(spec.id, findPath(spec, obstacles));
  return resolveOverlaps(routes, obstacles, ordered);
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
