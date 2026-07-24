/**
 * Dual-nipple routing:
 *  Score all L/R × L/R combos by real path quality (length, bends, body hits).
 *  Facing sides are a soft preference, never a hard lock that forces a detour.
 *  WASM only when no simple clear path exists for any combo.
 */

import type { Edge, Node } from '@xyflow/react';
import { pathHitsNodeBodies, simplifyClearPath, type NodeBox } from './pathAvoidNodes';
import {
    basePortId,
    snapPathToNipples,
    sourceHandleOptions,
    targetHandleOptions,
    type Point,
    type Side,
} from './portHandles';
import { buildSimpleOrthoPath } from './simpleOrtho';

export const NIPPLE_WALL_PREFIX = '__nipple_wall__';

export function isNippleWallId(id: string): boolean {
  return id.startsWith(NIPPLE_WALL_PREFIX);
}

/** Inline PSU cards (virtual nodes) — obstacles only, no dual nipples / walls. */
export function isPsuObstacleId(id: string): boolean {
  return id.startsWith('__psu_card__');
}

/**
 * Each device → real card + fat interior obstacle (almost full body).
 * Only ~12px gutters on L/R remain free so pads can still attach.
 * PSU adapter cards pass through as plain obstacles.
 */
export function toRoutingNodesWithNippleWalls(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (isNippleWallId(n.id)) continue;
    if (isPsuObstacleId(n.id)) {
      const w = Number(n.measured?.width ?? n.width ?? 148);
      const h = Number(n.measured?.height ?? n.height ?? 52);
      out.push({
        id: n.id,
        type: n.type,
        position: { ...n.position },
        width: w,
        height: h,
        measured: { width: w, height: h },
        data: {},
      });
      continue;
    }
    const w = Number(n.measured?.width ?? n.width ?? 240);
    const h = Number(n.measured?.height ?? n.height ?? 100);
    const x = n.position.x;
    const y = n.position.y;

    out.push({
      id: n.id,
      type: n.type,
      position: { x, y },
      width: w,
      height: h,
      measured: { width: w, height: h },
      parentId: n.parentId,
      data: {},
    });

    const gutterX = 12;
    const gutterY = 6;
    const wallW = Math.max(48, w - gutterX * 2);
    const wallH = Math.max(40, h - gutterY * 2);
    out.push({
      id: `${NIPPLE_WALL_PREFIX}${n.id}`,
      position: {
        x: x + (w - wallW) / 2,
        y: y + (h - wallH) / 2,
      },
      width: wallW,
      height: wallH,
      measured: { width: wallW, height: wallH },
      data: {},
    });
  }
  return out;
}

export function toRoutingEdges(edges: Edge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: e.type,
    data: {},
  }));
}

type HandleHit = { id: string; side: Side; point: Point };

/** Side from handle id (authoritative) — RF position can lie after transforms. */
function sideFromHandleId(id: string, kind: 'source' | 'target'): Side {
  if (kind === 'source') {
    return id.endsWith('-src-left') ? 'left' : 'right';
  }
  return id.endsWith('-tgt-right') ? 'right' : 'left';
}

function listHandles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  internalNode: any,
  kind: 'source' | 'target',
): HandleHit[] {
  const list = (internalNode.internals?.handleBounds?.[kind] ?? []) as {
    id: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    position: string;
  }[];
  const abs = internalNode.internals.positionAbsolute as { x: number; y: number };
  const out: HandleHit[] = [];
  for (const h of list) {
    if (!h.id) continue;
    const side = sideFromHandleId(h.id, kind);
    out.push({
      id: h.id,
      side,
      point: { x: abs.x + h.x + h.width / 2, y: abs.y + h.y + h.height / 2 },
    });
  }
  return out;
}

function pathLength(pts: Point[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return len;
}

/**
 * Which face of `box` is closer (in X) to the other card's center.
 * This is the geometric "nearest nipple" rule — independent of path length.
 */
export function closerFace(box: { x: number; width: number }, otherCenterX: number): Side {
  const leftX = box.x;
  const rightX = box.x + box.width;
  return Math.abs(leftX - otherCenterX) <= Math.abs(rightX - otherCenterX) ? 'left' : 'right';
}

/**
 * Geometric facing sides: each card uses the face closer to the other card.
 * Stacked cards (similar X) share the freer outer face.
 */
export function preferredSides(
  sCx: number,
  tCx: number,
  sCy: number,
  tCy: number,
  sourceBox?: { x: number; width: number } | null,
  targetBox?: { x: number; width: number } | null,
): { source: Side; target: Side } {
  const dx = tCx - sCx;
  const dy = Math.abs(tCy - sCy);
  // Stacked cards: same outer face so the vertical corridor sits outside both.
  if (Math.abs(dx) < 120 && dy > 40) {
    const side: Side = (sCx + tCx) / 2 < 2000 ? 'left' : 'right';
    return { source: side, target: side };
  }
  if (sourceBox && targetBox) {
    return {
      source: closerFace(sourceBox, tCx),
      target: closerFace(targetBox, sCx),
    };
  }
  if (dx >= 0) return { source: 'right', target: 'left' };
  return { source: 'left', target: 'right' };
}

/** Free-air Manhattan via exterior stubs — pure geometric closeness of a nipple pair. */
function nippleAirLength(s: HandleHit, t: HandleHit, stub = 28): number {
  const sOut = s.side === 'right' ? s.point.x + stub : s.point.x - stub;
  const tOut = t.side === 'right' ? t.point.x + stub : t.point.x - stub;
  return Math.abs(sOut - tOut) + Math.abs(s.point.y - t.point.y) + stub * 2;
}

type Candidate = {
  path: Point[];
  sourceHandle: string;
  targetHandle: string;
  sourceSide: Side;
  targetSide: Side;
  score: number;
  nearest: boolean;
  simple: boolean;
};

/**
 * Pick L/R nipples + path.
 *
 * Rule (hard):
 *  1. Each card's closer face to the other card is the default ("nearest nipples").
 *  2. If that combo has a clear simple ortho path → always use it.
 *  3. Only if nearest is blocked by foreign cards do we try other L/R combos,
 *     picking the shortest clear path among those.
 */
export function pickBestNipplePath(
  wasmPath: Point[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceNode: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetNode: any,
  baseSourcePortId: string,
  baseTargetPortId: string,
  boxes: NodeBox[],
): { path: Point[]; sourceHandle: string; targetHandle: string; sourceSide: Side; targetSide: Side } | null {
  const srcBase = basePortId(baseSourcePortId);
  const tgtBase = basePortId(baseTargetPortId);

  const srcWanted = new Set(sourceHandleOptions(srcBase).map((o) => o.id));
  const tgtWanted = new Set(targetHandleOptions(tgtBase).map((o) => o.id));
  let srcOpts = listHandles(sourceNode, 'source').filter((h) => srcWanted.has(h.id));
  let tgtOpts = listHandles(targetNode, 'target').filter((h) => tgtWanted.has(h.id));

  const sourceBox = boxes.find((b) => b.id === sourceNode.id) ?? null;
  const targetBox = boxes.find((b) => b.id === targetNode.id) ?? null;
  const ownIds = new Set<string>([sourceNode.id as string, targetNode.id as string]);
  // Never treat own cards as obstacles for nipple scoring — stubs attach to their faces.
  const foreignBoxes = boxes.filter((b) => !ownIds.has(b.id));

  const portYFrom = (
    opts: HandleHit[],
    box: NodeBox | null,
    node: { internals?: { positionAbsolute?: { y: number } } },
  ) => {
    if (opts.length > 0) return opts[0].point.y;
    if (box) return (node.internals?.positionAbsolute?.y ?? box.y) + box.height / 2;
    return 0;
  };

  // Always ensure both L and R options exist (RF may only measure the currently connected side).
  if (sourceBox) {
    const y = portYFrom(srcOpts, sourceBox, sourceNode);
    const have = new Set(srcOpts.map((h) => h.side));
    for (const o of sourceHandleOptions(srcBase)) {
      if (have.has(o.side)) continue;
      srcOpts.push({
        id: o.id,
        side: o.side,
        point: {
          x: o.side === 'right' ? sourceBox.x + sourceBox.width : sourceBox.x,
          y,
        },
      });
    }
  }
  if (targetBox) {
    const y = portYFrom(tgtOpts, targetBox, targetNode);
    const have = new Set(tgtOpts.map((h) => h.side));
    for (const o of targetHandleOptions(tgtBase)) {
      if (have.has(o.side)) continue;
      tgtOpts.push({
        id: o.id,
        side: o.side,
        point: {
          x: o.side === 'right' ? targetBox.x + targetBox.width : targetBox.x,
          y,
        },
      });
    }
  }

  // Prefer real measured handle coords when both sides exist; keep synthesized for missing.
  // Deduplicate by side (measured wins over synthesized if we re-listed).
  const dedupeBySide = (opts: HandleHit[]): HandleHit[] => {
    const bySide = new Map<Side, HandleHit>();
    for (const h of opts) {
      const prev = bySide.get(h.side);
      // Keep first (measured listHandles comes first).
      if (!prev) bySide.set(h.side, h);
    }
    return [...bySide.values()];
  };
  srcOpts = dedupeBySide(srcOpts);
  tgtOpts = dedupeBySide(tgtOpts);

  if (srcOpts.length === 0 || tgtOpts.length === 0) return null;

  const sCx = (sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) / 2;
  const tCx = (targetBox?.x ?? 0) + (targetBox?.width ?? 0) / 2;
  const sCy = (sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) / 2;
  const tCy = (targetBox?.y ?? 0) + (targetBox?.height ?? 0) / 2;
  const prefer = preferredSides(sCx, tCx, sCy, tCy, sourceBox, targetBox);

  const trySimple = (s: HandleHit, t: HandleHit): Point[] | null => {
    const path = buildSimpleOrthoPath(
      s.point,
      t.point,
      s.side,
      t.side,
      sourceBox,
      targetBox,
      boxes,
      sourceNode.id as string,
      targetNode.id as string,
      28,
      4,
    );
    if (!path) return null;
    // Only foreign cards block — own faces are legal attach points.
    if (pathHitsNodeBodies(path, foreignBoxes, 2)) return null;
    return path;
  };

  const toResult = (c: Candidate) => ({
    path: c.path,
    sourceHandle: c.sourceHandle,
    targetHandle: c.targetHandle,
    sourceSide: c.sourceSide,
    targetSide: c.targetSide,
  });

  // --- 1) Nearest nipples first: if clear, done. No scoring contest. ---
  const nearestS = srcOpts.find((h) => h.side === prefer.source) ?? srcOpts[0];
  const nearestT = tgtOpts.find((h) => h.side === prefer.target) ?? tgtOpts[0];
  const nearestPath = trySimple(nearestS, nearestT);
  if (nearestPath) {
    return {
      path: nearestPath,
      sourceHandle: nearestS.id,
      targetHandle: nearestT.id,
      sourceSide: nearestS.side,
      targetSide: nearestT.side,
    };
  }

  // --- 2) Other simple combos: only when nearest is blocked. Min path length wins. ---
  let bestSimple: Candidate | null = null;
  for (const s of srcOpts) {
    for (const t of tgtOpts) {
      if (s.side === nearestS.side && t.side === nearestT.side) continue;
      const path = trySimple(s, t);
      if (!path) continue;
      // Geometric closeness of the nipple pair is primary; path length breaks ties.
      const score = nippleAirLength(s, t) * 2 + pathLength(path) + Math.max(0, path.length - 2) * 40;
      if (!bestSimple || score < bestSimple.score) {
        bestSimple = {
          path,
          sourceHandle: s.id,
          targetHandle: t.id,
          sourceSide: s.side,
          targetSide: t.side,
          score,
          nearest: false,
          simple: true,
        };
      }
    }
  }
  if (bestSimple) return toResult(bestSimple);

  // --- 3) WASM snap: prefer nearest sides, then shortest clear among all. ---
  let bestWasm: Candidate | null = null;
  const wasmCombos: { s: HandleHit; t: HandleHit; nearest: boolean }[] = [];
  for (const s of srcOpts) {
    for (const t of tgtOpts) {
      wasmCombos.push({
        s,
        t,
        nearest: s.side === nearestS.side && t.side === nearestT.side,
      });
    }
  }
  // Nearest first so we take it if tied / clear.
  wasmCombos.sort((a, b) => Number(b.nearest) - Number(a.nearest) || nippleAirLength(a.s, a.t) - nippleAirLength(b.s, b.t));

  for (const { s, t, nearest } of wasmCombos) {
    const snapped = snapPathToNipples(
      wasmPath,
      s.point,
      t.point,
      s.side,
      t.side,
      sourceBox,
      targetBox,
      28,
    );
    const path = simplifyClearPath(snapped, foreignBoxes, 4, ownIds);
    if (pathHitsNodeBodies(path, foreignBoxes, 2)) continue;
    // Huge penalty for non-nearest so WASM only flips sides when nearest is truly blocked.
    const score =
      (nearest ? 0 : 50_000) +
      nippleAirLength(s, t) * 2 +
      pathLength(path) +
      Math.max(0, path.length - 2) * 40;
    if (!bestWasm || score < bestWasm.score) {
      bestWasm = {
        path,
        sourceHandle: s.id,
        targetHandle: t.id,
        sourceSide: s.side,
        targetSide: t.side,
        score,
        nearest,
        simple: false,
      };
    }
    // If nearest WASM path is clear, stop — don't even look at far sides.
    if (nearest && bestWasm) break;
  }

  if (!bestWasm) return null;
  return toResult(bestWasm);
}

/**
 * After cable-manage / parallel pack, re-attach path ends to the *measured* handle
 * pixels for the chosen L/R ids. Keeps mid-corridor geometry; only rebuilds exterior
 * stubs via snapPathToNipples (strictly ortho, no render-time pin hacks).
 */
export function resnapRouteToMeasuredHandles(
  path: Point[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceNode: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetNode: any,
  sourceHandleId: string,
  targetHandleId: string,
  boxes: NodeBox[],
  stubLen = 28,
): Point[] {
  if (!path || path.length < 2 || !sourceHandleId || !targetHandleId) return path;

  const sourceSide = sideFromHandleId(sourceHandleId, 'source');
  const targetSide = sideFromHandleId(targetHandleId, 'target');
  const sourceBox = boxes.find((b) => b.id === sourceNode?.id) ?? null;
  const targetBox = boxes.find((b) => b.id === targetNode?.id) ?? null;

  const sHit =
    listHandles(sourceNode, 'source').find((h) => h.id === sourceHandleId) ??
    listHandles(sourceNode, 'source').find((h) => h.side === sourceSide);
  const tHit =
    listHandles(targetNode, 'target').find((h) => h.id === targetHandleId) ??
    listHandles(targetNode, 'target').find((h) => h.side === targetSide);

  const start =
    sHit?.point ??
    (sourceBox
      ? {
          x: sourceSide === 'right' ? sourceBox.x + sourceBox.width : sourceBox.x,
          y: sourceBox.y + sourceBox.height / 2,
        }
      : path[0]);
  const end =
    tHit?.point ??
    (targetBox
      ? {
          x: targetSide === 'right' ? targetBox.x + targetBox.width : targetBox.x,
          y: targetBox.y + targetBox.height / 2,
        }
      : path[path.length - 1]);

  return snapPathToNipples(path, start, end, sourceSide, targetSide, sourceBox, targetBox, stubLen);
}
