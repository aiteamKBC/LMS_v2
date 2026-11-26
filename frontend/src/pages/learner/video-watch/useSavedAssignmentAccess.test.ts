import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadLearningReflectionSubmission, type StoredLearningReflectionSubmission } from '@/api/reflectionSubmission';
import { useSavedAssignmentAccess } from './useSavedAssignmentAccess';

vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: vi.fn() }));
const saved = { id: 'submission-1', activityId: 'assignment-1', status: 'draft' } as StoredLearningReflectionSubmission;
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it('opens existing saved work without needing an authored brief', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue(saved);
  const { result } = renderHook(() => useSavedAssignmentAccess('commercial', '92', 'assignment-1', true));
  await waitFor(() => expect(result.current.status).toBe('available'));
  expect(loadLearningReflectionSubmission).toHaveBeenCalledWith({ learnerKind: 'commercial', learnerId: '92', activityType: 'assignment', activityId: 'assignment-1' });
});

it.each([null, { ...saved, activityId: 'different-assignment' }])('does not open empty work or another assignment response', async submission => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue(submission);
  const { result } = renderHook(() => useSavedAssignmentAccess('commercial', '92', 'assignment-1', true));
  await waitFor(() => expect(result.current.status).toBe('missing'));
});

it('keeps a failed read distinct from missing work and supports retry', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(saved);
  const { result } = renderHook(() => useSavedAssignmentAccess('commercial', '92', 'assignment-1', true));
  await waitFor(() => expect(result.current.status).toBe('error'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe('available'));
});

it('ignores an older response after navigating to another learner', async () => {
  let resolveOld!: (submission: StoredLearningReflectionSubmission) => void;
  vi.mocked(loadLearningReflectionSubmission).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(null);
  const { result, rerender } = renderHook(({ learnerId }) => useSavedAssignmentAccess('commercial', learnerId, 'assignment-1', true), { initialProps: { learnerId: '92' } });
  rerender({ learnerId: '93' });
  await waitFor(() => expect(result.current.status).toBe('missing'));
  await act(async () => { resolveOld(saved); });
  expect(result.current.status).toBe('missing');
});

it('does not fetch when the normal content or access checks make a lookup unnecessary', () => {
  renderHook(() => useSavedAssignmentAccess('commercial', '92', 'assignment-1', false));
  expect(loadLearningReflectionSubmission).not.toHaveBeenCalled();
});
