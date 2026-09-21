import { PARALLEL_CABLE_GAP } from '../../cables/label-clearance';
import { segmentCrossesRect } from '../geometry/intersections';
import type { EdgeRouteSpec, Point, RectObstacle } from '../types';

const PORT_STUB_LENGTH = 48;
const LANE_GAP = PARALLEL_CABLE_GAP;
const LANE_GROUP_TOLERANCE = Math.round(PARALLEL_CABLE_GAP * 0.55);

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
      const isOwnDevice =
        spec != null && (o.id === spec.sourceNodeId || o.id === spec.targetNodeId);
      // Own device at padding 0: approach legs legitimately graze the card edge.
      return segmentCrossesRect(p, pts[i + 1], o, isOwnDevice ? 0 : otherPadding);
    }),
  );
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
  if (len > PORT_STUB_LENGTH * 1.5) return false;
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
      // Keep only the short segments attached directly to the ports fixed. The adjacent approach
      // runs must remain movable; otherwise dense fan-ins converge onto one shared vertical lane.
      if (i === 0 || i === pts.length - 2) continue;
      if (isPortStubSegment(orientation, fixed, lo, hi, i, pts.length, spec)) continue;

      let anchor = fixed;
      if (spec) {
        if (i === pts.length - 2 || i === pts.length - 3)
          anchor = orientation === 'h' ? spec.end.y : spec.end.x;
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
    const sorted = [...group].sort(
      (a, b) => a.anchor - b.anchor || a.lo - b.lo || a.edgeId.localeCompare(b.edgeId),
    );
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
    const fixedByEdge = new Map<string, number>();

    // Spread symmetrically around the base corridor. If a preferred lane hits a device, probe
    // nearby free lanes instead of reverting several edges onto the same original coordinate.
    for (const seg of group) {
      const lane = laneOfEdge.get(seg.edgeId)!;
      const centered = (lane - (laneCount - 1) / 2) * groupLaneGap;

      const pts = working.get(seg.edgeId)!;
      const spec = specById.get(seg.edgeId);
      const prevA = { x: pts[seg.i].x, y: pts[seg.i].y };
      const prevB = { x: pts[seg.i + 1].x, y: pts[seg.i + 1].y };
      const currentFixed = orientation === 'h' ? prevA.y : prevA.x;

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
      const assigned = fixedByEdge.get(seg.edgeId);
      const candidates =
        assigned == null
          ? [
              fixedAvg + centered,
              ...Array.from({ length: laneCount + 6 }, (_, index) => {
                const step = Math.floor(index / 2) + 1;
                const sign = index % 2 === 0 ? 1 : -1;
                return fixedAvg + sign * step * groupLaneGap;
              }),
            ]
          : [assigned];

      for (const candidate of new Set(candidates)) {
        const occupied = [...fixedByEdge].some(
          ([edgeId, fixed]) => edgeId !== seg.edgeId && Math.abs(fixed - candidate) < 0.5,
        );
        if (occupied) continue;
        applyFixed(candidate);
        if (!pathHitsObstacle(pts, spec, obstacles)) {
          placed = true;
          fixedByEdge.set(seg.edgeId, candidate);
          moved ||= Math.abs(currentFixed - candidate) >= 0.5;
          break;
        }
      }
      if (!placed) {
        pts[seg.i].x = prevA.x;
        pts[seg.i].y = prevA.y;
        pts[seg.i + 1].x = prevB.x;
        pts[seg.i + 1].y = prevB.y;
        fixedByEdge.set(seg.edgeId, currentFixed);
      }
    }
  }
  return moved;
}

/** Stage 2: nudge coincident parallel runs apart into separate lanes. */
export function resolveOverlaps(
  routes: Map<string, Point[]>,
  obstacles: RectObstacle[],
  edges: EdgeRouteSpec[],
): Map<string, Point[]> {
  const working = new Map(
    Array.from(routes, ([id, pts]) => [id, pts.map((p) => ({ ...p }))] as const),
  );
  const originals = new Map(
    Array.from(routes, ([id, pts]) => [id, pts.map((p) => ({ ...p }))] as const),
  );
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
      working.set(
        edgeId,
        original.map((p) => ({ ...p })),
      );
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
