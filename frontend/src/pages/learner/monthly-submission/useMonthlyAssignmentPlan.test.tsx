import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { CaseFileContext, type CaseFileSession } from '@/features/coach/case-file/hooks/caseFileSessionContext';
import { useMonthlyAssignmentPlan } from './useMonthlyAssignmentPlan';

const dates = { A1: { date: '2026-09-09', date_source: 'builder_week', date_needs_review: false, due_timing: '', week_end: '2026-09-13' } };
const fetcher = vi.fn(async (url: string) => ({
  ok: true, status: 200,
  json: async () => url.includes('/monthly-submission/') ? { activity_dates: dates }
    : url.includes('/subject-covers/') ? { covers: {}, activity_dates: dates, current_subjects: [{ id: 'M1', title: 'Module' }] }
    : url.includes('/training-plan-dashboard/') ? { months: {}, contractStatus: 'ready' }
    : { statuses: [] },
}));
const urls = () => fetcher.mock.calls.map(([url]) => String(url));

beforeEach(() => { vi.stubGlobal('fetch', fetcher); });
afterEach(() => { clearAllCachedResources(); fetcher.mockClear(); vi.unstubAllGlobals(); });

it('reads scoped dates only when the learner page opts in', async () => {
  const { result } = renderHook(() => useMonthlyAssignmentPlan('commercial', '125', { scopedDates: true }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.errors).toEqual([]);
  expect(result.current.metadata?.activity_dates).toEqual(dates);
  expect(urls()).toContain('/learner_api/monthly-submission/commercial/125/dates/');
  expect(urls().some(url => url.includes('/subject-covers/'))).toBe(false);
});

it('keeps subject-covers for every other caller, such as coach Assignments', async () => {
  const { result } = renderHook(() => useMonthlyAssignmentPlan('commercial', '125'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(urls()).toContain('/learner_api/subject-covers/125/?refs=');
  expect(urls().some(url => url.includes('/monthly-submission/'))).toBe(false);
  expect(result.current.metadata?.current_subjects).toEqual([{ id: 'M1', title: 'Module' }]);
});

it('keeps the staff case-file session reads, with or without the option', async () => {
  for (const options of [{ scopedDates: true }, {}]) {
    const read = vi.fn(async (_section: string, params?: Record<string, string>) =>
      params?.resource === 'covers' ? { covers: {}, activity_dates: dates }
        : params?.resource === 'contract' ? { months: {}, contractStatus: 'ready' } : { statuses: [] });
    const session = { learnerId: '125', read, detail: vi.fn() } as unknown as CaseFileSession;
    const wrapper = ({ children }: { children: ReactNode }) => <CaseFileContext.Provider value={session}>{children}</CaseFileContext.Provider>;
    const { result, unmount } = renderHook(() => useMonthlyAssignmentPlan('commercial', '125', options), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(read).toHaveBeenCalledWith('assignments', { resource: 'covers' }, expect.anything());
    expect(fetcher).not.toHaveBeenCalled();
    unmount();
  }
});
