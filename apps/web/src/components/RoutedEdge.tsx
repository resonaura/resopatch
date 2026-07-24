import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import {
    buildAdaptiveCableLabel,
    formatCableGenderPair,
    formatCableLabel,
    formatConnectorPair,
    shortConnectorLabel,
    cableLabelIconPorts,
} from '../lib/cableLabel';
import { maxLabelWidthForRun, MIN_LABEL_RUN_PX } from '../lib/cableLabelClearance';
import { findLabelPoint, roundedPathFromPoints, sampleAlongPath, type Point } from '../lib/edgeRouting';
import type { CableEdgeMeta } from '../lib/graphCableToEdge';
import { useI18n } from '../lib/i18n';
import { formatI18nText } from '../lib/i18nText';
import { PortTypeIcon } from '../lib/portIcons';

// Re-export label helpers so existing imports from this module keep working.
export {
    buildAdaptiveCableLabel,
    formatCableGenderPair,
    formatCableLabel,
    formatConnectorPair,
    shortConnectorLabel,
    cableLabelIconPorts,
};

export interface RoutedEdgeData {
  points?: Point[];
  powerConverter?: {
    fromVoltage: string;
    toVoltage: string;
    adapterName?: string;
    dcColor: string;
  } | null;
  cableMeta?: CableEdgeMeta | null;
  psuAsNode?: boolean;
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

function segLen(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Longest straight run on the path (prefer interior segments), centered + rotated.
 * `len` is used to decide how much caption detail fits (with margin to bends).
 */
function findLongestPathSegment(
  points: Point[] | undefined,
): { x: number; y: number; deg: number; len: number } | null {
  if (!points || points.length < 2) return null;

  const consider = (from: number, to: number, best: { x: number; y: number; deg: number; len: number } | null) => {
    let next = best;
    for (let i = from; i < to; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = segLen(a, b);
      if (len < MIN_LABEL_RUN_PX) continue;
      if (next && len <= next.len) continue;
      let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      next = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, deg, len };
    }
    return next;
  };

  // Prefer interior (skip pad→stub leads).
  const first = points.length >= 4 ? 1 : 0;
  const last = points.length >= 4 ? points.length - 2 : points.length - 1;
  let best = consider(first, last, null);
  if (!best) best = consider(0, points.length - 1, null);
  return best;
}

/** Solid cable-tint background, slightly dimmed so white text stays readable. */
function cableLabelBg(stroke: string, brightness = 0.78): string {
  const k = Math.max(0, Math.min(1, brightness));
  const hex = stroke.trim();
  const dim = (r: number, g: number, b: number) =>
    `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;

  const m6 = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return dim((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const m3 = /^#([0-9a-f]{3})$/i.exec(hex);
  if (m3) {
    return dim(
      parseInt(m3[1][0] + m3[1][0], 16),
      parseInt(m3[1][1] + m3[1][1], 16),
      parseInt(m3[1][2] + m3[1][2], 16),
    );
  }
  return hex;
}

function findBestMidpoint(points?: Point[], sourceX?: number, sourceY?: number, targetX?: number, targetY?: number): Point {
  const fallback = {
    x: ((sourceX ?? 0) + (targetX ?? 0)) / 2,
    y: ((sourceY ?? 0) + (targetY ?? 0)) / 2,
  };
  if (!points || points.length < 2) return fallback;
  return findLabelPoint(points, [], fallback);
}

/** Renders whatever path `CableRouter` (in Constructor.tsx) computed for this edge and cached
 *  onto `data.points`. Falls back to a straight line between the handles for the one render
 *  before routing has run — e.g. a cable just created this session. */
export default function RoutedEdge({ id, data, style, markerEnd, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const { t, language } = useI18n();
  const edgeData = data as RoutedEdgeData | undefined;
  const points = edgeData?.points;
  // PSU badge (edge label or real node) owns the mid-cable slot — no text caption then.
  const hasPsuInfo = !!(edgeData?.powerConverter || edgeData?.psuAsNode);
  const powerConverter =
    edgeData?.powerConverter && !edgeData.psuAsNode ? edgeData.powerConverter : null;
  const texture = edgeData?.texture;
  const cableMeta = edgeData?.cableMeta;
  const pathSeg = !hasPsuInfo ? findLongestPathSegment(points) : null;
  // Leave pad to bends so the chip has a little free air along the wire.
  const maxLabelPx = pathSeg ? maxLabelWidthForRun(pathSeg.len) : 0;
  const adaptive =
    pathSeg && cableMeta && maxLabelPx > 24
      ? buildAdaptiveCableLabel(cableMeta, t, language, maxLabelPx)
      : null;

  let path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  if (points && points.length >= 2) {
    path = roundedPathFromPoints(points, 16);
  }

  // PSU floating badge still uses longest free run (mid), not a corner.
  const mid = findBestMidpoint(points, sourceX, sourceY, targetX, targetY);

  const effectiveStyle = { ...style };
  if (powerConverter) {
    effectiveStyle.stroke = powerConverter.dcColor || '#FF3B30';
  }

  const hasTexture = texture && (texture.start || texture.end || texture.middle);
  const thickness = Math.max(8, (Number(effectiveStyle.strokeWidth) || 4) * 2.4);

  const TEXTURE_UNDERLAY_OFFSET = 2;
  const underlayPath =
    hasTexture && points && points.length >= 2
      ? roundedPathFromPoints(
          points.map((p) => ({ x: p.x + TEXTURE_UNDERLAY_OFFSET, y: p.y + TEXTURE_UNDERLAY_OFFSET })),
          16,
        )
      : null;

  const strokeColor = String(effectiveStyle.stroke ?? '#8E8E93');

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
                {formatI18nText(powerConverter.adapterName, language) || t('powerSupply')}
              </span>
              <div className="flex items-center gap-1 text-[10px] font-bold leading-tight mt-0.5">
                <span className="text-red-400">120V AC</span>
                <span className="text-neutral-400">➔</span>
                <span style={{ color: powerConverter.dcColor }}>{powerConverter.toVoltage}</span>
              </div>
            </div>
          </div>
        </EdgeLabelRenderer>
      ) : pathSeg && adaptive ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${pathSeg.x}px, ${pathSeg.y}px) translate(-50%, -50%) rotate(${pathSeg.deg}deg)`,
              pointerEvents: 'none',
              transformOrigin: 'center center',
              color: strokeColor,
              backgroundColor: cableLabelBg(strokeColor, 0.18),
              borderColor: strokeColor,
              maxWidth: Math.max(48, maxLabelPx),
            }}
            className="flex items-center gap-0.5 whitespace-nowrap rounded border px-1 py-px text-[8px] font-extrabold leading-tight"
            title={adaptive.fullText}
          >
            {adaptive.iconPorts.map((pt, i) => (
              <PortTypeIcon key={`${pt}-${i}`} portType={pt} className="h-2.5 w-2.5 shrink-0" tone="inherit" />
            ))}
            <span className="min-w-0">{adaptive.text}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
