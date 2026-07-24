/**
 * Dual-nipple routing:
 *  1) Fat virtual body-block between L/R faces (worker obstacles).
 *  2) Score every L/R × L/R nipple combo after WASM — pick the one that does not
 *     tunnel through the card (user idea: try both sides, keep the clear path).
 */

import type { Edge, Node } from '@xyflow/react';
import { pathHitsNodeBodies, type NodeBox } from './pathAvoidNodes';
import {
    basePortId,
    snapPathToNipples,
    sourceHandleOptions,
    targetHandleOptions,
    type Point,
    type Side,
} from './portHandles';

export const NIPPLE_WALL_PREFIX = '__nipple_wall__';

export function isNippleWallId(id: string): boolean {
  return id.startsWith(NIPPLE_WALL_PREFIX);
}

/**
 * Each device → real card + fat interior obstacle (almost full body).
 * Only ~12px gutters on L/R remain free so pads can still attach.
 */
export function toRoutingNodesWithNippleWalls(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (isNippleWallId(n.id)) continue;
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
    out.push({
      id: h.id,
      side: h.position === 'left' ? 'left' : 'right',
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
 * Try left & right nipples on BOTH ends (up to 4 combos). Keep the path that
 * does not cross card bodies; among clear ones, shortest.
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
  const srcOpts = listHandles(sourceNode, 'source').filter((h) => srcWanted.has(h.id));
  const tgtOpts = listHandles(targetNode, 'target').filter((h) => tgtWanted.has(h.id));
  if (srcOpts.length === 0 || tgtOpts.length === 0) return null;

  const sourceBox = boxes.find((b) => b.id === sourceNode.id) ?? null;
  const targetBox = boxes.find((b) => b.id === targetNode.id) ?? null;

  let best: {
    path: Point[];
    sourceHandle: string;
    targetHandle: string;
    sourceSide: Side;
    targetSide: Side;
    score: number;
  } | null = null;

  for (const s of srcOpts) {
    for (const t of tgtOpts) {
      const snapped = snapPathToNipples(
        wasmPath,
        s.point,
        t.point,
        s.side,
        t.side,
        sourceBox,
        targetBox,
        32,
      );
      const hitsBody = pathHitsNodeBodies(snapped, boxes, 6);
      // Prefer clear paths; among equals, shorter + facing L/R pair.
      const facing =
        (s.side === 'right' && t.side === 'left') || (s.side === 'left' && t.side === 'right') ? 0 : 80;
      const score = (hitsBody ? 1e9 : 0) + pathLength(snapped) + facing;

      if (!best || score < best.score) {
        best = {
          path: snapped,
          sourceHandle: s.id,
          targetHandle: t.id,
          sourceSide: s.side,
          targetSide: t.side,
          score,
        };
      }
    }
  }

  return best
    ? {
        path: best.path,
        sourceHandle: best.sourceHandle,
        targetHandle: best.targetHandle,
        sourceSide: best.sourceSide,
        targetSide: best.targetSide,
      }
    : null;
}
