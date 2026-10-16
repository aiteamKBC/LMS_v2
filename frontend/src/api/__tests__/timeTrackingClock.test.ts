import { afterEach, expect, it, vi } from 'vitest';
import { startTimeTracking, resumeTimeTracking } from '../timeTracking';
import { trackingOffsets } from '@/lib/trackingClock';
import type { TimeTrackingSession } from '../timeTracking';
vi.mock('@/lib/personalLearning', () => ({ learningFetch: (...args: unknown[]) => fetch(...args as [string, RequestInit]) }));
const session: TimeTrackingSession = { sessionId: 'server-session', trackingToken: 'signed-token',
  startedAt: '2026-10-16T10:00:00Z', countingMode: 'visible_page', rewardTracking: true };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('starts the observation timeline at receipt independent of the device wall clock', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(session.startedAt) + 3600000);
  vi.spyOn(performance, 'now').mockReturnValue(7000);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(session) }));
  const started = await startTimeTracking('component', 'slides', 'commercial', '1', 'visible_page');
  expect(trackingOffsets(started, 7000, 10000)).toEqual({ start: 0, end: 3000 });
});

it('restores a signed session with server elapsed time and never replaces its token', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessionId: session.sessionId, elapsedMilliseconds: 50000 }) }));
  expect(await resumeTimeTracking(session, 'component', 'slides')).toBe(session);
  expect(trackingOffsets(session, 100, 1100)).toEqual({ start: 50000, end: 51000 });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ trackingToken: session.trackingToken, activityKind: 'component', activityId: 'slides' });
});

it('refuses failed or mismatched calibration without silently starting a new session', async () => {
  const request = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'expired' }) });
  vi.stubGlobal('fetch', request);
  await expect(resumeTimeTracking(session, 'video', 'v1')).rejects.toThrow('expired');
  request.mockResolvedValue({ ok: true, json: async () => ({ sessionId: 'other', elapsedMilliseconds: 1000 }) });
  await expect(resumeTimeTracking(session, 'video', 'v1')).rejects.toThrow('did not confirm');
});
