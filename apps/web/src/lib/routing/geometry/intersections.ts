import type { Point, RectObstacle } from '../types';

/** Checks whether two axis-aligned segments overlap or cross in their interiors. */
export function segmentsCross(startA: Point, endA: Point, startB: Point, endB: Point): boolean {
  const isHorizontalA = startA.y === endA.y;
  const isHorizontalB = startB.y === endB.y;

  if (isHorizontalA && isHorizontalB) {
    if (startA.y !== startB.y) return false;
    return (
      Math.max(startA.x, endA.x) > Math.min(startB.x, endB.x) &&
      Math.max(startB.x, endB.x) > Math.min(startA.x, endA.x)
    );
  }

  if (!isHorizontalA && !isHorizontalB) {
    if (startA.x !== startB.x) return false;
    return (
      Math.max(startA.y, endA.y) > Math.min(startB.y, endB.y) &&
      Math.max(startB.y, endB.y) > Math.min(startA.y, endA.y)
    );
  }

  const horizontal = isHorizontalA
    ? { y: startA.y, low: Math.min(startA.x, endA.x), high: Math.max(startA.x, endA.x) }
    : { y: startB.y, low: Math.min(startB.x, endB.x), high: Math.max(startB.x, endB.x) };
  const vertical = isHorizontalA
    ? { x: startB.x, low: Math.min(startB.y, endB.y), high: Math.max(startB.y, endB.y) }
    : { x: startA.x, low: Math.min(startA.y, endA.y), high: Math.max(startA.y, endA.y) };

  return (
    vertical.x > horizontal.low &&
    vertical.x < horizontal.high &&
    horizontal.y > vertical.low &&
    horizontal.y < vertical.high
  );
}

/** Treats diagonal segments as unsafe because routing paths must remain orthogonal. */
export function segmentCrossesRect(
  start: Point,
  end: Point,
  rect: RectObstacle,
  padding: number,
): boolean {
  const left = rect.x - padding;
  const top = rect.y - padding;
  const right = rect.x + rect.width + padding;
  const bottom = rect.y + rect.height + padding;

  if (start.y === end.y) {
    return (
      start.y > top &&
      start.y < bottom &&
      Math.max(start.x, end.x) > left &&
      Math.min(start.x, end.x) < right
    );
  }
  if (start.x === end.x) {
    return (
      start.x > left &&
      start.x < right &&
      Math.max(start.y, end.y) > top &&
      Math.min(start.y, end.y) < bottom
    );
  }
  return true;
}

/** Insets an endpoint's own card so a route can leave its port without crossing the card body. */
export function insetOwnObstacle(rect: RectObstacle, inset = 3): RectObstacle {
  return {
    id: rect.id,
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(0, rect.width - inset * 2),
    height: Math.max(0, rect.height - inset * 2),
  };
}

/** Returns true when non-adjacent segments cross or double back over each other. */
export function pathSelfIntersects(points: Point[]): boolean {
  if (points.length < 4) return false;

  for (let first = 0; first < points.length - 1; first++) {
    for (let second = first + 2; second < points.length - 1; second++) {
      const startA = points[first];
      const endA = points[first + 1];
      const startB = points[second];
      const endB = points[second + 1];
      if (endA.x === startB.x && endA.y === startB.y) continue;
      if (startA.x === endB.x && startA.y === endB.y) continue;
      if (segmentsCross(startA, endA, startB, endB)) return true;
    }
  }
  return false;
}

/** Returns true when any segments in two routes overlap or cross. */
export function pathsViolateDrc(first: Point[], second: Point[]): boolean {
  for (let firstIndex = 0; firstIndex < first.length - 1; firstIndex++) {
    for (let secondIndex = 0; secondIndex < second.length - 1; secondIndex++) {
      if (
        segmentsCross(
          first[firstIndex],
          first[firstIndex + 1],
          second[secondIndex],
          second[secondIndex + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}
