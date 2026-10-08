import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { caseFileRead } from './api/caseFileApi';
import { CaseFileSessionProvider } from './hooks/CaseFileSession';
import { useCaseFileMonthFocus } from './hooks/useCaseFileMonthFocus';
import { useCaseFileModuleDetail } from './hooks/useCaseFileModuleDetail';
import { useLearnerProfile } from '@/features/coach/learner-profile/hooks/useLearnerProfile';
import type { CaseFileTabId } from '@/pages/coach/learner-case-file/components/caseFileTabs.config';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.test' }) }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: transport }));

const shell = {
  learner: { id: '101', enrolmentId: '201', aptemId: null, learnerType: 'apprenticeship',
    name: 'Synthetic Learner', email: 'learner@example.test', programme: 'Programme', group: 'Group',
    employer: 'Employer', status: 'Active', startDate: '2026-01-01', plannedEndDate: '2027-01-01' },
};
const attendance = { learnerId: 201, sessions: 2, present: 1, absent: 1, attendanceRate: 50, consecutiveMissed: 1, lastSessionDate: '2026-09-01', sessionHistory: [] };
const summary = {
  metrics: { migrated: false, programme: { completed: 1, total: 2, percent: 50, status: 'ready' }, otjh: { actual: 12, planned: 100 }, ksb: { completed: 1, total: 2, percent: 50, status: 'ready' } },
  attendance, nextSession: null, reviews: [], errors: {},
};
const wrapper = ({ children }: { children: ReactNode }) => <CaseFileSessionProvider learnerId="101" coach="coach@example.test">{children}</CaseFileSessionProvider>;

describe('Case File session request lifecycle', () => {
  beforeEach(() => {
    clearAllCachedResources();
    transport.mockReset();
    transport.mockImplementation(async (url: string) => {
      const body = url.endsWith('/profile') ? shell : url.endsWith('/overview') ? { wholeProgrammeProgress: summary.metrics, programmeProgress: [] }
        : url.includes('/attendance') ? { summary: { sessions: 2, present: 1, absent: 1, attendanceRate: 50, outstandingAbsences: 1 }, sessions: [{ id: 'session-1', date: '2026-09-01', title: 'Synthetic session', status: 'absent', reason: null }], months: ['2026-09'], pagination: { page: 1, pageSize: 20, total: 1, hasMore: false } }
        : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
  });

  it('deduplicates concurrent review reads and expires them after 60 seconds', async () => {
    const before = Date.now();
    const reads = await Promise.all([caseFileRead('coach-a', '101', 'reviews'), caseFileRead('coach-a', '101', 'reviews')]);
    expect(reads[0]).toBe(reads[1]);
    vi.spyOn(Date, 'now').mockReturnValue(before + 90_000);
    try { await caseFileRead('coach-a', '101', 'reviews'); }
    finally { vi.restoreAllMocks(); }
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('separates coach, learner and selected-month cache keys', async () => {
    await caseFileRead('coach-a', '101', 'monthly-focus', { month: '2026-09' });
    await caseFileRead('coach-b', '101', 'monthly-focus', { month: '2026-09' });
    await caseFileRead('coach-a', '102', 'monthly-focus', { month: '2026-09' });
    await caseFileRead('coach-a', '101', 'monthly-focus', { month: '2026-10' });
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('invalidates session reads after mutations while the Case File is unmounted', async () => {
    await caseFileRead('coach-a', '101', 'reviews');
    invalidateLearnerReads();
    await caseFileRead('coach-a', '101', 'reviews');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('keeps first-visit snapshots when more than 200 section and month keys have been read', async () => {
    await caseFileRead('coach-a', '101', 'reviews');
    for (let index = 0; index < 205; index++) await caseFileRead('coach-a', String(index + 200), 'reviews');
    await caseFileRead('coach-a', '101', 'reviews');
    expect(transport).toHaveBeenCalledTimes(206);
  });

  it('does not cache errors and makes explicit refresh replace a successful snapshot', async () => {
    transport.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unavailable' }), { status: 503 }));
    await expect(caseFileRead('coach-a', '101', 'reviews')).rejects.toThrow('Unavailable');
    await caseFileRead('coach-a', '101', 'reviews');
    await caseFileRead('coach-a', '101', 'reviews', {}, { refresh: true });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('reuses successful reads for each tab and explicit KSB details without a remount refetch', async () => {
    const sections = ['overview', 'weekly-learning', 'monthly-focus', 'otjh-ksb', 'attendance', 'learning-plan', 'reviews', 'assignments', 'enrolment-documents'];
    for (const section of sections) await caseFileRead('coach-a', '101', section, section === 'monthly-focus' ? { month: '2026-09' } : {});
    await caseFileRead('coach-a', '101', 'ksb-detail', { code: 'K1' });
    const firstVisitCount = transport.mock.calls.length;
    for (const section of [...sections].reverse()) await caseFileRead('coach-a', '101', section, section === 'monthly-focus' ? { month: '2026-09' } : {});
    await caseFileRead('coach-a', '101', 'ksb-detail', { code: 'K1' });
    expect(firstVisitCount).toBe(10);
    expect(transport).toHaveBeenCalledTimes(firstVisitCount);
    expect(transport.mock.calls.at(-1)?.[0]).toBe('/coach_api/coach/case-file/101/ksbs/K1');
  });

  it('loads only the selected month and reuses it after navigation and an explicit retry', async () => {
    transport.mockImplementation(async () => new Response(JSON.stringify({ months: {}, actual: [], actualAvailable: true, reviews: [] }), { status: 200 }));
    const { result, rerender } = renderHook(({ month }) => useCaseFileMonthFocus(month, true), { wrapper, initialProps: { month: '2026-09' } });
    await waitFor(() => expect(result.current?.data).toBeDefined());
    expect(transport.mock.calls[0][0]).toBe('/coach_api/coach/case-file/101/monthly-focus?month=2026-09');
    act(() => result.current!.refresh());
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    rerender({ month: '2026-10' });
    await waitFor(() => expect(result.current?.data).toBeDefined());
    rerender({ month: '2026-09' });
    await waitFor(() => expect(result.current?.data).toBeDefined());
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('uses the owning Learning Plan response for module details without another request', async () => {
    transport.mockImplementation(async () => new Response(JSON.stringify({ schedule: { modules: [
      { id: 'M1', description: 'First module' }, { id: 'M2', description: 'Selected module' },
    ] } }), { status: 200 }));
    const { result, rerender } = renderHook(({ id }) => useCaseFileModuleDetail(id), { wrapper, initialProps: { id: 'M1' } });
    await waitFor(() => expect(result.current?.module?.id).toBe('M1'));
    rerender({ id: 'M2' });
    await waitFor(() => expect(result.current?.module?.id).toBe('M2'));
    rerender({ id: 'M1' });
    await waitFor(() => expect(result.current?.module?.id).toBe('M1'));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe('/coach_api/coach/case-file/101/learning-plan');
  });

  it('loads the persistent profile without metrics, learner detail or hidden header reads', async () => {
    const { result } = renderHook(() => useLearnerProfile({ learnerId: '101', enabled: true, activeTab: 'overview' }), { wrapper });
    await waitFor(() => expect(result.current.data?.employer).toBe('Employer'));
    expect(result.current.data?.otjhCompleted).toBeNull();
    expect(result.current.data?.ksbProgress).toBeNull();
    expect(result.current.data?.detail).toBeNull();
    expect(transport.mock.calls.map(call => call[0])).toEqual(['/coach_api/coach/case-file/101/profile']);
  });

  it('cancels only the caller and clears stored data on the existing logout boundary', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(caseFileRead('coach-a', '101', 'reviews', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await caseFileRead('coach-a', '101', 'reviews');
    expect(transport).toHaveBeenCalledTimes(1);
    clearAllCachedResources();
    await caseFileRead('coach-a', '101', 'reviews');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('starts exactly one profile request before a data tab is visited', async () => {
    const { result, rerender } = renderHook(({ tab }: { tab: CaseFileTabId }) => useLearnerProfile({ learnerId: '101', enabled: true, activeTab: tab }), { wrapper, initialProps: { tab: 'coach-notes' as CaseFileTabId } });
    await waitFor(() => expect(result.current.nextSession.loading).toBe(false));
    await waitFor(() => expect(result.current.data?.displayName).toBe('Synthetic Learner'));
    expect(result.current.attendance.data).toBeNull();
    expect(result.current.reviews.data).toBeNull();
    expect(transport.mock.calls.map(call => call[0])).toEqual([
      '/coach_api/coach/case-file/101/profile',
    ]);
    expect(result.current.data?.otjhCompleted).toBeNull();
    expect(result.current.data?.ksbProgress).toBeNull();
    rerender({ tab: 'attendance' });
    await waitFor(() => expect(result.current.attendance.data?.sessionHistory).toHaveLength(1));
    const firstVisitCount = transport.mock.calls.length;
    rerender({ tab: 'coach-notes' });
    rerender({ tab: 'attendance' });
    await act(async () => {});
    expect(transport).toHaveBeenCalledTimes(firstVisitCount);
    expect(firstVisitCount).toBe(2);
  });
});
