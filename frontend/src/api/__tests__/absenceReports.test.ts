import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitAbsenceReport } from '../absenceReports';
import { clearAllCachedResources } from '../cachedRequest';

const html = (status: number) => new Response('<html><body>Bad gateway</body></html>', { status, headers: { 'Content-Type': 'text/html' } });

beforeEach(() => { clearAllCachedResources(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

describe('absence report submission', () => {
  it.each([502, 504])('explains a gateway timeout (%s) instead of reporting an invalid response', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(html(status));
    await expect(submitAbsenceReport('apprenticeship', '12', new FormData()))
      .rejects.toThrow('The server took too long to respond. Please check your reports before trying again.');
  });

  it('shows a plain message for any other page that is not the API response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(html(500));
    const error = await submitAbsenceReport('apprenticeship', '12', new FormData()).catch((reason: Error) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/invalid response/);
    expect((error as Error).message).toBe('Something went wrong on our side. Please try again in a moment.');
  });

  it('keeps the API error message and accepts a retried report that was already saved', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Choose an available alternative session.' }), { status: 400 }));
    await expect(submitAbsenceReport('apprenticeship', '12', new FormData())).rejects.toThrow('Choose an available alternative session.');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 7, reference: 'AR-0007' }), { status: 200 }));
    await expect(submitAbsenceReport('apprenticeship', '12', new FormData())).resolves.toMatchObject({ id: 7 });
  });
});
