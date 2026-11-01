import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchLearnerStatusCounts, type LearnerStatusCounts, type LearnerTarget } from '@/api/assignedLearners';
import { createLearnerStatusCountStore } from '../learnerStatusCountStore';

vi.mock('@/api/assignedLearners', () => ({ fetchLearnerStatusCounts: vi.fn() }));
const target: LearnerTarget = { scope: 'module', id: 'M1', name: 'Synthetic module' };
const summary = { total: 2, statuses: { active: 1, withdrawn: 1 } };
const stores: ReturnType<typeof createLearnerStatusCountStore>[] = [];
function store() { const result = createLearnerStatusCountStore(); stores.push(result); return result; }
function deferred() {
  let resolve!: (value: Record<string, LearnerStatusCounts>) => void;
  const promise = new Promise<Record<string, LearnerStatusCounts>>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchLearnerStatusCounts).mockImplementation(async (_scope, ids) => Object.fromEntries(ids.map(id => [id, summary])));
});
afterEach(() => { stores.splice(0).forEach(value => value.dispose()); });

it('coalesces refresh bursts and waits for an in-flight read before requesting its replacement', async () => {
  const counts = store(), first = deferred(), listener = vi.fn();
  vi.mocked(fetchLearnerStatusCounts).mockReturnValueOnce(first.promise);
  counts.subscribe(target, listener);
  await vi.waitFor(() => expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(1));
  counts.refreshAll(); counts.refreshAll(); counts.refresh(target, 1);
  await Promise.resolve();
  expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(1);
  first.resolve({ M1: { total: 99, statuses: { active: 99 } } });
  await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith({ value: summary, loading: false, error: '' }));
  expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(2);
  expect(listener.mock.calls.some(([state]) => state.value?.total === 99)).toBe(false);
});

it('combines new subscribers and waiting revisions into bounded sequential batches', async () => {
  const counts = store(), first = deferred();
  vi.mocked(fetchLearnerStatusCounts).mockReturnValueOnce(first.promise);
  for (let index = 0; index < 205; index++) counts.subscribe({ ...target, id: `M${index}` }, vi.fn());
  await vi.waitFor(() => expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(1));
  counts.refresh({ ...target, id: 'M204' }, 2);
  counts.subscribe({ ...target, scope: 'group', id: 'G1' }, vi.fn());
  await Promise.resolve();
  expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(1);
  first.resolve(Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`M${index}`, summary])));
  await vi.waitFor(() => expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(4));
  expect(vi.mocked(fetchLearnerStatusCounts).mock.calls.map(([scope, ids]) => [scope, ids.length])).toEqual([
    ['module', 100], ['module', 100], ['module', 5], ['group', 1],
  ]);
  expect(vi.mocked(fetchLearnerStatusCounts).mock.calls.flatMap(([, ids]) => ids).filter(id => id === 'M204')).toHaveLength(1);
});

it('loads an invalidated hidden row when it returns, without leaving it stuck loading', async () => {
  const counts = store(), listener = vi.fn();
  const unsubscribe = counts.subscribe(target, listener);
  await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith({ value: summary, loading: false, error: '' }));
  unsubscribe(); counts.refresh(target, 1);
  await Promise.resolve();
  expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(1);
  counts.subscribe(target, listener);
  await vi.waitFor(() => expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(2));
  expect(listener).toHaveBeenLastCalledWith({ value: summary, loading: false, error: '' });
});

it('does not strand rows removed before their first batch starts', async () => {
  const counts = store(), listener = vi.fn();
  counts.subscribe(target, listener)();
  await Promise.resolve();
  expect(fetchLearnerStatusCounts).not.toHaveBeenCalled();
  counts.subscribe(target, listener);
  await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith({ value: summary, loading: false, error: '' }));
});

it('aborts a disposed drain and permits a fresh subscription without receiving its old result', async () => {
  const counts = store(), first = deferred(), listener = vi.fn();
  vi.mocked(fetchLearnerStatusCounts).mockReturnValueOnce(first.promise);
  counts.subscribe(target, vi.fn());
  await vi.waitFor(() => expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(fetchLearnerStatusCounts).mock.calls[0][2];
  counts.dispose(); counts.subscribe(target, listener);
  await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith({ value: summary, loading: false, error: '' }));
  expect(signal.aborted).toBe(true);
  first.resolve({ M1: { total: 99, statuses: { active: 99 } } });
  await Promise.resolve();
  expect(listener).toHaveBeenLastCalledWith({ value: summary, loading: false, error: '' });
  expect(fetchLearnerStatusCounts).toHaveBeenCalledTimes(2);
});
