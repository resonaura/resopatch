/**
 * Dual left/right nipples on DeviceNode:
 *  - source: right = `portId`, left = `${portId}-src-left`
 *  - target: left  = `portId`, right = `${portId}-tgt-right`
 *
 * Critical: never draw a horizontal on the port's Y that spans across the card
 * (that was "reaches L then tunnels to R").
 */

export type Side = 'left' | 'right';
export type Point = { x: number; y: number };

export interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function basePortId(handleId: string | null | undefined): string {
  if (!handleId) return '';
  return handleId.replace(/-(src|tgt)-(left|right)$/, '');
}

export function sourceHandleOptions(portId: string): { id: string; side: Side }[] {
  const base = basePortId(portId);
  return [
    { id: base, side: 'right' },
    { id: `${base}-src-left`, side: 'left' },
  ];
}

export function targetHandleOptions(portId: string): { id: string; side: Side }[] {
  const base = basePortId(portId);
  return [
    { id: base, side: 'left' },
    { id: `${base}-tgt-right`, side: 'right' },
  ];
}

/**
 * Pick the source nipple on the face closer to the target (right when target is to the right).
 */
export function pickNearestSourceHandle(
  portId: string,
  sourceCenterX: number,
  targetCenterX: number,
): { id: string; side: Side } {
  const opts = sourceHandleOptions(portId);
  // Face toward the other device — never the far side by default.
  const prefer: Side = targetCenterX >= sourceCenterX ? 'right' : 'left';
  return opts.find((o) => o.side === prefer) ?? opts[0];
}

/**
 * Pick the target nipple on the face closer to the source (left when source is to the left).
 */
export function pickNearestTargetHandle(
  portId: string,
  sourceCenterX: number,
  targetCenterX: number,
): { id: string; side: Side } {
  const opts = targetHandleOptions(portId);
  const prefer: Side = sourceCenterX <= targetCenterX ? 'left' : 'right';
  return opts.find((o) => o.side === prefer) ?? opts[0];
}

function pointInCard(p: Point, box: CardBox, inset = 1): boolean {
  return (
    p.x > box.x + inset &&
    p.x < box.x + box.width - inset &&
    p.y > box.y + inset &&
    p.y < box.y + box.height - inset
  );
}

/** Exterior X just outside the chosen face (pad stub tip). */
export function exteriorStubX(box: CardBox, side: Side, stubLen: number): number {
  return side === 'right'
    ? Math.round(box.x + box.width + stubLen)
    : Math.round(box.x - stubLen);
}

/**
 * True if orthogonal segment a→b crosses the open face of the card on the port row
 * (the classic L↔R tunnel on the nipple's Y).
 */
export function segmentTunnelsCard(a: Point, b: Point, box: CardBox): boolean {
  // Horizontal on a Y that intersects the card vertically, spanning into the body.
  if (Math.abs(a.y - b.y) < 0.5) {
    if (a.y <= box.y + 1 || a.y >= box.y + box.height - 1) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    // Segment overlaps the card's X interior by more than a few px.
    const overlap = Math.min(hi, box.x + box.width) - Math.max(lo, box.x);
    return overlap > 8;
  }
  // Vertical deep inside the card (not along the outer face).
  if (Math.abs(a.x - b.x) < 0.5) {
    if (a.x <= box.x + 4 || a.x >= box.x + box.width - 4) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    const overlap = Math.min(hi, box.y + box.height) - Math.max(lo, box.y);
    return overlap > 8;
  }
  return true;
}

function pathTunnelsOwnCards(path: Point[], sourceBox: CardBox | null, targetBox: CardBox | null): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    if (sourceBox && segmentTunnelsCard(path[i], path[i + 1], sourceBox)) return true;
    if (targetBox && segmentTunnelsCard(path[i], path[i + 1], targetBox)) return true;
  }
  return false;
}

/**
 * Attach WASM route to a specific nipple pair WITHOUT ever crossing the card body.
 *
 * Structure always:
 *   start → stubS (outside face) → [WASM mid, filtered] → stubT (outside face) → end
 *
 * Joins between mid and stubs are forced onto the stub column (outside), never
 * a horizontal that runs across the card at the port Y.
 */
export function snapPathToNipples(
  path: Point[],
  start: Point,
  end: Point,
  sourceSide: Side,
  targetSide: Side,
  sourceBox: CardBox | null = null,
  targetBox: CardBox | null = null,
  stubLen = 32,
): Point[] {
  const stubSX = sourceBox
    ? exteriorStubX(sourceBox, sourceSide, stubLen)
    : Math.round(start.x + (sourceSide === 'right' ? stubLen : -stubLen));
  const stubTX = targetBox
    ? exteriorStubX(targetBox, targetSide, stubLen)
    : Math.round(end.x + (targetSide === 'right' ? stubLen : -stubLen));

  const stubS: Point = { x: stubSX, y: Math.round(start.y) };
  const stubT: Point = { x: stubTX, y: Math.round(end.y) };

  // Mid corners from libavoid — drop anything inside own cards.
  let mid: Point[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const p = { x: Math.round(path[i].x), y: Math.round(path[i].y) };
    if (sourceBox && pointInCard(p, sourceBox, 0)) continue;
    if (targetBox && pointInCard(p, targetBox, 0)) continue;
    mid.push(p);
  }

  // Build: start → stubS → climb/drop on stub column → mid → approach on stubT column → stubT → end
  const pts: Point[] = [{ x: Math.round(start.x), y: Math.round(start.y) }, stubS];

  if (mid.length === 0) {
    // Minimal exterior Z between the two stub columns (never enters either card).
    if (Math.abs(stubS.y - stubT.y) > 0.5) {
      pts.push({ x: stubS.x, y: stubT.y });
    }
  } else {
    const first = mid[0];
    // Always vertical on the SOURCE stub column first (outside the source card).
    if (Math.abs(first.y - stubS.y) > 0.5) {
      pts.push({ x: stubS.x, y: first.y });
    }
    // If first mid is not on stub column, go there horizontally at first.y (must not tunnel source).
    if (Math.abs(first.x - stubS.x) > 0.5) {
      const hop = { x: first.x, y: first.y };
      if (!sourceBox || !segmentTunnelsCard({ x: stubS.x, y: first.y }, hop, sourceBox)) {
        // horizontal already at first.y from stubS.x via previous point
      }
      pts.push(hop);
    }

    // Remaining mid — always axis-aligned joins (never diagonal between WASM corners).
    const startI =
      Math.abs(first.x - stubS.x) > 0.5 || Math.abs(first.y - stubS.y) > 0.5 ? 1 : 0;
    for (let i = startI; i < mid.length; i++) {
      const prev = pts[pts.length - 1];
      const curr = mid[i];
      if (Math.abs(prev.x - curr.x) < 0.5 || Math.abs(prev.y - curr.y) < 0.5) {
        pts.push(curr);
      } else {
        // Prefer continuing previous axis when inserting a 90° corner.
        const before = pts.length >= 2 ? pts[pts.length - 2] : prev;
        const wasV = Math.abs(before.x - prev.x) < 0.5;
        if (wasV) {
          pts.push({ x: prev.x, y: curr.y }, curr);
        } else {
          pts.push({ x: curr.x, y: prev.y }, curr);
        }
      }
    }

    const last = pts[pts.length - 1];
    // Approach target ONLY on the target stub column (outside target card).
    // Never: last → (last.x, end.y) → end if that horizontal crosses the card.
    if (Math.abs(last.x - stubT.x) > 0.5) {
      // Go to stub column at current Y (if that horizontal would tunnel target, go via stubS-like outside)
      const toCol: Point = { x: stubT.x, y: last.y };
      if (targetBox && segmentTunnelsCard(last, toCol, targetBox)) {
        // Detour: vertical outside first using last x if outside, else already at exterior
        // Use a Y outside the target card then into stub column.
        const overY =
          last.y < (targetBox.y + targetBox.height / 2)
            ? Math.round(targetBox.y - 20)
            : Math.round(targetBox.y + targetBox.height + 20);
        pts.push({ x: last.x, y: overY }, { x: stubT.x, y: overY });
      } else {
        pts.push(toCol);
      }
    }
    if (Math.abs(pts[pts.length - 1].y - stubT.y) > 0.5) {
      pts.push({ x: stubT.x, y: stubT.y });
    }
  }

  pts.push(stubT, { x: Math.round(end.x), y: Math.round(end.y) });

  const cleaned = simplifyColinear(pts);

  // Final safety: if anything still tunnels own cards, fall back to pure exterior Z.
  if (pathTunnelsOwnCards(cleaned, sourceBox, targetBox)) {
    return simplifyColinear([
      { x: Math.round(start.x), y: Math.round(start.y) },
      stubS,
      { x: stubS.x, y: stubT.y },
      stubT,
      { x: Math.round(end.x), y: Math.round(end.y) },
    ]);
  }

  return cleaned;
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
  const out: Point[] = [result[0]];
  for (let i = 1; i < result.length; i++) {
    const prev = out[out.length - 1];
    const curr = result[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) < 2) {
      if (i === result.length - 1) out[out.length - 1] = curr;
      continue;
    }
    out.push(curr);
  }
  return out;
}
