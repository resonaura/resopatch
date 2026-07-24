/**
 * Math-only orthogonal cable router backed by `obstacle-router` (TypeScript port of libavoid).
 *
 * Takes rectangular device cards + port endpoints and returns pure bend-point polylines.
 * Rendering (SVG, textures, labels) stays outside this module.
 */

import {
    AStarPath,
    Point as AvoidPoint,
    ConnDirLeft,
    ConnDirRight,
    ConnEnd,
    ConnRef,
    ConnectorCrossings,
    OrthogonalRouting,
    Rectangle,
    Router,
    ShapeConnectionPin,
    ShapeRef,
    crossingPenalty,
    generateStaticOrthogonalVisGraph,
    idealNudgingDistance,
    improveOrthogonalRoutes,
    nudgeOrthogonalSegmentsConnectedToShapes,
    nudgeOrthogonalTouchingColinearSegments,
    nudgeSharedPathsWithCommonEndPoint,
    penaliseOrthogonalSharedPathsAtConnEnds,
    segmentPenalty,
    shapeBufferDistance,
    vertexVisibility,
} from 'obstacle-router';

import type { EdgeRouteSpec, Point, RectObstacle } from './routingTypes';

export interface LibavoidRouteOptions {
  /** Keep-out around each device card (shape buffer). */
  nodeSpacing?: number;
  /** Target centre-to-centre gap between parallel traces (nudging). */
  cableSpacing?: number;
  /** Extra cost per bend. Must be > 0 for nudging to engage. */
  bendPenalty?: number;
  /** Extra cost when two connectors cross — keep ≫ bendPenalty. */
  crossPenalty?: number;
}

const DEFAULTS: Required<LibavoidRouteOptions> = {
  nodeSpacing: 8,
  // Modest parallel nudge — enough for labels, not so wide that dense fans fail.
  cableSpacing: 20,
  bendPenalty: 50,
  // Crossing is expensive but not "try forever" — the TS port of libavoid can thrash with
  // extremely high crossing penalties + hateCrossings on dense boards.
  crossPenalty: 800,
};

function wireOrthogonalHelpers(router: Router): void {
  // Late-bound helpers (package keeps them separate for tree-shaking / cycle breaks).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = router as any;
  r._generateStaticOrthogonalVisGraph = generateStaticOrthogonalVisGraph;
  r._improveOrthogonalRoutes = improveOrthogonalRoutes;
  r._ConnectorCrossings = ConnectorCrossings;
  r._AStarPath = AStarPath;
  r._vertexVisibility = vertexVisibility;
}

/** Source defaults to leaving rightward; target defaults to receiving from the left (facing ports). */
function sourceDirFlag(dir?: 'left' | 'right'): number {
  return dir === 'left' ? ConnDirLeft : ConnDirRight;
}

function targetDirFlag(dir?: 'left' | 'right'): number {
  // Match legacy edgeRouting: only explicit 'right' faces right; unset → left.
  return dir === 'right' ? ConnDirRight : ConnDirLeft;
}

function sourceDirSide(dir?: 'left' | 'right'): 'left' | 'right' {
  return dir === 'left' ? 'left' : 'right';
}

function targetDirSide(dir?: 'left' | 'right'): 'left' | 'right' {
  return dir === 'right' ? 'right' : 'left';
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

/** Map an absolute port coordinate onto proportional pin offsets for a shape rect. */
function pinOffsets(
  shape: RectObstacle,
  port: Point,
  dir: 'left' | 'right' | undefined,
): { xOff: number; yOff: number } {
  const w = Math.max(1, shape.width);
  const h = Math.max(1, shape.height);
  const yOff = clamp01((port.y - shape.y) / h);
  if (dir === 'left') return { xOff: 0, yOff };
  if (dir === 'right') return { xOff: 1, yOff };
  return { xOff: clamp01((port.x - shape.x) / w), yOff };
}

function simplifyColinearLocal(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const result: Point[] = [points[0]];
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

function dropMicroLocal(points: Point[], minLen = 3): Point[] {
  if (points.length < 2) return points;
  const out: Point[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const curr = points[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) < minLen) {
      if (i === points.length - 1) out[out.length - 1] = { ...curr };
      continue;
    }
    out.push({ ...curr });
  }
  return simplifyColinearLocal(out);
}

function polygonToPoints(route: { size(): number; at(i: number): { x: number; y: number } }): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < route.size(); i++) {
    const p = route.at(i);
    pts.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  // Drop consecutive duplicates libavoid sometimes leaves after nudging.
  const dedup: Point[] = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    dedup.push(p);
  }
  return dropMicroLocal(simplifyColinearLocal(dedup));
}

/**
 * Snap path ends to exact port pixels and guarantee orthogonal stub exits/entries.
 * Libavoid pins can land a few px off the handle centre; we never invent diagonals.
 */
function snapPortsOrthogonal(
  path: Point[],
  start: Point,
  end: Point,
  sDir: 'left' | 'right',
  tDir: 'left' | 'right',
  minStub = 20,
): Point[] {
  if (path.length < 2) return [{ ...start }, { ...end }];

  const sSign = sDir === 'left' ? -1 : 1;
  // Outward normal from the target pad (approach comes from this side).
  const tOut = tDir === 'right' ? 1 : -1;

  // Interior corners from libavoid (drop its endpoints — we re-attach exact ports).
  let mid = path.slice(1, -1).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));

  // Source stub: always leave horizontally from the nipple.
  const srcStub: Point = { x: Math.round(start.x + sSign * minStub), y: Math.round(start.y) };
  // Drop mid points that sit on the source stub ray.
  mid = mid.filter(
    (p) =>
      !(
        Math.abs(p.y - start.y) < 0.5 &&
        Math.sign(p.x - start.x || sSign) === sSign &&
        Math.abs(p.x - start.x) <= minStub + 1
      ),
  );

  // Target stub: approach pad horizontally from the exterior.
  const tgtStub: Point = { x: Math.round(end.x + tOut * minStub), y: Math.round(end.y) };
  mid = mid.filter(
    (p) =>
      !(
        Math.abs(p.y - end.y) < 0.5 &&
        Math.sign(p.x - end.x || tOut) === tOut &&
        Math.abs(p.x - end.x) <= minStub + 1
      ),
  );

  // Bridge srcStub → first mid orthogonally if needed (pin Y may differ from route row).
  const head: Point[] = [{ ...start }, srcStub];
  if (mid.length > 0) {
    const first = mid[0];
    if (Math.abs(first.y - srcStub.y) > 0.5 && Math.abs(first.x - srcStub.x) > 0.5) {
      // Prefer vertical first (continue column), then horizontal — classic stub breakout.
      head.push({ x: srcStub.x, y: first.y });
    } else if (Math.abs(first.y - srcStub.y) > 0.5) {
      // already same x-ish; vertical segment implicit when we append first
    } else if (Math.abs(first.x - srcStub.x) > 0.5) {
      // horizontal — fine
    }
  }

  // Bridge last mid → tgtStub orthogonally.
  const tail: Point[] = [tgtStub, { ...end }];
  const body = [...mid];
  if (body.length > 0) {
    const last = body[body.length - 1];
    if (Math.abs(last.y - tgtStub.y) > 0.5 && Math.abs(last.x - tgtStub.x) > 0.5) {
      body.push({ x: last.x, y: tgtStub.y });
    }
  } else {
    // No interior: Z between stubs.
    if (Math.abs(srcStub.y - tgtStub.y) > 0.5) {
      const midX = Math.round((srcStub.x + tgtStub.x) / 2);
      body.push({ x: midX, y: srcStub.y }, { x: midX, y: tgtStub.y });
    }
  }

  return dropMicroLocal(simplifyColinearLocal([...head, ...body, ...tail]));
}

function stubFallback(spec: EdgeRouteSpec): Point[] {
  const sSign = sourceDirSide(spec.sourceDir) === 'left' ? -1 : 1;
  const tSign = targetDirSide(spec.targetDir) === 'right' ? 1 : -1;
  const stub = 32;
  const a = { x: spec.start.x + sSign * stub, y: spec.start.y };
  const b = { x: spec.end.x + tSign * stub, y: spec.end.y };
  // Simple orthogonal Z via mid-X corridor.
  const midX = Math.round((a.x + b.x) / 2);
  return dropMicroLocal(
    simplifyColinearLocal([
      { ...spec.start },
      a,
      { x: midX, y: a.y },
      { x: midX, y: b.y },
      b,
      { ...spec.end },
    ]),
  );
}

/**
 * Route every net together so libavoid can nudge parallel runs and penalise crossings globally.
 * Returns one polyline per edge id (missing only if the input list is empty).
 */
export function routeWithLibavoid(
  obstacles: RectObstacle[],
  edges: EdgeRouteSpec[],
  options: LibavoidRouteOptions = {},
): Map<string, Point[]> {
  const opts = { ...DEFAULTS, ...options };
  const result = new Map<string, Point[]>();
  if (edges.length === 0) return result;

  const router = new Router(OrthogonalRouting);
  wireOrthogonalHelpers(router);
  router.setRoutingParameter(shapeBufferDistance, opts.nodeSpacing);
  router.setRoutingParameter(idealNudgingDistance, opts.cableSpacing);
  // segmentPenalty MUST be > 0 for orthogonal nudging (libavoid requirement).
  router.setRoutingParameter(segmentPenalty, opts.bendPenalty);
  router.setRoutingParameter(crossingPenalty, opts.crossPenalty);
  router.setRoutingOption(nudgeOrthogonalSegmentsConnectedToShapes, true);
  router.setRoutingOption(nudgeOrthogonalTouchingColinearSegments, true);
  router.setRoutingOption(nudgeSharedPathsWithCommonEndPoint, true);
  router.setRoutingOption(penaliseOrthogonalSharedPathsAtConnEnds, true);

  const shapeById = new Map<string, { shape: ShapeRef; rect: RectObstacle }>();
  let nextObjectId = 1;

  for (const o of obstacles) {
    // Skip synthetic keep-outs from our old pipeline if any leak in.
    if (o.id.startsWith('trace:') || o.id.startsWith('adapter-card-')) continue;
    const tl = new AvoidPoint(o.x, o.y);
    const br = new AvoidPoint(o.x + Math.max(1, o.width), o.y + Math.max(1, o.height));
    // Package typings for ShapeRef/Router are inconsistent across submodules — cast at boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape = new ShapeRef(router as any, new Rectangle(tl, br), nextObjectId++);
    shapeById.set(o.id, { shape, rect: o });
  }

  // Unique pin class ids per shape (ConnEnd addresses pins by class id on the shape).
  const pinCounter = new Map<string, number>();
  const takePinClass = (nodeId: string): number => {
    const n = (pinCounter.get(nodeId) ?? 1) + 1;
    pinCounter.set(nodeId, n);
    return n;
  };

  type ConnEntry = { edgeId: string; ref: ConnRef; spec: EdgeRouteSpec };
  const conns: ConnEntry[] = [];

  for (const spec of edges) {
    // Deduplicate by id — last wins order for pin placement; same id shouldn't appear twice.
    if (conns.some((c) => c.edgeId === spec.id)) continue;

    const src = shapeById.get(spec.sourceNodeId);
    const tgt = shapeById.get(spec.targetNodeId);

    let srcEnd: ConnEnd;
    let tgtEnd: ConnEnd;

    const sSide = sourceDirSide(spec.sourceDir);
    const tSide = targetDirSide(spec.targetDir);

    if (src) {
      const pinClass = takePinClass(spec.sourceNodeId);
      const { xOff, yOff } = pinOffsets(src.rect, spec.start, sSide);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pin = ShapeConnectionPin.createForShape(
        src.shape as any,
        pinClass,
        xOff,
        yOff,
        true,
        0,
        sourceDirFlag(spec.sourceDir),
      );
      pin.setExclusive(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      srcEnd = ConnEnd.fromShapePin(src.shape as any, pinClass);
    } else {
      srcEnd = ConnEnd.fromPoint(new AvoidPoint(spec.start.x, spec.start.y), sourceDirFlag(spec.sourceDir));
    }

    if (tgt) {
      const pinClass = takePinClass(spec.targetNodeId);
      const { xOff, yOff } = pinOffsets(tgt.rect, spec.end, tSide);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pin = ShapeConnectionPin.createForShape(
        tgt.shape as any,
        pinClass,
        xOff,
        yOff,
        true,
        0,
        targetDirFlag(spec.targetDir),
      );
      pin.setExclusive(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tgtEnd = ConnEnd.fromShapePin(tgt.shape as any, pinClass);
    } else {
      tgtEnd = ConnEnd.fromPoint(new AvoidPoint(spec.end.x, spec.end.y), targetDirFlag(spec.targetDir));
    }

    const ref = new ConnRef(router, srcEnd, tgtEnd, nextObjectId++);
    // hateCrossings triggers expensive re-routing phases; prefer soft crossingPenalty instead.
    ref.setHateCrossings(false);
    conns.push({ edgeId: spec.id, ref, spec });
  }

  try {
    router.processTransaction();
  } catch {
    // Libavoid can throw on degenerate geometry — fall back per-edge stubs.
    for (const { edgeId, spec } of conns) {
      result.set(edgeId, stubFallback(spec));
    }
    return result;
  }

  for (const { edgeId, ref, spec } of conns) {
    try {
      const route = ref.displayRoute();
      let pts = polygonToPoints(route);
      if (pts.length < 2) {
        pts = stubFallback(spec);
      } else {
        pts = snapPortsOrthogonal(
          pts,
          spec.start,
          spec.end,
          sourceDirSide(spec.sourceDir),
          targetDirSide(spec.targetDir),
        );
      }
      result.set(edgeId, pts);
    } catch {
      result.set(edgeId, stubFallback(spec));
    }
  }

  // Any edge that somehow wasn't registered (should not happen).
  for (const spec of edges) {
    if (!result.has(spec.id)) result.set(spec.id, stubFallback(spec));
  }

  return result;
}

/** Single-net convenience wrapper used by findPath / findBestPath. */
export function routeOneWithLibavoid(spec: EdgeRouteSpec, obstacles: RectObstacle[]): Point[] {
  return routeWithLibavoid(obstacles, [spec]).get(spec.id) ?? stubFallback(spec);
}
