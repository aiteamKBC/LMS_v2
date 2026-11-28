import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLearnerEventReviewInstance, type LearnerCalendarEvent, type LearnerReviewDefinition } from '@/api/learnerCalendar';
import { useCoachingReviewDefinitions } from './useCoachingReviewDefinitions';

vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerEventReviewInstance: vi.fn() }));

const fetchDefinition = vi.mocked(fetchLearnerEventReviewInstance);
const session = (id: string, overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: 'Monthly coaching', source: 'mcr', type: 'coaching', sequence: 1,
  status: 'awaiting-signature', date: '2026-09-01', targetDate: '2026-09-01', scheduledDate: '2026-09-01', scheduledTime: '10:00',
  durationMinutes: 60, coachName: 'Coach', coachEmail: '', meetingLink: '', meetingProvider: '', notes: '',
  reviewTemplateId: 'template-1', ...overrides,
});
const definition = (id: string): LearnerReviewDefinition => ({
  manualOverride: null,
  instance: { id, reviewTemplateId: 'template-1', learnerId: 12, programmeId: 'programme-1',
    occurrenceNumber: 1, targetDate: '2026-09-01', status: 'awaiting-signature', startedAt: null, completedAt: '2026-09-01' },
  template: { id: 'template-1', name: 'Monthly coaching',
    signatures: { participant: true, advisor: true, employer: false, referrer: false },
    visibleTo: { participant: true, advisor: true, employer: false, referrer: false },
    recurrence: { interval: 1, unit: 'month' }, notifications: {}, allowEditingPriorDays: 0 },
  sections: [], signatures: {
    participant: { required: true, signed: false }, advisor: { required: true, signed: true },
    employer: { required: false, signed: false }, referrer: { required: false, signed: false },
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('coaching signature details loading', () => {
  it('fetches submitted template signatures even when the legacy calendar flag says signed', async () => {
    const pending = deferred<LearnerReviewDefinition>();
    fetchDefinition.mockReturnValue(pending.promise);
    const sessions = [session('pending', { learnerSigned: true }), session('completed', { status: 'completed' }),
      session('scheduled', { status: 'scheduled' }), session('legacy', { reviewTemplateId: null })];
    const { result } = renderHook(() => useCoachingReviewDefinitions('apprenticeship', '12', sessions));
    expect(result.current.loading).toBe(true);
    expect(fetchDefinition.mock.calls.map(call => call[2])).toEqual(['pending', 'completed']);
    const review = definition('pending-instance');
    await act(async () => { pending.resolve(review); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.definitions.pending?.signatures.participant).toEqual({ required: true, signed: false });
    expect(result.current.error).toBe('');
  });

  it('retains partial successes and exposes a retry that clears the error once details load', async () => {
    const first = definition('first-instance');
    const second = definition('second-instance');
    fetchDefinition.mockImplementation(async (_kind, _id, key) => {
      if (key === 'first') return first;
      throw new Error('Network unavailable');
    });
    const sessions = [session('first'), session('second')];
    const { result } = renderHook(() => useCoachingReviewDefinitions('apprenticeship', '12', sessions));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.definitions.first).toBe(first);
    expect(result.current.definitions.second).toBeUndefined();
    expect(result.current.error).toContain('Some meeting signature details could not be loaded');

    const retry = deferred<LearnerReviewDefinition>();
    fetchDefinition.mockImplementation((_kind, _id, key) => key === 'first' ? Promise.resolve(first) : retry.promise);
    act(() => result.current.refresh());
    expect(result.current.loading).toBe(true);
    expect(result.current.definitions.first).toBe(first);
    await act(async () => { retry.resolve(second); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.definitions).toEqual({ first, second });
    expect(result.current.error).toBe('');
  });

  it('clears the previous learner immediately and ignores an old response after switching learners', async () => {
    const old = deferred<LearnerReviewDefinition>();
    const next = deferred<LearnerReviewDefinition>();
    fetchDefinition.mockImplementation((_kind, id) => id === '12' ? old.promise : next.promise);
    const oldSessions = [session('old-meeting')];
    const newSessions = [session('new-meeting')];
    const { result, rerender } = renderHook(({ id, sessions }) => useCoachingReviewDefinitions('apprenticeship', id, sessions), {
      initialProps: { id: '12', sessions: oldSessions },
    });
    const oldSignal = fetchDefinition.mock.calls[0][3];
    rerender({ id: '24', sessions: newSessions });
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.definitions).toEqual({});
    expect(result.current.loading).toBe(true);
    const newDefinition = definition('new-instance');
    await act(async () => { next.resolve(newDefinition); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { old.resolve(definition('old-instance')); });
    expect(result.current.definitions).toEqual({ 'new-meeting': newDefinition });
    expect(result.current.error).toBe('');
  });

  it('reports a missing form as unresolved instead of treating it as no signature required', async () => {
    fetchDefinition.mockResolvedValue({ instance: null });
    const sessions = [session('missing')];
    const { result, rerender } = renderHook(({ rows }) => useCoachingReviewDefinitions('apprenticeship', '12', rows), {
      initialProps: { rows: sessions },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBe('');
    expect(result.current.definitions).toEqual({});
    rerender({ rows: [] });
    expect(result.current).toMatchObject({ definitions: {}, loading: false, error: '' });
  });

  it('does not show a signature loading error for a completed legacy meeting with no form', async () => {
    fetchDefinition.mockResolvedValue({ instance: null });
    const sessions = [session('legacy-completed', { status: 'completed' })];

    const { result } = renderHook(() => useCoachingReviewDefinitions('apprenticeship', '12', sessions));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.definitions).toEqual({});
    expect(result.current.error).toBe('');
  });
});
