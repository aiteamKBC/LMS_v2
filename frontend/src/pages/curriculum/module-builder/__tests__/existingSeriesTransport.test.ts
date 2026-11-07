import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('existing Teams series request verification', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  async function request(action: 'preview' | 'apply') {
    const api = await import('../moduleAuthoringData');
    if (action === 'preview') {
      return api.previewExistingTeamsSeries('MOD/1', {
        link: 'https://teams.microsoft.com/meet/synthetic',
        weekIds: ['W1', 'W3'], calendarMailbox: 'owner@example.invalid',
      });
    }
    return api.linkExistingTeamsSeries('MOD/1', 'signed-review');
  }

  it.each(['preview', 'apply'] as const)('sends %s with the session CSRF token and original payload', async action => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { createLocalModuleDraft } = await import('../moduleAuthoringData');
    const module = createLocalModuleDraft({ programme: 'Synthetic', title: 'Course', description: '', weeks: 1, status: 'draft' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: 'session-token' }))
      .mockResolvedValueOnce(jsonResponse(action === 'preview' ? { matched: 1, previewToken: 'signed-review' }
        : { module, matched: 1, unmatched: 0, alreadyLinked: false }));

    await expect(request(action)).resolves.toMatchObject({ matched: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/csrf');
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/curriculum/modules/MOD%2F1/teams-existing-series/');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('session-token');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual(action === 'preview'
      ? { action, link: 'https://teams.microsoft.com/meet/synthetic', weekIds: ['W1', 'W3'], calendarMailbox: 'owner@example.invalid' }
      : { action, previewToken: 'signed-review' });
  });

  it.each(['preview', 'apply'] as const)('never sends %s after CSRF bootstrap fails', async action => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request(action)).rejects.toThrow('Unable to initialise request verification.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/csrf');
  });

  it.each(['preview', 'apply'] as const)('preserves server refusals for %s without retrying', async action => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'session-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'The series changed. Check it again.' }, 409));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request(action)).rejects.toMatchObject({ status: 409, message: 'The series changed. Check it again.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps join-links-only requests on their existing transport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ updated: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const { replaceModuleTeamsLinks } = await import('../moduleAuthoringData');
    await replaceModuleTeamsLinks('MOD-1', { weekIds: ['W1'], link: 'https://teams.microsoft.com/meet/synthetic' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/curriculum/modules/MOD-1/teams-links/');
  });
});
