import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { roundedPathFromPoints, type Point } from '../lib/edgeRouting';

export interface RoutedEdgeData {
  points?: Point[];
  [key: string]: unknown;
}

/** Renders whatever path `CableRouter` (in Constructor.tsx) computed for this edge and cached
 *  onto `data.points`. Falls back to a straight line between the handles for the one render
 *  before routing has run — e.g. a cable just created this session. */
export default function RoutedEdge({ id, data, style, markerEnd, label, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const points = (data as RoutedEdgeData | undefined)?.points;

  let path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  if (points && points.length >= 2) {
    if (points.length === 2 && Math.abs(points[0].y - points[1].y) < 1 && Math.abs(points[0].x - points[1].x) > 20) {
      const p1 = points[0];
      const p2 = points[1];
      const dx = Math.abs(p2.x - p1.x);
      const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const arcHeight = 14 + (hash % 12);
      const sSign = p2.x > p1.x ? 1 : -1;
      const tSign = p2.x > p1.x ? -1 : 1;
      const cp1X = p1.x + sSign * Math.min(30, dx / 3);
      const cp2X = p2.x + tSign * Math.min(30, dx / 3);
      const arcY = p1.y + arcHeight;
      path = `M ${p1.x} ${p1.y} C ${cp1X} ${arcY}, ${cp2X} ${arcY}, ${p2.x} ${p2.y}`;
    } else {
      path = roundedPathFromPoints(points, 16);
    }
  }

  const mid = points && points.length > 0 ? points[Math.floor(points.length / 2)] : { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} interactionWidth={14} />
      {label != null && (
        <EdgeLabelRenderer>
          <div
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)`, pointerEvents: 'none' }}
            className="rounded bg-surface px-1 text-[9px] text-default-500"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
