import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEmployerDashboardMetrics, fetchEmployerPortal, fetchEmployerLearningOverview, fetchEmployerProgressReviewSummary, fetchEmployerTraining } from '../employerPortal';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';

afterEach(() => vi.unstubAllGlobals());

describe('employer portal responses', () => {
  it('uses employer-owned projection routes, preserves null/zero and encodes module identity', async () => {
    const overview = dashboardOverviewFixture();
    overview.metrics.otjh = { actual: 0, targetToDate: null };
    const training = { timeline: { modules: [], reviews: [] }, selectedModuleId: null, selectedModule: null };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(overview)))
      .mockResolvedValueOnce(new Response(JSON.stringify(training)));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await expect(fetchEmployerLearningOverview('9', 'commercial', '265', signal)).resolves.toEqual(overview);
    await expect(fetchEmployerTraining('9', 'commercial', '265', 'current:M1', '2026-10', signal)).resolves.toEqual(training);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/learner_api/employer-portal/9/learner/commercial/265/overview/dashboard/',
      '/learner_api/employer-portal/9/learner/commercial/265/overview/training/?subject=current%3AM1&month=2026-10',
    ]);
    expect(fetch.mock.calls.every(call => call[1].credentials === 'include' && call[1].signal === signal)).toBe(true);
  });

  it('rejects incomplete projection payloads instead of fabricating empty progress', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    await expect(fetchEmployerLearningOverview('9', 'commercial', '265')).rejects.toThrow('Could not load learner progress');
    await expect(fetchEmployerTraining('9', 'commercial', '265')).rejects.toThrow('Could not load the training plan');
  });

  it('requests learner OTJ and programme projections separately', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await fetchEmployerDashboardMetrics('9', signal, 'summary');
    await fetchEmployerDashboardMetrics('9', signal, 'programme');
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/learner_api/employer-portal/9/dashboard-metrics/?section=summary',
      '/learner_api/employer-portal/9/dashboard-metrics/?section=programme',
    ]);
    expect(fetch.mock.calls.every(call => call[1].credentials === 'include' && call[1].signal === signal)).toBe(true);
  });

  it('requests saved risk status independently from the heavier progress projection', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await fetchEmployerDashboardMetrics('9', undefined, 'status');
    expect(fetch).toHaveBeenCalledWith(
      '/learner_api/employer-portal/9/dashboard-metrics/?section=status',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('requests the current-month review summary without the full review history', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [] })));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await fetchEmployerProgressReviewSummary('9', 'commercial', '265', '2026-10', signal);
    expect(fetch).toHaveBeenCalledWith(
      '/learner_api/employer-portal/9/learner/commercial/265/progress-reviews/?summary_month=2026-10',
      expect.objectContaining({ credentials: 'include', signal }),
    );
  });

  it.each([500, 502])('reports an HTML server error without exposing a JSON parsing error (%s)', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!DOCTYPE html><h1>Server error</h1>', { status })));
    await expect(fetchEmployerPortal('9')).rejects.toThrow(`Could not load employer portal data (${status}). Please try again.`);
  });

  it('rejects an HTML success response rather than presenting it as employer data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!DOCTYPE html><h1>Sign in</h1>')));
    await expect(fetchEmployerPortal('9')).rejects.toThrow('The employer portal returned an unexpected response. Please try again.');
  });

  it.each(['error', 'detail'])('retains the server JSON %s message', async key => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ [key]: 'Access denied.' }), { status: 403 })));
    await expect(fetchEmployerPortal('9')).rejects.toThrow('Access denied.');
  });

  it('allows a retry after an HTML failure and retains the successful response and session credentials', async () => {
    const payload = { employer: { id: '9' }, learners: [], outstandingTotal: 0 };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('<!DOCTYPE html>', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchEmployerPortal('9')).rejects.toThrow('(500)');
    await expect(fetchEmployerPortal('9')).resolves.toEqual(payload);
    expect(fetch).toHaveBeenLastCalledWith('/learner_api/employer-portal/9/', expect.objectContaining({ credentials: 'include' }));
  });
});
