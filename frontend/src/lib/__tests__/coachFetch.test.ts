import { beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('coachFetch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('sends GET credentials without requesting or attaching a CSRF token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { coachFetch } = await import('../coachFetch');

    await coachFetch('/coach_api/coach/dashboard');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).has('X-CSRFToken')).toBe(false);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE']) (
    'sends credentials and X-CSRFToken for %s',
    async method => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ csrfToken: 'server-token' }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);
      const { coachFetch } = await import('../coachFetch');

      await coachFetch('/coach_api/coach/resource', { method });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/csrf');
      expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: 'include' });
      const init = fetchMock.mock.calls[1][1] as RequestInit;
      expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).get('X-CSRFToken')).toBe('server-token');
    },
  );
});
