import { describe, expect, it } from 'vitest';
import type { Point } from '../types';
import { mergeRouteCache } from './route-cache';

const path = (...coordinates: Array<[number, number]>): Point[] =>
  coordinates.map(([x, y]) => ({ x, y }));

describe('mergeRouteCache', () => {
  it('retains routes omitted by a temporary filter', () => {
    const hiddenRoute = path([0, 0], [20, 0]);
    const visibleRoute = path([0, 10], [30, 10]);

    const merged = mergeRouteCache(
      new Map([
        ['hidden', hiddenRoute],
        ['visible', path([0, 5], [10, 5])],
      ]),
      new Map([['visible', visibleRoute]]),
    );

    expect(merged.get('hidden')).toBe(hiddenRoute);
    expect(merged.get('visible')).toBe(visibleRoute);
  });

  it('does not mutate the previous cache', () => {
    const previous = new Map([['edge', path([0, 0], [10, 0])]]);
    const next = mergeRouteCache(previous, new Map([['edge', path([0, 0], [20, 0])]]));

    expect(next).not.toBe(previous);
    expect(previous.get('edge')?.[1].x).toBe(10);
    expect(next.get('edge')?.[1].x).toBe(20);
  });
});
