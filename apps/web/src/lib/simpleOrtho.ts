/**
 * Shortest orthogonal cable between two nipples — no WASM.
 * Always preferred when the shape is free of *foreign* cards.
 */

import { segmentHitsBox, type NodeBox } from './pathAvoidNodes';
import type { CardBox, Point, Side } from './portHandles';
import { exteriorStubX, segmentTunnelsCard } from './portHandles';

function simplify(points: Point[]): Point[] {
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

function pathLen(path: Point[]): number {
  let n = 0;
  for (let i = 0; i < path.length - 1; i++) {
    n += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  }
  return n;
}

/**
 * Clear of foreign obstacles. Own source/target only forbid *tunnels* through the body
 * (so a free diagonal L/Z past the outer faces is always allowed).
 */
function simplePathClear(
  path: Point[],
  boxes: NodeBox[],
  sourceId: string | null,
  targetId: string | null,
  sourceBox: CardBox | null,
  targetBox: CardBox | null,
  pad: number,
): boolean {
  if (path.length < 2) return false;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const isStub = i === 0 || i === path.length - 2;

    if (sourceBox && segmentTunnelsCard(a, b, sourceBox)) return false;
    if (targetBox && segmentTunnelsCard(a, b, targetBox)) return false;

    for (const box of boxes) {
      if (box.id === sourceId || box.id === targetId) continue;
      // Stubs: pad 0; interior: soft pad (don't over-reject open air).
      if (segmentHitsBox(a, b, box, isStub ? 0 : pad)) return false;
    }
  }
  return true;
}

/**
 * Pure stub + L/Z candidates. For "left-lower / right-upper, empty between"
 * this must return a 2-corner path, not a zigzag.
 */
export function buildSimpleOrthoPath(
  start: Point,
  end: Point,
  sourceSide: Side,
  targetSide: Side,
  sourceBox: CardBox | null,
  targetBox: CardBox | null,
  boxes: NodeBox[],
  sourceId: string | null = null,
  targetId: string | null = null,
  stubLen = 28,
  pad = 4,
): Point[] | null {
  const s = { x: Math.round(start.x), y: Math.round(start.y) };
  const e = { x: Math.round(end.x), y: Math.round(end.y) };

  const stubSX = sourceBox
    ? exteriorStubX(sourceBox, sourceSide, stubLen)
    : s.x + (sourceSide === 'right' ? stubLen : -stubLen);
  const stubTX = targetBox
    ? exteriorStubX(targetBox, targetSide, stubLen)
    : e.x + (targetSide === 'right' ? stubLen : -stubLen);

  const stubS: Point = { x: Math.round(stubSX), y: s.y };
  const stubT: Point = { x: Math.round(stubTX), y: e.y };

  // Order matters: fewest corners first.
  const cands: Point[][] = [
    // Single turn if stubs already share row/col
    simplify([s, stubS, stubT, e]),
    // Two standard elbows — covers left-low / right-high with empty space
    simplify([s, stubS, { x: stubS.x, y: stubT.y }, stubT, e]), // out → vertical → into target column
    simplify([s, stubS, { x: stubT.x, y: stubS.y }, stubT, e]), // out → horizontal → into target row
  ];

  // Same-side shared outer corridor (stacked cards)
  if (sourceSide === targetSide) {
    const outerX =
      sourceSide === 'left' ? Math.min(stubS.x, stubT.x) : Math.max(stubS.x, stubT.x);
    cands.push(
      simplify([s, stubS, { x: outerX, y: stubS.y }, { x: outerX, y: stubT.y }, stubT, e]),
    );
  }

  // Mid corridor
  const midX = Math.round((stubS.x + stubT.x) / 2);
  if (Math.abs(midX - stubS.x) > 16 && Math.abs(midX - stubT.x) > 16) {
    cands.push(
      simplify([s, stubS, { x: midX, y: stubS.y }, { x: midX, y: stubT.y }, stubT, e]),
    );
  }

  // Go above / below both cards (common when a third box sits between on the port row).
  if (sourceBox && targetBox) {
    const topY = Math.min(sourceBox.y, targetBox.y) - 40;
    const botY = Math.max(sourceBox.y + sourceBox.height, targetBox.y + targetBox.height) + 40;
    for (const cy of [topY, botY]) {
      cands.push(
        simplify([
          s,
          stubS,
          { x: stubS.x, y: cy },
          { x: stubT.x, y: cy },
          stubT,
          e,
        ]),
      );
    }
  }

  let best: Point[] | null = null;
  let bestScore = Infinity;

  // Prefer pad=0 for short facing hops so a 2-bend path isn't rejected by soft keepout.
  for (const p of [0, 2, pad]) {
    for (const cand of cands) {
      if (cand.length < 2) continue;
      if (!simplePathClear(cand, boxes, sourceId, targetId, sourceBox, targetBox, p)) continue;
      const bends = Math.max(0, cand.length - 2);
      // Heavily prefer fewer corners; length is tie-break only.
      const score = bends * 1_000_000 + pathLen(cand) + p * 10;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    // As soon as pad=0 finds a short path, take it (don't wait for looser pads).
    if (best && best.length <= 6) return best;
  }

  return best;
}
