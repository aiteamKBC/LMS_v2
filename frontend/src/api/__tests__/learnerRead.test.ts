import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readLearnerJson, invalidateLearnerReads, LEARNER_READ_TIMEOUT_MS, LEARNER_SOURCE_READ_TIMEOUT_MS } from '../learnerRead';
import { clearAllCachedResources } from '../cachedRequest';
import { fetchLearnerDetail, fetchLearnerSummary, peekLearnerDetail, invalidateLearnerDetailCache } from '../learnerDetail';
import { fetchStudentActivity } from '../studentActivity';
import { fetchTrainingPlanDashboard } from '../trainingPlanDashboard';
import { overviewSchedule } from '../learnerOverview';
import { getSummary, RecordError } from '@/features/old-otjh/api';

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { clearAllCachedResources(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('learner data transport', () => {
  it.each(['student-activity', 'metrics'])('allows slow verified %s reads but still bounds a stuck source', async resource => {
    vi.useFakeTimers();
    const network = pending<Response>();
    vi.mocked(fetch).mockReturnValueOnce(network.promise);
    const request = readLearnerJson(`/learner_api/${resource}/commercial/125/`);
    await vi.advanceTimersByTimeAsync(LEARNER_READ_TIMEOUT_MS + 1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    network.resolve(reply({ complete: true }));
    await expect(request).resolves.toEqual({ complete: true });
    vi.mocked(fetch).mockReturnValueOnce(new Promise(() => {}));
    const stuck = expect(readLearnerJson(`/learner_api/${resource}/commercial/126/`)).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(LEARNER_SOURCE_READ_TIMEOUT_MS);
    await stuck;
    expect(vi.mocked(fetch).mock.calls[1][1]?.signal?.aborted).toBe(true);
  });
  it('shares the moved training plan schedule with Upcoming without coupling cancellation', async () => {
    const network = pending<Response>();
    vi.mocked(fetch).mockReturnValue(network.promise);
    const controller = new AbortController();
    const plan = fetchTrainingPlanDashboard('commercial', '125', controller.signal);
    const cancelled = expect(plan).rejects.toMatchObject({ name: 'AbortError' });
    const upcoming = overviewSchedule.read('commercial', '125', undefined, true);
    controller.abort();
    const schedule = { sessions: [], reviews: [] };
    network.resolve(reply(schedule));
    await cancelled;
    await expect(upcoming).resolves.toEqual(schedule);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/learner_api/training-plan-dashboard/commercial/125/?section=overview');
  });

  it('shares concurrent reads and caches only when the caller opts in', async () => {
    vi.mocked(fetch).mockImplementation(async () => reply({ count: 1 }));
    const url = '/learner_api/attendance/commercial/125/';
    await Promise.all([readLearnerJson(url, { ttlMs: 30_000 }), readLearnerJson(url, { ttlMs: 30_000 })]);
    await readLearnerJson(url, { ttlMs: 30_000 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await readLearnerJson('/learner_api/live/');
    await readLearnerJson('/learner_api/live/');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('isolates learners, query filters and staff preview headers', async () => {
    vi.mocked(fetch).mockImplementation(async () => reply({ count: 1 }));
    await Promise.all([
      readLearnerJson('/learner_api/evidence/commercial/125/?status=pending'),
      readLearnerJson('/learner_api/evidence/commercial/126/?status=pending'),
      readLearnerJson('/learner_api/evidence/commercial/125/?status=approved'),
      readLearnerJson('/learner_api/evidence/commercial/125/?status=pending', { headers: { 'X-View-As': 'other' } }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('lets a StrictMode remount join the request after the first caller cancels', async () => {
    const network = pending<Response>();
    vi.mocked(fetch).mockReturnValue(network.promise);
    const controller = new AbortController();
    const first = readLearnerJson('/learner_api/example/', { signal: controller.signal });
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    const second = readLearnerJson('/learner_api/example/');
    const transport = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(transport?.aborted).toBe(false);
    network.resolve(reply({ ready: true }));
    await rejected;
    await expect(second).resolves.toEqual({ ready: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not start a request for an already cancelled caller', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readLearnerJson('/learner_api/example/', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['headers', 'body'])('bounds a stuck %s and allows recovery', async phase => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce(() => phase === 'headers'
      ? new Promise(() => {})
      : Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response));
    const result = expect(readLearnerJson('/learner_api/example/')).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(LEARNER_READ_TIMEOUT_MS);
    await result;
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(reply({ recovered: true }));
    await expect(readLearnerJson('/learner_api/example/')).resolves.toEqual({ recovered: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403, 500])('preserves HTTP %i and never caches a refusal or failure', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ error: 'Cannot load this record', code: 'unavailable' }, status));
    await expect(readLearnerJson('/learner_api/example/', { ttlMs: 30_000 })).rejects.toMatchObject({ status, code: 'unavailable' });
    vi.mocked(fetch).mockResolvedValueOnce(reply({ ok: true }));
    await expect(readLearnerJson('/learner_api/example/', { ttlMs: 30_000 })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects HTML and retries instead of caching an invalid JSON response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>Error</html>', { status: 502 }));
    await expect(readLearnerJson('/learner_api/example/')).rejects.toThrow(/invalid response/);
    vi.mocked(fetch).mockResolvedValueOnce(reply({ ok: true }));
    await expect(readLearnerJson('/learner_api/example/')).resolves.toEqual({ ok: true });
  });

  it('does not restore an old snapshot after an action invalidates pending reads', async () => {
    const old = pending<Response>();
    vi.mocked(fetch).mockReturnValueOnce(old.promise).mockImplementation(async () => reply({ version: 2 }));
    const url = '/learner_api/example/';
    const first = readLearnerJson(url, { ttlMs: 30_000 });
    invalidateLearnerReads();
    await expect(readLearnerJson(url, { ttlMs: 30_000 })).resolves.toEqual({ version: 2 });
    old.resolve(reply({ version: 1 })); await first;
    await expect(readLearnerJson(url, { ttlMs: 30_000 })).resolves.toEqual({ version: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('expires an optional cache and clears all learner data on account changes', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(async () => reply({ id: '125', activities: [] }));
    await fetchLearnerDetail('commercial', '125');
    expect(peekLearnerDetail('commercial', '125')).toMatchObject({ id: '125' });
    await fetchLearnerSummary('commercial', '125');
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchStudentActivity('commercial', '125');
    await fetchStudentActivity('commercial', '125');
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(peekLearnerDetail('commercial', '125')).toBeUndefined();
    await fetchStudentActivity('commercial', '125');
    clearAllCachedResources();
    await fetchLearnerDetail('commercial', '125');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('forces a new learner detail request and ignores the previous completion', async () => {
    const old = pending<Response>();
    vi.mocked(fetch).mockReturnValueOnce(old.promise).mockImplementation(async () => reply({ id: '125', name: 'Latest' }));
    const first = fetchLearnerDetail('commercial', '125');
    await fetchLearnerDetail('commercial', '125', { force: true });
    old.resolve(reply({ id: '125', name: 'Old' })); await first;
    expect(peekLearnerDetail('commercial', '125')?.name).toBe('Latest');
    invalidateLearnerDetailCache('commercial', '125');
    expect(peekLearnerDetail('commercial', '125')).toBeUndefined();
  });

  it('retries malformed activity data without reusing the invalid snapshot', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ activities: null })).mockResolvedValueOnce(reply({ activities: [] }));
    await expect(fetchStudentActivity('commercial', '125')).rejects.toThrow(/invalid student activity/);
    await expect(fetchStudentActivity('commercial', '125')).resolves.toEqual({ activities: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds the previous-record gate and preserves its error contract', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const pendingGate = getSummary();
    const rejected = expect(pendingGate).rejects.toMatchObject({ status: 0, code: 'timeout' });
    const errorType = expect(pendingGate).rejects.toBeInstanceOf(RecordError);
    await vi.advanceTimersByTimeAsync(LEARNER_READ_TIMEOUT_MS);
    await Promise.all([rejected, errorType]);
  });
});
