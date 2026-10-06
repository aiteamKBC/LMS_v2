import { describe, expect, it, vi } from 'vitest';
import { adaptDashboardLearnerRow, type DashboardLearnerRow } from './dashboardLearnerRow';
import { normalizeLearner, otjhProgressAsOfToday } from '@/pages/coach/caseload/lib/format';

vi.mock('@/lib/sharedGetJson', () => ({ fetchSharedJsonGet: vi.fn() }));
vi.mock('@/lib/coachViewAs', () => ({ withCoachViewAs: (url: string) => url }));
import { fetchSharedJsonGet } from '@/lib/sharedGetJson';
import { fetchDashboardLearners, getDashboardLearnerPageCache, invalidateDashboardLearners } from './dashboardApi';

const row: DashboardLearnerRow = {
  id: '42', name: 'Synthetic Learner', initials: 'SL', learnerType: 'apprenticeship', enrolmentId: '1002',
  programme: 'Programme A', programmeStatus: 'Active',
  otjh: { completed: 7, targetToDate: 13, planned: 400, progress: 12.34, ragStatus: 'need-attention' },
  activities: { completed: 2, total: 3, progress: 66.67 }, attendance: { rate: 0 },
  startDate: '2026-01-01', lastActivity: { date: '2026-09-20' }, lastPr: null, lastMcm: '2026-09-01',
};

describe('dashboard minimal learner contract', () => {
  it('adapts the fetched response and cached page without changing pagination or filters', async () => {
    const pagination = { page: 2, pageSize: 15, total: 30, totalPages: 2, hasNext: false, hasPrevious: true };
    const filterOptions = { cohort: [{ value: 'cohort-a', label: 'Cohort A' }], group: [], programStatus: [], employer: [] };
    vi.mocked(fetchSharedJsonGet).mockResolvedValueOnce({ results: [row], pagination, filterOptions, learnerFilterData: { '42': { email: 'synthetic@example.invalid', cohortId: 'cohort-a', group: 'Group A' } } });
    const response = await fetchDashboardLearners(new AbortController().signal, 'synthetic-page');
    expect(response.pagination).toEqual(pagination);
    expect(response.filterOptions).toEqual(filterOptions);
    expect(response.results?.[0]).toMatchObject({ id: '42', enrolmentId: '1002', learnerType: 'apprenticeship', otjhProgressAsOfToday: 12.34, email: 'synthetic@example.invalid', cohortId: 'cohort-a', group: 'Group A' });
    expect(getDashboardLearnerPageCache('synthetic-page')).toEqual(response);
    expect(await fetchDashboardLearners(new AbortController().signal, 'synthetic-page')).toBe(response);
    expect(fetchSharedJsonGet).toHaveBeenCalledTimes(1);
    expect(fetchSharedJsonGet).toHaveBeenCalledWith('/coach_api/coach/dashboard/learners', expect.anything());
    invalidateDashboardLearners('synthetic-page');
    vi.mocked(fetchSharedJsonGet).mockResolvedValueOnce({ results: [], pagination, filterOptions });
    await fetchDashboardLearners(new AbortController().signal, 'synthetic-page');
    expect(fetchSharedJsonGet).toHaveBeenCalledTimes(2);
  });
  it('does not retry a failed learners request automatically or cache a failure', async () => {
    vi.mocked(fetchSharedJsonGet).mockClear().mockRejectedValueOnce(new Error('Unavailable'));
    await expect(fetchDashboardLearners(new AbortController().signal, 'failed-coach')).rejects.toThrow('Unavailable');
    expect(fetchSharedJsonGet).toHaveBeenCalledTimes(1);
    expect(getDashboardLearnerPageCache('failed-coach')).toBeUndefined();
  });
  it('does not restore a dataset invalidated while its request is pending', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetchSharedJsonGet).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fetchDashboardLearners(new AbortController().signal, 'invalidated-coach');
    invalidateDashboardLearners('invalidated-coach');
    finish({ results: [row] });
    await pending;
    expect(getDashboardLearnerPageCache('invalidated-coach')).toBeUndefined();
  });
  it('preserves backend OTJH even when progress differs from the hours ratio', () => {
    const learner = normalizeLearner(adaptDashboardLearnerRow(row));
    expect(otjhProgressAsOfToday(learner)).toMatchObject({ actualHours: 7, targetHours: 13, percent: 12.34, status: 'need-attention' });
    expect(learner).toMatchObject({ learnerType: 'apprenticeship', enrolmentId: '1002', programmeName: 'Programme A', rawProgramStatus: 'Active', activityProgress: 66.67, lastActivityDate: '2026-09-20' });
    expect(adaptDashboardLearnerRow(row).attendanceAvailable).toBe(true);
  });
  it('keeps unavailable values distinct from zero without calculating OTJH', () => {
    const unavailable = adaptDashboardLearnerRow({ ...row, otjh: { completed: 0, targetToDate: null, planned: 850, progress: null, ragStatus: 'unavailable' }, attendance: { rate: null } });
    expect(otjhProgressAsOfToday(normalizeLearner(unavailable))).toMatchObject({ actualHours: 0, targetHours: null, percent: null, status: 'unavailable' });
    expect(unavailable.attendanceAvailable).toBe(false);
  });
});
