import { describe, expect, it } from 'vitest';
import {
    buildCenterMap,
    countCrossings,
    greedySwapMinimize,
    resolveNodeOverlaps,
    segmentsIntersect,
} from './crossings';

// ---------------------------------------------------------------------------
// segmentsIntersect
// ---------------------------------------------------------------------------

describe('segmentsIntersect', () => {
  it('detects a simple X cross', () => {
    expect(segmentsIntersect({ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 2 })).toBe(true);
  });

  it('detects diagonal cross', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(true);
  });

  it('returns false for parallel horizontal segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 })).toBe(false);
  });

  it('returns false for non-crossing T-shape', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 })).toBe(false);
  });

  it('returns boolean for shared endpoint segments', () => {
    const result = segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 });
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// countCrossings
// ---------------------------------------------------------------------------

describe('countCrossings', () => {
  it('counts 1 crossing for two diagonal cables', () => {
    const centers = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 100, y: 0 }],
      ['C', { x: 0, y: 100 }],
      ['D', { x: 100, y: 100 }],
    ]);
    const edges: [string, string][] = [['A', 'D'], ['B', 'C']];
    expect(countCrossings(edges, centers)).toBe(1);
  });

  it('counts 0 crossings for two non-crossing cables', () => {
    const centers = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 100, y: 0 }],
      ['C', { x: 0, y: 100 }],
      ['D', { x: 100, y: 100 }],
    ]);
    const edges: [string, string][] = [['A', 'B'], ['C', 'D']];
    expect(countCrossings(edges, centers)).toBe(0);
  });

  it('ignores edges sharing a node', () => {
    const centers = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 100, y: 0 }],
      ['C', { x: 50, y: 100 }],
    ]);
    const edges: [string, string][] = [['A', 'C'], ['B', 'C']];
    expect(countCrossings(edges, centers)).toBe(0);
  });

  it('counts multiple crossings', () => {
    const centers = new Map([
      ['A', { x: 0, y: 50 }],
      ['B', { x: 50, y: 0 }],
      ['C', { x: 50, y: 100 }],
      ['D', { x: 100, y: 50 }],
      ['E', { x: 0, y: 0 }],
      ['F', { x: 100, y: 100 }],
    ]);
    const edges: [string, string][] = [['A', 'D'], ['B', 'C'], ['E', 'F']];
    expect(countCrossings(edges, centers)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// greedySwapMinimize
// ---------------------------------------------------------------------------

describe('greedySwapMinimize', () => {
  it('reduces crossings by swapping node positions', () => {
    const sizes = new Map([
      ['P', { width: 0, height: 0 }],
      ['Q', { width: 0, height: 0 }],
      ['R', { width: 0, height: 0 }],
      ['S', { width: 0, height: 0 }],
    ]);
    const positions = new Map([
      ['P', { x: 0, y: 0 }],
      ['Q', { x: 200, y: 0 }],
      ['R', { x: 0, y: 200 }],
      ['S', { x: 200, y: 200 }],
    ]);
    const edges: [string, string][] = [['P', 'S'], ['Q', 'R']];

    const before = countCrossings(edges, buildCenterMap(positions, sizes));
    expect(before).toBe(1);

    greedySwapMinimize(['P', 'Q', 'R', 'S'], edges, positions, sizes);

    const after = countCrossings(edges, buildCenterMap(positions, sizes));
    expect(after).toBe(0);
  });

  it('leaves positions unchanged when no swap helps', () => {
    const sizes = new Map([
      ['A', { width: 0, height: 0 }],
      ['B', { width: 0, height: 0 }],
    ]);
    const positions = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 200, y: 0 }],
    ]);
    const initialA = { ...positions.get('A')! };
    const initialB = { ...positions.get('B')! };

    greedySwapMinimize(['A', 'B'], [['A', 'B']], positions, sizes);

    expect(positions.get('A')).toEqual(initialA);
    expect(positions.get('B')).toEqual(initialB);
  });

  it('returns positions unchanged when no edges provided', () => {
    const sizes = new Map([['X', { width: 0, height: 0 }], ['Y', { width: 0, height: 0 }]]);
    const positions = new Map([['X', { x: 0, y: 0 }], ['Y', { x: 100, y: 0 }]]);
    greedySwapMinimize(['X', 'Y'], [], positions, sizes);
    expect(positions.get('X')).toEqual({ x: 0, y: 0 });
    expect(positions.get('Y')).toEqual({ x: 100, y: 0 });
  });
});

describe('resolveNodeOverlaps', () => {
  it('separates two identical-position cards', () => {
    const sizes = new Map([
      ['A', { width: 200, height: 100 }],
      ['B', { width: 200, height: 100 }],
    ]);
    const positions = new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 0, y: 0 }],
    ]);
    resolveNodeOverlaps(['A', 'B'], positions, sizes, 40);
    const a = positions.get('A')!;
    const b = positions.get('B')!;
    const gap = 40;
    const overlapX =
      Math.min(a.x + 200 + gap, b.x + 200 + gap) - Math.max(a.x, b.x);
    const overlapY =
      Math.min(a.y + 100 + gap, b.y + 100 + gap) - Math.max(a.y, b.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });
});
