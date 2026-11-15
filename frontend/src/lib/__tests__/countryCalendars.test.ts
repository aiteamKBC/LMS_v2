import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('country calendar protected transport', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => vi.unstubAllGlobals());

  it('imports each required year with CSRF and filters to the delivery period', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ csrfToken: 'synthetic-token' }))
      .mockResolvedValueOnce(json({ holidays: [{ id: 'one', startDate: '2026-12-25', endDate: '2026-12-25' }] }))
      .mockResolvedValueOnce(json({ holidays: [{ id: 'two', startDate: '2027-01-01', endDate: '2027-01-01' },
        { id: 'outside', startDate: '2027-06-01', endDate: '2027-06-01' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { importCountryCalendar } = await import('../curriculumApi');
    const response = await importCountryCalendar('SA', '2026-12-01', '2027-02-01');
    expect(response.holidays.map(row => row.id)).toEqual(['one', 'two']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls.slice(1) as [string, RequestInit][]) {
      expect(url).toContain('/curriculum/country-calendars/');
      expect(new Headers(init.headers).get('X-CSRFToken')).toBe('synthetic-token');
      expect(init.credentials).toBe('include');
    }
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).startDate).toBe('2026-01-01');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).endDate).toBe('2027-12-31');
  });

  it('does not make import requests when CSRF initialization fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, 403));
    vi.stubGlobal('fetch', fetchMock);
    const { importCountryCalendar } = await import('../curriculumApi');
    await expect(importCountryCalendar('EG', '2026-01-01', '2026-12-31')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/csrf');
  });

  it('reports a partial sync and never imports countries outside the saved list', async () => {
    const saved = { country: 'SA', year: 2026, fetchedAt: '', due: true, expired: false, count: 10, message: '' };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ calendars: [saved] }))
      .mockResolvedValueOnce(json({ csrfToken: 'synthetic-token' }))
      .mockResolvedValueOnce(json({ england: { status: 'ok' } }))
      .mockResolvedValueOnce(json({ calendar: { ...saved, status: 'error', message: 'Provider unavailable' } }, 207));
    vi.stubGlobal('fetch', fetchMock);
    const { syncCountryCalendars } = await import('../curriculumApi');
    const result = await syncCountryCalendars();
    expect(result.success).toBe(false);
    expect(result.england.status).toBe('ok');
    expect(result.calendars).toEqual([{ ...saved, status: 'error', message: 'Provider unavailable' }]);
    const writes = fetchMock.mock.calls.filter(call => call[1]?.method === 'POST');
    expect(writes.map(call => JSON.parse(call[1].body))).toEqual([{ country: 'GB' }, { country: 'SA', year: 2026 }]);
  });
});
