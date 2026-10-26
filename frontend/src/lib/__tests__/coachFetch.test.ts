import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
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
      // Bootstrap deliberately has a timeout; retain an exact transport
      // assertion and verify its abort behaviour below.
      expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: 'include', signal: expect.any(AbortSignal) });
      const init = fetchMock.mock.calls[1][1] as RequestInit;
      expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).get('X-CSRFToken')).toBe('server-token');
    },
  );

  it('aborts a stalled CSRF bootstrap at 15 seconds and permits a fresh retry', async () => {
    vi.useFakeTimers();
    let bootstrapSignal!: AbortSignal;
    const fetchMock = vi.fn().mockImplementationOnce((_input: RequestInfo, init: RequestInit) => {
      bootstrapSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        bootstrapSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { coachFetch } = await import('../coachFetch');
    const failure = expect(coachFetch('/coach_api/coach/resource', { method: 'POST' }))
      .rejects.toThrow('Timed out initialising request verification.');
    await vi.advanceTimersByTimeAsync(14999);
    expect(bootstrapSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(bootstrapSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no unsafe request after failed verification
    fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: 'fresh-server-token' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    await coachFetch('/coach_api/coach/resource', { method: 'POST' });
    expect(fetchMock.mock.calls[1][0]).toBe('/coach_api/csrf');
    const init = fetchMock.mock.calls[2][1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('fresh-server-token');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("carries an administrator's selected coach on every coach request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    const { setCoachViewAs } = await import('../coachViewAs');
    const { coachFetch } = await import('../coachFetch');
    setCoachViewAs({ email: 'coach-a@kbc.test', name: 'Coach A' }, 'admin@kbc.test');

    await coachFetch('/coach_api/coach/caseload');

    expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/coach/caseload?viewAsCoach=coach-a%40kbc.test');
    localStorage.clear();
  });
});
