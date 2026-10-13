import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { coachFetch } from '@/lib/coachFetch';
import { acquireAttendanceContext, attendanceContextKey, invalidateAttendanceContext } from './attendanceContextCache';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const payload = { programme: { id: 'p', name: 'Programme' }, group: { id: 'g', name: 'Group', cohort: 'C' }, learners: [], sessions: [] };
const key = attendanceContextKey('coach@example.test', 'p', 'g');

describe('Coach attendance context requests', () => {
  beforeEach(() => {
    clearAllCachedResources();
    vi.restoreAllMocks();
    vi.mocked(coachFetch).mockReset().mockResolvedValue(new Response(JSON.stringify(payload)));
  });

  it('shares in-flight reads and survives StrictMode cleanup without an abort', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(coachFetch).mockImplementation(() => new Promise(done => { resolve = done; }));
    const first = acquireAttendanceContext(key);
    first.release();
    const replay = acquireAttendanceContext(key);
    const concurrent = acquireAttendanceContext(key);
    await Promise.resolve();
    expect(first.promise).toBe(replay.promise);
    expect(replay.promise).toBe(concurrent.promise);
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(coachFetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    resolve(new Response(JSON.stringify(payload)));
    expect(await replay.promise).toEqual(payload);
    replay.release(); concurrent.release();
  });

  it('reuses fresh contexts for 60 seconds, then makes exactly one new request', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    await acquireAttendanceContext(key).promise;
    clock.mockReturnValue(59_000);
    await acquireAttendanceContext(key).promise;
    expect(coachFetch).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(61_000);
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify(payload)));
    await acquireAttendanceContext(key).promise;
    expect(coachFetch).toHaveBeenCalledTimes(2);
  });

  it('invalidates after a save and isolates programme, group and coach/viewAs', async () => {
    vi.mocked(coachFetch).mockImplementation(async () => new Response(JSON.stringify(payload)));
    await acquireAttendanceContext(key).promise;
    invalidateAttendanceContext(key);
    await acquireAttendanceContext(key).promise;
    for (const separate of [attendanceContextKey('other', 'p', 'g'), attendanceContextKey('coach@example.test', 'other', 'g'), attendanceContextKey('coach@example.test', 'p', 'other')]) {
      await acquireAttendanceContext(separate).promise;
    }
    expect(coachFetch).toHaveBeenCalledTimes(5);
  });
});
