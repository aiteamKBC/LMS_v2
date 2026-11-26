import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { checkMonthlyAssignment } from '@/api/monthlyAssignment';
import { useAssignmentStepCheck } from './useAssignmentStepCheck';

vi.mock('@/api/monthlyAssignment', () => ({ checkMonthlyAssignment: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const keys = ['answer', 'learning', 'evidence', 'ksbs', 'planned', 'declarations', 'hours', 'reflection', 'benefit', 'impact', 'action', 'meeting', 'presentation'];
const checks = (failed: string) => keys.map(key => ({ key, label: `Complete ${key}`, passed: key !== failed }));

it.each([[0, 'answer'], [1, 'evidence'], [2, 'declarations'], [3, 'reflection'], [4, 'impact'], [5, 'action'], [6, 'presentation']] as const)('blocks step %i using its existing server requirements', async (step, key) => {
  vi.mocked(checkMonthlyAssignment).mockResolvedValue(checks(key));
  const { result } = renderHook(() => useAssignmentStepCheck('{}', step, true));
  expect(result.current.ready).toBe(false);
  await waitFor(() => expect(result.current.missing[0]?.key).toBe(key));
  expect(result.current.ready).toBe(false);
});

it('allows optional evidence to be empty and ignores missing future requirements', async () => {
  vi.mocked(checkMonthlyAssignment).mockResolvedValue(checks('meeting'));
  const { result } = renderHook(() => useAssignmentStepCheck('{}', 1, true));
  await waitFor(() => expect(result.current.ready).toBe(true));
});

it('invalidates success immediately on edit and ignores an old response', async () => {
  let resolveOld: (value: ReturnType<typeof checks>) => void = () => {};
  vi.mocked(checkMonthlyAssignment).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(checks('answer'));
  const { result, rerender } = renderHook(({ snapshot }) => useAssignmentStepCheck(snapshot, 0, true), { initialProps: { snapshot: '{"answer":"old"}' } });
  await waitFor(() => expect(checkMonthlyAssignment).toHaveBeenCalledTimes(1));
  rerender({ snapshot: '{"answer":"new"}' });
  resolveOld(checks('meeting'));
  await waitFor(() => expect(result.current.missing[0]?.key).toBe('answer'));
  expect(result.current.ready).toBe(false);
});

it('fails closed on incomplete responses and offers retry', async () => {
  vi.mocked(checkMonthlyAssignment).mockResolvedValue([]);
  const { result } = renderHook(() => useAssignmentStepCheck('{}', 2, true));
  await waitFor(() => expect(result.current.error).toContain('retry'));
  expect(result.current.ready).toBe(false);
});

it('keeps historical navigation available without validation calls', () => {
  const { result } = renderHook(() => useAssignmentStepCheck('{}', 2, false));
  expect(result.current.ready).toBe(true);
  expect(checkMonthlyAssignment).not.toHaveBeenCalled();
});
