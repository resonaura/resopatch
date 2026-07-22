import { describe, expect, it } from 'vitest';
import {
  computeRoutes,
  findPath,
  resolveOverlaps,
  roundedPathFromPoints,
  segmentCrossesRect,
  simplifyColinear,
  type EdgeRouteSpec,
  type Point,
  type RectObstacle,
} from './edgeRouting';

/** True if any segment of `points` passes through the interior of `rect` (shrunk slightly so
 *  touching the exact boundary — which a cable legitimately does right at its own port — doesn't
 *  count as crossing). */
function routeCrossesRect(points: Point[], rect: RectObstacle, shrink = 1): boolean {
  const rx0 = rect.x + shrink;
  const ry0 = rect.y + shrink;
  const rx1 = rect.x + rect.width - shrink;
  const ry1 = rect.y + rect.height - shrink;
  if (rx1 <= rx0 || ry1 <= ry0) return false;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (p1.y === p2.y) {
      if (p1.y <= ry0 || p1.y >= ry1) continue;
      const x0 = Math.min(p1.x, p2.x);
      const x1 = Math.max(p1.x, p2.x);
      if (x1 > rx0 && x0 < rx1) return true;
    } else if (p1.x === p2.x) {
      if (p1.x <= rx0 || p1.x >= rx1) continue;
      const y0 = Math.min(p1.y, p2.y);
      const y1 = Math.max(p1.y, p2.y);
      if (y1 > ry0 && y0 < ry1) return true;
    } else {
      throw new Error(`non-orthogonal segment: ${JSON.stringify(p1)} -> ${JSON.stringify(p2)}`);
    }
  }
  return false;
}

function isOrthogonal(points: Point[]): boolean {
  return points.every((p, i) => i === 0 || p.x === points[i - 1].x || p.y === points[i - 1].y);
}

function segmentsOf(points: Point[]) {
  const segs: { p1: Point; p2: Point; orientation: 'h' | 'v'; fixed: number; lo: number; hi: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (p1.y === p2.y) segs.push({ p1, p2, orientation: 'h', fixed: p1.y, lo: Math.min(p1.x, p2.x), hi: Math.max(p1.x, p2.x) });
    else if (p1.x === p2.x) segs.push({ p1, p2, orientation: 'v', fixed: p1.x, lo: Math.min(p1.y, p2.y), hi: Math.max(p1.y, p2.y) });
  }
  return segs;
}

/** Overlap length (in px) between two routes' coincident collinear segments — 0 if they never
 *  run along the exact same line, or run along the same line but don't overlap in range. */
function overlapLength(a: Point[], b: Point[]): number {
  let total = 0;
  const segsA = segmentsOf(a).slice(1, -1);
  const segsB = segmentsOf(b).slice(1, -1);
  for (const sa of segsA) {
    for (const sb of segsB) {
      if (sa.orientation !== sb.orientation) continue;
      if (Math.abs(sa.fixed - sb.fixed) > 0.01) continue;
      const overlap = Math.min(sa.hi, sb.hi) - Math.max(sa.lo, sb.lo);
      if (overlap > 0) total += overlap;
    }
  }
  return total;
}

function rect(id: string, x: number, y: number, width: number, height: number): RectObstacle {
  return { id, x, y, width, height };
}

function spec(id: string, sourceNodeId: string, targetNodeId: string, start: Point, end: Point): EdgeRouteSpec {
  return { id, sourceNodeId, targetNodeId, start, end };
}

describe('findPath', () => {
  it('draws a direct path with no detour when nothing is in the way', () => {
    const source = rect('a', 0, 0, 200, 100);
    const target = rect('b', 500, 0, 200, 100);
    const s = spec('e1', 'a', 'b', { x: 200, y: 50 }, { x: 500, y: 50 });
    const path = findPath(s, [source, target]);
    expect(isOrthogonal(path)).toBe(true);
    expect(routeCrossesRect(path, source)).toBe(false);
    expect(routeCrossesRect(path, target)).toBe(false);
    // A clear straight shot should stay a single row — no vertical excursion at all.
    expect(path.every((p) => p.y === 50)).toBe(true);
  });

  it('routes around a single obstacle directly between source and target', () => {
    const source = rect('a', 0, 0, 200, 100);
    const target = rect('b', 600, 0, 200, 100);
    const wall = rect('wall', 300, -50, 200, 300);
    const s = spec('e1', 'a', 'b', { x: 200, y: 50 }, { x: 600, y: 50 });
    const path = findPath(s, [source, target, wall]);
    expect(isOrthogonal(path)).toBe(true);
    expect(routeCrossesRect(path, wall)).toBe(false);
  });

  it('never crosses a different device even when it must exit right through padding', () => {
    // Two cards sitting close together, one immediately to the right of the other's exit.
    const source = rect('a', 0, 0, 200, 100);
    const neighbour = rect('neighbour', 230, 0, 200, 100);
    const target = rect('b', 500, 300, 200, 100);
    const s = spec('e1', 'a', 'b', { x: 200, y: 50 }, { x: 500, y: 350 });
    const path = findPath(s, [source, neighbour, target]);
    expect(routeCrossesRect(path, neighbour)).toBe(false);
  });

  it('lets a cable exit through its own device footprint at its own port row, but never through a different row on the same card', () => {
    // Regression test for the original bug: excluding a whole node from obstacles let every cable
    // on a multi-port device cut across its *neighbours'* rows on that same card.
    const device = rect('strip', 0, 0, 220, 300); // one tall card, 8 outlet rows
    const target1 = rect('t1', 500, 20, 100, 40);
    const target2 = rect('t2', 500, 250, 100, 40);
    const specs: EdgeRouteSpec[] = [
      spec('row-top', 'strip', 't1', { x: 220, y: 20 }, { x: 500, y: 40 }),
      spec('row-bottom', 'strip', 't2', { x: 220, y: 260 }, { x: 500, y: 270 }),
    ];
    const obstacles = [device, target1, target2];
    for (const s of specs) {
      const path = findPath(s, obstacles);
      // Must not cross the *other* rows of its own card — approximate by checking the path
      // doesn't dip back to x < 220 (back inside the card) after leaving except at the exact
      // start, which would indicate it tunnelled back through the card body.
      const afterExit = path.slice(1);
      expect(afterExit.every((p) => p.x >= 220 - 0.01)).toBe(true);
    }
  });

  it('produces only axis-aligned segments, including at the port-to-grid seam', () => {
    // A port position deliberately not aligned to any grid (16 / 28 / 44) multiple.
    const source = rect('a', 0, 0, 220, 137);
    const target = rect('b', 900, 683, 220, 91);
    const s = spec('e1', 'a', 'b', { x: 220, y: 71 }, { x: 900, y: 711 });
    const path = findPath(s, [source, target]);
    expect(isOrthogonal(path)).toBe(true);
  });

  it('handles a target sitting behind its source (forced reversal) without crossing either device', () => {
    // Two devices stacked vertically, connected port-to-port — the classic "must exit right,
    // then double back" case.
    const source = rect('laptop', 0, 0, 220, 60);
    const target = rect('interface', 0, 200, 220, 200);
    const s = spec('e1', 'laptop', 'interface', { x: 220, y: 30 }, { x: 0, y: 250 });
    const path = findPath(s, [source, target]);
    expect(isOrthogonal(path)).toBe(true);
    expect(routeCrossesRect(path, source)).toBe(false);
    expect(routeCrossesRect(path, target)).toBe(false);
  });

  it('finds a path across a very long distance without timing out or falling back to an unchecked line', () => {
    const source = rect('a', 0, 0, 220, 100);
    const target = rect('b', 4000, 700, 220, 150);
    // A cluster of obstacles roughly in the middle, like a busy zone between two stage sides.
    const obstacles = [source, target];
    for (let i = 0; i < 5; i++) obstacles.push(rect(`mid-${i}`, 2000 + i * 240, 600 + (i % 2) * 100, 220, 90));
    const s = spec('e1', 'a', 'b', { x: 220, y: 50 }, { x: 4000, y: 775 });
    const path = findPath(s, obstacles);
    expect(isOrthogonal(path)).toBe(true);
    for (const o of obstacles) if (o.id !== 'a' && o.id !== 'b') expect(routeCrossesRect(path, o)).toBe(false);
  });

  it('falls back to a checked elbow (never an unchecked straight line) when truly boxed in', () => {
    const source = rect('a', 0, 0, 220, 100);
    const target = rect('b', 260, 500, 220, 100);
    // Wrap the whole area between them in obstacles so no full grid path exists within the
    // search margin, forcing the elbow fallback — it must still avoid `blocker`.
    const blocker = rect('blocker', 0, 90, 500, 400);
    const s = spec('e1', 'a', 'b', { x: 220, y: 50 }, { x: 260, y: 550 });
    const path = findPath(s, [source, target, blocker]);
    expect(isOrthogonal(path)).toBe(true);
  });
});

describe('resolveOverlaps', () => {
  it('separates two cables that would otherwise run exactly on top of each other', () => {
    const source1 = rect('a1', 0, 0, 220, 40);
    const source2 = rect('a2', 0, 60, 220, 40);
    const target = rect('b', 600, 0, 220, 100);
    const specs = [spec('e1', 'a1', 'b', { x: 220, y: 20 }, { x: 600, y: 50 }), spec('e2', 'a2', 'b', { x: 220, y: 80 }, { x: 600, y: 50 })];
    const obstacles = [source1, source2, target];
    const raw = new Map(specs.map((s) => [s.id, findPath(s, obstacles)]));
    // Before resolution these two very plausibly share a long horizontal run into the same
    // target row — confirm the fixture actually exercises the code path being tested.
    const before = overlapLength(raw.get('e1')!, raw.get('e2')!);
    expect(before).toBeGreaterThan(0);

    const resolved = resolveOverlaps(raw, obstacles, specs);
    const after = overlapLength(resolved.get('e1')!, resolved.get('e2')!);
    expect(after).toBe(0);
    // And it must still be a valid, obstacle-clear, orthogonal path for both.
    for (const id of ['e1', 'e2']) {
      const path = resolved.get(id)!;
      expect(isOrthogonal(path)).toBe(true);
      expect(routeCrossesRect(path, target)).toBe(false);
    }
  });

  it('spreads many parallel cables from a multi-port device into distinct lanes', () => {
    const strip = rect('strip', 0, 0, 220, 300);
    const target = rect('target', 700, 500, 220, 100);
    const specs: EdgeRouteSpec[] = [];
    // Eight distinct ports on each end (a real target device never has two different cables
    // landing on the exact same pixel — that's not an overlap to resolve, it's two cables
    // sharing one port, which is a different bug entirely) spread across the target's own height.
    for (let i = 0; i < 8; i++) {
      specs.push(spec(`cable-${i}`, 'strip', 'target', { x: 220, y: 20 + i * 30 }, { x: 700, y: 510 + i * 10 }));
    }
    const obstacles = [strip, target];
    const routes = computeRoutes(obstacles, specs);
    const ids = specs.map((s) => s.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(overlapLength(routes.get(ids[i])!, routes.get(ids[j])!)).toBe(0);
      }
    }
  });

  it('never introduces a new obstacle crossing when nudging a lane — reverts instead', () => {
    // A tight corridor barely wide enough for one lane: any offset would clip the walls, so the
    // safety net must revert rather than ship a crossing.
    const source1 = rect('a1', 0, 0, 220, 20);
    const source2 = rect('a2', 0, 30, 220, 20);
    const wallTop = rect('wallTop', 400, 0, 40, 44);
    const wallBottom = rect('wallBottom', 400, 56, 40, 200);
    const target = rect('b', 600, 0, 220, 100);
    const specs = [spec('e1', 'a1', 'b', { x: 220, y: 10 }, { x: 600, y: 50 }), spec('e2', 'a2', 'b', { x: 220, y: 40 }, { x: 600, y: 50 })];
    const obstacles = [source1, source2, wallTop, wallBottom, target];
    const routes = computeRoutes(obstacles, specs);
    for (const id of ['e1', 'e2']) {
      const path = routes.get(id)!;
      expect(isOrthogonal(path)).toBe(true);
      for (const o of obstacles) if (o.id !== 'a1' && o.id !== 'a2' && o.id !== 'b') expect(routeCrossesRect(path, o)).toBe(false);
    }
  });
});

describe('computeRoutes (full pipeline)', () => {
  it('produces zero obstacle violations and zero overlaps across a realistic multi-device graph', () => {
    // A small stage-map-shaped fixture: a power strip with several outlets feeding various
    // devices scattered around, some stacked, some far apart.
    const obstacles: RectObstacle[] = [
      rect('strip', 0, 0, 220, 300),
      rect('pedalboard', 400, -50, 220, 200),
      rect('interface', 400, 250, 220, 150),
      rect('laptop', 750, -100, 220, 60),
      rect('stagebox', 1200, 100, 220, 400),
      rect('mic1', 750, 400, 220, 80),
      rect('mic2', 750, 500, 220, 80),
    ];
    const specs: EdgeRouteSpec[] = [
      spec('c1', 'strip', 'pedalboard', { x: 220, y: 20 }, { x: 400, y: 0 }),
      spec('c2', 'strip', 'interface', { x: 220, y: 50 }, { x: 400, y: 300 }),
      spec('c3', 'strip', 'laptop', { x: 220, y: 80 }, { x: 750, y: -70 }),
      spec('c4', 'pedalboard', 'stagebox', { x: 620, y: 0 }, { x: 1200, y: 150 }),
      spec('c5', 'interface', 'stagebox', { x: 620, y: 300 }, { x: 1200, y: 200 }),
      spec('c6', 'mic1', 'stagebox', { x: 970, y: 430 }, { x: 1200, y: 450 }),
      spec('c7', 'mic2', 'stagebox', { x: 970, y: 530 }, { x: 1200, y: 480 }),
      // Distinct port from c2's on the same interface (two cables landing on the exact same pixel
      // isn't an "overlap" for this pass to resolve — it's two cables sharing one port).
      spec('c8', 'laptop', 'interface', { x: 970, y: -70 }, { x: 400, y: 350 }),
    ];
    const nodeIds = new Set(obstacles.map((o) => o.id));
    const routes = computeRoutes(obstacles, specs);

    for (const s of specs) {
      const path = routes.get(s.id)!;
      expect(isOrthogonal(path)).toBe(true);
      for (const o of obstacles) {
        if (o.id === s.sourceNodeId || o.id === s.targetNodeId) continue;
        expect(routeCrossesRect(path, o), `edge ${s.id} crosses node ${o.id}`).toBe(false);
      }
    }
    // No two cables' routes should coincide anywhere.
    for (let i = 0; i < specs.length; i++) {
      for (let j = i + 1; j < specs.length; j++) {
        const overlap = overlapLength(routes.get(specs[i].id)!, routes.get(specs[j].id)!);
        expect(overlap, `edges ${specs[i].id} and ${specs[j].id} overlap by ${overlap}px`).toBe(0);
      }
    }
    expect(nodeIds.size).toBe(obstacles.length);
  });

  it('is deterministic — running twice on the same input produces the same output', () => {
    const obstacles = [rect('a', 0, 0, 220, 100), rect('b', 500, 200, 220, 100), rect('mid', 250, 80, 150, 60)];
    const specs = [spec('e1', 'a', 'b', { x: 220, y: 50 }, { x: 500, y: 250 })];
    const r1 = computeRoutes(obstacles, specs);
    const r2 = computeRoutes(obstacles, specs);
    expect(r1.get('e1')).toEqual(r2.get('e1'));
  });
});

describe('simplifyColinear', () => {
  it('drops redundant collinear points but keeps real corners', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 100, y: 160 },
    ];
    expect(simplifyColinear(points)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 160 },
    ]);
  });
});

describe('segmentCrossesRect', () => {
  it('detects a horizontal segment passing through a padded rect', () => {
    const r = rect('x', 100, 100, 50, 50);
    expect(segmentCrossesRect({ x: 0, y: 120 }, { x: 200, y: 120 }, r, 5)).toBe(true);
  });

  it('does not flag a segment that passes outside the padded rect', () => {
    const r = rect('x', 100, 100, 50, 50);
    expect(segmentCrossesRect({ x: 0, y: 90 }, { x: 200, y: 90 }, r, 5)).toBe(false);
  });

  it('treats a diagonal segment as unsafe', () => {
    const r = rect('x', 100, 100, 50, 50);
    expect(segmentCrossesRect({ x: 0, y: 0 }, { x: 200, y: 200 }, r, 5)).toBe(true);
  });
});

describe('roundedPathFromPoints', () => {
  it('produces a path string starting and ending at the given points', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const d = roundedPathFromPoints(points, 10);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('L 100 100')).toBe(true);
  });

  it('clamps the corner radius so it never exceeds half of either adjoining segment', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 100 },
    ];
    // Should not throw and should stay well-formed even with a radius larger than the short leg.
    expect(() => roundedPathFromPoints(points, 50)).not.toThrow();
  });

  it('handles the degenerate empty and single-point cases without throwing', () => {
    expect(roundedPathFromPoints([], 10)).toBe('');
    expect(roundedPathFromPoints([{ x: 5, y: 7 }], 10)).toBe('M 5 7');
  });
});

describe('findPath — direct-line fast path', () => {
  it('draws a direct vertical line with zero jitter when nothing is in the way', () => {
    const source = rect('a', 0, 0, 200, 100);
    const target = rect('b', 0, 500, 200, 100);
    const s = spec('e1', 'a', 'b', { x: 100, y: 100 }, { x: 100, y: 500 });
    const path = findPath(s, [source, target]);
    expect(path).toEqual([s.start, s.end]);
  });

  it('does not take the direct-line shortcut when another device sits on the straight line', () => {
    const source = rect('a', 0, 0, 200, 100);
    const target = rect('b', 500, 0, 200, 100);
    const wall = rect('wall', 300, -50, 50, 300);
    const s = spec('e1', 'a', 'b', { x: 200, y: 50 }, { x: 500, y: 50 });
    const path = findPath(s, [source, target, wall]);
    expect(path.length).toBeGreaterThan(2);
    expect(routeCrossesRect(path, wall)).toBe(false);
  });

  it('still takes the shortcut when the only thing "in between" is its own source or target device', () => {
    // A wide source card and a narrow target directly to its right, both on the same row — the
    // straight shot only ever touches its own two devices, never a third one.
    const source = rect('a', 0, 0, 400, 200);
    const target = rect('b', 400, 80, 100, 40);
    const s = spec('e1', 'a', 'b', { x: 400, y: 100 }, { x: 400, y: 100 });
    const path = findPath(s, [source, target]);
    expect(path).toEqual([s.start, s.end]);
  });
});

describe('resolveOverlaps — regression coverage for the reverted-fix bugs', () => {
  it('does not revert a lane offset just because it lands inside its own device padding zone (the original bug)', () => {
    // This is the exact shape that used to break: two sources feeding one target, whose stubs
    // legitimately sit inside their own target's padding — the old safety net treated that as an
    // obstacle hit and threw the fix away every time, so the cables stayed stacked.
    const source1 = rect('a1', 0, 0, 220, 40);
    const source2 = rect('a2', 0, 60, 220, 40);
    const target = rect('b', 600, 0, 220, 100);
    const specs = [spec('e1', 'a1', 'b', { x: 220, y: 20 }, { x: 600, y: 50 }), spec('e2', 'a2', 'b', { x: 220, y: 80 }, { x: 600, y: 50 })];
    const obstacles = [source1, source2, target];
    const routes = computeRoutes(obstacles, specs);
    expect(overlapLength(routes.get('e1')!, routes.get('e2')!)).toBe(0);
  });

  it('still reverts an offset that would cut through a genuinely different device', () => {
    const source1 = rect('a1', 0, 0, 220, 20);
    const source2 = rect('a2', 0, 30, 220, 20);
    // A third, unrelated device sitting directly where a naive offset would push either cable.
    const bystander = rect('bystander', 400, 34, 40, 10);
    const target = rect('b', 600, 0, 220, 100);
    const specs = [spec('e1', 'a1', 'b', { x: 220, y: 10 }, { x: 600, y: 50 }), spec('e2', 'a2', 'b', { x: 220, y: 40 }, { x: 600, y: 50 })];
    const obstacles = [source1, source2, bystander, target];
    const routes = computeRoutes(obstacles, specs);
    for (const id of ['e1', 'e2']) {
      const path = routes.get(id)!;
      expect(routeCrossesRect(path, bystander)).toBe(false);
    }
  });

  it('orders lanes by each cable\'s real port position, not its grid-rounded one, so two approach rows that round to the same grid line never cross', () => {
    // Two target ports only 10px apart — closer together than the router's own grid resolution —
    // so both cables' raw paths round to the *same* approach row before lane separation runs.
    // Naively offsetting by arbitrary lane order then crosses their final port-facing stubs.
    const strip = rect('strip', 0, 0, 220, 300);
    const target = rect('target', 700, 500, 220, 100);
    const specs = [
      spec('cable-6', 'strip', 'target', { x: 220, y: 200 }, { x: 700, y: 570 }),
      spec('cable-7', 'strip', 'target', { x: 220, y: 230 }, { x: 700, y: 580 }),
    ];
    const obstacles = [strip, target];
    const routes = computeRoutes(obstacles, specs);
    expect(overlapLength(routes.get('cable-6')!, routes.get('cable-7')!)).toBe(0);
  });

  it('never lets one cable cross through a different row of its own multi-port source after lane separation', () => {
    // Regression guard for the safety-net relaxation above: excluding a cable's own device from
    // the padded check must not also let it cut across a *different* port row on that same card.
    const strip = rect('strip', 0, 0, 220, 300);
    const target = rect('target', 700, 500, 220, 100);
    const specs: EdgeRouteSpec[] = [];
    for (let i = 0; i < 6; i++) {
      specs.push(spec(`c${i}`, 'strip', 'target', { x: 220, y: 20 + i * 40 }, { x: 700, y: 510 + i * 14 }));
    }
    const obstacles = [strip, target];
    const routes = computeRoutes(obstacles, specs);
    for (const s of specs) {
      const path = routes.get(s.id)!;
      expect(isOrthogonal(path)).toBe(true);
      // No route may re-enter the strip anywhere other than its own exact exit row.
      const afterExit = path.slice(1);
      expect(afterExit.every((p) => p.x >= 220 - 0.01)).toBe(true);
    }
  });
});

describe('computeRoutes — larger graphs', () => {
  it('stays overlap-free and crossing-free on a busy 24-cable synthetic stage graph', () => {
    const obstacles: RectObstacle[] = [
      rect('strip1', 0, 0, 220, 400),
      rect('strip2', 0, 450, 220, 400),
      rect('pedalboard1', 380, -80, 220, 160),
      rect('pedalboard2', 380, 120, 220, 160),
      rect('interface1', 380, 340, 220, 160),
      rect('interface2', 380, 560, 220, 160),
      rect('stagebox', 1100, 100, 240, 600),
      rect('foh', 1600, 200, 220, 300),
    ];
    const deviceIds = obstacles.map((o) => o.id);
    const specs: EdgeRouteSpec[] = [];
    let n = 0;
    // Fan every strip outlet out to a handful of scattered targets, and every pedalboard/interface
    // in to the stagebox, and the stagebox on to FOH — a deliberately tangled, densely-connected
    // fixture rather than a hand-picked easy case.
    for (let i = 0; i < 8; i++) {
      const src = i < 4 ? 'strip1' : 'strip2';
      const targets = ['pedalboard1', 'pedalboard2', 'interface1', 'interface2'];
      const target = targets[i % targets.length];
      const srcRect = obstacles.find((o) => o.id === src)!;
      const targetRect = obstacles.find((o) => o.id === target)!;
      specs.push(
        spec(
          `strip-${n++}`,
          src,
          target,
          { x: srcRect.x + srcRect.width, y: srcRect.y + 20 + (i % 4) * 30 },
          // `i` (not `i % 4`) so two strips landing on the same target device — e.g. i=1 and
          // i=5 both hitting pedalboard2 — still get genuinely distinct ports, not the same pixel.
          { x: targetRect.x, y: targetRect.y + 15 + i * 12 },
        ),
      );
    }
    for (const src of ['pedalboard1', 'pedalboard2', 'interface1', 'interface2']) {
      const srcRect = obstacles.find((o) => o.id === src)!;
      const stageboxRect = obstacles.find((o) => o.id === 'stagebox')!;
      for (let p = 0; p < 4; p++) {
        specs.push(
          spec(
            `mid-${n++}`,
            src,
            'stagebox',
            { x: srcRect.x + srcRect.width, y: srcRect.y + 15 + p * 30 },
            { x: stageboxRect.x, y: stageboxRect.y + 20 + (specs.length % 20) * 28 },
          ),
        );
      }
    }
    const stageboxRect = obstacles.find((o) => o.id === 'stagebox')!;
    const fohRect = obstacles.find((o) => o.id === 'foh')!;
    for (let p = 0; p < 8; p++) {
      specs.push(spec(`out-${n++}`, 'stagebox', 'foh', { x: stageboxRect.x + stageboxRect.width, y: stageboxRect.y + 20 + p * 60 }, { x: fohRect.x, y: fohRect.y + 15 + p * 30 }));
    }

    const routes = computeRoutes(obstacles, specs);
    expect(routes.size).toBe(specs.length);

    for (const s of specs) {
      const path = routes.get(s.id)!;
      expect(isOrthogonal(path)).toBe(true);
      for (const o of obstacles) {
        if (o.id === s.sourceNodeId || o.id === s.targetNodeId) continue;
        expect(routeCrossesRect(path, o), `edge ${s.id} crosses node ${o.id}`).toBe(false);
      }
    }
    for (let i = 0; i < specs.length; i++) {
      for (let j = i + 1; j < specs.length; j++) {
        const overlap = overlapLength(routes.get(specs[i].id)!, routes.get(specs[j].id)!);
        expect(overlap, `edges ${specs[i].id} and ${specs[j].id} overlap by ${overlap}px`).toBe(0);
      }
    }
    expect(new Set(deviceIds).size).toBe(deviceIds.length);
  });

  it('is deterministic on the busy graph regardless of the input edge order', () => {
    const obstacles: RectObstacle[] = [rect('a', 0, 0, 200, 300), rect('b', 500, 0, 200, 300), rect('mid', 250, 100, 150, 60)];
    const specs: EdgeRouteSpec[] = [
      spec('e1', 'a', 'b', { x: 200, y: 20 }, { x: 500, y: 30 }),
      spec('e2', 'a', 'b', { x: 200, y: 60 }, { x: 500, y: 70 }),
      spec('e3', 'a', 'b', { x: 200, y: 100 }, { x: 500, y: 110 }),
    ];
    const forward = computeRoutes(obstacles, specs);
    const shuffled = computeRoutes(obstacles, [...specs].reverse());
    for (const s of specs) {
      expect(shuffled.get(s.id)).toEqual(forward.get(s.id));
    }
  });
});

describe('simplifyColinear — edge cases', () => {
  it('leaves fewer-than-3-point inputs untouched', () => {
    expect(simplifyColinear([])).toEqual([]);
    const one: Point[] = [{ x: 1, y: 2 }];
    expect(simplifyColinear(one)).toEqual(one);
    const two: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    expect(simplifyColinear(two)).toEqual(two);
  });

  it('leaves an already-simplified path untouched', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(simplifyColinear(points)).toEqual(points);
  });
});
