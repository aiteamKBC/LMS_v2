import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ coachFetch: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));

import { useCaseFileNextSession } from './useCaseFileNextSession';
import { useCaseFileReviews } from './useCaseFileReviews';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const review = {
  id: 'review-1', eventKey: 'review-1', learnerId: '316', enrolmentId: '5170', title: 'Progress Review',
  type: 'review', source: 'progress-review', reviewTypeName: 'Progress Review', status: 'scheduled',
  date: '2026-10-10', targetDate: '2026-10-10', scheduledDate: '2026-10-10', scheduledTime: '10:00',
  startHour: 10, endHour: 11, reviewerName: 'Coach', reviewInstanceId: 'instance-1',
};

describe('Case File learner-scoped timetable boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads one learner-scoped Next Session request', async () => {
    mocks.coachFetch.mockResolvedValue(response({ available: true, event: {
      id: 'live-1', eventKey: 'live-1', learnerId: '316', enrolmentId: '5170', title: 'Live Session',
      type: 'live-session', source: 'live-session', status: 'scheduled', date: '2026-10-01', startHour: 9, endHour: 10,
    } }));
    const { result } = renderHook(() => useCaseFileNextSession('316', true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.coachFetch).toHaveBeenCalledTimes(1);
    expect(mocks.coachFetch.mock.calls[0][0]).toBe('/coach_api/coach/learners/316/next-session');
    expect(result.current.data?.id).toBe('live-1');
  });

  it('keeps Reviews lazy and reuses its successful page-lifetime result', async () => {
    mocks.coachFetch.mockResolvedValue(response({ events: [review], reviewGenerationIssues: [] }));
    const { result, rerender } = renderHook(
      ({ enabled }) => useCaseFileReviews('316', enabled),
      { initialProps: { enabled: false } },
    );
    expect(mocks.coachFetch).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ enabled: false });
    rerender({ enabled: true });

    expect(mocks.coachFetch).toHaveBeenCalledTimes(1);
    expect(mocks.coachFetch.mock.calls[0][0]).toBe('/coach_api/coach/learners/316/reviews');
    expect(result.current.data?.groups[0]?.items[0]?.reviewInstanceId).toBe('instance-1');
  });

  it('isolates Reviews failure and retries only after an explicit action', async () => {
    mocks.coachFetch.mockResolvedValueOnce(response({ detail: 'Reviews unavailable' }, 503))
      .mockResolvedValueOnce(response({ events: [review], reviewGenerationIssues: [] }));
    const { result } = renderHook(() => useCaseFileReviews('316', true));
    await waitFor(() => expect(result.current.error).toBe('Reviews unavailable'));
    expect(mocks.coachFetch).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data?.groups.length).toBe(1));
    expect(mocks.coachFetch).toHaveBeenCalledTimes(2);
  });
});
