import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoachCaseload } from './caseloadApi';

const { coachFetch } = vi.hoisted(() => ({ coachFetch: vi.fn() }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch }));

const response = (payload: unknown) => ({ ok: true, json: vi.fn().mockResolvedValue(payload) });

describe('Caseload request ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts the Caseload and engagement bulk requests in parallel', async () => {
    let resolveCaseload!: (value: ReturnType<typeof response>) => void;
    let resolveAnalytics!: (value: ReturnType<typeof response>) => void;
    coachFetch.mockReturnValue(new Promise((resolve) => { resolveCaseload = resolve; }));
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((resolve) => { resolveAnalytics = resolve; })));
    const controller = new AbortController();

    const pending = loadCoachCaseload('/coach_api/coach/caseload?page=1', controller.signal);

    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(coachFetch).toHaveBeenCalledWith(
      '/coach_api/coach/caseload?page=1', { signal: controller.signal },
    );
    expect(fetch).toHaveBeenCalledWith('/engagement_api/learner-analytics/', {
      credentials: 'include', signal: controller.signal,
    });

    resolveAnalytics(response({ learners: [{ id: '7', overallStatus: 'high' }] }));
    resolveCaseload(response({ results: [{ id: '1', enrolmentId: '7' }] }));
    await expect(pending).resolves.toEqual({
      caseload: { results: [{ id: '1', enrolmentId: '7' }] },
      analytics: [{ id: '7', overallStatus: 'high' }],
    });
  });

  it('does not retry either request and degrades analytics failure to unavailable data', async () => {
    coachFetch.mockResolvedValue(response({ results: [] }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('analytics unavailable')));

    await expect(loadCoachCaseload('/coach_api/coach/caseload?page=1', new AbortController().signal))
      .resolves.toEqual({ caseload: { results: [] }, analytics: [] });
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
