import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { reviewDateLabel } from '../calendarTime';
import { offScheduleRunLabel, offScheduleRunSentence, type OffScheduleRun } from '../offScheduleRuns';

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
vi.mock('../../module-builder/moduleAuthoringData', () => ({
  loadTeamsOffScheduleRuns: vi.fn(async (liveSessionId: string) => ({
    liveSessionId, timeZoneIana: 'Europe/London',
    occurrences: { 'OCC-1': [early] },
  })),
}));

const early: OffScheduleRun = {
  runStartUtc: '2026-10-26T11:40:00+00:00', runEndUtc: '2026-10-26T11:52:00+00:00',
  scheduledStartUtc: '2026-10-30T14:00:00+00:00', reason: 'before_session',
};
const when = (iso: string) => reviewDateLabel(iso, 'Europe/London');

describe('a Teams call on a session link that was not the session', () => {
  it('says when it was, when the session is, and that it counts for nothing', () => {
    const sentence = offScheduleRunSentence(early, when);
    expect(sentence).toContain('Mon, 26 Oct 2026');
    expect(sentence).toContain('before this session (Fri, 30 Oct 2026');
    expect(sentence).toContain('Teams shows the meeting as held then.');
    expect(sentence).toContain('no attendance or recording is attached to it');
  });

  it('names a later use and a check of the room for what they are', () => {
    expect(offScheduleRunSentence({ ...early, reason: 'after_session' }, when)).toContain('more than 12 hours after this session');
    expect(offScheduleRunSentence({ ...early, reason: 'test_open' }, when)).toContain('a check of the room');
    expect(offScheduleRunLabel([early])).toBe('A Teams call on another day was ignored');
    expect(offScheduleRunLabel([early, early])).toBe('2 Teams calls on other days were ignored');
    expect(offScheduleRunLabel([])).toBe('');
  });

  it('is found for the week whose live session it was', async () => {
    const { useOffScheduleRuns } = await import('../../module-builder/useOffScheduleRuns');
    const module = { weekStructure: [
      { id: 'W1', components: [{ type: 'live-session', settings: { teamsLiveSessionId: 'LIVE-1', teamsOccurrenceId: 'OCC-1' } }] },
      { id: 'W2', components: [{ type: 'live-session', settings: { teamsLiveSessionId: 'LIVE-1', teamsOccurrenceId: 'OCC-2' } }] },
    ] };
    const { result } = renderHook(() => useOffScheduleRuns(module));
    await waitFor(() => expect(result.current.get('W1')?.runs).toEqual([early]));
    expect(result.current.has('W2')).toBe(false);
    expect(result.current.get('W1')?.timeZone).toBe('Europe/London');
  });
});
