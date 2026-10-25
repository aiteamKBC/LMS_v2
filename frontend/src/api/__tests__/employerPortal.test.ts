import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEmployerDashboardMetrics, fetchEmployerLearnerAttendance, fetchEmployerPortal } from '../employerPortal';

afterEach(() => vi.unstubAllGlobals());

describe('employer portal responses', () => {
  it('requests lightweight saved totals independently from programme and attendance reads', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await fetchEmployerDashboardMetrics('9', signal, 'summary');
    await fetchEmployerDashboardMetrics('9', signal, 'programme');
    await fetchEmployerLearnerAttendance('9', 'commercial', '12', signal);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/learner_api/employer-portal/9/dashboard-metrics/?section=summary',
      '/learner_api/employer-portal/9/dashboard-metrics/?section=programme',
      '/learner_api/employer-portal/9/learner/commercial/12/overview/attendance/',
    ]);
    expect(fetch.mock.calls.every(call => call[1].credentials === 'include' && call[1].signal === signal)).toBe(true);
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
