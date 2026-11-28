import { afterEach, describe, expect, it, vi } from 'vitest';
import { qaFindingsApi } from './qaFindings';

afterEach(() => vi.unstubAllGlobals());

describe('QA findings API', () => {
  it('reads findings through the deployed staff API route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ findings: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(qaFindingsApi.list()).resolves.toEqual({ findings: [] });
    expect(fetchMock).toHaveBeenCalledWith('/coach_api/qms/feedback-findings/', expect.objectContaining({ credentials: 'include' }));
  });

  it('sends a CSRF protected versioned update and returns the saved finding', async () => {
    const saved = { id: 11, status: 'In Progress', version: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'synthetic-csrf' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ finding: saved }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await qaFindingsApi.update(11, { expectedVersion: 0, status: 'In Progress' })).toEqual(saved);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/coach_api/qms/feedback-findings/11/', expect.objectContaining({
      method: 'PATCH', credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRFToken': 'synthetic-csrf' }),
      body: JSON.stringify({ expectedVersion: 0, status: 'In Progress' }),
    }));
  });

  it('surfaces a version conflict instead of claiming a save', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'synthetic-csrf' }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Finding changed. Reload and try again.' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(qaFindingsApi.update(11, { expectedVersion: 0, status: 'In Progress' }))
      .rejects.toThrow('Finding changed. Reload and try again.');
  });
});
