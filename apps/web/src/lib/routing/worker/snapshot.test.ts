import { describe, expect, it } from 'vitest';
import { hasCompleteRouteSnapshot } from './snapshot';

const edges = [{ id: 'one' }, { id: 'two' }];

describe('hasCompleteRouteSnapshot', () => {
  it('accepts an empty graph', () => {
    expect(hasCompleteRouteSnapshot([], {})).toBe(true);
  });

  it('rejects a partial worker result', () => {
    expect(hasCompleteRouteSnapshot(edges, { one: { path: 'M 0 0 L 1 1' } })).toBe(false);
  });

  it('rejects blank paths', () => {
    expect(
      hasCompleteRouteSnapshot(edges, {
        one: { path: 'M 0 0 L 1 1' },
        two: { path: '   ' },
      }),
    ).toBe(false);
  });

  it('accepts a complete worker result', () => {
    expect(
      hasCompleteRouteSnapshot(edges, {
        one: { path: 'M 0 0 L 1 1' },
        two: { path: 'M 1 1 L 2 2' },
      }),
    ).toBe(true);
  });
});
