import { describe, expect, it } from 'vitest';
import { closerFace, pickBestNipplePath, preferredSides } from './nippleRouting';
import type { NodeBox } from './pathAvoidNodes';

function fakeNode(
  id: string,
  box: NodeBox,
  handles: { id: string; kind: 'source' | 'target'; side: 'left' | 'right'; y: number }[],
) {
  const src: { id: string; x: number; y: number; width: number; height: number; position: string }[] = [];
  const tgt: typeof src = [];
  for (const h of handles) {
    const x = h.side === 'right' ? box.width - 4 : 0;
    const entry = {
      id: h.id,
      x,
      y: h.y - box.y - 4,
      width: 8,
      height: 8,
      position: h.side,
    };
    if (h.kind === 'source') src.push(entry);
    else tgt.push(entry);
  }
  return {
    id,
    internals: {
      positionAbsolute: { x: box.x, y: box.y },
      handleBounds: { source: src, target: tgt },
    },
    measured: { width: box.width, height: box.height },
  };
}

describe('closerFace / preferredSides', () => {
  it('picks the face geometrically closer to the other card', () => {
    const box = { x: 0, width: 240 };
    expect(closerFace(box, 500)).toBe('right');
    expect(closerFace(box, -100)).toBe('left');
  });

  it('faces right→left when target is to the right', () => {
    expect(preferredSides(0, 500, 100, 100)).toEqual({ source: 'right', target: 'left' });
    expect(
      preferredSides(120, 720, 100, 100, { x: 0, width: 240 }, { x: 600, width: 240 }),
    ).toEqual({ source: 'right', target: 'left' });
  });

  it('faces left→right when target is to the left', () => {
    expect(preferredSides(500, 0, 100, 100)).toEqual({ source: 'left', target: 'right' });
  });
});

describe('pickBestNipplePath', () => {
  it('ALWAYS picks nearer L/R nipples for a clear free-air hop (not the far side)', () => {
    const sourceBox: NodeBox = { id: 's', x: 0, y: 0, width: 240, height: 200 };
    const targetBox: NodeBox = { id: 't', x: 600, y: 40, width: 240, height: 200 };
    const boxes = [sourceBox, targetBox];

    const sNode = fakeNode('s', sourceBox, [
      { id: 'p1', kind: 'source', side: 'right', y: 80 },
      { id: 'p1-src-left', kind: 'source', side: 'left', y: 80 },
    ]);
    const tNode = fakeNode('t', targetBox, [
      { id: 'p2', kind: 'target', side: 'left', y: 120 },
      { id: 'p2-tgt-right', kind: 'target', side: 'right', y: 120 },
    ]);

    // Dummy WASM path that would attach poorly — simple should win.
    const wasm = [
      { x: 0, y: 80 },
      { x: -100, y: 80 },
      { x: -100, y: 400 },
      { x: 900, y: 400 },
      { x: 900, y: 120 },
      { x: 840, y: 120 },
    ];

    const best = pickBestNipplePath(wasm, sNode, tNode, 'p1', 'p2', boxes);
    expect(best).not.toBeNull();
    // Nearer nipples: source right face, target left face — NEVER the far sides.
    expect(best!.sourceSide).toBe('right');
    expect(best!.targetSide).toBe('left');
    expect(best!.sourceHandle).toBe('p1');
    expect(best!.targetHandle).toBe('p2');
    // Short free-air hop — not the long WASM wrap via y=400.
    const maxY = Math.max(...best!.path.map((p) => p.y));
    const len = best!.path.reduce((n, p, i, arr) => {
      if (i === 0) return 0;
      return n + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y);
    }, 0);
    expect(maxY).toBeLessThan(250);
    expect(len).toBeLessThan(700);
  });

  it('picks nearer nipples even when edge was previously attached to the far side', () => {
    const sourceBox: NodeBox = { id: 's', x: 1000, y: 0, width: 240, height: 200 };
    const targetBox: NodeBox = { id: 't', x: 0, y: 20, width: 240, height: 200 };
    const boxes = [sourceBox, targetBox];

    const sNode = fakeNode('s', sourceBox, [
      { id: 'p1', kind: 'source', side: 'right', y: 90 },
      { id: 'p1-src-left', kind: 'source', side: 'left', y: 90 },
    ]);
    const tNode = fakeNode('t', targetBox, [
      { id: 'p2', kind: 'target', side: 'left', y: 100 },
      { id: 'p2-tgt-right', kind: 'target', side: 'right', y: 100 },
    ]);

    // Call with far-side handle ids (as if RF still held the wrong attachment).
    const best = pickBestNipplePath(
      [
        { x: 1240, y: 90 },
        { x: 1300, y: 90 },
        { x: 1300, y: 500 },
        { x: -50, y: 500 },
        { x: -50, y: 100 },
        { x: 0, y: 100 },
      ],
      sNode,
      tNode,
      'p1', // right — far from target on the left
      'p2', // left — far from source on the right
      boxes,
    );
    expect(best).not.toBeNull();
    // Source is to the right of target → source left, target right.
    expect(best!.sourceSide).toBe('left');
    expect(best!.targetSide).toBe('right');
  });

  it('prefers a short same-side path over a long facing detour when bodies block the middle', () => {
    const sourceBox: NodeBox = { id: 's', x: 0, y: 0, width: 240, height: 200 };
    const targetBox: NodeBox = { id: 't', x: 800, y: 0, width: 240, height: 200 };
    // Wall of obstacles between them at mid height.
    const wall: NodeBox = { id: 'wall', x: 300, y: 0, width: 200, height: 400 };
    const boxes = [sourceBox, targetBox, wall];

    const sNode = fakeNode('s', sourceBox, [
      { id: 'p1', kind: 'source', side: 'right', y: 100 },
      { id: 'p1-src-left', kind: 'source', side: 'left', y: 100 },
    ]);
    const tNode = fakeNode('t', targetBox, [
      { id: 'p2', kind: 'target', side: 'left', y: 100 },
      { id: 'p2-tgt-right', kind: 'target', side: 'right', y: 100 },
    ]);

    const wasm = [
      { x: 0, y: 100 },
      { x: -40, y: 100 },
      { x: -40, y: 500 },
      { x: 1080, y: 500 },
      { x: 1080, y: 100 },
      { x: 1040, y: 100 },
    ];

    const best = pickBestNipplePath(wasm, sNode, tNode, 'p1', 'p2', boxes);
    expect(best).not.toBeNull();
    // Must not tunnel the wall — path clear of wall body.
    for (let i = 0; i < best!.path.length - 1; i++) {
      const a = best!.path[i];
      const b = best!.path[i + 1];
      if (Math.abs(a.y - b.y) < 0.5 && a.y > 10 && a.y < 390) {
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const throughWall = x0 < 500 && x1 > 300;
        expect(throughWall).toBe(false);
      }
    }
  });
});
