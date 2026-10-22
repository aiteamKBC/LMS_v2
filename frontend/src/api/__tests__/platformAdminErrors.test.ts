import { afterEach, expect, it, vi } from 'vitest';
import { fetchAccounts, fetchReportDrill, type ReportDrill } from '../platformAdmin';

afterEach(() => vi.restoreAllMocks());

it('preserves an unavailable report response with redacted string fields', async () => {
  const payload: ReportDrill = {
    metric: 'synthetic_metric', label: 'Synthetic', available: false,
    error: 'The database service is temporarily unavailable.',
    table: '', countSql: '', rowsSql: '',
  };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload));
  await expect(fetchReportDrill('synthetic_metric')).resolves.toEqual(payload);
  expect(fetcher).toHaveBeenCalledWith('/login_api/admin/report-drill/?metric=synthetic_metric',
    expect.objectContaining({ credentials: 'include' }));
});

it.each([
  [502, 'The database service is temporarily unavailable.'],
  [403, 'You do not have permission to perform this action.'],
  [400, 'Invalid account filter.'],
] as const)('preserves the public error message for HTTP %i', async (status, error) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error }, { status }));
  await expect(fetchAccounts()).rejects.toThrow(error);
});
