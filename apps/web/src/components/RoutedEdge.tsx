import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { roundedPathFromPoints, type Point } from '../lib/edgeRouting';

export interface RoutedEdgeData {
  points?: Point[];
  powerConverter?: {
    fromVoltage: string;
    toVoltage: string;
    adapterName?: string;
    dcColor: string;
  } | null;
  [key: string]: unknown;
}

function findBestMidpoint(points?: Point[], sourceX?: number, sourceY?: number, targetX?: number, targetY?: number): Point {
  if (!points || points.length < 2) {
    return { x: ((sourceX ?? 0) + (targetX ?? 0)) / 2, y: ((sourceY ?? 0) + (targetY ?? 0)) / 2 };
  }

  let maxDist = -1;
  let bestMid = { x: (points[0].x + points[points.length - 1].x) / 2, y: (points[0].y + points[points.length - 1].y) / 2 };

  const startIdx = points.length >= 4 ? 1 : 0;
  const endIdx = points.length >= 4 ? points.length - 2 : points.length - 1;

  for (let i = startIdx; i < endIdx; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (dist > maxDist) {
      maxDist = dist;
      bestMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }
  }

  return bestMid;
}

/** Renders whatever path `CableRouter` (in Constructor.tsx) computed for this edge and cached
 *  onto `data.points`. Falls back to a straight line between the handles for the one render
 *  before routing has run — e.g. a cable just created this session. */
export default function RoutedEdge({ id, data, style, markerEnd, label, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const edgeData = data as RoutedEdgeData | undefined;
  const points = edgeData?.points;
  const powerConverter = edgeData?.powerConverter;

  let path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  if (points && points.length >= 2) {
    const p1 = points[0];
    const p2 = points[points.length - 1];
    // Deterministic per-edge offset so adjacent same-axis cables don't overlap
    const hash = id.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0);
    const absHash = Math.abs(hash);

    if (points.length === 2 && Math.abs(p1.y - p2.y) < 1 && Math.abs(p1.x - p2.x) > 20) {
      // Same-height horizontal cable — orthogonal dip in corridor (dipping below row)
      const stub = 24 + (absHash % 10);
      const dipY = p1.y + 28 + (absHash % 16); // dips 28–43px into open corridor below row
      const sx = p1.x < p2.x ? p1.x + stub : p1.x - stub;
      const tx = p1.x < p2.x ? p2.x - stub : p2.x + stub;
      path = roundedPathFromPoints(
        [p1, { x: sx, y: p1.y }, { x: sx, y: dipY }, { x: tx, y: dipY }, { x: tx, y: p2.y }, p2],
        10,
      );
    } else if (points.length === 2 && Math.abs(p1.x - p2.x) < 1 && Math.abs(p1.y - p2.y) > 20) {
      // Same-column vertical cable — orthogonal side bracket: |----______--
      // Step horizontally out of top port -> run vertically down side corridor -> step horizontally into bottom port
      const jog = 28 + (absHash % 20);   // 28–47 px side offset into open corridor
      const bowDir = hash % 2 === 0 ? 1 : -1;  // alternate left / right per cable
      const sideX = p1.x + bowDir * jog;
      path = roundedPathFromPoints(
        [p1, { x: sideX, y: p1.y }, { x: sideX, y: p2.y }, p2],
        12,
      );
    } else {
      path = roundedPathFromPoints(points, 16);
    }
  }

  const mid = findBestMidpoint(points, sourceX, sourceY, targetX, targetY);

  const effectiveStyle = { ...style };
  if (powerConverter) {
    effectiveStyle.stroke = powerConverter.dcColor || '#FF3B30';
  }

  return (
    <>
      <BaseEdge id={id} path={path} style={effectiveStyle} markerEnd={markerEnd} interactionWidth={14} />
      {powerConverter ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)`,
              pointerEvents: 'all',
            }}
            className="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/95 px-2.5 py-1 shadow-2xl backdrop-blur-md text-[11px] font-mono text-white select-none z-30"
          >
            <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">
              🔌
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] uppercase tracking-wider text-neutral-400 font-semibold leading-none">
                {powerConverter.adapterName || 'Блок Питания'}
              </span>
              <div className="flex items-center gap-1 text-[10px] font-bold leading-tight mt-0.5">
                <span className="text-red-400">120V AC</span>
                <span className="text-neutral-400">➔</span>
                <span style={{ color: powerConverter.dcColor }}>{powerConverter.toVoltage}</span>
              </div>
            </div>
          </div>
        </EdgeLabelRenderer>
      ) : label != null ? (
        <EdgeLabelRenderer>
          <div
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)`, pointerEvents: 'none' }}
            className="rounded bg-surface px-1 text-[9px] text-default-500"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
