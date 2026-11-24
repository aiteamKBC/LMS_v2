import { afterEach, expect, it, vi } from 'vitest';
import { fetchDeepDiveSummaries } from './deepDive';
import { readLearnerJson } from './learnerRead';

vi.mock('./learnerRead', () => ({ readLearnerJson: vi.fn() }));

afterEach(() => vi.mocked(readLearnerJson).mockReset());

it('loads Deep Dive summaries through the deployed staff API route', async () => {
  const summaries = { count: 0, records: [] };
  vi.mocked(readLearnerJson).mockResolvedValue(summaries);

  await expect(fetchDeepDiveSummaries()).resolves.toEqual(summaries);
  expect(readLearnerJson).toHaveBeenCalledWith('/coach_api/qms/deep-dive/records/summary/');
});
