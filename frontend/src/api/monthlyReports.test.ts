import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readLearnerJson } from './learnerRead';
import {
  fetchMonthlyReport,
  fetchMonthlyReports,
  submitMonthlyReport,
} from './monthlyReports';

vi.mock('./learnerRead', () => ({ readLearnerJson: vi.fn() }));

const report = (id: string, monthKey: string) => ({
  id,
  learnerKind: 'commercial',
  learnerId: '42',
  learnerName: 'Synthetic Learner',
  programmeName: 'Programme',
  monthKey,
  monthLabel: monthKey,
  status: 'submitted',
  learnedSummary: 'Reflection',
  summaryMetrics: {},
  attachments: [],
  selectedKsbs: [],
  signed: true,
  signedName: 'Synthetic Learner',
  signedAt: null,
  submittedAt: null,
  updatedAt: '2026-10-24T09:30:00Z',
  activityCount: 1,
});

describe('monthly report bounded reads and concurrency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('walks every bounded summary page without duplicates', async () => {
    vi.mocked(readLearnerJson)
      .mockResolvedValueOnce({
        reports: [report('one', '2026-09')],
        savedSignature: 'saved',
        savedSignatureName: 'Learner',
        pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2, hasNext: true, hasPrevious: false },
      })
      .mockResolvedValueOnce({
        reports: [report('two', '2026-08'), report('one', '2026-09')],
        pagination: { page: 2, pageSize: 1, total: 2, totalPages: 2, hasNext: false, hasPrevious: true },
      });

    const result = await fetchMonthlyReports('commercial', '42');

    expect(readLearnerJson).toHaveBeenNthCalledWith(
      1, '/learner_api/monthly-reports/commercial/42/?page=1&pageSize=50',
    );
    expect(readLearnerJson).toHaveBeenNthCalledWith(
      2, '/learner_api/monthly-reports/commercial/42/?page=2&pageSize=50',
    );
    expect(result.reports.map((item) => item.id)).toEqual(['one', 'two']);
    expect(result.savedSignature).toBe('saved');
  });

  it('loads one full report only when requested', async () => {
    vi.mocked(readLearnerJson).mockResolvedValue({
      report: { ...report('one', '2026-09'), signature: 'data:image/png;base64,c2ln', activitySnapshot: [] },
    });

    await fetchMonthlyReport('commercial', '42', '2026-09');

    expect(readLearnerJson).toHaveBeenCalledWith(
      '/learner_api/monthly-reports/commercial/42/?month=2026-09',
    );
  });

  it('sends the optimistic version token on resubmission', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      report: { ...report('one', '2026-09'), signature: 'data:image/png;base64,c2ln', activitySnapshot: [] },
    }), { status: 201 }));

    await submitMonthlyReport('commercial', '42', {
      monthKey: '2026-09',
      monthLabel: 'September 2026',
      learnedSummary: 'Updated',
      activitySnapshot: [],
      summaryMetrics: {},
      attachments: [],
      selectedKsbs: [],
      signature: 'data:image/png;base64,c2ln',
      signedName: 'Synthetic Learner',
      expectedUpdatedAt: '2026-10-24T09:30:00Z',
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      expectedUpdatedAt: '2026-10-24T09:30:00Z',
    });
  });
});

