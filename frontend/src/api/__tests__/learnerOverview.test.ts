import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeSummary, learningSchedule, overviewSchedule, overviewWeek, upcomingSchedule } from '../learnerOverview';
import { dashboardOverview } from '../dashboardTabs';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import { clearAllCachedResources } from '../cachedRequest';

const week = { weekStart: '2026-09-07', modules: [], deadlines: [], otjh: {} };
const home = { ...week, homeProgress: {
  otjh: { actual: 10, submitted: 2, planned: 100, percent: 10, missingPlannedActivities: 0 },
  period: { start: '2026-01-01', end: '2026-09-13' },
  activities: { completed: 1, total: 10 }, assignments: { completed: 1, total: 4 },
  lectures: null, modules: { completed: 0, total: 4 }, undatedActivities: 0,
} };
beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });
describe('home progress transport', () => {
  it('requests the compact home summary without reusing a weekly-only cache or another learner', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(week)))
      .mockResolvedValueOnce(new Response(JSON.stringify(home)));
    await overviewWeek.read('apprenticeship', '499');
    expect(homeSummary.peek('apprenticeship', '499')).toBeUndefined();
    await expect(homeSummary.read('apprenticeship', '499')).resolves.toEqual(home);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('/overview-week/apprenticeship/499/?section=home-summary');
    expect(homeSummary.peek('apprenticeship', '499')).toEqual(home);
    expect(homeSummary.peek('apprenticeship', '500')).toBeUndefined();
    expect(homeSummary.peek('commercial', '499')).toBeUndefined();
  });
  it('rejects a stale server response that lacks the new totals', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(week)));
    await expect(homeSummary.read('apprenticeship', '499')).rejects.toThrow('Could not load your overview');
  });
});

describe('home upcoming transport', () => {
  const upcoming = { events: [{ id: 's1', type: 'session', title: 'Lecture', date: '2026-10-15T09:00:00+00:00' }] };
  it('requests only the upcoming section for this learner', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(upcoming)));
    await expect(upcomingSchedule.read('commercial', '265')).resolves.toEqual(upcoming);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/training-plan-dashboard/commercial/265/?section=upcoming');
    expect(upcomingSchedule.peek('commercial', '265')).toEqual(upcoming);
    expect(upcomingSchedule.peek('commercial', '266')).toBeUndefined();
  });
  it('does not mistake a cached full overview for the compact events', async () => {
    const overview = { sessions: [], reviews: [], modules: [], moduleLinks: {}, coach: { name: 'Coach' } };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(overview)));
    await overviewSchedule.read('commercial', '265');
    expect(upcomingSchedule.peek('commercial', '265')).toBeUndefined();
  });
  it('rejects a response without events, such as the previous sessions-and-reviews shape', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sessions: [], reviews: [] })));
    await expect(upcomingSchedule.read('commercial', '265')).rejects.toThrow('Could not load your overview');
  });
});

describe('dashboard overview transport', () => {
  it('loads canonical dashboard facts independently of the legacy weekly cache', async () => {
    const dashboard = dashboardOverviewFixture();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(dashboard)));
    await expect(dashboardOverview.read('commercial', '125')).resolves.toEqual(dashboard);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('/learner_api/dashboard/commercial/125/overview/');
    expect(overviewWeek.peek('commercial', '125')).toBeUndefined();
  });

  it('rejects a dashboard response without metrics', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(week)));
    await expect(dashboardOverview.read('commercial', '125')).rejects.toThrow('Could not load your overview');
  });
});

describe('My Learning schedule transport', () => {
  it('requests the lightweight learning section', async () => {
    const schedule = { modules: [], moduleLinks: {}, generatedAt: '2026-09-16T00:00:00Z' };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(schedule)));
    await expect(learningSchedule.read('commercial', '125')).resolves.toEqual(schedule);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/training-plan-dashboard/commercial/125/?section=learning');
  });
});
