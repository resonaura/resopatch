/**
 * Orthogonal cable routing for the patch canvas (main-thread safe).
 *
 * **Important:** this module must NEVER import `libavoidRouter` / `obstacle-router`.
 * That package is ~0.5MB of sync JS and used to freeze the tab on every import of
 * PatchCanvas/RoutedEdge. Libavoid runs only in `routeWorker.ts` (Web Worker).
 *
 * This file keeps: local A* findPath, geometric findBestPath, legacy fan-in, labels, SVG helpers.
 */

import { PARALLEL_CABLE_GAP } from './cableLabelClearance';
import type { EdgeRouteSpec, Point, RectObstacle } from './routingTypes';
export type { EdgeRouteSpec, Point, RectObstacle } from './routingTypes';

// Keep-out around chip bodies (package-to-trace clearance on a dense board — NOT a huge halo).
// Real stages pack cards ~50px apart (MOTU then CME); a 20px pad on each side left zero channel.
const OBSTACLE_PADDING = 8;
// How far a cable travels straight out from its port ("сосочек") before the first bend is allowed.
// Must clear the handle/dot and a bit of the card edge so the cable never turns straight up/down
// on top of the nipple.
const STUB = 48;
/** Minimum horizontal run off a port before the first bend (still readable as "leaving the nipple"). */
const MIN_STUB = 20;
// High turn cost so A* strongly prefers long straight runs over staircases when both work.
const TURN_PENALTY = 22;
const MAX_EXPANSIONS = 40000;

// Minimum center-to-center spacing between parallel traces (label chip + air).
const LANE_GAP = PARALLEL_CABLE_GAP;
/** Half-gap: how far a finished trace's keep-out extends from its centerline. */
const TRACE_CLEARANCE = Math.round(PARALLEL_CABLE_GAP / 2) - 2;
// Group near-coincident parallel runs (grid rounding / float noise), not only exact equals.
const LANE_GROUP_TOLERANCE = Math.round(PARALLEL_CABLE_GAP * 0.55);

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

/** Drop near-zero-length jogs left by grid rounding (e.g. 1–2 px "stairs"). */
function dropMicroSegments(points: Point[], minLen = 4): Point[] {
  if (points.length < 2) return points;
  const out: Point[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const curr = points[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) < minLen) {
      // Keep the final endpoint even if it lands on top of the previous sample —
      // just overwrite so we never emit a trailing duplicate.
      if (i === points.length - 1) out[out.length - 1] = { ...curr };
      continue;
    }
    out.push({ ...curr });
  }
  return simplifyColinear(out);
}

/**
 * Remove unnecessary corners: if two non-adjacent points can be joined by a clear
 * orthogonal 1- or 2-segment path, drop everything between them. Collapses A*
 * staircases into L / Z elbows whenever space allows.
 */
export function reduceBends(
  points: Point[],
  segmentClear: (a: Point, b: Point) => boolean,
): Point[] {
  let pts = dropMicroSegments(simplifyColinear(points));
  if (pts.length < 3) return pts;

  const pathClear = (a: Point, b: Point): Point[] | null => {
    if (a.x === b.x || a.y === b.y) {
      return segmentClear(a, b) ? [a, b] : null;
    }
    // Prefer horizontal-first, then vertical-first L elbows.
    const viaH: Point = { x: b.x, y: a.y };
    if (segmentClear(a, viaH) && segmentClear(viaH, b)) return [a, viaH, b];
    const viaV: Point = { x: a.x, y: b.y };
    if (segmentClear(a, viaV) && segmentClear(viaV, b)) return [a, viaV, b];
    return null;
  };

  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    // Greedy: from each vertex try to jump as far as possible.
    outer: for (let i = 0; i < pts.length - 1; i++) {
      for (let j = pts.length - 1; j > i + 1; j--) {
        const bridge = pathClear(pts[i], pts[j]);
        if (!bridge) continue;
        // Only accept if the bridge has strictly fewer interior corners than the span.
        const spanCorners = j - i - 1;
        const bridgeCorners = bridge.length - 2;
        if (bridgeCorners >= spanCorners) continue;
        // bridge already includes pts[i] and pts[j] — don't also keep pts[j] from the tail.
        pts = [...pts.slice(0, i), ...bridge, ...pts.slice(j + 1)];
        pts = dropMicroSegments(simplifyColinear(pts));
        changed = true;
        break outer;
      }
    }
  }
  return dropMicroSegments(pts);
}

/**
 * How far we can leave a port horizontally before hitting a neighbour's keep-out.
 * Real stages pack cards tightly (MOTU then CME 55px away) — a fixed 48px stub would
 * immediately clip the neighbour. Shrink the stub into the free pocket, never below MIN_STUB.
 */
export function exitStubLen(
  start: Point,
  sSign: number,
  obstacles: RectObstacle[],
  ownIds: Set<string>,
  preferred = STUB,
): number {
  let free = preferred;
  for (const o of obstacles) {
    if (ownIds.has(o.id)) continue;
    const top = o.y - OBSTACLE_PADDING;
    const bot = o.y + o.height + OBSTACLE_PADDING;
    if (start.y < top || start.y > bot) continue;
    if (sSign > 0) {
      const face = o.x - OBSTACLE_PADDING;
      if (face > start.x) free = Math.min(free, face - start.x - 4);
    } else {
      const face = o.x + o.width + OBSTACLE_PADDING;
      if (face < start.x) free = Math.min(free, start.x - face - 4);
    }
  }
  // free can go negative when a neighbour's keep-out already covers the port exit —
  // still force a readable MIN_STUB so we never turn on the nipple itself.
  if (!Number.isFinite(free) || free < MIN_STUB) free = MIN_STUB;
  return Math.max(MIN_STUB, Math.min(preferred, free));
}

/**
 * Force the canonical exit/entry: horizontal stub out of the source nipple, then routing,
 * then horizontal stub into the target nipple. Never turn up/down on top of the port.
 *
 * Pure same-row horizontals that already leave both ports along their facing axis are left alone.
 */
export function enforceExitStubs(
  path: Point[],
  start: Point,
  end: Point,
  sSign: number,
  tSign: number,
  stubLen: number,
): Point[] {
  if (path.length < 2) return [start, end];

  // Same-row direct shot: the whole cable *is* the exit run — no vertical needed.
  if (path.length === 2 && Math.abs(start.y - end.y) < 0.5 && Math.abs(path[0].y - path[1].y) < 0.5) {
    return [start, end];
  }

  const stubS: Point = { x: start.x + sSign * stubLen, y: start.y };
  const stubT: Point = { x: end.x + tSign * stubLen, y: end.y };

  // Keep interior corners, drop anything still sitting on the port exit/entry segments.
  const mid: Point[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    const onSourceStub =
      Math.abs(p.y - start.y) < 0.5 &&
      ((sSign > 0 && p.x >= start.x - 0.5 && p.x <= stubS.x + 0.5) ||
        (sSign < 0 && p.x <= start.x + 0.5 && p.x >= stubS.x - 0.5));
    const onTargetStub =
      Math.abs(p.y - end.y) < 0.5 &&
      ((tSign > 0 && p.x >= end.x - 0.5 && p.x <= stubT.x + 0.5) ||
        (tSign < 0 && p.x <= end.x + 0.5 && p.x >= stubT.x - 0.5));
    if (onSourceStub || onTargetStub) continue;
    mid.push(p);
  }

  return dropMicroSegments(simplifyColinear([start, stubS, ...mid, stubT, end]));
}

/** Canonical stubbed Z path on a chosen vertical corridor X. */
function buildCorridorPath(
  start: Point,
  end: Point,
  sSign: number,
  tSign: number,
  corridorX: number,
  stubLen: number,
  segmentClear: (a: Point, b: Point) => boolean,
): Point[] | null {
  const stubS: Point = { x: start.x + sSign * stubLen, y: start.y };
  const stubT: Point = { x: end.x + tSign * stubLen, y: end.y };
  const path = simplifyColinear([
    start,
    stubS,
    { x: corridorX, y: stubS.y },
    { x: corridorX, y: stubT.y },
    stubT,
    end,
  ]);
  if (!pathIsClear(path, segmentClear)) return null;
  if (Math.abs(path[1].y - start.y) > 0.5) return null;
  if (Math.sign(path[1].x - start.x || sSign) !== sSign) return null;
  return path;
}

/**
 * Stub-first detour on a horizontal "highway" (1-layer PCB multi-pin breakout).
 *
 *   pad → stub off nipple → unique column (lane) → highway Y → unique approach column → pad
 *
 * Columns are scanned in free air (package clearance, not a huge halo) so several tracks fit
 * in the ~50px channel between packed stage cards.
 */
function buildHighwayPath(
  start: Point,
  end: Point,
  sSign: number,
  tSign: number,
  highwayY: number,
  sourceStubLen: number,
  targetStubLen: number,
  segmentClear: (a: Point, b: Point) => boolean,
  laneIndex = 0,
  _laneCount = 1,
): Point[] | null {
  const stubS: Point = { x: start.x + sSign * sourceStubLen, y: start.y };
  const stubT: Point = { x: end.x + tSign * targetStubLen, y: end.y };
  if (!segmentClear(start, stubS) || !segmentClear(stubT, end)) return null;

  // Collect free source-side columns (pad row → highway), spaced by LANE_GAP.
  const runCols: number[] = [];
  for (let step = 0; step < 80 && runCols.length <= laneIndex; step++) {
    const x = Math.round(stubS.x + sSign * step * 3);
    if (runCols.length && Math.abs(x - runCols[runCols.length - 1]) < LANE_GAP) continue;
    if (!segmentClear(stubS, { x, y: stubS.y })) continue;
    if (!segmentClear({ x, y: stubS.y }, { x, y: highwayY })) continue;
    runCols.push(x);
  }
  if (runCols.length === 0) return null;
  const runX = runCols[Math.min(laneIndex, runCols.length - 1)];

  // Free target-side columns (highway → pad).
  const appCols: number[] = [];
  for (let step = 0; step < 80 && appCols.length <= laneIndex; step++) {
    const x = Math.round(stubT.x + tSign * step * 3);
    if (appCols.length && Math.abs(x - appCols[appCols.length - 1]) < LANE_GAP) continue;
    if (!segmentClear({ x, y: stubT.y }, stubT)) continue;
    if (!segmentClear({ x, y: highwayY }, { x, y: stubT.y })) continue;
    appCols.push(x);
  }
  const approachX = appCols.length ? appCols[Math.min(laneIndex, appCols.length - 1)] : stubT.x;

  const path = simplifyColinear([
    start,
    stubS,
    { x: runX, y: stubS.y },
    { x: runX, y: highwayY },
    { x: approachX, y: highwayY },
    { x: approachX, y: stubT.y },
    stubT,
    end,
  ]).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));

  if (!pathIsClear(path, segmentClear)) return null;
  if (Math.abs(path[1].y - start.y) > 0.5) return null;
  if (Math.sign(path[1].x - start.x || sSign) !== sSign) return null;
  if (Math.abs(path[1].x - start.x) < MIN_STUB - 0.5) return null;
  return path;
}

/**
 * Prefer simple orthogonal elbows that always leave the port horizontally before any vertical.
 * Returns null when no short candidate clears obstacles.
 */
function trySimpleRoute(
  start: Point,
  end: Point,
  sSign: number,
  tSign: number,
  stubLen: number,
  segmentClear: (a: Point, b: Point) => boolean,
): Point[] | null {
  const stubS: Point = { x: start.x + sSign * stubLen, y: start.y };
  const stubT: Point = { x: end.x + tSign * stubLen, y: end.y };

  if (!segmentClear(start, stubS) || !segmentClear(stubT, end)) return null;

  // After stubs, a horizontal bridge on the same row.
  if (stubS.y === stubT.y && segmentClear(stubS, stubT)) {
    return simplifyColinear([start, stubS, stubT, end]);
  }

  const candidates: Point[][] = [];

  // Out horizontally → vertical on target-stub column → into target (never vertical on the port).
  candidates.push([start, stubS, { x: stubT.x, y: stubS.y }, stubT, end]);
  // Out horizontally → vertical on source-stub column → across → into target.
  candidates.push([start, stubS, { x: stubS.x, y: stubT.y }, stubT, end]);

  // Mid corridor between the two stubs (good default when devices face each other).
  const midX = (stubS.x + stubT.x) / 2;
  if (Math.abs(midX - stubS.x) > 8 && Math.abs(midX - stubT.x) > 8) {
    candidates.push([start, stubS, { x: midX, y: stubS.y }, { x: midX, y: stubT.y }, stubT, end]);
  }

  // Forced U-turn when both ports face the same way.
  if (sSign === tSign) {
    const loopX = sSign > 0 ? Math.max(stubS.x, stubT.x) + stubLen : Math.min(stubS.x, stubT.x) - stubLen;
    candidates.push([start, stubS, { x: loopX, y: stubS.y }, { x: loopX, y: stubT.y }, stubT, end]);
  }

  let best: Point[] | null = null;
  let bestScore = Infinity;
  for (const raw of candidates) {
    const path = simplifyColinear(raw);
    if (!pathIsClear(path, segmentClear)) continue;
    // Reject anything that turns vertically at the port (first segment must be horizontal out).
    if (Math.abs(path[1].y - start.y) > 0.5) continue;
    if (Math.sign(path[1].x - start.x || sSign) !== sSign) continue;

    let len = 0;
    for (let i = 0; i < path.length - 1; i++) {
      len += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    }
    const score = (path.length - 2) * 10000 + len;
    if (score < bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best;
}

/** Both segments here are always axis-aligned (this router never produces a diagonal run) — an
 *  H/H or V/V pair "crosses" when their fixed coordinates match and their ranges overlap; an H/V
 *  pair crosses when the vertical one's x sits inside the horizontal one's x-range and vice versa
 *  for y. Used to keep one cable's cosmetic dip (see `addCosmeticCurve`) from swinging through a
 *  completely different cable's path — `segmentCrossesRect` only ever checked device boxes, so
 *  two independent straight cables could otherwise end up visually overlapping. */
function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const aH = a1.y === a2.y;
  const bH = b1.y === b2.y;
  if (aH && bH) {
    if (a1.y !== b1.y) return false;
    const aLo = Math.min(a1.x, a2.x);
    const aHi = Math.max(a1.x, a2.x);
    const bLo = Math.min(b1.x, b2.x);
    const bHi = Math.max(b1.x, b2.x);
    return aHi > bLo && bHi > aLo;
  }
  if (!aH && !bH) {
    if (a1.x !== b1.x) return false;
    const aLo = Math.min(a1.y, a2.y);
    const aHi = Math.max(a1.y, a2.y);
    const bLo = Math.min(b1.y, b2.y);
    const bHi = Math.max(b1.y, b2.y);
    return aHi > bLo && bHi > aLo;
  }
  const h = aH ? { y: a1.y, xLo: Math.min(a1.x, a2.x), xHi: Math.max(a1.x, a2.x) } : { y: b1.y, xLo: Math.min(b1.x, b2.x), xHi: Math.max(b1.x, b2.x) };
  const v = aH ? { x: b1.x, yLo: Math.min(b1.y, b2.y), yHi: Math.max(b1.y, b2.y) } : { x: a1.x, yLo: Math.min(a1.y, a2.y), yHi: Math.max(a1.y, a2.y) };
  return v.x > h.xLo && v.x < h.xHi && h.y > v.yLo && h.y < v.yHi;
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

/** Own-card body inset so the port edge itself stays walkable but the interior is blocked. */
function ownBodyRect(rect: RectObstacle): RectObstacle {
  const inset = 3;
  return {
    id: rect.id,
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(0, rect.width - inset * 2),
    height: Math.max(0, rect.height - inset * 2),
  };
}

/** True if non-adjacent segments of an orthogonal path cross or run back over each other. */
export function pathSelfIntersects(points: Point[]): boolean {
  if (points.length < 4) return false;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      // Allow segments that share a vertex (j === i+1 is already skipped).
      if (j === i + 1) continue;
      // Skip consecutive-around-join cases already excluded; also skip if they only meet at an endpoint.
      const a1 = points[i];
      const a2 = points[i + 1];
      const b1 = points[j];
      const b2 = points[j + 1];
      if (a2.x === b1.x && a2.y === b1.y) continue;
      if (a1.x === b2.x && a1.y === b2.y) continue;
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Segment is clear of every device: foreign boxes use full keep-out padding; own cards only
 * block their *inset body* so the cable may leave/enter at the port edge without tunneling
 * through the middle of a multi-port strip.
 */
export function makeSegmentClear(spec: EdgeRouteSpec, obstacles: RectObstacle[]) {
  const otherObstacles = obstacles.filter((o) => o.id !== spec.sourceNodeId && o.id !== spec.targetNodeId);
  const ownObstacles = obstacles
    .filter((o) => o.id === spec.sourceNodeId || o.id === spec.targetNodeId)
    .map(ownBodyRect);

  return (p1: Point, p2: Point) =>
    otherObstacles.every((o) => !segmentCrossesRect(p1, p2, o, OBSTACLE_PADDING)) &&
    ownObstacles.every((o) => o.width <= 0 || o.height <= 0 || !segmentCrossesRect(p1, p2, o, 0));
}

export function pathIsClear(points: Point[], segmentClear: (a: Point, b: Point) => boolean): boolean {
  if (points.length < 2) return false;
  for (let i = 0; i < points.length - 1; i++) {
    if (!segmentClear(points[i], points[i + 1])) return false;
  }
  return !pathSelfIntersects(points);
}

/** Lower is better. Infinite-ish when invalid. */
export function scorePath(points: Point[], segmentClear: (a: Point, b: Point) => boolean): number {
  if (!pathIsClear(points, segmentClear)) return 1e12;
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  const turns = Math.max(0, points.length - 2);
  // Penalize tiny back-and-forth jogs (self-curl signature).
  let reversePenalty = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const v1x = points[i].x - points[i - 1].x;
    const v1y = points[i].y - points[i - 1].y;
    const v2x = points[i + 1].x - points[i].x;
    const v2y = points[i + 1].y - points[i].y;
    if (v1x * v2x + v1y * v2y < 0) reversePenalty += 800;
  }
  return len + turns * 400 + reversePenalty;
}

function hasHorizontalExit(path: Point[], start: Point, sSign: number): boolean {
  if (path.length < 2) return false;
  if (Math.abs(path[0].x - start.x) > 0.5 || Math.abs(path[0].y - start.y) > 0.5) return false;
  const dx = path[1].x - path[0].x;
  const dy = path[1].y - path[0].y;
  return Math.abs(dy) < 0.5 && Math.sign(dx || sSign) === sSign && Math.abs(dx) >= STUB * 0.5;
}

/**
 * One cable's obstacle-avoiding path (fast local A* / elbows).
 *
 * Intentionally NOT libavoid: `findBestPath` may call this for every L/R handle candidate
 * on every edge at canvas open — a full visibility-graph transaction per call freezes the tab.
 * Multi-net spacing happens in `computeRoutes` (libavoid once, or legacy fan-in).
 */
export function findPath(spec: EdgeRouteSpec, obstacles: RectObstacle[]): Point[] {
  const { start, end } = spec;

  // Degenerate: both ends on the same pixel.
  if (Math.abs(start.x - end.x) < 0.5 && Math.abs(start.y - end.y) < 0.5) {
    return [{ ...start }];
  }

  const sSign = spec.sourceDir === 'left' ? -1 : 1;
  const tSign = spec.targetDir === 'right' ? 1 : -1;
  const ownIds = new Set([spec.sourceNodeId, spec.targetNodeId]);
  const sStub = exitStubLen(start, sSign, obstacles, ownIds);
  const tStub = exitStubLen(end, tSign, obstacles, ownIds);
  const segmentClear = makeSegmentClear(spec, obstacles);

  const accept = (pts: Point[]): Point[] | null => {
    const stubbed = enforceExitStubs(pts, start, end, sSign, tSign, sStub);
    const cleanStubbed = dropMicroSegments(simplifyColinear(stubbed));
    if (pathIsClear(cleanStubbed, segmentClear) && hasHorizontalExit(cleanStubbed, start, sSign)) {
      return cleanStubbed;
    }
    // Don't force stubs if that newly clips a device — keep a clear path that already exits horizontally.
    const clean = dropMicroSegments(simplifyColinear(pts));
    if (pathIsClear(clean, segmentClear) && hasHorizontalExit(clean, start, sSign)) return clean;
    // Same-row pure horizontal is allowed without an explicit stub point (the whole run *is* the exit).
    if (
      clean.length === 2 &&
      Math.abs(clean[0].y - clean[1].y) < 0.5 &&
      pathIsClear(clean, segmentClear)
    ) {
      return clean;
    }
    return null;
  };

  // Same-row horizontal only when fully clear of every card.
  if (Math.abs(start.y - end.y) < 0.5) {
    const direct = accept([start, end]);
    if (direct) return direct;
  }

  const effectiveStub = sStub;
  const simple = trySimpleRoute(start, end, sSign, tSign, effectiveStub, segmentClear);
  if (simple) {
    const ok = accept(simple);
    if (ok) return ok;
  }

  // Wide detours above/below every obstacle — covers walls sitting on the direct row.
  {
    let minY = Math.min(start.y, end.y);
    let maxY = Math.max(start.y, end.y);
    for (const o of obstacles) {
      if (o.id === spec.sourceNodeId || o.id === spec.targetNodeId) continue;
      minY = Math.min(minY, o.y - OBSTACLE_PADDING - STUB);
      maxY = Math.max(maxY, o.y + o.height + OBSTACLE_PADDING + STUB);
    }
    const stubS = { x: start.x + sSign * effectiveStub, y: start.y };
    const stubT = { x: end.x + tSign * effectiveStub, y: end.y };
    for (const bypassY of [minY, maxY]) {
      const detour = [
        start,
        stubS,
        { x: stubS.x, y: bypassY },
        { x: stubT.x, y: bypassY },
        stubT,
        end,
      ];
      const ok = accept(detour);
      if (ok) return ok;
    }
  }

  const cell = pickCellSize(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const cellOf = (v: number) => Math.round(v / cell);

  // Block foreign devices with keep-out; block own bodies (inset) so we never tunnel mid-card.
  const globalObstacles = new Set<string>();
  for (const rect of obstacles) {
    const isOwn = rect.id === spec.sourceNodeId || rect.id === spec.targetNodeId;
    const r = isOwn ? ownBodyRect(rect) : rect;
    const pad = isOwn ? 0 : OBSTACLE_PADDING;
    if (r.width <= 0 || r.height <= 0) continue;
    const x0 = cellOf(r.x - pad);
    const x1 = cellOf(r.x + r.width + pad);
    const y0 = cellOf(r.y - pad);
    const y1 = cellOf(r.y + r.height + pad);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) globalObstacles.add(cellKey(cx, cy));
    }
  }

  // Walk exit direction until the stub cell is free of foreign blocks (don't start inside a wall).
  const walkFreeX = (fromX: number, y: number, sign: number): number => {
    let x = fromX + sign * effectiveStub;
    for (let i = 0; i < 24; i++) {
      const cx = cellOf(x);
      const cy = cellOf(y);
      if (!globalObstacles.has(cellKey(cx, cy))) return x;
      x += sign * cell;
    }
    return fromX + sign * effectiveStub;
  };

  const startStubX = walkFreeX(start.x, start.y, sSign);
  const endStubX = walkFreeX(end.x, end.y, tSign);
  let startCellX = cellOf(startStubX);
  const startCellY = cellOf(start.y);
  let endCellX = cellOf(endStubX);
  const endCellY = cellOf(end.y);

  if (startCellX === endCellX) {
    startCellX += sSign * Math.max(1, Math.ceil(STUB / cell));
  }

  // Unblock only the port cells themselves — never punch a free corridor through foreign cards.
  const corridor = new Set<string>();
  corridor.add(cellKey(cellOf(start.x), cellOf(start.y)));
  corridor.add(cellKey(cellOf(end.x), cellOf(end.y)));
  // Also free the walk-out stub endpoints if they're clear of foreign obstacles.
  if (!globalObstacles.has(cellKey(startCellX, startCellY))) {
    corridor.add(cellKey(startCellX, startCellY));
  }
  if (!globalObstacles.has(cellKey(endCellX, endCellY))) {
    corridor.add(cellKey(endCellX, endCellY));
  }

  const isBlocked = (cx: number, cy: number) => {
    const k = cellKey(cx, cy);
    if (corridor.has(k)) return false;
    return globalObstacles.has(k);
  };

  // If start/end A* seeds are still blocked, nudge further out.
  const ensureFree = (cx: number, cy: number, sign: number): number => {
    let x = cx;
    for (let i = 0; i < 24 && isBlocked(x, cy); i++) x += sign;
    return x;
  };
  startCellX = ensureFree(startCellX, startCellY, sSign);
  endCellX = ensureFree(endCellX, endCellY, tSign);

  let found: [number, number][] | null = null;
  let margin = Math.max(400, cell * 12);
  for (let attempt = 0; attempt < 5 && !found; attempt++, margin *= 2.2) {
    const minX = Math.min(start.x, end.x) - margin;
    const maxX = Math.max(start.x, end.x) + margin;
    const minY = Math.min(start.y, end.y) - margin;
    const maxY = Math.max(start.y, end.y) + margin;
    const bounds: GridBounds = { minCx: cellOf(minX), maxCx: cellOf(maxX), minCy: cellOf(minY), maxCy: cellOf(maxY) };
    found = astar([startCellX, startCellY], [endCellX, endCellY], isBlocked, bounds);
  }

  if (found) {
    const corners: Point[] = [];
    for (let i = 0; i < found.length; i++) {
      const [cx, cy] = found[i];
      corners.push({ x: cx * cell, y: cy * cell });
    }
    const simplifiedCorners = simplifyColinear(corners);
    const firstCorner = simplifiedCorners[0];
    const lastCorner = simplifiedCorners[simplifiedCorners.length - 1];

    const sourceStubX = sSign === 1 ? Math.max(start.x + sStub, firstCorner.x) : Math.min(start.x - sStub, firstCorner.x);
    const sourcePoints: Point[] = [start, { x: sourceStubX, y: start.y }, { x: sourceStubX, y: firstCorner.y }];

    const targetStubX = tSign === 1 ? Math.max(end.x + tStub, lastCorner.x) : Math.min(end.x - tStub, lastCorner.x);
    const targetPoints: Point[] = [{ x: targetStubX, y: lastCorner.y }, { x: targetStubX, y: end.y }, end];

    const rawPath: Point[] = [...sourcePoints, ...simplifiedCorners, ...targetPoints];
    const simplified = simplifyColinear(rawPath);
    const reduced = reduceBends(simplified, segmentClear);
    const reducedOk = accept(reduced);
    if (reducedOk) return reducedOk;
    const simpleOk = accept(simplified);
    if (simpleOk) return simpleOk;
  }

  // Fallback elbows — always stub-first, only if fully clear.
  for (const candidate of [
    [start, { x: start.x + sSign * sStub, y: start.y }, { x: start.x + sSign * sStub, y: end.y }, { x: end.x + tSign * tStub, y: end.y }, end],
    [start, { x: start.x + sSign * sStub, y: start.y }, { x: end.x + tSign * tStub, y: start.y }, { x: end.x + tSign * tStub, y: end.y }, end],
  ] as Point[][]) {
    const ok = accept(candidate);
    if (ok) return ok;
  }

  // Absolute last resort: stub-first highways far below/above — only accept if DRC-clean.
  for (const hy of [
    Math.max(start.y, end.y) + 200,
    Math.min(start.y, end.y) - 200,
    Math.max(start.y, end.y) + 400,
    Math.min(start.y, end.y) - 400,
    Math.max(start.y, end.y) + 600,
    Math.min(start.y, end.y) - 600,
  ]) {
    const hw = buildHighwayPath(start, end, sSign, tSign, hy, sStub, tStub, segmentClear, 0, 1);
    if (hw) return hw;
  }

  // PCB rule: never ship a trace that shorts a chip or another net. Return the best
  // stub-first elbow only when it is clear; otherwise the shortest clear highway-ish path
  // we can still assemble (even if long).
  const fallback = enforceExitStubs(
    [
      start,
      { x: start.x + sSign * sStub, y: start.y },
      { x: start.x + sSign * sStub, y: end.y },
      { x: end.x + tSign * tStub, y: end.y },
      end,
    ],
    start,
    end,
    sSign,
    tSign,
    sStub,
  );
  if (pathIsClear(fallback, segmentClear)) return fallback;

  // Last ditch: go very far around the bounding box of every obstacle.
  let minOx = start.x;
  let maxOx = start.x;
  let minOy = start.y;
  let maxOy = start.y;
  for (const o of obstacles) {
    if (o.id === spec.sourceNodeId || o.id === spec.targetNodeId) continue;
    if (o.id.startsWith('trace:') || o.id.startsWith('adapter-card-')) continue;
    minOx = Math.min(minOx, o.x);
    maxOx = Math.max(maxOx, o.x + o.width);
    minOy = Math.min(minOy, o.y);
    maxOy = Math.max(maxOy, o.y + o.height);
  }
  for (const hy of [minOy - 80, maxOy + 80, minOy - 200, maxOy + 200]) {
    const hw = buildHighwayPath(start, end, sSign, tSign, hy, sStub, tStub, segmentClear, 0, 1);
    if (hw) return hw;
  }
  for (const hx of [minOx - 80, maxOx + 80]) {
    const path = simplifyColinear([
      start,
      { x: start.x + sSign * sStub, y: start.y },
      { x: hx, y: start.y },
      { x: hx, y: end.y },
      { x: end.x + tSign * tStub, y: end.y },
      end,
    ]);
    if (pathIsClear(path, segmentClear)) return path;
  }

  // Truly boxed in: still return stub-first geometry (UI must show something) but never a
  // raw vertical-on-port. Callers doing sequential PCB routing should treat uncleared paths
  // as soft failures.
  return fallback;
}

/**
 * Rebuild multi-cable fans as stub-first routes with visible lane spacing.
 *
 * Strategy:
 *  1. Try a vertical corridor in the open gap (works when the gap is empty).
 *  2. Otherwise route each cable onto its own horizontal "highway" below or above the
 *     obstacle cluster (FEX800/CME/etc. between MOTU and stagebox) — highways spaced by LANE_GAP.
 */
function bundleFanInRoutes(
  routes: Map<string, Point[]>,
  edges: EdgeRouteSpec[],
  obstacles: RectObstacle[],
): void {
  const processed = new Set<string>();

  const applyGroup = (group: EdgeRouteSpec[]) => {
    const unique = [...new Map(group.map((g) => [g.id, g])).values()].filter((g) => !processed.has(g.id));
    if (unique.length < 2) return;

    const sorted = [...unique].sort(
      (a, b) => a.start.y - b.start.y || a.end.y - b.end.y || a.id.localeCompare(b.id),
    );
    const n = sorted.length;

    // Span of the fan in X (after exit stubs / before entry stubs).
    let spanLo = Infinity;
    let spanHi = -Infinity;
    let yLo = Infinity;
    let yHi = -Infinity;
    for (const s of sorted) {
      const sSign = s.sourceDir === 'left' ? -1 : 1;
      const tSign = s.targetDir === 'right' ? 1 : -1;
      const outX = s.start.x + sSign * STUB;
      const inX = s.end.x + tSign * STUB;
      spanLo = Math.min(spanLo, outX, inX);
      spanHi = Math.max(spanHi, outX, inX);
      yLo = Math.min(yLo, s.start.y, s.end.y);
      yHi = Math.max(yHi, s.start.y, s.end.y);
    }

    // Obstacles sitting in the span (the reason direct Z-routes clip cards).
    const blockers = obstacles.filter((o) => {
      if (sorted.some((s) => s.sourceNodeId === o.id || s.targetNodeId === o.id)) return false;
      return o.x < spanHi && o.x + o.width > spanLo;
    });

    let clusterBottom = yHi;
    let clusterTop = yLo;
    for (const o of blockers) {
      clusterBottom = Math.max(clusterBottom, o.y + o.height + OBSTACLE_PADDING);
      clusterTop = Math.min(clusterTop, o.y - OBSTACLE_PADDING);
    }

    // Preferred vertical corridors across the gap (empty-gap case).
    const gapLo = spanLo + 16;
    const gapHi = spanHi - 16;
    const packWidth = (n - 1) * LANE_GAP;
    const firstCorridorX =
      gapHi > gapLo
        ? gapLo + Math.max(0, gapHi - gapLo - packWidth) / 2
        : (spanLo + spanHi) / 2;

    // Highway Y bases: below the cluster and above it.
    const highwayBelow0 = clusterBottom + 36;
    const highwayAbove0 = clusterTop - 36;

    // Sequential breakout within the group: each placed net becomes copper keep-out for the next
    // (true 1-layer PCB). That forces later pins off a shared vertical short into free columns.
    const groupLive: RectObstacle[] = obstacles.map((o) => ({ ...o }));

    for (let i = 0; i < n; i++) {
      const spec = sorted[i];
      const sSign = spec.sourceDir === 'left' ? -1 : 1;
      const tSign = spec.targetDir === 'right' ? 1 : -1;
      const own = new Set([spec.sourceNodeId, spec.targetNodeId]);
      const sStub = exitStubLen(spec.start, sSign, groupLive, own);
      const tStub = exitStubLen(spec.end, tSign, groupLive, own);
      const clear = makeSegmentClear(spec, groupLive);
      let placed: Point[] | null = null;

      // 1) Vertical corridor in the gap (each cable its own X).
      if (gapHi - gapLo >= LANE_GAP * 0.5) {
        const corridorX = firstCorridorX + i * LANE_GAP;
        placed = buildCorridorPath(spec.start, spec.end, sSign, tSign, corridorX, sStub, clear);
        if (!placed) {
          for (const nOff of [12, -12, 24, -24, 40, -40, 60, -60, 90, -90]) {
            const x = Math.min(gapHi, Math.max(gapLo, corridorX + nOff));
            placed = buildCorridorPath(spec.start, spec.end, sSign, tSign, x, sStub, clear);
            if (placed) break;
          }
        }
      }

      // 2) Highways below / above the cluster with lane columns (respects groupLive copper).
      if (!placed) {
        const hyBelow = highwayBelow0 + i * LANE_GAP;
        const hyAbove = highwayAbove0 - i * LANE_GAP;
        const midY = (spec.start.y + spec.end.y) / 2;
        const order = Math.abs(hyBelow - midY) <= Math.abs(hyAbove - midY) ? [hyBelow, hyAbove] : [hyAbove, hyBelow];
        for (const hy of order) {
          placed = buildHighwayPath(spec.start, spec.end, sSign, tSign, hy, sStub, tStub, clear, i, n);
          if (placed) break;
        }
        if (!placed) {
          for (const extra of [40, 80, 120, 180, 240, 320, 400]) {
            for (const hy of [highwayBelow0 + i * LANE_GAP + extra, highwayAbove0 - i * LANE_GAP - extra]) {
              placed = buildHighwayPath(spec.start, spec.end, sSign, tSign, hy, sStub, tStub, clear, i, n);
              if (placed) break;
            }
            if (placed) break;
          }
        }
      }

      // 3) Full A* against chips + already-routed nets in this fan (last resort for this pin).
      if (!placed) {
        const astarPath = dropMicroSegments(simplifyColinear(findPath(spec, groupLive)));
        if (pathIsClear(astarPath, clear)) placed = astarPath;
      }

      if (placed) {
        routes.set(spec.id, placed);
        processed.add(spec.id);
        groupLive.push(...traceKeepouts(placed, spec.id, TRACE_CLEARANCE));
      }
    }
  };

  // 1) Same device-pair fans (MOTU → stagebox).
  const byPair = new Map<string, EdgeRouteSpec[]>();
  for (const e of edges) {
    const key = `${e.sourceNodeId}->${e.targetNodeId}`;
    const list = byPair.get(key) ?? [];
    list.push(e);
    byPair.set(key, list);
  }
  for (const group of byPair.values()) applyGroup(group);

  // 2) Remaining cables that share only a target.
  const byTarget = new Map<string, EdgeRouteSpec[]>();
  for (const e of edges) {
    if (processed.has(e.id)) continue;
    const list = byTarget.get(e.targetNodeId) ?? [];
    list.push(e);
    byTarget.set(e.targetNodeId, list);
  }
  for (const group of byTarget.values()) applyGroup(group);
}

/**
 * Pick the best L/R × L/R handle pair. Scoring is geometric (cheap) so opening a dense stage
 * never runs N×4 full routers. Actual geometry is produced later by `computeRoutes`.
 */
export function findBestPath(candidates: EdgeRouteSpec[], obstacles: RectObstacle[]): { path: Point[]; spec: EdgeRouteSpec } {
  if (candidates.length === 0) {
    return { path: [], spec: { id: '', sourceNodeId: '', targetNodeId: '', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } } };
  }

  const scoreCandidate = (spec: EdgeRouteSpec): number => {
    const sDir = spec.sourceDir ?? 'right';
    const tDir = spec.targetDir ?? 'left';
    const dx = spec.end.x - spec.start.x;
    const dy = spec.end.y - spec.start.y;
    // Manhattan lower bound + mild bend preference for non-aligned ports.
    let score = Math.abs(dx) + Math.abs(dy) + (Math.abs(dy) > 0.5 && Math.abs(dx) > 0.5 ? 40 : 0);
    // Prefer exits that face each other.
    if (dx > 40 && sDir === 'right' && tDir === 'left') score -= 600;
    if (dx < -40 && sDir === 'left' && tDir === 'right') score -= 600;
    // Mild penalty when both ports face the same way (forced U-turn).
    if (sDir === tDir) score += 200;
    // Tiny penalty if the straight corridor would immediately enter a foreign card (rough).
    const midX = (spec.start.x + spec.end.x) / 2;
    const midY = (spec.start.y + spec.end.y) / 2;
    for (const o of obstacles) {
      if (o.id === spec.sourceNodeId || o.id === spec.targetNodeId) continue;
      if (midX > o.x && midX < o.x + o.width && midY > o.y && midY < o.y + o.height) {
        score += 300;
        break;
      }
    }
    return score;
  };

  let best = candidates[0];
  let bestScore = scoreCandidate(best);
  for (let i = 1; i < candidates.length; i++) {
    const s = scoreCandidate(candidates[i]);
    if (s < bestScore) {
      bestScore = s;
      best = candidates[i];
    }
  }
  // No routing here — path is filled later by computeRoutes / the worker. Callers that need a
  // preview can call findPath(spec) themselves (fast local A*, not libavoid).
  return { path: [], spec: best };
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

function pathHitsObstacle(
  pts: Point[],
  spec: EdgeRouteSpec | undefined,
  obstacles: RectObstacle[],
  /** Padding for *other* devices. Lane nudges use a tighter pad so parallel cables can
   *  actually separate; full keep-out is enforced during pathfinding itself. */
  otherPadding = 6,
): boolean {
  return pts.slice(0, -1).some((p, i) =>
    obstacles.some((o) => {
      const isOwnDevice = spec != null && (o.id === spec.sourceNodeId || o.id === spec.targetNodeId);
      // Own device at padding 0: approach legs legitimately graze the card edge.
      return segmentCrossesRect(p, pts[i + 1], o, isOwnDevice ? 0 : otherPadding);
    }),
  );
}

/**
 * Which way to expand parallel lanes so we never push toward a device the cables are hugging.
 * For a vertical approach just left of a stagebox, this returns -1 (further left into open space).
 */
function freeSideSign(
  orientation: 'h' | 'v',
  fixed: number,
  group: SegmentRef[],
  specById: Map<string, EdgeRouteSpec>,
): number {
  let vote = 0;
  for (const seg of group) {
    const spec = specById.get(seg.edgeId);
    if (!spec) continue;
    if (orientation === 'v') {
      // Distance to each port's x — push away from the nearer port (usually the target face).
      const dStart = Math.abs(fixed - spec.start.x);
      const dEnd = Math.abs(fixed - spec.end.x);
      if (dEnd <= dStart) vote += Math.sign(fixed - spec.end.x) || -1;
      else vote += Math.sign(fixed - spec.start.x) || 1;
    } else {
      const dStart = Math.abs(fixed - spec.start.y);
      const dEnd = Math.abs(fixed - spec.end.y);
      if (dEnd <= dStart) vote += Math.sign(fixed - spec.end.y) || -1;
      else vote += Math.sign(fixed - spec.start.y) || 1;
    }
  }
  if (vote === 0) return -1;
  return vote > 0 ? 1 : -1;
}

/** True only for the short port stub, not a long shared run that happens to sit on the port row. */
function isPortStubSegment(
  orientation: 'h' | 'v',
  fixed: number,
  lo: number,
  hi: number,
  i: number,
  ptsLen: number,
  spec: EdgeRouteSpec | undefined,
): boolean {
  if (!spec) return false;
  const len = hi - lo;
  // Long interior runs at the port's y/x must still be lane-separated.
  if (len > STUB * 1.5) return false;
  if (orientation === 'h') {
    if (i === 0 && Math.abs(fixed - spec.start.y) < 0.5) return true;
    if (i === ptsLen - 2 && Math.abs(fixed - spec.end.y) < 0.5) return true;
  } else {
    if (i === 0 && Math.abs(fixed - spec.start.x) < 0.5) return true;
    if (i === ptsLen - 2 && Math.abs(fixed - spec.end.x) < 0.5) return true;
  }
  return false;
}

/**
 * One pass of collinear-segment lane separation. Offsetting a horizontal run moves the
 * endpoints of its adjoining verticals, which can *create* new vertical overlaps — so
 * `resolveOverlaps` runs this several times until stable.
 */
function resolveOverlapsPass(
  working: Map<string, Point[]>,
  obstacles: RectObstacle[],
  specById: Map<string, EdgeRouteSpec>,
): boolean {
  const segments: SegmentRef[] = [];
  for (const [edgeId, pts] of working) {
    if (pts.length < 3) continue;
    const spec = specById.get(edgeId);
    for (let i = 0; i < pts.length - 1; i++) {
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
      if (hi - lo < 1) continue;
      // Never touch the exit/entry stubs (first two + last two segments on a normal route).
      // Offsetting those collapses "leave the nipple horizontally first" and fuses fan-ins.
      if (i <= 1 || i >= pts.length - 3) continue;
      if (isPortStubSegment(orientation, fixed, lo, hi, i, pts.length, spec)) continue;

      let anchor = fixed;
      if (spec) {
        if (i === pts.length - 2 || i === pts.length - 3) anchor = orientation === 'h' ? spec.end.y : spec.end.x;
        else if (i === 0 || i === 1) anchor = orientation === 'h' ? spec.start.y : spec.start.x;
      }
      segments.push({ edgeId, i, orientation, fixed, lo, hi, anchor });
    }
  }

  // Cluster near-coincident parallel segments, then connected components by range overlap.
  const parent = segments.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      if (a.orientation !== b.orientation) continue;
      if (Math.abs(a.fixed - b.fixed) > LANE_GROUP_TOLERANCE) continue;
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) <= 0) continue;
      unite(i, j);
    }
  }
  const groupMap = new Map<number, SegmentRef[]>();
  for (let i = 0; i < segments.length; i++) {
    const root = find(i);
    const list = groupMap.get(root);
    if (list) list.push(segments[i]);
    else groupMap.set(root, [segments[i]]);
  }
  const groups = [...groupMap.values()].filter((g) => g.length >= 2);

  let moved = false;
  for (const group of groups) {
    // Always give every segment in the group its own lane index by port order.
    // Interval packing used to let "non-overlapping" ranges share a lane — fine for short
    // stubs, bad for long fan-ins that almost fully overlap and must stay visibly parallel.
    const sorted = [...group].sort((a, b) => a.anchor - b.anchor || a.lo - b.lo || a.edgeId.localeCompare(b.edgeId));
    // One lane per unique edge (multiple segments of the same edge share a lane).
    const edgeOrder: string[] = [];
    for (const seg of sorted) {
      if (!edgeOrder.includes(seg.edgeId)) edgeOrder.push(seg.edgeId);
    }
    const laneOfEdge = new Map(edgeOrder.map((id, i) => [id, i] as const));
    const laneCount = edgeOrder.length;
    if (laneCount < 2) continue;

    const isPowerAdapterGroup = group.some((s) => specById.get(s.edgeId)?.isPowerAdapter);
    const groupLaneGap = isPowerAdapterGroup ? 32 : LANE_GAP;
    const orientation = group[0].orientation;
    const fixedAvg = group.reduce((s, g) => s + g.fixed, 0) / group.length;

    // Spread symmetrically around the group's base line so the bundle stays near the original corridor.
    for (const seg of group) {
      const lane = laneOfEdge.get(seg.edgeId)!;
      // Signed lane index: half the bundle each side of the shared base line.
      const centered = (lane - (laneCount - 1) / 2) * groupLaneGap;
      const targetFixed = fixedAvg + centered;

      const pts = working.get(seg.edgeId)!;
      const spec = specById.get(seg.edgeId);
      const prevA = { x: pts[seg.i].x, y: pts[seg.i].y };
      const prevB = { x: pts[seg.i + 1].x, y: pts[seg.i + 1].y };
      const currentFixed = orientation === 'h' ? prevA.y : prevA.x;
      if (Math.abs(currentFixed - targetFixed) < 0.5) continue;

      const applyFixed = (fixed: number) => {
        if (seg.orientation === 'h') {
          pts[seg.i].y = fixed;
          pts[seg.i + 1].y = fixed;
        } else {
          pts[seg.i].x = fixed;
          pts[seg.i + 1].x = fixed;
        }
      };

      let placed = false;
      for (const scale of [1, 1.25, 1.5, 0.75, 0.5]) {
        applyFixed(fixedAvg + centered * scale);
        if (!pathHitsObstacle(pts, spec, obstacles)) {
          placed = true;
          moved = true;
          break;
        }
      }
      if (!placed) {
        pts[seg.i].x = prevA.x;
        pts[seg.i].y = prevA.y;
        pts[seg.i + 1].x = prevB.x;
        pts[seg.i + 1].y = prevB.y;
      }
    }
  }
  return moved;
}

/** Stage 2: nudge coincident parallel runs apart into separate lanes. */
export function resolveOverlaps(routes: Map<string, Point[]>, obstacles: RectObstacle[], edges: EdgeRouteSpec[]): Map<string, Point[]> {
  const working = new Map(Array.from(routes, ([id, pts]) => [id, pts.map((p) => ({ ...p }))] as const));
  const originals = new Map(Array.from(routes, ([id, pts]) => [id, pts.map((p) => ({ ...p }))] as const));
  const specById = new Map(edges.map((e) => [e.id, e] as const));

  // Multiple passes: moving a horizontal lane changes adjoining vertical ranges and can create
  // new collinear vertical overlaps that need a second (or third) separation pass.
  for (let pass = 0; pass < 4; pass++) {
    if (!resolveOverlapsPass(working, obstacles, specById)) break;
  }

  // Final safety: if combined multi-group offsets still clip, blend back toward the original.
  for (const [edgeId, pts] of working) {
    const original = originals.get(edgeId)!;
    const spec = specById.get(edgeId);
    if (!pathHitsObstacle(pts, spec, obstacles)) continue;
    if (pts.length !== original.length) {
      working.set(edgeId, original.map((p) => ({ ...p })));
      continue;
    }
    let lo = 0;
    let hi = 1;
    let best = original.map((p) => ({ ...p }));
    for (let iter = 0; iter < 8; iter++) {
      const mid = (lo + hi) / 2;
      const blended = original.map((p, i) => ({
        x: p.x + (pts[i].x - p.x) * mid,
        y: p.y + (pts[i].y - p.y) * mid,
      }));
      if (!pathHitsObstacle(blended, spec, obstacles)) {
        best = blended;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    working.set(edgeId, best);
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
 *  disqualifies it), the same own-device-at-zero-padding rule `resolveOverlaps`'s safety net uses.
 *
 *  `otherSegments` is every *other* edge's already-finalized route (pre-cosmetic-curve), flattened
 *  into consecutive point pairs — checked in addition to device boxes, so a dip never swings
 *  through a completely unrelated cable's straight line (see `segmentsCross`). */
function addCosmeticCurve(
  edgeId: string,
  points: Point[],
  spec: EdgeRouteSpec | undefined,
  obstacles: RectObstacle[],
  otherSegments: [Point, Point][],
): Point[] {
  if (points.length !== 2) return points;
  const [p1, p2] = points;
  const clear = (pts: Point[]) =>
    pts.slice(0, -1).every(
      (p, i) =>
        obstacles.every((o) => {
          const isOwnDevice = spec != null && (o.id === spec.sourceNodeId || o.id === spec.targetNodeId);
          return !segmentCrossesRect(p, pts[i + 1], o, isOwnDevice ? 0 : OBSTACLE_PADDING);
        }) && otherSegments.every(([b1, b2]) => !segmentsCross(p, pts[i + 1], b1, b2)),
    );

  const hash = edgeId.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0);
  const absHash = Math.abs(hash);

  if (Math.abs(p1.y - p2.y) < 1 && Math.abs(p1.x - p2.x) > 20) {
    // Same-row cable — try dipping below the row first, then above, before giving up.
    // Scale dip depth with cable length so long cables clear any nodes sitting between the ports.
    const cableLen = Math.abs(p2.x - p1.x);
    const stub = 24 + (absHash % 10);
    const sx = p1.x < p2.x ? p1.x + stub : p1.x - stub;
    const tx = p1.x < p2.x ? p2.x - stub : p2.x + stub;
    const baseDip = 28 + (absHash % 16);
    // Grow the dip by ~4% of the cable's length, capped at 80px so short cables stay tidy.
    const scaledDip = Math.min(baseDip + cableLen * 0.04, 80);
    for (const dip of [scaledDip, scaledDip * 1.6]) {
      for (const sign of [1, -1]) {
        const dipY = p1.y + sign * dip;
        const bent = [p1, { x: sx, y: p1.y }, { x: sx, y: dipY }, { x: tx, y: dipY }, { x: tx, y: p2.y }, p2];
        if (clear(bent)) return bent;
      }
    }
    return points;
  }
  if (Math.abs(p1.x - p2.x) < 1 && Math.abs(p1.y - p2.y) > 20) {
    // Same-column cable — try the hash-preferred side first, then the opposite side.
    // Scale the jog with cable length for the same reason as the dip above.
    const cableLen = Math.abs(p2.y - p1.y);
    const baseJog = 28 + (absHash % 20);
    const scaledJog = Math.min(baseJog + cableLen * 0.04, 80);
    const preferredDir = hash % 2 === 0 ? 1 : -1;
    for (const jog of [scaledJog, scaledJog * 1.6]) {
      for (const dir of [preferredDir, -preferredDir]) {
        const sideX = p1.x + dir * jog;
        const bent = [p1, { x: sideX, y: p1.y }, { x: sideX, y: p2.y }, p2];
        if (clear(bent)) return bent;
      }
    }
    return points;
  }
  return points;
}

/**
 * Inflate a finished trace into keep-out rectangles (copper clearance on a 1-layer PCB).
 * Later nets must not enter these — that's how we prevent shorts and crossings.
 */
export function traceKeepouts(path: Point[], edgeId: string, clearance = TRACE_CLEARANCE): RectObstacle[] {
  const rects: RectObstacle[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) continue;
    if (Math.abs(a.y - b.y) < 0.5) {
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      rects.push({
        id: `trace:${edgeId}:${i}`,
        x: lo - clearance,
        y: a.y - clearance,
        width: hi - lo + clearance * 2,
        height: clearance * 2,
      });
    } else if (Math.abs(a.x - b.x) < 0.5) {
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      rects.push({
        id: `trace:${edgeId}:${i}`,
        x: a.x - clearance,
        y: lo - clearance,
        width: clearance * 2,
        height: hi - lo + clearance * 2,
      });
    }
  }
  return rects;
}

/** True if two paths short (collinear overlap) or cross (H/V intersection). */
export function pathsViolateDrc(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
    }
  }
  return false;
}

/**
 * Label anchor for adapter badges / edge labels: midpoint of the longest interior segment
 * whose center is outside every device card (label is copper silkscreen — not on a chip).
 */
export function findLabelPoint(
  points: Point[],
  nodeObstacles: RectObstacle[],
  fallback: Point,
): Point {
  if (points.length < 2) return fallback;
  const startIdx = points.length >= 4 ? 1 : 0;
  const endIdx = points.length >= 4 ? points.length - 2 : points.length - 1;
  let best = fallback;
  let bestScore = -1;
  for (let i = startIdx; i < endIdx; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (len < 40) continue;
    // Sample a few points along the segment; pick the one furthest from chip interiors.
    for (const t of [0.35, 0.5, 0.65]) {
      const mid = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
      let minDist = Infinity;
      let inside = false;
      for (const o of nodeObstacles) {
        if (o.id.startsWith('trace:') || o.id.startsWith('adapter-card-')) continue;
        const cx = Math.max(o.x, Math.min(mid.x, o.x + o.width));
        const cy = Math.max(o.y, Math.min(mid.y, o.y + o.height));
        const d = Math.hypot(mid.x - cx, mid.y - cy);
        if (d < 1) inside = true;
        minDist = Math.min(minDist, d);
      }
      if (inside) continue;
      const score = len + minDist * 4;
      if (score > bestScore) {
        bestScore = score;
        best = mid;
      }
    }
  }
  return best;
}

/**
 * Sync full-netlist routing for unit tests and main-thread fallback.
 * Uses the bounded legacy pipeline only (no libavoid on this module's import graph).
 *
 * Production UI: `routeInWorker` → `finalizeRoutes`.
 */
export function computeRoutes(obstacles: RectObstacle[], edges: EdgeRouteSpec[]): Map<string, Point[]> {
  return finalizeRoutes(obstacles, edges, computeRoutesLegacy(obstacles, edges));
}

/**
 * Post-process paths from the worker (or any raw router): adapter-card clearance + cosmetic dips.
 * Cheap enough for the main thread.
 */
export function finalizeRoutes(
  obstacles: RectObstacle[],
  edges: EdgeRouteSpec[],
  raw: Map<string, Point[]>,
): Map<string, Point[]> {
  const specById = new Map(edges.map((s) => [s.id, s] as const));
  let routes = raw;

  const adapterObstacles: RectObstacle[] = [];
  for (const spec of edges) {
    if (!spec.isPowerAdapter) continue;
    const pts = routes.get(spec.id);
    if (!pts || pts.length < 2) continue;
    const label = findLabelPoint(pts, obstacles, {
      x: (pts[0].x + pts[pts.length - 1].x) / 2,
      y: (pts[0].y + pts[pts.length - 1].y) / 2,
    });
    adapterObstacles.push({
      id: `adapter-card-${spec.id}`,
      x: label.x - 65,
      y: label.y - 18,
      width: 130,
      height: 36,
    });
  }

  if (adapterObstacles.length > 0) {
    const live2: RectObstacle[] = [...obstacles, ...adapterObstacles];
    const routes2 = new Map<string, Point[]>();
    for (const spec of edges) {
      const prev = routes.get(spec.id);
      if (!prev) continue;
      if (spec.isPowerAdapter) {
        routes2.set(spec.id, prev);
        live2.push(...traceKeepouts(prev, spec.id, TRACE_CLEARANCE));
        continue;
      }
      const hitsAdapter = adapterObstacles.some((card) =>
        prev.slice(0, -1).some((p, i) => segmentCrossesRect(p, prev[i + 1], card, 2)),
      );
      const path = hitsAdapter
        ? dropMicroSegments(simplifyColinear(findPath(spec, live2)))
        : prev;
      routes2.set(spec.id, path);
      live2.push(...traceKeepouts(path, spec.id, TRACE_CLEARANCE));
    }
    routes = routes2;
  }

  const segmentsByEdge = new Map<string, [Point, Point][]>();
  for (const [id, pts] of routes) {
    const segs: [Point, Point][] = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
    segmentsByEdge.set(id, segs);
  }

  const curvedRoutes = new Map<string, Point[]>();
  for (const [id, pts] of routes) {
    const otherSegments = Array.from(segmentsByEdge, ([otherId, segs]) => (otherId === id ? [] : segs)).flat();
    const bent = addCosmeticCurve(id, pts, specById.get(id), obstacles, otherSegments);
    let ok = true;
    for (const [otherId, otherPts] of routes) {
      if (otherId === id) continue;
      if (pathsViolateDrc(bent, otherPts)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const spec = specById.get(id);
      for (const o of obstacles) {
        if (spec && (o.id === spec.sourceNodeId || o.id === spec.targetNodeId)) continue;
        if (o.id.startsWith('trace:') || o.id.startsWith('adapter-card-')) continue;
        if (bent.slice(0, -1).some((p, i) => segmentCrossesRect(p, bent[i + 1], o, OBSTACLE_PADDING))) {
          ok = false;
          break;
        }
      }
    }
    curvedRoutes.set(id, ok ? bent : pts);
  }
  return curvedRoutes;
}

/** Instant orthogonal stubs so cables appear before the worker answers (never blocks). */
export function stubRoutes(edges: EdgeRouteSpec[]): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  for (const spec of edges) {
    const sSign = spec.sourceDir === 'left' ? -1 : 1;
    const tSign = spec.targetDir === 'right' ? 1 : -1;
    const stub = 28;
    const a: Point = { x: spec.start.x + sSign * stub, y: spec.start.y };
    const b: Point = { x: spec.end.x + tSign * stub, y: spec.end.y };
    const midX = Math.round((a.x + b.x) / 2);
    out.set(
      spec.id,
      dropMicroSegments(
        simplifyColinear([
          { ...spec.start },
          a,
          { x: midX, y: a.y },
          { x: midX, y: b.y },
          b,
          { ...spec.end },
        ]),
      ),
    );
  }
  return out;
}

/**
 * Legacy sequential fan-in + short-first A* (bounded). Used as UI fallback when the libavoid
 * worker times out — never starts a second unbounded processTransaction on the main thread.
 */
export function computeRoutesLegacy(obstacles: RectObstacle[], edges: EdgeRouteSpec[]): Map<string, Point[]> {
  const routes = new Map<string, Point[]>();
  const live: RectObstacle[] = obstacles.map((o) => ({ ...o }));

  bundleFanInRoutes(routes, edges, obstacles);
  for (const [id, pts] of routes) {
    live.push(...traceKeepouts(pts, id, TRACE_CLEARANCE));
  }

  const remaining = edges
    .filter((e) => !routes.has(e.id))
    .sort((a, b) => {
      const la = Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y);
      const lb = Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y);
      return la - lb || a.id.localeCompare(b.id);
    });

  for (const spec of remaining) {
    let path = dropMicroSegments(simplifyColinear(findPath(spec, live)));

    const violates = () => {
      if (!pathIsClear(path, makeSegmentClear(spec, live))) return true;
      for (const [, otherPath] of routes) {
        if (pathsViolateDrc(path, otherPath)) return true;
      }
      return false;
    };

    if (violates()) {
      const boosted = live.map((o) =>
        o.id.startsWith('trace:')
          ? { ...o, x: o.x - 6, y: o.y - 6, width: o.width + 12, height: o.height + 12 }
          : o,
      );
      path = dropMicroSegments(simplifyColinear(findPath(spec, boosted)));
    }

    routes.set(spec.id, path);
    live.push(...traceKeepouts(path, spec.id, TRACE_CLEARANCE));
  }

  return routes;
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
