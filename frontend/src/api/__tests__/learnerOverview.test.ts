import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overviewHome, overviewWeek } from '../learnerOverview';
import { clearAllCachedResources } from '../cachedRequest';

const week = { weekStart: '2026-09-07', modules: [], deadlines: [], otjh: {} };
const home = { ...week, homeProgress: {
  otjh: { actual: 10, submitted: 2, planned: 100, percent: 10, missingPlannedActivities: 0 },
  period: { start: '2026-01-01', end: '2026-09-13', timezone: 'Europe/London' },
  activities: { completed: 1, total: 10 }, assignments: { completed: 1, total: 4 },
  lectures: null, modules: { completed: 0, total: 4 }, undatedActivities: 0,
} };
beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });
describe('home progress transport', () => {
  it('requests the home section without reusing a weekly-only cache or another learner', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(week)))
      .mockResolvedValueOnce(new Response(JSON.stringify(home)));
    await overviewWeek.read('apprenticeship', '499');
    expect(overviewHome.peek('apprenticeship', '499')).toBeUndefined();
    await expect(overviewHome.read('apprenticeship', '499')).resolves.toEqual(home);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('/overview-week/apprenticeship/499/?section=home');
    expect(overviewHome.peek('apprenticeship', '499')).toEqual(home);
    expect(overviewHome.peek('apprenticeship', '500')).toBeUndefined();
    expect(overviewHome.peek('commercial', '499')).toBeUndefined();
  });
  it('rejects a stale server response that lacks the new totals', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(week)));
    await expect(overviewHome.read('apprenticeship', '499')).rejects.toThrow('Could not load your overview');
  });
});
