/**
 * Obstacle checks + aggressive clear-path simplification.
 * Goal: if a short L/Z is free, never keep a WASM detour that "hugs" unrelated cards.
 */

export type Point = { x: number; y: number };

export interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function segmentHitsBox(a: Point, b: Point, box: NodeBox, pad: number): boolean {
  const rx0 = box.x - pad;
  const ry0 = box.y - pad;
  const rx1 = box.x + box.width + pad;
  const ry1 = box.y + box.height + pad;
  if (Math.abs(a.y - b.y) < 0.5) {
    if (a.y <= ry0 || a.y >= ry1) return false;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    return x1 > rx0 && x0 < rx1;
  }
  if (Math.abs(a.x - b.x) < 0.5) {
    if (a.x <= rx0 || a.x >= rx1) return false;
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    return y1 > ry0 && y0 < ry1;
  }
  return true;
}

export function segmentClearOfBoxes(a: Point, b: Point, boxes: NodeBox[], pad: number): boolean {
  return boxes.every((box) => !segmentHitsBox(a, b, box, pad));
}

export function pathHitsNodeBodies(path: Point[], boxes: NodeBox[], pad = 8): boolean {
  if (path.length < 2) return false;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    // Only the tiny pad→stub lead (first/last segment) may graze the face.
    // Everything else uses full pad. Long "stubs" that span a whole card still count.
    const isEndSeg = i === 0 || i === path.length - 2;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);

    for (const box of boxes) {
      // True exterior stub: short, starts/ends on face. Otherwise treat as interior.
      const allowFaceGraze = isEndSeg && segLen <= 48;
      if (!segmentHitsBox(a, b, box, allowFaceGraze ? 0 : pad)) continue;

      if (!allowFaceGraze) return true;

      // Even short face stubs must not run deep across the body.
      if (Math.abs(a.y - b.y) < 0.5) {
        if (Math.abs(b.x - a.x) > Math.min(40, box.width * 0.25)) return true;
      }
      if (Math.abs(a.x - b.x) < 0.5) {
        const midY = (a.y + b.y) / 2;
        if (
          a.x > box.x + 8 &&
          a.x < box.x + box.width - 8 &&
          midY > box.y &&
          midY < box.y + box.height
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function pathClear(path: Point[], boxes: NodeBox[], pad: number): boolean {
  if (path.length < 2) return false;
  for (let i = 0; i < path.length - 1; i++) {
    // Stubs (first/last) use pad 0 so pad→stub is always allowed on the face.
    const p = i === 0 || i === path.length - 2 ? 0 : pad;
    if (!segmentClearOfBoxes(path[i], path[i + 1], boxes, p)) return false;
  }
  return !pathHitsNodeBodies(path, boxes, pad);
}

function simplifyColinear(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const collinear =
      (curr.x - prev.x) * (next.y - curr.y) === (curr.y - prev.y) * (next.x - curr.x);
    if (!collinear) result.push(curr);
  }
  result.push(points[points.length - 1]);
  return result;
}

function pathLength(path: Point[]): number {
  let len = 0;
  for (let i = 0; i < path.length - 1; i++) {
    len += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  }
  return len;
}

/**
 * Penalty for running near cards that aren't the source/target — stops "magnetic"
 * hugging of unrelated devices when a freer corridor exists.
 */
export function pathHugPenalty(
  path: Point[],
  boxes: NodeBox[],
  ownIds: Set<string>,
  softRadius = 80,
): number {
  let pen = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const mid = {
      x: (path[i].x + path[i + 1].x) / 2,
      y: (path[i].y + path[i + 1].y) / 2,
    };
    for (const box of boxes) {
      if (ownIds.has(box.id)) continue;
      // Distance to AABB (0 if inside — already illegal for clear paths).
      const cx = Math.max(box.x, Math.min(mid.x, box.x + box.width));
      const cy = Math.max(box.y, Math.min(mid.y, box.y + box.height));
      const d = Math.hypot(mid.x - cx, mid.y - cy);
      if (d < softRadius) {
        // Closer = worse. Cap so distant boxes don't matter.
        pen += (softRadius - d) * (softRadius - d) * 0.02;
      }
    }
  }
  return pen;
}

function scorePath(path: Point[], boxes: NodeBox[], ownIds: Set<string>): number {
  const bends = Math.max(0, path.length - 2);
  return bends * 8000 + pathLength(path) + pathHugPenalty(path, boxes, ownIds);
}

/** 1- or 2-segment orthogonal joins between a and b (axis-aligned only). */
function orthoJoins(a: Point, b: Point): Point[][] {
  if (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5) {
    return [[a, b]];
  }
  return [
    [a, { x: b.x, y: a.y }, b],
    [a, { x: a.x, y: b.y }, b],
  ];
}

function joinClear(a: Point, b: Point, boxes: NodeBox[], pad: number): Point[] | null {
  for (const join of orthoJoins(a, b)) {
    let ok = true;
    for (let i = 0; i < join.length - 1; i++) {
      if (!segmentClearOfBoxes(join[i], join[i + 1], boxes, pad)) {
        ok = false;
        break;
      }
    }
    if (ok) return join;
  }
  return null;
}

/**
 * Prefer the shortest clear orthogonal shape between stub tips.
 * Tries L/Z and a few mid corridors so we don't follow unrelated obstacle contours.
 */
export function simplifyClearPath(
  path: Point[],
  boxes: NodeBox[],
  pad = 8,
  ownIds: Set<string> = new Set(),
): Point[] {
  if (path.length <= 3) return path;

  const pts = simplifyColinear(path.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })));
  if (pts.length <= 3) return pts;

  const start = pts[0];
  const end = pts[pts.length - 1];
  // Convention: [pad, stubOut, ...mid..., stubIn, pad]
  const stubS = pts.length >= 4 ? pts[1] : pts[0];
  const stubT = pts.length >= 4 ? pts[pts.length - 2] : pts[pts.length - 1];

  const candidates: Point[][] = [];

  // Direct if aligned.
  if (Math.abs(stubS.x - stubT.x) < 0.5 || Math.abs(stubS.y - stubT.y) < 0.5) {
    candidates.push(simplifyColinear([start, stubS, stubT, end]));
  }

  // Two standard elbows.
  candidates.push(
    simplifyColinear([start, stubS, { x: stubT.x, y: stubS.y }, stubT, end]),
    simplifyColinear([start, stubS, { x: stubS.x, y: stubT.y }, stubT, end]),
  );

  // Mid corridors — often freer than hugging a side of an unrelated card.
  const midX = Math.round((stubS.x + stubT.x) / 2);
  const midY = Math.round((stubS.y + stubT.y) / 2);
  const thirdX = Math.round(stubS.x + (stubT.x - stubS.x) / 3);
  const twoThirdX = Math.round(stubS.x + (2 * (stubT.x - stubS.x)) / 3);
  for (const cx of [midX, thirdX, twoThirdX]) {
    if (Math.abs(cx - stubS.x) < 8 || Math.abs(cx - stubT.x) < 8) continue;
    candidates.push(
      simplifyColinear([
        start,
        stubS,
        { x: cx, y: stubS.y },
        { x: cx, y: stubT.y },
        stubT,
        end,
      ]),
    );
  }
  for (const cy of [midY]) {
    if (Math.abs(cy - stubS.y) < 8 || Math.abs(cy - stubT.y) < 8) continue;
    candidates.push(
      simplifyColinear([
        start,
        stubS,
        { x: stubS.x, y: cy },
        { x: stubT.x, y: cy },
        stubT,
        end,
      ]),
    );
  }

  let best: Point[] | null = null;
  let bestScore = Infinity;

  // Try with a few pad values so slight keep-out inflation doesn't force a detour.
  for (const p of [pad, Math.max(4, pad - 4), Math.max(2, pad - 6)]) {
    for (const cand of candidates) {
      if (!pathClear(cand, boxes, p)) continue;
      const s = scorePath(cand, boxes, ownIds);
      if (s < bestScore) {
        bestScore = s;
        best = cand;
      }
    }
    if (best) break; // prefer first pad that yields any simple clear path
  }

  // Also score the original (peeled) against simple candidates.
  const peeled = reduceBends(pts, boxes, pad);
  if (pathClear(peeled, boxes, pad)) {
    const s = scorePath(peeled, boxes, ownIds);
    if (s < bestScore) {
      bestScore = s;
      best = peeled;
    }
  }

  // Only replace original if we actually win on score (fewer bends / less hug / shorter).
  if (best && pathClear(pts, boxes, pad)) {
    const origScore = scorePath(pts, boxes, ownIds);
    if (bestScore <= origScore - 50) return best;
    // Even small bend wins count
    if (best.length < pts.length) return best;
    return pts;
  }

  return best ?? peeled;
}

/**
 * Greedy bend reduction: skip from point i to j with a clear ortho join.
 * Preserves endpoints.
 */
function reduceBends(path: Point[], boxes: NodeBox[], pad: number): Point[] {
  let cur = path;
  let changed = true;
  while (changed && cur.length > 3) {
    changed = false;
    // Longest skips first so we collapse big detours.
    outer: for (let span = cur.length - 1; span >= 2; span--) {
      for (let i = 0; i + span < cur.length; i++) {
        const j = i + span;
        // Keep pad endpoints: don't skip over index 0 or last in a way that drops stubs wrongly.
        // Allow joining stubS (1) to stubT (n-2) etc.
        const join = joinClear(cur[i], cur[j], boxes, pad);
        if (!join) continue;
        const next = simplifyColinear([...cur.slice(0, i), ...join, ...cur.slice(j + 1)]);
        if (next.length >= cur.length) continue;
        if (!pathClear(next, boxes, pad)) continue;
        cur = next;
        changed = true;
        break outer;
      }
    }
  }
  return cur;
}
