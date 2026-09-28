import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachFetch } from '@/lib/coachFetch';
import { getCoachMonthlyCycle, monthlyCycleEndpoint } from './monthlyLogsApi';

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
});
