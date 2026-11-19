import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActivityPlan } from './activityPlanLoader';
import { clearDashboardLearnerPageCache, fetchDashboardActivityPlan, fetchDashboardLearners,
  getDashboardLearnerPageCache, invalidateDashboardLearners } from './dashboardApi';

const { get, viewAs } = vi.hoisted(() => ({ get: vi.fn(), viewAs: { coach: 'coach-a' } }));
vi.mock('@/lib/sharedGetJson', () => ({ fetchSharedJsonGet: get }));
vi.mock('@/lib/coachViewAs', () => ({ withCoachViewAs: (url: string) => `${url}?viewAsCoach=${viewAs.coach}` }));
const result = (id: string) => ({ learnerId: id, activityPlan: { completed: 3, total: 12, percent: 25 } });
const batch = (...ids: string[]) => ({ results: ids.map(result) });
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};
beforeEach(() => { get.mockReset(); clearDashboardLearnerPageCache(); viewAs.coach = 'coach-a'; });

describe('batched activity plan reads', () => {
  it('coalesces rows into batches of four with one real request active', async () => {
    const pending = deferred();
    get.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(batch('5', '6'));
    const reads = ['1', '2', '3', '4', '5', '6'].map(id => loadActivityPlan(id, new AbortController().signal));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get.mock.calls[0][0]).toContain('learnerIds=1,2,3,4');
    pending.resolve({ results: ['4', '2', '3', '1'].map(result) });
    expect(await Promise.all(reads)).toEqual(Array(6).fill(result('1').activityPlan));
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toContain('learnerIds=5,6');
  });

  it('keeps the slot on abort and discards cancelled queued rows without a request', async () => {
    const pending = deferred(); get.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(batch('3'));
    const firstController = new AbortController();
    const first = loadActivityPlan('1', firstController.signal).catch(error => error.name);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const queuedController = new AbortController();
    const second = loadActivityPlan('2', queuedController.signal).catch(error => error.name);
    const third = loadActivityPlan('3', new AbortController().signal);
    firstController.abort(); queuedController.abort();
    expect(await first).toBe('AbortError'); expect(await second).toBe('AbortError');
    expect(get).toHaveBeenCalledTimes(1);
    pending.resolve(batch('1')); await third;
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toContain('learnerIds=3');
  });

  it.each([
    { results: [result('8')] },
    { results: [result('7'), result('7')] },
    { results: [] },
    { results: [{ learnerId: '7', activityPlan: { completed: 9, total: 3, percent: 100 } }] },
    { results: [{ learnerId: '7', activityPlan: { completed: 3, total: 12, percent: 100 } }] },
  ])('rejects mismatched identity/count responses: %o', async wire => {
    get.mockResolvedValueOnce(wire);
    await expect(loadActivityPlan('7', new AbortController().signal)).rejects.toThrow('inconsistent');
  });

  it('captures view-as for queued work before the selected workspace changes', async () => {
    const one = deferred();
    get.mockReturnValueOnce(one.promise).mockResolvedValueOnce(batch('3'));
    const first = loadActivityPlan('1', new AbortController().signal);
    const second = loadActivityPlan('2', new AbortController().signal);
    viewAs.coach = 'coach-b';
    const third = loadActivityPlan('3', new AbortController().signal);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    one.resolve(batch('1', '2'));
    await Promise.all([first, second, third]);
    expect(get.mock.calls[0][0]).toContain('viewAsCoach=coach-a');
    expect(get.mock.calls[0][0]).toContain('learnerIds=1,2');
    expect(get.mock.calls[1][0]).toContain('viewAsCoach=coach-b');
    expect(get.mock.calls[1][0]).toContain('learnerIds=3');
  });

  it('retains successful rows when a peer fails, then retries only the failed row', async () => {
    get.mockResolvedValueOnce({ results: [result('1'), { learnerId: '2', error: 'Unavailable', retryable: true }] })
      .mockResolvedValueOnce(batch('2'));
    const first = loadActivityPlan('1', new AbortController().signal);
    const second = loadActivityPlan('2', new AbortController().signal).catch(error => error.message);
    expect(await first).toEqual(result('1').activityPlan);
    expect(await second).toContain('unavailable');
    await loadActivityPlan('2', new AbortController().signal);
    expect(get.mock.calls[1][0]).toContain('learnerIds=2');
  });

  it('deduplicates the same row and permits empty plans', async () => {
    get.mockResolvedValueOnce({ results: [{ learnerId: '1', activityPlan: { completed: 0, total: 0, percent: null } }] });
    const first = loadActivityPlan('1', new AbortController().signal);
    const second = loadActivityPlan('1', new AbortController().signal);
    expect(await first).toEqual(await second);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toContain('learnerIds=1');
  });

  it('does not restore an invalidated dataset or write a plan into another coach cache', async () => {
    const rows = { results: [{ id: '7', name: 'Synthetic', componentsCompleted: 9, componentsPlanned: 9 }] };
    get.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
    await fetchDashboardLearners(new AbortController().signal, 'account::coach-a');
    await fetchDashboardLearners(new AbortController().signal, 'account::coach-b');
    const pending = deferred(); get.mockReturnValueOnce(pending.promise);
    const read = fetchDashboardActivityPlan('7', new AbortController().signal, 'account::coach-a');
    invalidateDashboardLearners('account::coach-a');
    pending.resolve(batch('7')); await read;
    expect(getDashboardLearnerPageCache('account::coach-a')).toBeUndefined();
    expect(getDashboardLearnerPageCache('account::coach-b')?.results?.[0].activityPlan).toBeUndefined();
  });
});
