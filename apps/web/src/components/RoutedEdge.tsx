import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { findLabelPoint, roundedPathFromPoints, sampleAlongPath, type Point } from '../lib/edgeRouting';
import { useI18n } from '../lib/i18n';

export interface RoutedEdgeData {
  points?: Point[];
  powerConverter?: {
    fromVoltage: string;
    toVoltage: string;
    adapterName?: string;
    dcColor: string;
  } | null;
  texture?: {
    start?: string | null;
    end?: string | null;
    middle?: string | null;
  } | null;
  [key: string]: unknown;
}

// How much of the path (in px) each end cap texture claims before the repeating middle texture
// takes over. Comfortably inside the straight stub every route exits its port along (see `STUB`
// in edgeRouting.ts) so a cap essentially never lands mid-bend.
const CAP_LENGTH = 32;
// Spacing between repeating middle-texture stamps. Small enough that the seams between tiles
// aren't obvious once the path curves, large enough not to render hundreds of <image> tags on a
// long cable.
const TILE_LENGTH = 30;

/** One rotated `<image>` stamp: `anchor` is where its *local* (0,0) — the trailing edge, opposite
 *  the direction of travel — lands on the path, and it extends forward by `length` along the
 *  local tangent captured in `angle`. Stamping every cap/tile this same way, anchored at the back
 *  edge and rotated to the sample's own tangent, is what lets a straight repeating image read as
 *  bent once several of them are chained along a curved path. */
function TextureStamp({ href, anchor, angle, length, thickness, keyId }: { href: string; anchor: Point; angle: number; length: number; thickness: number; keyId: string }) {
  if (length <= 0) return null;
  const deg = (angle * 180) / Math.PI;
  return (
    <g key={keyId} transform={`translate(${anchor.x} ${anchor.y}) rotate(${deg})`}>
      <image href={href} x={0} y={-thickness / 2} width={length} height={thickness} preserveAspectRatio="none" />
    </g>
  );
}

/** Renders the custom start-cap / repeating-middle / end-cap textures (if the cable has any) on
 *  top of the plain colored stroke `BaseEdge` already draws — so a texture that fails to load, or
 *  a cap the user never uploaded, still shows a continuous cable rather than a gap. Bending is
 *  done by chopping the path into short samples via `sampleAlongPath` (same corner geometry
 *  `roundedPathFromPoints` renders) and stamping one rotated image per sample instead of trying to
 *  warp a single image around a curve. */
function CableTexture({
  id,
  points,
  texture,
  thickness,
}: {
  id: string;
  points: Point[];
  texture: NonNullable<RoutedEdgeData['texture']>;
  thickness: number;
}) {
  const { samples, length } = sampleAlongPath(points, 16, TILE_LENGTH);
  if (samples.length < 2 || length <= 0) return null;

  // Interpolates the exact point + local tangent at an arbitrary arc-length distance, bracketed
  // between whichever two coarse `samples` straddle it — needed because cap boundaries almost
  // never land exactly on a TILE_LENGTH-spaced sample, and snapping to the nearest one instead
  // would leave a gap or an overlap at the seam between a cap and the repeating middle.
  const interpAt = (dist: number): Point & { angle: number } => {
    let i = 0;
    while (i < samples.length - 2 && samples[i + 1].dist < dist) i++;
    const a = samples[i];
    const b = samples[i + 1] ?? a;
    const segLen = b.dist - a.dist;
    const t = segLen > 0 ? Math.max(0, Math.min(1, (dist - a.dist) / segLen)) : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: a.angle };
  };

  const hasStart = !!texture.start;
  const hasEnd = !!texture.end;
  const capLength = Math.min(CAP_LENGTH, length / 2);

  let midStartDist = hasStart ? capLength : 0;
  let midEndDist = hasEnd ? length - capLength : length;
  if (midEndDist < midStartDist) {
    midStartDist = length / 2;
    midEndDist = length / 2;
  }

  const nodes: React.ReactNode[] = [];

  if (hasStart) {
    nodes.push(<TextureStamp key={`${id}-start`} keyId={`${id}-start`} href={texture.start!} anchor={samples[0]} angle={samples[0].angle} length={midStartDist} thickness={thickness} />);
  }
  if (hasEnd) {
    const last = samples[samples.length - 1];
    const anchor = midEndDist === last.dist ? last : interpAt(midEndDist);
    nodes.push(<TextureStamp key={`${id}-end`} keyId={`${id}-end`} href={texture.end!} anchor={anchor} angle={anchor.angle} length={last.dist - midEndDist} thickness={thickness} />);
  }
  if (texture.middle) {
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      if (b.dist <= midStartDist || a.dist >= midEndDist) continue;
      const from = Math.max(a.dist, midStartDist);
      const to = Math.min(b.dist, midEndDist);
      if (to <= from) continue;
      // Re-anchor at the clamped start so a tile trimmed by a cap boundary begins exactly where
      // the cap leaves off, with no gap.
      const anchor = from === a.dist ? a : interpAt(from);
      nodes.push(<TextureStamp key={`${id}-mid-${i}`} keyId={`${id}-mid-${i}`} href={texture.middle} anchor={anchor} angle={a.angle} length={to - from} thickness={thickness} />);
    }
  }

  return <>{nodes}</>;
}

function findBestMidpoint(points?: Point[], sourceX?: number, sourceY?: number, targetX?: number, targetY?: number): Point {
  const fallback = {
    x: ((sourceX ?? 0) + (targetX ?? 0)) / 2,
    y: ((sourceY ?? 0) + (targetY ?? 0)) / 2,
  };
  if (!points || points.length < 2) return fallback;
  // Prefer the longest free run (PCB silkscreen: not on a pad exit). Node keep-out for labels
  // is applied when routing stores a preferred anchor; here we at least avoid stub tips.
  return findLabelPoint(points, [], fallback);
}

/** Renders whatever path `CableRouter` (in Constructor.tsx) computed for this edge and cached
 *  onto `data.points`. Falls back to a straight line between the handles for the one render
 *  before routing has run — e.g. a cable just created this session. */
export default function RoutedEdge({ id, data, style, markerEnd, label, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const { t } = useI18n();
  const edgeData = data as RoutedEdgeData | undefined;
  const points = edgeData?.points;
  // Inline PSU badges are real RF nodes now (`powerAdapter`) so cables route around them.
  // Keep rendering a label only if the host explicitly asks (legacy / no node yet).
  const powerConverter =
    edgeData?.powerConverter && !(edgeData as { psuAsNode?: boolean }).psuAsNode
      ? edgeData.powerConverter
      : null;
  const texture = edgeData?.texture;

  // Any decorative dip/jog for a dead-straight cable is already baked into `points` by
  // `computeRoutes`/`addCosmeticCurve` (edgeRouting.ts), which verifies it against every other
  // device before shipping it — never reshape the line again here without that check.
  let path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  if (points && points.length >= 2) {
    path = roundedPathFromPoints(points, 16);
  }

  const mid = findBestMidpoint(points, sourceX, sourceY, targetX, targetY);

  const effectiveStyle = { ...style };
  if (powerConverter) {
    effectiveStyle.stroke = powerConverter.dcColor || '#FF3B30';
  }

  const hasTexture = texture && (texture.start || texture.end || texture.middle);
  const thickness = Math.max(8, (Number(effectiveStyle.strokeWidth) || 4) * 2.4);

  // Textured cables draw their own raster stamps over the plain colored stroke, which would
  // otherwise fully hide it — offsetting a second copy of the same line a couple px down-right,
  // underneath the texture, keeps a sliver of the cable's real color/shape peeking out (matches
  // how a physical cable's jacket shows at its edges under a printed wrap).
  const TEXTURE_UNDERLAY_OFFSET = 2;
  const underlayPath =
    hasTexture && points && points.length >= 2
      ? roundedPathFromPoints(
          points.map((p) => ({ x: p.x + TEXTURE_UNDERLAY_OFFSET, y: p.y + TEXTURE_UNDERLAY_OFFSET })),
          16,
        )
      : null;

  return (
    <>
      <BaseEdge id={id} path={path} style={effectiveStyle} markerEnd={markerEnd} interactionWidth={14} />
      {underlayPath && (
        <path
          d={underlayPath}
          stroke={effectiveStyle.stroke ?? '#8E8E93'}
          strokeWidth={effectiveStyle.strokeWidth ?? 4}
          fill="none"
          strokeLinecap="round"
          opacity={0.55}
        />
      )}
      {hasTexture && points && points.length >= 2 ? (
        <CableTexture id={id} points={points} texture={texture} thickness={thickness} />
      ) : null}
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
                {powerConverter.adapterName || t('powerSupply')}
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
