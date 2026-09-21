import type { Point, RectObstacle } from '../types';

/** Finds a label anchor on a long route segment outside all device cards. */
export function findLabelPoint(
  points: Point[],
  nodeObstacles: RectObstacle[],
  fallback: Point,
): Point {
  if (points.length < 2) return fallback;

  const startIndex = points.length >= 4 ? 1 : 0;
  const endIndex = points.length >= 4 ? points.length - 2 : points.length - 1;
  let best = fallback;
  let bestScore = -1;

  for (let index = startIndex; index < endIndex; index++) {
    const start = points[index];
    const end = points[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 40) continue;

    for (const ratio of [0.35, 0.5, 0.65]) {
      const candidate = {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
      let minimumDistance = Infinity;
      let isInside = false;

      for (const obstacle of nodeObstacles) {
        if (obstacle.id.startsWith('trace:') || obstacle.id.startsWith('adapter-card-')) continue;
        const closestX = Math.max(obstacle.x, Math.min(candidate.x, obstacle.x + obstacle.width));
        const closestY = Math.max(obstacle.y, Math.min(candidate.y, obstacle.y + obstacle.height));
        const distance = Math.hypot(candidate.x - closestX, candidate.y - closestY);
        isInside ||= distance < 1;
        minimumDistance = Math.min(minimumDistance, distance);
      }

      if (isInside) continue;
      const score = length + minimumDistance * 4;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best;
}
