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
  const path =
    points && points.length >= 2 ? roundedPathFromPoints(points, 10) : `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
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
