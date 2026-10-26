import { describe, expect, it } from 'vitest';
import { readLocation, writeLocation } from './location';
describe('Coach meeting URL state', () => {
  it('roundtrips the filters, occurrence day and open evidence tab without a signed access token', () => {
    const query = new URLSearchParams('date=2026-10-20&view=week&zone=UTC&coach=coach%40example.invalid&learner=7&status=all&type=PR&match=review&lectures=1&meeting=' + 'a'.repeat(32) + '&on=2026-10-23&tab=analysis');
    expect(readLocation(writeLocation(readLocation(query)))).toEqual(readLocation(query));
    expect(writeLocation(readLocation(query)).has('reference')).toBe(false);
  });
  it('rejects invalid dates/options and drops the tab when the meeting closes', () => {
    const state = readLocation(new URLSearchParams('date=2026-02-30&view=bad&zone=bad&status=bad&type=LECTURE&tab=bad'));
    expect(state.date).not.toBe('2026-02-30'); expect(state.period).toBe('day'); expect(state.phase).toBe('ready'); expect(state.family).toBe('all');
    const closed = writeLocation({ ...state, meeting: '', tab: 'analysis' });
    expect(closed.has('tab')).toBe(false); expect(closed.has('on')).toBe(false);
  });
  it('retains another user’s valid IANA time zone when the shared link is opened elsewhere', () => {
    expect(readLocation(new URLSearchParams('date=2026-10-20&zone=America%2FNew_York')).zone).toBe('America/New_York');
  });
});
