import type { Point } from '../types';

/** Removes intermediate points that lie on the same straight segment. */
export function simplifyColinear(points: Point[]): Point[] {
  if (points.length < 3) return points;

  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    const previous = result[result.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const isCollinear =
      (current.x - previous.x) * (next.y - current.y) ===
      (current.y - previous.y) * (next.x - current.x);

    if (!isCollinear) result.push(current);
  }
  result.push(points[points.length - 1]);
  return result;
}

/** Removes near-zero-length jogs introduced by grid rounding. */
export function dropMicroSegments(points: Point[], minimumLength = 4): Point[] {
  if (points.length < 2) return points;

  const result: Point[] = [{ ...points[0] }];
  for (let index = 1; index < points.length; index++) {
    const previous = result[result.length - 1];
    const current = points[index];
    if (Math.hypot(current.x - previous.x, current.y - previous.y) < minimumLength) {
      if (index === points.length - 1) result[result.length - 1] = { ...current };
      continue;
    }
    result.push({ ...current });
  }
  return simplifyColinear(result);
}

/** Collapses A* staircases into the shortest clear orthogonal bridges. */
export function reduceBends(
  points: Point[],
  segmentClear: (start: Point, end: Point) => boolean,
): Point[] {
  let result = dropMicroSegments(simplifyColinear(points));
  if (result.length < 3) return result;

  const findClearBridge = (start: Point, end: Point): Point[] | null => {
    if (start.x === end.x || start.y === end.y) {
      return segmentClear(start, end) ? [start, end] : null;
    }

    const horizontalFirst = { x: end.x, y: start.y };
    if (segmentClear(start, horizontalFirst) && segmentClear(horizontalFirst, end)) {
      return [start, horizontalFirst, end];
    }

    const verticalFirst = { x: start.x, y: end.y };
    return segmentClear(start, verticalFirst) && segmentClear(verticalFirst, end)
      ? [start, verticalFirst, end]
      : null;
  };

  let changed = true;
  while (changed && result.length > 2) {
    changed = false;
    outer: for (let startIndex = 0; startIndex < result.length - 1; startIndex++) {
      for (let endIndex = result.length - 1; endIndex > startIndex + 1; endIndex--) {
        const bridge = findClearBridge(result[startIndex], result[endIndex]);
        if (!bridge || bridge.length - 2 >= endIndex - startIndex - 1) continue;

        result = [...result.slice(0, startIndex), ...bridge, ...result.slice(endIndex + 1)];
        result = dropMicroSegments(simplifyColinear(result));
        changed = true;
        break outer;
      }
    }
  }

  return dropMicroSegments(result);
}
