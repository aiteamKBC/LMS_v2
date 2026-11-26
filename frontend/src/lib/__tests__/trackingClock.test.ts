import { afterEach, expect, it, vi } from 'vitest';
import { synchronizeTrackingClock, trackingOffsets } from '../trackingClock';
import type { TimeTrackingSession } from '@/api/timeTracking';

const session: TimeTrackingSession = { sessionId: 'clock-test', trackingToken: 'signed',
  startedAt: '2026-10-16T10:00:00Z', countingMode: 'visible_page', rewardTracking: true };
afterEach(() => vi.restoreAllMocks());

it('device clocks ahead, behind, or changed during study cannot move observations', () => {
  vi.spyOn(performance, 'now').mockReturnValue(2000);
  const wall = vi.spyOn(Date, 'now');
  synchronizeTrackingClock(session);
  for (const deviceTime of [Date.parse(session.startedAt) + 3600000, 0, 9999999999999]) {
    wall.mockReturnValue(deviceTime);
    expect(trackingOffsets(session, 2000, 5000)).toEqual({ start: 0, end: 3000 });
    expect(trackingOffsets(session, 62000, 65000)).toEqual({ start: 60000, end: 63000 });
  }
});

it('reanchors a restored session without counting the away interval as study', () => {
  vi.spyOn(performance, 'now').mockReturnValue(100);
  synchronizeTrackingClock(session, 600000);
  expect(trackingOffsets(session, 100, 3100)).toEqual({ start: 600000, end: 603000 });
});

it('excludes time before the signed-session response and refuses missing calibration', () => {
  vi.spyOn(performance, 'now').mockReturnValue(2000);
  synchronizeTrackingClock(session);
  expect(trackingOffsets(session, 1000, 3000)).toEqual({ start: 0, end: 1000 });
  expect(() => trackingOffsets({ ...session, sessionId: 'unknown' }, 0, 1000)).toThrow('synchronize');
});
