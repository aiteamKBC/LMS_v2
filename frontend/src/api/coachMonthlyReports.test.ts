import { beforeEach, describe, expect, it, vi } from 'vitest';

import { coachFetch } from '@/lib/coachFetch';
import { fetchCoachMonthlyReports } from './coachMonthlyReports';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));

describe('coach monthly report pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests one stable server page and preserves whole-filter totals', async () => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({
      items: [],
      months: [{ monthKey: '2026-09', monthLabel: 'September 2026' }],
      learners: [{ learnerId: '42', learnerName: 'Synthetic Learner' }],
      pagination: { page: 2, pageSize: 25, total: 30, totalPages: 2, hasNext: false, hasPrevious: true },
      summary: { reports: 30, learners: 12, attachments: 8, unsigned: 1 },
    })));

    const result = await fetchCoachMonthlyReports({
      month: '2026-09', search: 'Synthetic', page: 2, pageSize: 25,
    });

    expect(coachFetch).toHaveBeenCalledWith(
      '/coach_api/coach/monthly-reports?month=2026-09&search=Synthetic&page=2&pageSize=25',
      { cache: 'no-store', signal: undefined },
    );
    expect(result.pagination.total).toBe(30);
    expect(result.summary.learners).toBe(12);
  });

  it('passes request cancellation through to the authenticated transport', async () => {
    vi.mocked(coachFetch).mockResolvedValue(new Response(JSON.stringify({
      items: [], months: [], learners: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1, hasNext: false, hasPrevious: false },
      summary: { reports: 0, learners: 0, attachments: 0, unsigned: 0 },
    })));
    const controller = new AbortController();

    await fetchCoachMonthlyReports({}, controller.signal);

    expect(coachFetch).toHaveBeenCalledWith(
      '/coach_api/coach/monthly-reports?page=1&pageSize=25',
      { cache: 'no-store', signal: controller.signal },
    );
  });
});

