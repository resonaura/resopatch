/**
 * Debug dump of all cable polylines — copy from console and paste back for diagnosis.
 *
 * Console:
 *   - auto-logs after every route recompute (group + one JSON blob)
 *   - window.__resopatchDumpRoutes() — re-dump current snapshot
 *   - window.__resopatchLastRouteDump — last object (copy via console)
 */

export type Point = { x: number; y: number };

export type RouteDumpEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null | undefined;
  targetHandle: string | null | undefined;
  sourceSide?: string;
  targetSide?: string;
  /** Final polyline after cable-manage + pack. */
  points: Point[];
  /** Intermediate stages (when provided). */
  stages?: {
    picked?: Point[];
    managed?: Point[];
    packed?: Point[];
    final?: Point[];
  };
  bendCount: number;
  length: number;
  nonOrtho: { i: number; a: Point; b: Point }[];
};

export type RouteDumpNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

export type RouteDump = {
  ts: string;
  edgeCount: number;
  nodeCount: number;
  nodes: RouteDumpNode[];
  edges: RouteDumpEdge[];
  /** Pairs of edges whose segments nearly collinear-overlap (stacking). */
  overlaps: {
    a: string;
    b: string;
    axis: 'h' | 'v';
    fixed: number;
    lo: number;
    hi: number;
    len: number;
  }[];
  nonOrthoEdges: string[];
};

const AXIS_TOL = 2;
const MIN_OVERLAP_LOG = 8;

function pathLen(pts: Point[]): number {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    n += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return Math.round(n);
}

function nonOrthoSegments(pts: Point[]): { i: number; a: Point; b: Point }[] {
  const bad: { i: number; a: Point; b: Point }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
      bad.push({ i, a, b });
    }
  }
  return bad;
}

type Seg = {
  edgeId: string;
  axis: 'h' | 'v';
  fixed: number;
  lo: number;
  hi: number;
};

function segmentsOf(edgeId: string, pts: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (Math.abs(a.y - b.y) < 0.5) {
      out.push({
        edgeId,
        axis: 'h',
        fixed: a.y,
        lo: Math.min(a.x, b.x),
        hi: Math.max(a.x, b.x),
      });
    } else if (Math.abs(a.x - b.x) < 0.5) {
      out.push({
        edgeId,
        axis: 'v',
        fixed: a.x,
        lo: Math.min(a.y, b.y),
        hi: Math.max(a.y, b.y),
      });
    }
  }
  return out;
}

function findOverlaps(routes: Map<string, Point[]>): RouteDump['overlaps'] {
  const segs: Seg[] = [];
  for (const [id, pts] of routes) {
    segs.push(...segmentsOf(id, pts));
  }
  const hits: RouteDump['overlaps'] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i];
      const b = segs[j];
      if (a.edgeId === b.edgeId) continue;
      if (a.axis !== b.axis) continue;
      if (Math.abs(a.fixed - b.fixed) > AXIS_TOL) continue;
      const lo = Math.max(a.lo, b.lo);
      const hi = Math.min(a.hi, b.hi);
      const len = hi - lo;
      if (len < MIN_OVERLAP_LOG) continue;
      hits.push({
        a: a.edgeId,
        b: b.edgeId,
        axis: a.axis,
        fixed: Math.round((a.fixed + b.fixed) / 2),
        lo: Math.round(lo),
        hi: Math.round(hi),
        len: Math.round(len),
      });
    }
  }
  // Longest first — most painful stacks.
  hits.sort((x, y) => y.len - x.len);
  return hits;
}

export type RouteDebugInput = {
  nodes: RouteDumpNode[];
  edges: {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    sourceSide?: string;
    targetSide?: string;
    final: Point[];
    picked?: Point[];
    managed?: Point[];
    packed?: Point[];
  }[];
};

function buildDump(input: RouteDebugInput): RouteDump {
  const finalMap = new Map(input.edges.map((e) => [e.id, e.final]));
  const edges: RouteDumpEdge[] = input.edges.map((e) => {
    const pts = e.final.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    const nonOrtho = nonOrthoSegments(pts);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      sourceSide: e.sourceSide,
      targetSide: e.targetSide,
      points: pts,
      stages: {
        picked: e.picked?.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
        managed: e.managed?.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
        packed: e.packed?.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
        final: pts,
      },
      bendCount: Math.max(0, pts.length - 2),
      length: pathLen(pts),
      nonOrtho,
    };
  });

  const nonOrthoEdges = edges.filter((e) => e.nonOrtho.length > 0).map((e) => e.id);
  const overlaps = findOverlaps(finalMap);

  return {
    ts: new Date().toISOString(),
    edgeCount: edges.length,
    nodeCount: input.nodes.length,
    nodes: input.nodes.map((n) => ({
      ...n,
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: Math.round(n.width),
      height: Math.round(n.height),
    })),
    edges,
    overlaps,
    nonOrthoEdges,
  };
}

declare global {
  interface Window {
    __resopatchLastRouteDump?: RouteDump;
    __resopatchDumpRoutes?: () => RouteDump | undefined;
    __resopatchCopyRouteDump?: () => Promise<string>;
  }
}

function installGlobals(getLast: () => RouteDump | undefined) {
  if (typeof window === 'undefined') return;
  window.__resopatchDumpRoutes = () => {
    const d = getLast();
    if (!d) {
      console.warn('[ResoPatch routes] no dump yet — wait for routes to compute');
      return undefined;
    }
    logDump(d);
    return d;
  };
  window.__resopatchCopyRouteDump = async () => {
    const d = getLast();
    if (!d) {
      console.warn('[ResoPatch routes] no dump yet');
      return '';
    }
    const text = JSON.stringify(d, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      console.info('[ResoPatch routes] JSON copied to clipboard (%d edges)', d.edgeCount);
    } catch {
      console.info('[ResoPatch routes] clipboard failed — use the JSON below');
      console.log(text);
    }
    return text;
  };
}

function logDump(dump: RouteDump) {
  const summary = {
    ts: dump.ts,
    edges: dump.edgeCount,
    nodes: dump.nodeCount,
    nonOrtho: dump.nonOrthoEdges.length,
    stackedPairs: dump.overlaps.length,
    topStacks: dump.overlaps.slice(0, 12),
  };

  console.groupCollapsed(
    `[ResoPatch routes] ${dump.edgeCount} edges · nonOrtho=${dump.nonOrthoEdges.length} · stacks=${dump.overlaps.length} · ${dump.ts}`,
  );
  console.info('summary', summary);
  console.table(
    dump.edges.map((e) => ({
      id: e.id.slice(0, 36),
      src: e.source.slice(0, 12),
      tgt: e.target.slice(0, 12),
      side: `${e.sourceSide ?? '?'}>${e.targetSide ?? '?'}`,
      bends: e.bendCount,
      len: e.length,
      pts: e.points.length,
      bad: e.nonOrtho.length,
    })),
  );
  if (dump.overlaps.length) {
    console.warn('stacked segment pairs (same axis, ~same line)', dump.overlaps.slice(0, 30));
  }
  if (dump.nonOrthoEdges.length) {
    console.warn('non-orthogonal edges', dump.nonOrthoEdges);
  }
  // Single blob for copy-paste back to the agent.
  console.log('FULL_JSON_COPY_ME → window.__resopatchLastRouteDump  |  __resopatchCopyRouteDump()');
  console.log(JSON.stringify(dump));
  console.groupEnd();
}

let lastDump: RouteDump | undefined;

/**
 * Build + print route dump. Call after final routes are ready.
 */
export function logAllRoutes(input: RouteDebugInput): RouteDump {
  const dump = buildDump(input);
  lastDump = dump;
  if (typeof window !== 'undefined') {
    window.__resopatchLastRouteDump = dump;
    installGlobals(() => lastDump);
  }
  logDump(dump);
  return dump;
}
