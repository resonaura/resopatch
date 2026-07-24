import type { Point } from './routingTypes';

/**
 * Parse an SVG path (M/L/H/V/Q from avoid-nodes-edge / libavoid) into bend points.
 * Used so RoutedEdge can keep textures + rounded corners on top of WASM routes.
 */
export function svgPathToPoints(d: string): Point[] {
  if (!d) return [];
  const pts: Point[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let cx = 0;
  let cy = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    const cmd = match[1];
    const nums = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));

    switch (cmd) {
      case 'M':
      case 'L':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cx = nums[i];
          cy = nums[i + 1];
          pts.push({ x: Math.round(cx), y: Math.round(cy) });
        }
        break;
      case 'm':
      case 'l':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cx += nums[i];
          cy += nums[i + 1];
          pts.push({ x: Math.round(cx), y: Math.round(cy) });
        }
        break;
      case 'H':
        for (const x of nums) {
          cx = x;
          pts.push({ x: Math.round(cx), y: Math.round(cy) });
        }
        break;
      case 'h':
        for (const dx of nums) {
          cx += dx;
          pts.push({ x: Math.round(cx), y: Math.round(cy) });
        }
        break;
      case 'V':
        for (const y of nums) {
          cy = y;
          pts.push({ x: Math.round(cx), y: Math.round(cy) });
        }
        break;
      case 'v':
        for (const dy of nums) {
          cy += dy;
          pts.push({ x: Math.round(cx), y: Math.round(cy) });
        }
        break;
      case 'Q':
        // control1x control1y endx endy — keep end only
        for (let i = 0; i + 3 < nums.length; i += 4) {
          cx = nums[i + 2];
          cy = nums[i + 3];
          pts.push({ x: Math.round(cx), y: Math.round(cy) });
        }
        break;
      case 'q':
        for (let i = 0; i + 3 < nums.length; i += 4) {
          cx += nums[i + 2];
          cy += nums[i + 3];
          pts.push({ x: Math.round(cx), y: Math.round(cy) });
        }
        break;
      default:
        break;
    }
  }

  // Drop consecutive duplicates
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out;
}
