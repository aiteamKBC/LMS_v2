import { afterEach, expect, it, vi } from 'vitest';
import { startTimeTracking, resumeTimeTracking, checkpointTimeTracking } from '../timeTracking';
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
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
  } });
  expect(trackingOffsets(started, 7000, 10000)).toEqual({ start: 0, end: 3000 });
});

it('restores a signed session with server elapsed time and never replaces its token', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessionId: session.sessionId, elapsedMilliseconds: 50000 }) }));
  expect(await resumeTimeTracking(session, 'component', 'slides')).toBe(session);
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
  } });
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

it('recovers an old session through the owner-scoped checkpoint without replacing its identity', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...session,
    persistent: true, savedSeconds: 600, elapsedMilliseconds: 172800000 }) }));
  const restored = await checkpointTimeTracking(session, 'component', 'reading', 'commercial', '7', 300);
  expect(restored).toMatchObject({ ...session, savedSeconds: 600, persistent: true });
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/learner_api/time-tracking/checkpoint/?kind=commercial&learnerId=7');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
    trackingToken: session.trackingToken, activityKind: 'component', activityId: 'reading', elapsedSeconds: 300,
  });
  expect(trackingOffsets(restored, 100, 1100)).toEqual({ start: 172800000, end: 172801000 });
});

it('serializes heartbeat and Finish without dropping the newer checkpoint', async () => {
  let release!: () => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ ok: true,
    json: async () => ({ ...session, persistent: true, savedSeconds: 300, elapsedMilliseconds: 300000 }) });
  })).mockResolvedValue({ ok: true, json: async () => ({ ...session, persistent: true, savedSeconds: 320, elapsedMilliseconds: 320000 }) });
  vi.stubGlobal('fetch', request);
  const heartbeat = checkpointTimeTracking(session, 'component', 'reading', 'commercial', '7', 300);
  const finish = checkpointTimeTracking(session, 'component', 'reading', 'commercial', '7', 320);
  expect(request).toHaveBeenCalledTimes(1);
  release();
  await heartbeat;
  expect((await finish).savedSeconds).toBe(320);
  expect(JSON.parse(request.mock.calls[1][1].body).elapsedSeconds).toBe(320);
});

it('does not accept a replacement identity or a failed checkpoint as successful recovery', async () => {
  const request = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'offline' }) })
    .mockResolvedValue({ ok: true, json: async () => ({ ...session, sessionId: 'different', persistent: true, savedSeconds: 300, elapsedMilliseconds: 300000 }) });
  vi.stubGlobal('fetch', request);
  await expect(checkpointTimeTracking(session, 'component', 'reading', 'commercial', '7', 300)).rejects.toThrow('offline');
  await expect(checkpointTimeTracking(session, 'component', 'reading', 'commercial', '7', 300)).rejects.toThrow('did not confirm');
});
