/**
 * Spread collinear parallel runs so stacked cables get air between them.
 *
 * Rules:
 *  - Always keep strictly orthogonal (90°) geometry after any offset.
 *  - Separate any long H/V overlap (including stub-column fan-outs), not only deep mid-corridors.
 *  - Never move pad endpoints; never push a cable through a foreign card body.
 */

import { pathHitsNodeBodies, type NodeBox } from './pathAvoidNodes';

export type Point = { x: number; y: number };

const DEFAULT_GAP = 16;
/** Same column/row only when almost exactly aligned. */
const AXIS_TOL = 4;
/**
 * Need a real shared run length before we bother spreading.
 * Short stubs / half-nipple nicks are ignored.
 */
const MIN_OVERLAP = 36;
/** Short face lead (pad → stub) — never treat as a packable corridor. */
const MAX_STUB_LEN = 48;
const MAX_PASSES = 5;

type Run = {
  edgeId: string;
  /** Inclusive index range of points to shift (never includes pad endpoints). */
  from: number;
  to: number;
  axis: 'v' | 'h';
  fixed: number;
  lo: number;
  hi: number;
  dir: 1 | -1;
  /** Pad side: push outward from the nearer card face when possible. */
  padFixed: number;
};

function runsOf(edgeId: string, path: Point[]): Run[] {
  if (path.length < 3) return [];
  const runs: Run[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const isV = Math.abs(a.x - b.x) < 0.5;
    const isH = Math.abs(a.y - b.y) < 0.5;
    if (!isV && !isH) continue;

    const axis: 'v' | 'h' = isV ? 'v' : 'h';
    const fixed = isV ? a.x : a.y;
    const lo = isV ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const hi = isV ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    const len = hi - lo;
    if (len < MIN_OVERLAP) continue;

    // Pure pad stubs (short first/last segment) stay under cable-management.
    const isEndSeg = i === 0 || i === path.length - 2;
    if (isEndSeg && len <= MAX_STUB_LEN) continue;

    // Merge collinear continuation of the same fixed axis into one run.
    let j = i;
    let runLo = lo;
    let runHi = hi;
    let sumFixed = fixed;
    let count = 1;
    const dir: 1 | -1 = isV ? (b.y >= a.y ? 1 : -1) : b.x >= a.x ? 1 : -1;

    while (j + 1 < path.length - 1) {
      const p = path[j + 1];
      const q = path[j + 2];
      const contV = axis === 'v' && Math.abs(p.x - q.x) < 0.5 && Math.abs(p.x - fixed) <= AXIS_TOL;
      const contH = axis === 'h' && Math.abs(p.y - q.y) < 0.5 && Math.abs(p.y - fixed) <= AXIS_TOL;
      if (!contV && !contH) break;
      const nextDir: 1 | -1 = axis === 'v' ? (q.y >= p.y ? 1 : -1) : q.x >= p.x ? 1 : -1;
      if (nextDir !== dir) break;
      const nLo = axis === 'v' ? Math.min(p.y, q.y) : Math.min(p.x, q.x);
      const nHi = axis === 'v' ? Math.max(p.y, q.y) : Math.max(p.x, q.x);
      runLo = Math.min(runLo, nLo);
      runHi = Math.max(runHi, nHi);
      sumFixed += axis === 'v' ? p.x : p.y;
      count++;
      j++;
    }

    if (runHi - runLo < MIN_OVERLAP) {
      i = j;
      continue;
    }

    // Points that define this run: both endpoints of every segment i..j.
    // Never move pad endpoints (0 and n-1).
    const safeFrom = Math.max(i, 1);
    const safeTo = Math.min(j + 1, path.length - 2);
    if (safeTo < safeFrom) {
      i = j;
      continue;
    }

    // Anchor: nearest pad on this axis (for free-side push).
    const padA = axis === 'v' ? path[0].x : path[0].y;
    const padB = axis === 'v' ? path[path.length - 1].x : path[path.length - 1].y;
    const meanFixed = sumFixed / count;
    const padFixed = Math.abs(meanFixed - padA) <= Math.abs(meanFixed - padB) ? padA : padB;

    runs.push({
      edgeId,
      from: safeFrom,
      to: safeTo,
      axis,
      fixed: meanFixed,
      lo: runLo,
      hi: runHi,
      dir,
      padFixed,
    });

    i = j;
  }
  return runs;
}

function overlap(a: Run, b: Run): number {
  return Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
}

function cluster(runs: Run[]): Run[][] {
  const n = runs.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = runs[i];
      const b = runs[j];
      if (a.edgeId === b.edgeId) continue;
      if (a.axis !== b.axis) continue;
      // Same-angle stack: allow opposite dir (both still collinear on the wire).
      if (Math.abs(a.fixed - b.fixed) > AXIS_TOL) continue;
      if (overlap(a, b) < MIN_OVERLAP) continue;
      unite(i, j);
    }
  }

  const map = new Map<number, Run[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = map.get(r) ?? [];
    list.push(runs[i]);
    map.set(r, list);
  }
  return [...map.values()].filter((g) => g.length >= 2);
}

/**
 * Force every segment to be axis-aligned. Non-ortho pairs get a single 90° corner inserted.
 * Prefer continuing the previous segment's axis when choosing the corner.
 */
export function enforceOrthogonal(path: Point[]): Point[] {
  if (path.length < 2) return path;
  const out: Point[] = [{ x: Math.round(path[0].x), y: Math.round(path[0].y) }];

  for (let i = 1; i < path.length; i++) {
    const prev = out[out.length - 1];
    const curr = { x: Math.round(path[i].x), y: Math.round(path[i].y) };
    const sameX = Math.abs(prev.x - curr.x) < 0.5;
    const sameY = Math.abs(prev.y - curr.y) < 0.5;
    if (sameX || sameY) {
      if (sameX) out.push({ x: prev.x, y: curr.y });
      else out.push({ x: curr.x, y: prev.y });
      continue;
    }

    let prevAxis: 'h' | 'v' | null = null;
    if (out.length >= 2) {
      const before = out[out.length - 2];
      if (Math.abs(before.y - prev.y) < 0.5) prevAxis = 'h';
      else if (Math.abs(before.x - prev.x) < 0.5) prevAxis = 'v';
    }

    if (prevAxis === 'v') {
      out.push({ x: prev.x, y: curr.y }, { x: curr.x, y: curr.y });
    } else {
      out.push({ x: curr.x, y: prev.y }, { x: curr.x, y: curr.y });
    }
  }

  return dropMicroAndColinear(out);
}

function dropMicroAndColinear(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const cleaned: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const curr = points[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) < 1) {
      if (i === points.length - 1) cleaned[cleaned.length - 1] = curr;
      continue;
    }
    cleaned.push(curr);
  }
  if (cleaned.length < 3) return cleaned;
  const result: Point[] = [cleaned[0]];
  for (let i = 1; i < cleaned.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = cleaned[i];
    const next = cleaned[i + 1];
    const collinear =
      (curr.x - prev.x) * (next.y - curr.y) === (curr.y - prev.y) * (next.x - curr.x);
    if (!collinear) result.push(curr);
  }
  result.push(cleaned[cleaned.length - 1]);
  for (let i = 1; i < result.length; i++) {
    const a = result[i - 1];
    const b = result[i];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
      result.splice(i, 0, { x: b.x, y: a.y });
      i++;
    }
  }
  return result;
}

function pathClearOfForeign(
  path: Point[],
  edgeId: string,
  boxes: NodeBox[],
  ownByEdge: Map<string, Set<string>>,
): boolean {
  if (boxes.length === 0) return true;
  const own = ownByEdge.get(edgeId);
  const foreign = own ? boxes.filter((b) => !own.has(b.id)) : boxes;
  return !pathHitsNodeBodies(path, foreign, 4);
}

function applyPack(
  out: Map<string, Point[]>,
  group: Run[],
  gap: number,
  boxes: NodeBox[],
  ownByEdge: Map<string, Set<string>>,
): boolean {
  // One run per edge (keep longest if duplicates).
  const byEdge = new Map<string, Run>();
  for (const r of group) {
    const prev = byEdge.get(r.edgeId);
    if (!prev || r.hi - r.lo > prev.hi - prev.lo) byEdge.set(r.edgeId, r);
  }
  const unique = [...byEdge.values()];
  if (unique.length < 2) return false;

  // Order by free-axis midpoint so neighbour cables stay neighbours.
  unique.sort((a, b) => {
    const midA = (a.lo + a.hi) / 2;
    const midB = (b.lo + b.hi) / 2;
    return midA - midB || a.edgeId.localeCompare(b.edgeId);
  });

  const meanFixed = unique.reduce((s, r) => s + r.fixed, 0) / unique.length;

  // Prefer pushing outward from the card face (away from padFixed).
  let outward = 0;
  for (const r of unique) {
    outward += Math.sign(r.fixed - r.padFixed) || 0;
  }
  // If unclear, expand symmetrically around mean.
  const bias = outward === 0 ? 0 : outward > 0 ? 1 : -1;

  let moved = false;

  for (let k = 0; k < unique.length; k++) {
    const run = unique[k];
    const centered = (k - (unique.length - 1) / 2) * gap;
    // Bias the whole bundle slightly outward when all share a face.
    const desired = meanFixed + centered + bias * (gap * 0.15);
    const delta = desired - run.fixed;
    if (Math.abs(delta) < 0.75) continue;

    const path = out.get(run.edgeId);
    if (!path) continue;

    const backup = path.map((p) => ({ ...p }));
    let placed = false;

    for (const scale of [1, 0.75, 0.5, 1.25, 1.5]) {
      const trial = backup.map((p) => ({ ...p }));
      for (let p = run.from; p <= run.to; p++) {
        if (p <= 0 || p >= trial.length - 1) continue;
        if (run.axis === 'v') {
          trial[p] = { x: Math.round(backup[p].x + delta * scale), y: backup[p].y };
        } else {
          trial[p] = { x: backup[p].x, y: Math.round(backup[p].y + delta * scale) };
        }
      }
      const ortho = enforceOrthogonal(trial);
      if (pathClearOfForeign(ortho, run.edgeId, boxes, ownByEdge)) {
        out.set(run.edgeId, ortho);
        placed = true;
        moved = true;
        break;
      }
    }

    if (!placed) {
      out.set(
        run.edgeId,
        backup.map((p) => ({ ...p })),
      );
    }
  }
  return moved;
}

/**
 * Multi-pass parallel separation, then hard 90° enforcement on every path.
 * Pass `boxes` + optional `ownByEdge` so offsets never tunnel through cards.
 */
export function nudgeParallelRuns(
  routes: Map<string, Point[]>,
  gap = DEFAULT_GAP,
  boxes: NodeBox[] = [],
  ownByEdge: Map<string, Set<string>> = new Map(),
): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  for (const [id, pts] of routes) {
    out.set(id, enforceOrthogonal(pts));
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const allRuns: Run[] = [];
    for (const [id, pts] of out) {
      allRuns.push(...runsOf(id, pts));
    }
    const groups = cluster(allRuns);
    if (groups.length === 0) break;

    let any = false;
    for (const g of groups) {
      if (applyPack(out, g, gap, boxes, ownByEdge)) any = true;
    }
    for (const [id, pts] of out) {
      out.set(id, enforceOrthogonal(pts));
    }
    if (!any) break;
  }

  for (const [id, pts] of out) {
    out.set(id, enforceOrthogonal(pts));
  }

  return out;
}
