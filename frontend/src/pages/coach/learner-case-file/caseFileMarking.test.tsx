import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ coachFetch: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));

import { useCaseFileMarking } from './useCaseFileMarking';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function item(learnerId = '5170') {
  return { id: 'submission-1', learnerId, learner: 'Same Name', email: 'same@example.test', activityId: 'activity-1', activityTitle: 'Assignment', submittedAt: '2026-09-20T10:00:00Z' };
}

describe('Case File learner-scoped marking cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.coachFetch.mockResolvedValue(response({ items: [item()] }));
  });

  it('stays idle outside Assignments and loads the stable enrolment id on first open', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useCaseFileMarking('5170', enabled),
      { initialProps: { enabled: false } },
    );
    expect(mocks.coachFetch).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.coachFetch).toHaveBeenCalledTimes(1);
    expect(mocks.coachFetch.mock.calls[0][0]).toBe('/coach_api/coach/marking-queue?page_size=100&learner=5170');
    expect(result.current.data?.items).toEqual([item()]);
  });

  it('reuses successful marking data when Assignments is left and reopened', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useCaseFileMarking('5170', enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(mocks.coachFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a different stable id even when name and email match', async () => {
    mocks.coachFetch.mockResolvedValue(response({ items: [item('9999')] }));
    const { result } = renderHook(() => useCaseFileMarking('5170', true));
    await waitFor(() => expect(result.current.error).toContain('identity'));
    expect(result.current.data).toBeNull();
  });

  it('isolates failure and retries only after an explicit action', async () => {
    mocks.coachFetch.mockResolvedValueOnce(response({ message: 'Marking unavailable' }, 502))
      .mockResolvedValueOnce(response({ items: [] }));
    const { result } = renderHook(() => useCaseFileMarking('5170', true));
    await waitFor(() => expect(result.current.error).toBe('Marking unavailable'));
    expect(mocks.coachFetch).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data?.serializedItemCount).toBe(0));
    expect(mocks.coachFetch).toHaveBeenCalledTimes(2);
  });
});
