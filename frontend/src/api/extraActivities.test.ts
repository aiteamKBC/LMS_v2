import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useExtraActivities } from './extraActivities';
import { readLearnerJson } from './learnerRead';
vi.mock('./learnerRead', () => ({ readLearnerJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('does not reuse activities from another learner or month while loading', async () => {
  vi.mocked(readLearnerJson).mockResolvedValueOnce({ activities: [{ title: 'September workshop', month: '2026-09' }] });
  const hook = renderHook(({ month, learner }) => useExtraActivities('commercial', learner, month), { initialProps: { month: '2026-09', learner: '101' } });
  await waitFor(() => expect(hook.result.current.activities).toHaveLength(1));
  let resolve!: (value: unknown) => void;
  vi.mocked(readLearnerJson).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  hook.rerender({ month: '2026-10', learner: '102' });
  expect(hook.result.current.activities).toEqual([]);
  expect(hook.result.current.loading).toBe(true);
  await act(async () => resolve({ activities: [] }));
  expect(readLearnerJson).toHaveBeenLastCalledWith(expect.stringContaining('learnerId=102&month=2026-10'), expect.objectContaining({ revalidate: true }));
  expect(hook.result.current.loading).toBe(false);
});
it('reports a failed load instead of showing an empty successful month', async () => {
  vi.mocked(readLearnerJson).mockRejectedValue(new Error('Unavailable'));
  const hook = renderHook(() => useExtraActivities('apprenticeship', '101', '2026-09'));
  await waitFor(() => expect(hook.result.current.error).toContain('Could not load'));
});
