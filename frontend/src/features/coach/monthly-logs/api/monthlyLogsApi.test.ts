import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { getCoachLogDetail, getCoachLogYear, getCoachMonthlyCycle, getCoachMonthlyLogLearners, monthlyCycleEndpoint } from './monthlyLogsApi';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));

describe('Coach Monthly Logs request ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves the exact monthly-cycle endpoint contract', () => {
    expect(monthlyCycleEndpoint('2026-09')).toBe('/coach_api/coach/monthly-activity?month=2026-09');
  });

  it('makes one abortable request for the selected month', async () => {
    const signal = new AbortController().signal;
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({ month: '2026-09', learners: [] })));
    await getCoachMonthlyCycle('2026-09', signal);
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/monthly-activity?month=2026-09', { signal });
  });

  it.each([
    ['learner list', () => getCoachMonthlyLogLearners()],
    ['learner year', () => getCoachLogYear('7', 2026)],
    ['another learner year', () => getCoachLogYear('8', 2026)],
    ['month detail', () => getCoachLogDetail('7', '2026-10')],
  ])('shows a readable HTTP error for an HTML %s response', async (_, read) => {
    vi.mocked(coachFetch).mockResolvedValue(new Response('<!doctype html><title>Server Error</title>', {
      status: 500, headers: { 'Content-Type': 'text/html' },
    }));
    await expect(read()).rejects.toThrow('Monthly logs could not be loaded (HTTP 500). Please try again.');
  });

  it.each([null, [], '<!doctype html><title>Sign in</title>'])('rejects an invalid successful response without exposing parser errors', async payload => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(typeof payload === 'string' ? payload : JSON.stringify(payload)));
    await expect(getCoachLogYear('7', 2026)).rejects.toThrow('The server returned an invalid monthly logs response. Please refresh and try again.');
  });

  it.each([
    [401, { error: 'Please sign in again.' }, 'Please sign in again.'],
    [403, { detail: 'This learner is outside your caseload.' }, 'This learner is outside your caseload.'],
    [503, { error: 'Monthly logs are temporarily unavailable.' }, 'Monthly logs are temporarily unavailable.'],
    [502, { error: { internal: true } }, 'Monthly logs could not be loaded (HTTP 502). Please try again.'],
  ])('preserves readable JSON errors for HTTP %i', async (status, payload, message) => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify(payload), { status }));
    await expect(getCoachLogYear('7', 2026)).rejects.toThrow(message);
  });

  it('preserves successful data and the learner/year request contract', async () => {
    const payload = { learner: { id: 8 }, months: [], unallocatedActivities: [{ id: 80, actual_hours: 1.25 }] };
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(getCoachLogYear('8', 2026)).resolves.toEqual(payload);
    expect(coachFetch).toHaveBeenCalledWith('/coach_api/coach/monthly-logs/8?year=2026');
  });
});
