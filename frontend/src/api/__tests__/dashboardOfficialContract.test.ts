import { afterEach, describe, expect, it, vi } from 'vitest';
import { dashboardOverview } from '../dashboardTabs';
import { fetchEmployerLearningOverview } from '../employerPortal';
import { clearAllCachedResources } from '../cachedRequest';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });
describe('additive official programme contract', () => {
  it.each([288, null, 0, undefined, -1, '288'])('retains independent monthly facts and raw optional P=%s for guarded presentation', async value => {
    const payload = dashboardOverviewFixture();
    Object.assign(payload.metrics.otjh, { officialPlannedHours: value });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))));
    const learner = await dashboardOverview.read('commercial', '265');
    const employer = await fetchEmployerLearningOverview('9', 'commercial', '265');
    expect(learner.metrics.otjh.officialPlannedHours).toBe(value);
    expect(employer).toEqual(learner);
    expect(learner.hours).toEqual(payload.hours);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['actual', 'targetToDate'])('does not weaken required %s validation', async key => {
    const payload = dashboardOverviewFixture(); delete (payload.metrics.otjh as Record<string, unknown>)[key];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))));
    await expect(dashboardOverview.read('commercial', '265')).rejects.toThrow();
    await expect(fetchEmployerLearningOverview('9', 'commercial', '265')).rejects.toThrow();
  });
  it('preserves forbidden Employer request semantics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })));
    await expect(fetchEmployerLearningOverview('9', 'commercial', '265')).rejects.toThrow();
  });
});
