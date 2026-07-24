import { describe, expect, it } from 'vitest';
import { applyCableManagement, type EdgePortMeta } from './cableManage';
import { nudgeParallelRuns, type Point } from './nudgeParallel';
import type { NodeBox } from './pathAvoidNodes';

function stackLen(routes: Map<string, Point[]>, min = 20): number {
  const segs: { id: string; axis: 'h' | 'v'; fixed: number; lo: number; hi: number }[] = [];
  for (const [id, pts] of routes) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (Math.abs(a.y - b.y) < 0.5) {
        segs.push({ id, axis: 'h', fixed: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      } else if (Math.abs(a.x - b.x) < 0.5) {
        segs.push({ id, axis: 'v', fixed: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      }
    }
  }
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i];
      const b = segs[j];
      if (a.id === b.id || a.axis !== b.axis) continue;
      if (Math.abs(a.fixed - b.fixed) > 3) continue;
      const len = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
      if (len >= min) n++;
    }
  }
  return n;
}

describe('cableManage + nudgeParallel', () => {
  it('preserves highway detours instead of collapsing into body-crossing L', () => {
    // Picked path went around above cards; old rebuild collapsed to y=228 through bodies.
    const picked: Point[] = [
      { x: 981, y: 1176 },
      { x: 952, y: 1176 },
      { x: 952, y: 1313 },
      { x: 2712, y: 1313 },
      { x: 2712, y: 228 },
      { x: 2741, y: 228 },
    ];
    const boxes: NodeBox[] = [
      { id: 'src', x: 980, y: 1000, width: 240, height: 300 },
      { id: 'tgt', x: 2740, y: 0, width: 240, height: 269 },
      { id: 'blocker', x: 1420, y: 0, width: 240, height: 404 },
      { id: 'blocker2', x: 1860, y: 0, width: 240, height: 323 },
    ];
    const routes = new Map([['e1', picked]]);
    const meta: EdgePortMeta[] = [
      {
        edgeId: 'e1',
        sourceId: 'src',
        targetId: 'tgt',
        sourceSide: 'left',
        targetSide: 'left',
      },
    ];
    const managed = applyCableManagement(routes, meta, boxes);
    const path = managed.get('e1')!;
    // Must keep a high Y corridor (not drop to a pure L at y=228 through blockers).
    const ys = path.map((p) => p.y);
    expect(Math.max(...ys)).toBeGreaterThan(1000);
    // Must not run horizontally through blocker at y=228.
    let hits = false;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (Math.abs(a.y - b.y) > 0.5) continue;
      if (a.y < 200 || a.y > 250) continue;
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      if (x0 < 1660 && x1 > 1420) hits = true;
    }
    expect(hits).toBe(false);
  });

  it('separates stacked vertical fan-outs on the same stub column', () => {
    const routes = new Map<string, Point[]>();
    const meta: EdgePortMeta[] = [];
    for (let i = 0; i < 6; i++) {
      const id = `e${i}`;
      const y = 1800 + i * 27;
      routes.set(id, [
        { x: 4841, y },
        { x: 4813, y },
        { x: 4813, y: 3700 + i * 27 },
        { x: 1, y: 3700 + i * 27 },
      ]);
      meta.push({
        edgeId: id,
        sourceId: 'src',
        targetId: `t${i}`,
        sourceSide: 'left',
        targetSide: 'left',
      });
    }
    const boxes: NodeBox[] = [{ id: 'src', x: 4840, y: 1600, width: 240, height: 400 }];
    const managed = applyCableManagement(routes, meta, boxes);
    const own = new Map(meta.map((m) => [m.edgeId, new Set([m.sourceId, m.targetId])]));
    const packed = nudgeParallelRuns(managed, undefined, boxes, own);

    // Unique stub columns after comb + pack.
    const stubXs = [...packed.values()].map((p) => p[1].x);
    const unique = new Set(stubXs.map((x) => Math.round(x)));
    expect(unique.size).toBeGreaterThanOrEqual(4);

    // Long collinear stacks should be gone or greatly reduced.
    expect(stackLen(packed, 200)).toBeLessThan(stackLen(routes, 200));
    expect(stackLen(packed, 200)).toBe(0);
  });
});
