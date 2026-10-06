import { describe, expect, it, vi } from 'vitest';
import { adaptDashboardPopupContract, adaptDashboardSummary, type DashboardSummary } from './dashboardSummary';
import { fetchCoachDashboard } from './dashboardApi';
import { fetchSharedJsonGet } from '@/lib/sharedGetJson';

vi.mock('@/lib/sharedGetJson', () => ({ fetchSharedJsonGet: vi.fn() }));
vi.mock('@/lib/coachViewAs', () => ({ withCoachViewAs: (url: string) => url }));
const summary: DashboardSummary = { totalLearners: 42, otjh: { atRisk: 9, needAttention: 7 },
  pendingMarking: 0, meetingsThisWeek: { pr: 2, mcm: 8, catchUps: 0 } };

describe('summary contract compatibility', () => {
  it('preserves the current UI values and makes one request', async () => {
    const owner = { name: 'Synthetic Coach' };
    vi.mocked(fetchSharedJsonGet).mockResolvedValueOnce({ ...summary, owner, learners: [], marking: { items: [] } });
    const response = await fetchCoachDashboard<ReturnType<typeof adaptDashboardSummary>>(new AbortController().signal);
    expect(response.totals).toEqual({ totalLearners: 42, otjhAtRisk: 9, needAttention: 7,
      pendingMarking: 0, prThisWeek: 2, mcmThisWeek: 8, catchUpsThisWeek: 0 });
    expect(response.weeklyCounts).toEqual({ progressReviews: 2, monthlyCoaching: 8, catchUps: 0, reviewsAvailable: true });
    expect(response).toMatchObject({ owner, learners: [], marking: { items: [] } });
    expect(fetchSharedJsonGet).toHaveBeenCalledTimes(1);
  });
  it('preserves unavailable review counts and marking rather than displaying zero', () => {
    const result = adaptDashboardSummary({ ...summary, pendingMarking: null, meetingsThisWeek: { pr: null, mcm: null, catchUps: 3 } });
    expect(result.totals).toMatchObject({ pendingMarking: null, prThisWeek: null, mcmThisWeek: null, catchUpsThisWeek: 3 });
    expect(result.weeklyCounts.reviewsAvailable).toBe(false);
  });
  it('preserves learner popup navigation, authoritative OTJH without attendance with one request', async () => {
    const wire = {
      owner: { name: 'Synthetic Coach' }, summary,
      learnerPopup: { all: [{ id: '42', name: 'Synthetic Learner', programme: 'Programme A', group: 'Group A',
        otjh: { completed: 7, target: 13, planned: 400, ragStatus: 'at-risk' as const } }], atRisk: ['42'] },
      markingPopup: { count: 0, items: [] },
      meetingsPopup: { pr: { count: 2, items: [{ learnerId: "42", learnerName: "Synthetic Learner", programme: "Programme A", group: "Group A", date: "2026-09-21", time: "09:30", durationMinutes: 45, status: "scheduled" as const }] }, mcm: { count: 8, items: [] }, catchUps: { count: 0, items: [] } },
    };
    vi.mocked(fetchSharedJsonGet).mockClear();
    vi.mocked(fetchSharedJsonGet).mockResolvedValueOnce(wire);
    const result = await fetchCoachDashboard<ReturnType<typeof adaptDashboardPopupContract>>(new AbortController().signal);
    expect(result.owner).toEqual(wire.owner);
    expect(result.popupLearners).toEqual(wire.learnerPopup.all);
    expect(result.learners[0]).toMatchObject({ id: '42', name: 'Synthetic Learner', otjhTargetAsOfToday: 13, otjhPlanned: 400 });
    expect(Object.keys(result.learners[0]).some(key => key.startsWith('attendance'))).toBe(false);
    expect(result.marking).toEqual({ summary: { pendingItems: 0 }, items: [] });
    expect(result.popupWeekEvents[0]).toMatchObject({ learnerId: "42", source: "progress-review", scheduledDate: "2026-09-21", scheduledTime: "09:30", durationMinutes: 45, status: "scheduled" });
    expect(fetchSharedJsonGet).toHaveBeenCalledTimes(1);
  });
  it('preserves supplied popup profile identity without fetching', () => {
    const wire = {
      owner: { name: 'Synthetic Coach' }, summary,
      learnerPopup: { all: [{ id: '42', name: 'Synthetic Learner', initials: 'SL',
        learnerType: 'apprenticeship' as const, enrolmentId: '101', programmeStatus: 'active',
        programme: 'Programme A', group: 'Group A',
        otjh: { completed: 7, target: 13, planned: 400, ragStatus: 'at-risk' as const } }], atRisk: ['42'] },
      markingPopup: { count: 0, items: [] },
      meetingsPopup: { pr: { count: 0, items: [] }, mcm: { count: 0, items: [] }, catchUps: { count: 0, items: [] } },
    };
    vi.mocked(fetchSharedJsonGet).mockClear();
    expect(adaptDashboardPopupContract(wire).learners[0]).toMatchObject({
      initials: 'SL', learnerType: 'apprenticeship', enrolmentId: '101', rawProgramStatus: 'active',
    });
    expect(fetchSharedJsonGet).not.toHaveBeenCalled();
  });
  it('accepts the previous server shape during rollout', async () => {
    const old = { totals: { totalLearners: 42 }, weeklyCounts: { reviewsAvailable: false } };
    vi.mocked(fetchSharedJsonGet).mockResolvedValueOnce(old);
    expect(await fetchCoachDashboard(new AbortController().signal)).toEqual(old);
  });
});

it('derives the risk count from unique nested popup statuses, ignoring legacy fields and names', () => {
  const row = { id: 'a', name: 'Same Name', programme: null, group: null,
    otjh: { completed: 0, target: 100, planned: 100, ragStatus: 'at-risk' as const } };
  const learners = [row, { ...row }, { ...row, id: 'b', programmeStatus: 'On break' },
    { ...row, id: 'c', status: 'at-risk', otjhRagStatus: 'at-risk', otjh: { ...row.otjh, ragStatus: 'on-track' as const } }];
  const result = adaptDashboardPopupContract({ owner: {}, summary,
    learnerPopup: { all: learners, atRisk: ['c'] }, markingPopup: { count: 0, items: [] },
    meetingsPopup: { pr: { count: 0, items: [] }, mcm: { count: 0, items: [] }, catchUps: { count: 0, items: [] } } });
  expect(result.totals.otjhAtRisk).toBe(2);
  expect(result.popupLearners.map(row => row.id)).toEqual(['a', 'b', 'c']);
  expect(result.popupLearners.filter(row => row.otjh.ragStatus === 'at-risk').map(row => row.id)).toEqual(['a', 'b']);
});
