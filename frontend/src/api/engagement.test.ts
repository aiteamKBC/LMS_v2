import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('engagement API error handling', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

  it('reports a useful server error when a failed write returns HTML', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf-1' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => '<!DOCTYPE html>' });
    vi.stubGlobal('fetch', fetchMock);
    const { createEvent } = await import('./engagement');

    await expect(createEvent({
      title: 'Offline event', description: 'Description', eventDate: '2029-09-29',
      startTime: '14:05', endTime: '14:40', location: 'Tanta', type: 'offline', organizer: 'Staff',
    })).rejects.toThrow('The server could not complete the request (500). Check the backend logs.');
  });
});
