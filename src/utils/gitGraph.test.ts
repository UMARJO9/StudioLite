import { describe, expect, it } from 'vitest';
import { layoutGraph, type GraphCommit, type GraphEdge } from './gitGraph';

const c = (hash: string, ...parents: string[]): GraphCommit => ({ hash, parents });

/** Edges as `from>to` strings, order-independent. */
const shape = (edges: GraphEdge[]) => edges.map((e) => `${e.from}>${e.to}`).sort();

describe('layoutGraph', () => {
  it('returns nothing for an empty history', () => {
    expect(layoutGraph([])).toEqual({ rows: [], laneCount: 0 });
  });

  it('keeps a linear history in a single lane', () => {
    const { rows, laneCount } = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')]);

    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(new Set(rows.map((r) => r.color)).size).toBe(1);

    // The tip has nothing above it, the root has nothing below it.
    expect(rows[0].top).toEqual([]);
    expect(shape(rows[0].bottom)).toEqual(['0>0']);
    expect(shape(rows[1].top)).toEqual(['0>0']);
    expect(shape(rows[1].bottom)).toEqual(['0>0']);
    expect(shape(rows[2].top)).toEqual(['0>0']);
    expect(rows[2].bottom).toEqual([]);
  });

  it('opens a second lane for a merged branch and closes it at the fork point', () => {
    // m merges b into a; both a and b start from r.
    const { rows, laneCount } = layoutGraph([c('m', 'a', 'b'), c('b', 'r'), c('a', 'r'), c('r')]);
    const [m, b, a, r] = rows;

    expect(laneCount).toBe(2);
    expect(m.lane).toBe(0);
    expect(shape(m.bottom)).toEqual(['0>0', '0>1']);

    expect(b.lane).toBe(1);
    expect(b.color).not.toBe(m.color);
    expect(shape(b.top)).toEqual(['0>0', '1>1']);
    expect(shape(b.bottom)).toEqual(['0>0', '1>1']);

    // The first-parent line stays in lane 0; the side branch bends back into it.
    expect(a.lane).toBe(0);
    expect(a.color).toBe(m.color);
    expect(shape(a.bottom)).toEqual(['0>0', '1>0']);

    expect(r.lane).toBe(0);
    expect(shape(r.top)).toEqual(['0>0']);
    expect(r.bottom).toEqual([]);
  });

  it('draws the merged branch in its own colour on the merge edge', () => {
    const { rows } = layoutGraph([c('m', 'a', 'b'), c('b', 'r'), c('a', 'r'), c('r')]);
    const mergeEdge = rows[0].bottom.find((e) => e.to === 1);
    expect(mergeEdge?.color).toBe(rows[1].color);
  });

  it('places unrelated parallel branches side by side', () => {
    const { rows, laneCount } = layoutGraph([
      c('x2', 'x1'),
      c('y2', 'y1'),
      c('x1', 'x0'),
      c('y1', 'y0'),
      c('x0'),
      c('y0'),
    ]);

    expect(laneCount).toBe(2);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(rows[0].color).not.toBe(rows[1].color);

    // y's lane passes straight through x's rows.
    expect(shape(rows[2].top)).toEqual(['0>0', '1>1']);
    expect(shape(rows[2].bottom)).toEqual(['0>0', '1>1']);
    // x ends at x0; only y's lane continues below it.
    expect(shape(rows[4].bottom)).toEqual(['1>1']);
    expect(shape(rows[5].top)).toEqual(['1>1']);
  });

  it('joins several branch tips into their common parent', () => {
    // main, f1 and f2 all branch from base.
    const { rows, laneCount } = layoutGraph([
      c('main', 'base'),
      c('f1', 'base'),
      c('f2', 'base'),
      c('base', 'root'),
      c('root'),
    ]);

    // f1 sees a lane to its parent on the left and bends into it right away,
    // which frees lane 1 for f2.
    expect(laneCount).toBe(2);
    expect(rows.slice(0, 3).map((r) => r.lane)).toEqual([0, 1, 1]);
    expect(shape(rows[1].bottom)).toEqual(['0>0', '1>0']);
    expect(shape(rows[2].bottom)).toEqual(['0>0', '1>0']);
    expect(rows[1].color).not.toBe(rows[2].color);
    expect(rows[3].lane).toBe(0);
    expect(shape(rows[3].top)).toEqual(['0>0']);
    expect(rows[4].lane).toBe(0);
  });

  it('reuses a lane after its branch has ended', () => {
    const { rows, laneCount } = layoutGraph([
      c('m2', 'm1', 'b1'),
      c('b1', 'm1'),
      c('m1', 'm0', 'a1'),
      c('a1', 'm0'),
      c('m0'),
    ]);

    expect(laneCount).toBe(2);
    expect(rows.find((r) => r.hash === 'b1')?.lane).toBe(1);
    expect(rows.find((r) => r.hash === 'a1')?.lane).toBe(1);
    expect(rows.find((r) => r.hash === 'b1')?.color).not.toBe(
      rows.find((r) => r.hash === 'a1')?.color,
    );
  });

  it('keeps lanes open for parents that are not loaded yet', () => {
    // A page cut in the middle of history: both parents are beyond the limit.
    const { rows } = layoutGraph([c('m', 'p1', 'p2')]);
    expect(shape(rows[0].bottom)).toEqual(['0>0', '0>1']);
  });

  it('handles an octopus merge', () => {
    const { rows, laneCount } = layoutGraph([c('o', 'a', 'b', 'd'), c('a'), c('b'), c('d')]);
    expect(laneCount).toBe(3);
    expect(shape(rows[0].bottom)).toEqual(['0>0', '0>1', '0>2']);
    expect(rows.slice(1).map((r) => r.lane)).toEqual([0, 1, 2]);
  });
});
