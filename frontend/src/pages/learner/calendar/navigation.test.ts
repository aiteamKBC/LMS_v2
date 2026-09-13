import { describe, expect, it } from 'vitest';
import { moveCalendarDate } from './navigation';

describe('calendar navigation boundaries', () => {
  it.each([
    ['weekly', '2026-12-28', 1, '2027-01-04'],
    ['weekly', '2027-01-04', -1, '2026-12-28'],
    ['monthly', '2026-01-31', 1, '2026-02-28'],
    ['monthly', '2028-01-31', 1, '2028-02-29'],
    ['monthly', '2026-03-31', -1, '2026-02-28'],
    ['daily', '2026-12-31', 1, '2027-01-01'],
  ] as const)('%s %s %+d stays in the requested period', (view, source, direction, expected) => {
    const result = moveCalendarDate(new Date(`${source}T12:00:00`), view, direction);
    expect(result.getFullYear()).toBe(Number(expected.slice(0, 4)));
    expect(result.getMonth() + 1).toBe(Number(expected.slice(5, 7)));
    expect(result.getDate()).toBe(Number(expected.slice(8, 10)));
  });
});
