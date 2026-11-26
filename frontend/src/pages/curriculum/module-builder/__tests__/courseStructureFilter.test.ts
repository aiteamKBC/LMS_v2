import { describe, expect, it } from 'vitest';
import { componentTypeCounts, mergeFilteredComponents } from '../courseStructureFilter';

const c = (id: string, type: string) => ({ id, type });

describe('Course structure type filter', () => {
  it('counts every type across all weeks, in authoring order', () => {
    const counts = componentTypeCounts([
      { components: [c('a', 'reading'), c('b', 'live-session')] },
      { components: [c('c', 'live-session'), c('d', 'video')] },
    ]);
    expect(counts.map(item => [item.type, item.count])).toEqual([['live-session', 2], ['video', 1], ['reading', 1]]);
    expect(counts.find(item => item.type === 'reading')?.label).toBe('Reading Material');
  });

  const week = [c('r1', 'reading'), c('l1', 'live-session'), c('v1', 'video'), c('l2', 'live-session'), c('r2', 'reading')];
  const shown = new Set(['l1', 'l2']);

  it('reorders the shown components in their own slots and leaves the rest alone', () => {
    const merged = mergeFilteredComponents(week, shown, [week[3], week[1]]);
    expect(merged.map(item => item.id)).toEqual(['r1', 'l2', 'v1', 'l1', 'r2']);
  });

  it('a delete removes only that component', () => {
    expect(mergeFilteredComponents(week, shown, [week[3]]).map(item => item.id)).toEqual(['r1', 'v1', 'l2', 'r2']);
  });

  it('a duplicate follows the last shown component and nothing hidden is lost', () => {
    const copy = c('l2-copy', 'live-session');
    expect(mergeFilteredComponents(week, shown, [week[1], week[3], copy]).map(item => item.id))
      .toEqual(['r1', 'l1', 'v1', 'l2', 'l2-copy', 'r2']);
  });
});
