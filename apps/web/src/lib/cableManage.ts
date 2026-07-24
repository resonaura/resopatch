/**
 * Cable-management layer near device nipples.
 *
 * Goals:
 *  - Strictly orthogonal polylines (only H/V, 90° corners).
 *  - Neat comb exits/entries on each card face — unique stub depth per cable.
 *  - Never collapse a clear detour into a body-crossing L/Z.
 */

import { STUB_LANE_GAP } from './cableLabelClearance';
import { enforceOrthogonal, type Point } from './nudgeParallel';
import { pathHitsNodeBodies, type NodeBox } from './pathAvoidNodes';
import type { Side } from './portHandles';

export const BASE_STUB = 28;
/** Extra depth per lane when several cables leave/enter the same face. */
export const LANE_GAP = STUB_LANE_GAP;

export type EdgePortMeta = {
  edgeId: string;
  sourceId: string;
  targetId: string;
  sourceSide: Side;
  targetSide: Side;
};

function simplifyColinear(points: Point[]): Point[] {
  if (points.length < 3) return points;
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
      Math.abs((curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x)) < 0.5;
    if (!collinear) result.push(curr);
  }
  result.push(cleaned[cleaned.length - 1]);
  return result;
}

/** Orthogonal join: prefer continuing previous axis (default H then V from a). */
function orthoBridge(a: Point, b: Point, prefer: 'h-first' | 'v-first' = 'h-first'): Point[] {
  if (Math.abs(a.x - b.x) < 0.5) return [a, { x: a.x, y: b.y }];
  if (Math.abs(a.y - b.y) < 0.5) return [a, { x: b.x, y: a.y }];
  if (prefer === 'v-first') {
    return [a, { x: a.x, y: b.y }, b];
  }
  return [a, { x: b.x, y: a.y }, b];
}

/**
 * Rebuild path with exact pad stubs:
 *   padS → stubS → [mid ortho] → stubT → padT
 *
 * Mid corners from the picker/WASM are preserved whenever present — collapsing them
 * to a pure L/Z was cutting through unrelated cards and stacking every cable on one column.
 */
export function rebuildWithStubs(
  path: Point[],
  sourceSide: Side,
  targetSide: Side,
  stubDepthS: number,
  stubDepthT: number,
): Point[] {
  if (path.length < 2) return enforceOrthogonal(path);

  const padS = { x: Math.round(path[0].x), y: Math.round(path[0].y) };
  const padT = {
    x: Math.round(path[path.length - 1].x),
    y: Math.round(path[path.length - 1].y),
  };

  const stubSX =
    sourceSide === 'right'
      ? Math.round(padS.x + stubDepthS)
      : Math.round(padS.x - stubDepthS);
  const stubTX =
    targetSide === 'right'
      ? Math.round(padT.x + stubDepthT)
      : Math.round(padT.x - stubDepthT);

  const stubS: Point = { x: stubSX, y: padS.y };
  const stubT: Point = { x: stubTX, y: padT.y };

  // Interior geometry: everything between the two pad endpoints, excluding pure stub tips
  // that sit on the pad row within the new stub depth.
  let mid: Point[] = [];
  if (path.length >= 4) {
    mid = path.slice(1, -1).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    mid = mid.filter((p) => {
      // Drop exact stub tips we'll re-add (pad-row points within stub depth of either pad).
      const onSourceStubRow =
        Math.abs(p.y - padS.y) < 0.5 && Math.abs(p.x - padS.x) <= stubDepthS + 2;
      const onTargetStubRow =
        Math.abs(p.y - padT.y) < 0.5 && Math.abs(p.x - padT.x) <= stubDepthT + 2;
      if (onSourceStubRow || onTargetStubRow) return false;
      // Drop duplicates of the new stub tips.
      if (Math.abs(p.x - stubSX) < 0.5 && Math.abs(p.y - stubS.y) < 0.5) return false;
      if (Math.abs(p.x - stubTX) < 0.5 && Math.abs(p.y - stubT.y) < 0.5) return false;
      return true;
    });
  }

  const pts: Point[] = [padS, stubS];

  if (mid.length === 0) {
    // Clean L/Z between stub columns.
    if (Math.abs(stubS.y - stubT.y) > 0.5 || Math.abs(stubS.x - stubT.x) > 0.5) {
      if (Math.abs(stubS.x - stubT.x) > 0.5 && Math.abs(stubS.y - stubT.y) > 0.5) {
        pts.push({ x: stubS.x, y: stubT.y });
      } else if (Math.abs(stubS.y - stubT.y) > 0.5) {
        pts.push({ x: stubS.x, y: stubT.y });
      }
    }
  } else {
    // Bridge stubS → first mid: finish vertical on stub column, then horizontal.
    const first = mid[0];
    if (Math.abs(first.y - stubS.y) > 0.5) {
      pts.push({ x: stubS.x, y: first.y });
    }
    if (Math.abs(first.x - stubS.x) > 0.5 || Math.abs(pts[pts.length - 1].y - first.y) > 0.5) {
      const bridge = orthoBridge(pts[pts.length - 1], first, 'h-first');
      pts.push(...bridge.slice(1));
    }

    for (let i = 1; i < mid.length; i++) {
      const prev = pts[pts.length - 1];
      const curr = mid[i];
      if (Math.abs(prev.x - curr.x) < 0.5 || Math.abs(prev.y - curr.y) < 0.5) {
        pts.push(curr);
      } else {
        const before = pts.length >= 2 ? pts[pts.length - 2] : prev;
        const wasV = Math.abs(before.x - prev.x) < 0.5;
        const bridge = orthoBridge(prev, curr, wasV ? 'v-first' : 'h-first');
        pts.push(...bridge.slice(1));
      }
    }

    // Approach target: land on stubT column at current Y, then vertical to stubT.
    const last = pts[pts.length - 1];
    if (Math.abs(last.x - stubT.x) > 0.5) {
      pts.push({ x: stubT.x, y: last.y });
    }
    if (Math.abs(pts[pts.length - 1].y - stubT.y) > 0.5) {
      pts.push({ x: stubT.x, y: stubT.y });
    }
  }

  pts.push(stubT, padT);
  return enforceOrthogonal(simplifyColinear(pts));
}

type LaneKey = string; // `${nodeId}:${side}`

/**
 * Stub depths for one card face — always a unique comb ordered by pad Y.
 * Shared columns look neat for short hops but stack long fan-outs into one thick line.
 */
function assignLanes(items: { edgeId: string; y: number }[]): Map<string, number> {
  const sorted = [...items].sort(
    (a, b) => a.y - b.y || a.edgeId.localeCompare(b.edgeId),
  );
  const depths = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    depths.set(sorted[i].edgeId, BASE_STUB + i * LANE_GAP);
  }
  return depths;
}

/**
 * Apply cable-management stubs + 90° enforcement to a full route set.
 * When `boxes` is provided, reject rebuilds that tunnel through foreign cards
 * and keep the previous polyline (still orthogonalised).
 */
export function applyCableManagement(
  routes: Map<string, Point[]>,
  meta: EdgePortMeta[],
  boxes: NodeBox[] = [],
): Map<string, Point[]> {
  const metaById = new Map(meta.map((m) => [m.edgeId, m]));

  // Group by face for lane assignment.
  const srcGroups = new Map<LaneKey, { edgeId: string; y: number }[]>();
  const tgtGroups = new Map<LaneKey, { edgeId: string; y: number }[]>();

  for (const m of meta) {
    const path = routes.get(m.edgeId);
    if (!path || path.length < 2) continue;
    const sKey: LaneKey = `${m.sourceId}:${m.sourceSide}`;
    const tKey: LaneKey = `${m.targetId}:${m.targetSide}`;
    const sList = srcGroups.get(sKey) ?? [];
    sList.push({ edgeId: m.edgeId, y: path[0].y });
    srcGroups.set(sKey, sList);
    const tList = tgtGroups.get(tKey) ?? [];
    tList.push({ edgeId: m.edgeId, y: path[path.length - 1].y });
    tgtGroups.set(tKey, tList);
  }

  const srcDepth = new Map<string, number>();
  const tgtDepth = new Map<string, number>();
  for (const [, list] of srcGroups) {
    for (const [id, d] of assignLanes(list)) srcDepth.set(id, d);
  }
  for (const [, list] of tgtGroups) {
    for (const [id, d] of assignLanes(list)) tgtDepth.set(id, d);
  }

  const out = new Map<string, Point[]>();
  for (const [id, path] of routes) {
    const m = metaById.get(id);
    if (!m || path.length < 2) {
      out.set(id, enforceOrthogonal(path));
      continue;
    }
    const ds = srcDepth.get(id) ?? BASE_STUB;
    const dt = tgtDepth.get(id) ?? BASE_STUB;
    const rebuilt = rebuildWithStubs(path, m.sourceSide, m.targetSide, ds, dt);

    if (boxes.length > 0) {
      const foreign = boxes.filter((b) => b.id !== m.sourceId && b.id !== m.targetId);
      if (pathHitsNodeBodies(rebuilt, foreign, 4)) {
        // Prefer original geometry if it was clear; otherwise keep rebuilt (still better stubs).
        const orig = enforceOrthogonal(path);
        if (!pathHitsNodeBodies(orig, foreign, 4)) {
          // Re-apply only the face stubs without discarding mid detours from orig.
          out.set(id, rebuildWithStubs(orig, m.sourceSide, m.targetSide, ds, dt));
          // If that still hits, fall back to original ortho path.
          const attempt = out.get(id)!;
          if (pathHitsNodeBodies(attempt, foreign, 4)) {
            out.set(id, orig);
          }
          continue;
        }
      }
    }

    out.set(id, rebuilt);
  }
  return out;
}
