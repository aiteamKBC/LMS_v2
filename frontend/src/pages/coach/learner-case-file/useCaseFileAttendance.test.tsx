import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaseFileSessionProvider } from '@/features/coach/case-file/hooks/CaseFileSession';
import { clearCaseFileCache } from '@/features/coach/case-file/cache/caseFileCache';
import { useCaseFileAttendance } from './useCaseFileAttendance';

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: fetch }));
vi.mock('@/hooks/useCoachViewAs', () => ({ useCoachViewAs: () => null }));
const summary = { sessions: 46, present: 23, absent: 23, attendanceRate: 50, outstandingAbsences: 23 };
function wrapper({ children }: { children: React.ReactNode }) {
  return <CaseFileSessionProvider learnerId="101" coach="coach@example.test">{children}</CaseFileSessionProvider>;
}
afterEach(() => { clearCaseFileCache(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('compact Case File Attendance transport', () => {
  it('reads once, caches revisit, and scopes page/filter requests', async () => {
    fetch.mockImplementation(async (url: string, options: RequestInit) => {
      expect(options.method ?? 'GET').toBe('GET');
      const page = Number(new URL(url, 'https://example.test').searchParams.get('page') || 1);
      return { ok: true, json: async () => ({ summary,
        sessions: [{ id: `session-${page}`, title: 'Lesson', date: '2026-10-06', status: 'absent', reason: 'Transport' }],
        months: ['2026-10'], pagination: { page, pageSize: 20, total: 46, hasMore: page < 3 } }) };
    });
    const first = renderHook(() => useCaseFileAttendance('apprenticeship', '201'), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.result.current.projection?.summary).toEqual(summary);
    expect(Object.keys(first.result.current.projection!.sessions[0])).toEqual(['id', 'title', 'date', 'status', 'reason']);
    first.unmount();
    const revisit = renderHook(() => useCaseFileAttendance('apprenticeship', '201'), { wrapper });
    await waitFor(() => expect(revisit.result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => revisit.result.current.setSelection(current => ({ ...current, page: '2' })));
    await waitFor(() => expect(revisit.result.current.projection?.pagination.page).toBe(2));
    expect(fetch).toHaveBeenCalledTimes(2);
    act(() => revisit.result.current.setSelection(current => ({ ...current, page: '1', search: 'Transport', status: 'absent', month: '2026-10' })));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2][0]).toContain('search=Transport&status=absent&month=2026-10');
    expect(revisit.result.current.data?.sessions).toBe(46);
  });
  it('refreshes dynamic data after 60 seconds', async () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1_000_000);
    fetch.mockResolvedValue({ ok: true, json: async () => ({ summary, sessions: [], months: [],
      pagination: { page: 1, pageSize: 20, total: 0, hasMore: false } }) });
    const first = renderHook(() => useCaseFileAttendance('commercial', '201'), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    clock.mockReturnValue(1_060_001);
    const expired = renderHook(() => useCaseFileAttendance('commercial', '201'), { wrapper });
    await waitFor(() => expect(expired.result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
