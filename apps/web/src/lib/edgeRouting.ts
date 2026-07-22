/**
 * Grid-based orthogonal cable router: given every device box on the canvas and the exact pixel
 * position each cable enters/exits at, finds a rectilinear path per cable that (a) never crosses
 * through a *different* device's box and (b) prefers empty grid cells over ones another cable
 * already occupies, so parallel runs fan out into separate lanes instead of stacking on the same
 * line. This is deliberately a local, per-edge A* rather than a single global solve — cheap enough
 * to rerun after every drag, and "good enough" beats a perfect global router for a patch diagram.
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

const OBSTACLE_PADDING = 10;
// Long enough that when a cable's target sits behind its fixed exit side (forcing a reversal —
// e.g. two devices stacked directly on top of each other, connected port-to-port) the loop that
// buys the U-turn reads as a deliberate wide arc clearing both cards, not a knot cinched tight
// against the corner.
const STUB = 40;
// Turn penalty dominates usage penalty: a route should almost always look like a clean L/Z with
// as few bends as physically necessary, only nudging sideways by a lane when it would otherwise
// run exactly on top of another cable — not the other way around (weaving to dodge a shared cell
// is what produced the staircase-y paths this was tuned to get rid of). Usage cost is additionally
// capped per cell so that crowding on a busy shared corridor can never out-cost a real detour loop
// — it should only ever break ties between otherwise-equal routes, never manufacture bends.
const TURN_PENALTY = 26;
const USAGE_PENALTY = 2;
const USAGE_PENALTY_CAP = 10;
const MAX_EXPANSIONS = 40000;

/** Grid resolution scales with how far apart a cable's ends are: a fine 16px grid keeps routing
 *  precise in crowded local clusters, but the same resolution applied to a cable spanning most of
 *  the canvas (e.g. stage-left to stage-right) blows the search space past MAX_EXPANSIONS well
 *  before it ever finds the goal — which was silently falling back to an unchecked straight elbow
 *  that could cut through anything in its path. Coarsening the grid for long hauls keeps the state
 *  space bounded regardless of canvas size, at the cost of precision those distances don't need
 *  anyway. */
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
  usageCost: (cx: number, cy: number) => number,
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
      const stepCost = 1 + Math.min(usageCost(ncx, ncy) * USAGE_PENALTY, USAGE_PENALTY_CAP);
      const tentativeG = curG + turnCost + stepCost;
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

/** The exact pixel stub anchor (`stubStart`/`stubEnd`) and the grid-rounded A* cell it seeds from
 *  (`cellOf` rounds to the nearest 16px) are the same *conceptual* point but not the same pixel —
 *  off by up to half a cell in both axes. Left alone, that stitches a short genuinely diagonal
 *  segment into an otherwise all-orthogonal path, which can clip straight through the corner of
 *  whatever obstacle the grid was routing around. Every consecutive pair here is expected to
 *  already share an x or a y; this only patches the handful of joins where rounding broke that. */
function orthogonalize(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (prev.x !== curr.x && prev.y !== curr.y) result.push({ x: curr.x, y: prev.y });
    result.push(curr);
  }
  return result;
}

function simplifyColinear(points: Point[]): Point[] {
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

/** Every cable exits its source device heading right and enters its target heading left (matches
 *  the fixed Left/Right Handle layout in DeviceNode.tsx), so routes never need to consider the
 *  other two approach directions. */
export function computeRoutes(obstacles: RectObstacle[], edges: EdgeRouteSpec[]): Map<string, Point[]> {
  // Obstacle grids and usage-lane tracking are both keyed by cell size, since a "cell" at one
  // resolution doesn't correspond to anything meaningful at another — built lazily since most
  // graphs only ever need the fine grid.
  const obstacleSets = new Map<number, Set<string>>();
  const getObstacleSet = (cell: number): Set<string> => {
    const cached = obstacleSets.get(cell);
    if (cached) return cached;
    const set = new Set<string>();
    const cellOf = (v: number) => Math.round(v / cell);
    for (const rect of obstacles) {
      const x0 = cellOf(rect.x - OBSTACLE_PADDING);
      const x1 = cellOf(rect.x + rect.width + OBSTACLE_PADDING);
      const y0 = cellOf(rect.y - OBSTACLE_PADDING);
      const y1 = cellOf(rect.y + rect.height + OBSTACLE_PADDING);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          set.add(cellKey(cx, cy));
        }
      }
    }
    obstacleSets.set(cell, set);
    return set;
  };
  const usageByCell = new Map<number, Map<string, number>>();
  const getUsage = (cell: number): Map<string, number> => {
    let m = usageByCell.get(cell);
    if (!m) {
      m = new Map();
      usageByCell.set(cell, m);
    }
    return m;
  };

  const routes = new Map<string, Point[]>();
  const ordered = [...edges].sort((a, b) => a.id.localeCompare(b.id));

  for (const spec of ordered) {
    const { start, end } = spec;
    const cell = pickCellSize(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    const cellOf = (v: number) => Math.round(v / cell);
    const globalObstacles = getObstacleSet(cell);
    const usage = getUsage(cell);

    const stubStart = { x: start.x + STUB, y: start.y };
    const stubEnd = { x: end.x - STUB, y: end.y };

    // A cable is only ever allowed to touch its own source/target device along the exact row it
    // exits/enters on (the straight stub segment right at its own port) — never anywhere else on
    // that card. Excluding the *whole* device footprint here was the bug: with several ports on
    // one card (e.g. an 8-outlet power strip), every one of those cables would then be free to
    // cut straight across its neighbours' rows on the same card, since the entire card counted as
    // "not an obstacle" for each of them individually.
    const corridor = new Set<string>();
    const carveHorizontal = (xa: number, xb: number, y: number) => {
      const cy = cellOf(y);
      const cx0 = cellOf(Math.min(xa, xb));
      const cx1 = cellOf(Math.max(xa, xb));
      for (let cx = cx0; cx <= cx1; cx++) corridor.add(cellKey(cx, cy));
    };
    carveHorizontal(start.x, stubStart.x, start.y);
    carveHorizontal(stubEnd.x, end.x, end.y);

    const isBlocked = (cx: number, cy: number) => {
      const k = cellKey(cx, cy);
      if (corridor.has(k)) return false;
      return globalObstacles.has(k);
    };
    const usageCost = (cx: number, cy: number) => usage.get(cellKey(cx, cy)) ?? 0;

    let found: [number, number][] | null = null;
    let margin = Math.max(260, cell * 8);
    for (let attempt = 0; attempt < 4 && !found; attempt++, margin *= 2.5) {
      const minX = Math.min(start.x, end.x) - margin;
      const maxX = Math.max(start.x, end.x) + margin;
      const minY = Math.min(start.y, end.y) - margin;
      const maxY = Math.max(start.y, end.y) + margin;
      const bounds: GridBounds = { minCx: cellOf(minX), maxCx: cellOf(maxX), minCy: cellOf(minY), maxCy: cellOf(maxY) };
      found = astar([cellOf(stubStart.x), cellOf(stubStart.y)], [cellOf(stubEnd.x), cellOf(stubEnd.y)], isBlocked, usageCost, bounds);
    }

    let waypoints: Point[];
    if (found) {
      for (const [cx, cy] of found) usage.set(cellKey(cx, cy), (usage.get(cellKey(cx, cy)) ?? 0) + 1);
      const cellPoints = found.map(([cx, cy]) => ({ x: cx * cell, y: cy * cell }));
      waypoints = simplifyColinear(orthogonalize([start, stubStart, ...cellPoints, stubEnd, end]));
    } else {
      // Genuinely no path found even at the coarsest, widest-margin attempt (pathologically
      // boxed in) — fall back to a plain elbow rather than drawing nothing, picking whichever of
      // the two possible elbow shapes clears every obstacle if one of them does.
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      const viaMidX = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
      const viaMidY = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
      const otherObstacles = obstacles.filter((o) => o.id !== spec.sourceNodeId && o.id !== spec.targetNodeId);
      const clear = (pts: Point[]) =>
        pts.slice(0, -1).every((p, i) => otherObstacles.every((o) => !segmentCrossesRect(p, pts[i + 1], o, OBSTACLE_PADDING)));
      waypoints = simplifyColinear(clear(viaMidX) ? viaMidX : clear(viaMidY) ? viaMidY : viaMidX);
    }
    routes.set(spec.id, waypoints);
  }

  return routes;
}

function segmentCrossesRect(p1: Point, p2: Point, rect: RectObstacle, padding: number): boolean {
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
