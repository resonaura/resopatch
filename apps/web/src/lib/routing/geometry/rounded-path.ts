import type { Point } from '../types';

interface RoundedCorner {
  entry: Point;
  corner: Point;
  exit: Point;
}

export interface PathSample extends Point {
  /** Direction of travel in radians, using the `Math.atan2` convention. */
  angle: number;
  /** Arc length from the start of the path. */
  dist: number;
}

function getRoundedCorner(
  previous: Point,
  current: Point,
  next: Point,
  radius: number,
): RoundedCorner {
  const incoming = { x: current.x - previous.x, y: current.y - previous.y };
  const outgoing = { x: next.x - current.x, y: next.y - current.y };
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
  const appliedRadius = Math.max(0, Math.min(radius, incomingLength / 2, outgoingLength / 2));

  return {
    entry:
      incomingLength > 0
        ? {
            x: current.x - (incoming.x / incomingLength) * appliedRadius,
            y: current.y - (incoming.y / incomingLength) * appliedRadius,
          }
        : current,
    corner: current,
    exit:
      outgoingLength > 0
        ? {
            x: current.x + (outgoing.x / outgoingLength) * appliedRadius,
            y: current.y + (outgoing.y / outgoingLength) * appliedRadius,
          }
        : current,
  };
}

/** Converts an orthogonal polyline into an SVG path with quadratic rounded corners. */
export function roundedPathFromPoints(points: Point[], radius: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const { entry, corner, exit } = getRoundedCorner(
      points[index - 1],
      points[index],
      points[index + 1],
      radius,
    );
    path += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }
  const end = points[points.length - 1];
  return `${path} L ${end.x} ${end.y}`;
}

function flattenRoundedPath(points: Point[], radius: number, curveSteps = 8): Point[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));

  const flattened: Point[] = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index++) {
    const { entry, corner, exit } = getRoundedCorner(
      points[index - 1],
      points[index],
      points[index + 1],
      radius,
    );
    flattened.push(entry);
    for (let step = 1; step <= curveSteps; step++) {
      const ratio = step / curveSteps;
      const inverse = 1 - ratio;
      flattened.push({
        x: inverse * inverse * entry.x + 2 * inverse * ratio * corner.x + ratio * ratio * exit.x,
        y: inverse * inverse * entry.y + 2 * inverse * ratio * corner.y + ratio * ratio * exit.y,
      });
    }
  }
  flattened.push({ ...points[points.length - 1] });
  return flattened;
}

/** Samples the exact rounded render path at fixed arc-length intervals. */
export function sampleAlongPath(
  points: Point[],
  radius: number,
  step: number,
): { samples: PathSample[]; length: number } {
  const flattened = flattenRoundedPath(points, radius);
  if (flattened.length < 2) return { samples: [], length: 0 };

  const segmentLengths = flattened
    .slice(0, -1)
    .map((point, index) =>
      Math.hypot(flattened[index + 1].x - point.x, flattened[index + 1].y - point.y),
    );
  const length = segmentLengths.reduce((sum, segmentLength) => sum + segmentLength, 0);

  const pointAt = (distance: number): PathSample => {
    let segmentStart = 0;
    for (let index = 0; index < segmentLengths.length; index++) {
      const segmentLength = segmentLengths[index];
      if (distance <= segmentStart + segmentLength || index === segmentLengths.length - 1) {
        const ratio =
          segmentLength > 0
            ? Math.max(0, Math.min(1, (distance - segmentStart) / segmentLength))
            : 0;
        const start = flattened[index];
        const end = flattened[index + 1];
        return {
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
          angle: Math.atan2(end.y - start.y, end.x - start.x),
          dist: distance,
        };
      }
      segmentStart += segmentLength;
    }

    const end = flattened[flattened.length - 1];
    return { ...end, angle: 0, dist: distance };
  };

  const samples = Array.from({ length: Math.max(1, Math.floor(length / step)) + 1 }, (_, index) =>
    pointAt(Math.min(index * step, length)),
  );
  const lastPoint = flattened[flattened.length - 1];
  const lastSample = samples[samples.length - 1];
  if (!lastSample || lastSample.x !== lastPoint.x || lastSample.y !== lastPoint.y) {
    samples.push(pointAt(length));
  }

  return { samples, length };
}
