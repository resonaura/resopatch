/**
 * Detect when an orthogonal path still clips a device body (incl. L→R through own card).
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

/**
 * True if any interior segment (or a stub that tunnels across a card) hits a body.
 * First/last segments may touch the pad edge, but must not span most of the card width.
 */
export function pathHitsNodeBodies(path: Point[], boxes: NodeBox[], pad = 8): boolean {
  if (path.length < 2) return false;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const isStub = i === 0 || i === path.length - 2;

    for (const box of boxes) {
      if (!segmentHitsBox(a, b, box, isStub ? 0 : pad)) continue;

      if (!isStub) return true;

      // Stub that crosses the whole card (L nipple → R nipple) counts as a hit.
      if (Math.abs(a.y - b.y) < 0.5) {
        const span = Math.abs(b.x - a.x);
        if (span > box.width * 0.45) return true;
      }
      // Vertical stub deep inside the card (not just along the face).
      if (Math.abs(a.x - b.x) < 0.5) {
        const midY = (a.y + b.y) / 2;
        if (a.x > box.x + 8 && a.x < box.x + box.width - 8 && midY > box.y && midY < box.y + box.height) {
          return true;
        }
      }
    }
  }
  return false;
}
