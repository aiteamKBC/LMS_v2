import { describe, expect, it, vi } from 'vitest';
import { formatDate, matchesSessionGroup, sessionGroups } from "../page.helpers";

describe('session calendar date keys', () => {
  it('keeps a calendar cell on its local day instead of shifting it through UTC', () => {
    const localThursday = new Date(2026, 7, 6);

    // Cairo midnight is the previous UTC date. The calendar must not use that
    // UTC value as the key that it compares with the API's date-only string.
    vi.spyOn(localThursday, 'toISOString').mockReturnValue('2026-08-05T21:00:00.000Z');

    expect(formatDate(localThursday)).toBe('2026-08-06');
  });
});

describe('session calendar group filters', () => {
  it('matches complete group names instead of matching G1 inside G10', () => {
    expect(matchesSessionGroup('G10', 'G1')).toBe(false);
    expect(matchesSessionGroup('G1, G10', 'G1')).toBe(true);
    expect(matchesSessionGroup('G10', 'all')).toBe(true);
  });

  it('uses the same trimmed multi-group names for options and filtering', () => {
    expect(sessionGroups('G1,G2, G10, ')).toEqual(['G1', 'G2', 'G10']);
    expect(matchesSessionGroup('G1,G2, G10', 'G2')).toBe(true);
    expect(matchesSessionGroup('G1,G2, G10', 'G3')).toBe(false);
  });
});
