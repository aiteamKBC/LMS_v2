import { beforeEach, describe, expect, it } from 'vitest';
import type { TimeTrackingSession } from '@/api/timeTracking';
import {
  activityTimerStorageKey,
  canResumeActivityTimer,
  clearActivityTimer,
  readActivityTimer,
  saveActivityTimerElapsed,
  saveActivityTimerSession,
} from '../activityTimer';

const startedAt = '2026-08-29T12:00:00.000Z';
const session: TimeTrackingSession = {
  trackingToken: 'signed-token',
  startedAt,
  sessionId: 'session-1',
  countingMode: 'visible_page',
};

describe('activityTimer', () => {
  beforeEach(() => localStorage.clear());

  it('stores elapsed seconds and the signed session across reads', () => {
    const key = activityTimerStorageKey('apprenticeship', '98', 'component-1');
    saveActivityTimerSession(key, session);
    saveActivityTimerElapsed(key, 15);

    expect(readActivityTimer(key)).toEqual({ elapsedSeconds: 15, session });
  });

  it('keeps elapsed seconds when the session arrives after the counter starts', () => {
    const key = activityTimerStorageKey('commercial', '12', 'component-2');
    saveActivityTimerElapsed(key, 3);
    saveActivityTimerSession(key, session);

    expect(readActivityTimer(key)).toEqual({ elapsedSeconds: 3, session });
  });

  it('only resumes a matching, unexpired session', () => {
    const timer = { elapsedSeconds: 15, session };
    const shortlyAfterStart = Date.parse(startedAt) + 10_000;
    expect(canResumeActivityTimer(timer, 'visible_page', shortlyAfterStart)).toBe(true);
    expect(canResumeActivityTimer(timer, 'active_playback', shortlyAfterStart)).toBe(false);
    expect(canResumeActivityTimer(timer, 'visible_page', Date.parse(startedAt) + 24 * 60 * 60 * 1000)).toBe(false);
  });

  it('clears a completed activity timer', () => {
    const key = activityTimerStorageKey('apprenticeship', '98', 'component-3');
    saveActivityTimerElapsed(key, 20);
    clearActivityTimer(key);
    expect(readActivityTimer(key)).toBeNull();
  });
});
