import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installApiGetBatching, uninstallApiGetBatching } from '../apiGetBatching';

describe('API GET batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    uninstallApiGetBatching();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends simultaneous API GETs through one HTTP request', async () => {
    const transport = vi.fn(async (
      _input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const requestPayload = JSON.parse(String(init?.body)) as {
        requests: Array<{ id: string; url: string }>;
      };
      return new Response(JSON.stringify({
        responses: requestPayload.requests.map(item => ({
          id: item.id,
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: btoa(JSON.stringify({ url: item.url })),
        })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', transport);
    installApiGetBatching();

    const first = fetch(`${location.origin}/coach_api/coach/caseload`);
    const second = fetch(`${location.origin}/learner_api/learners/`);
    await vi.advanceTimersByTimeAsync(20);

    const [firstPayload, secondPayload] = await Promise.all([
      first.then(response => response.json()),
      second.then(response => response.json()),
    ]);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('/coach_api/_batch/', expect.objectContaining({ method: 'POST' }));
    expect(firstPayload.url).toBe('/coach_api/coach/caseload');
    expect(secondPayload.url).toBe('/learner_api/learners/');
  });

  it('sends a single GET directly without batch encoding overhead', async () => {
    const transport = vi.fn(async () => new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', transport);
    installApiGetBatching();

    const pending = fetch(`${location.origin}/coach_api/coach/dashboard`);
    await vi.advanceTimersByTimeAsync(20);
    const payload = await pending.then(response => response.json());

    expect(payload).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      '/coach_api/coach/dashboard',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('does not batch writes, external calls, or downloads', async () => {
    const transport = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', transport);
    installApiGetBatching();

    await Promise.all([
      fetch(`${location.origin}/learner_api/learners/`, { method: 'POST' }),
      fetch('https://example.com/data'),
      fetch(`${location.origin}/learner_api/evidence/1/download/`),
      fetch(`${location.origin}/api/chat/session/`, { credentials: 'include' }),
    ]);

    expect(transport).toHaveBeenCalledTimes(4);
  });
});
