import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAuditRequestContext } from '../auditRequestContext';

describe('audit request page', () => {
  let stop: () => void;
  const transport = vi.fn().mockResolvedValue(new Response('{}'));
  beforeEach(() => {
    transport.mockClear();
    vi.stubGlobal('fetch', transport);
    window.history.replaceState({}, '', '/tutor/marking?private=omitted#details');
    stop = installAuditRequestContext();
  });
  afterEach(() => { stop(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

  it('preserves body, signal and CSRF while recording only the initiating path', async () => {
    const signal = new AbortController().signal;
    await fetch('/coach_api/mark/', { method: 'POST', body: '{"score":7}', signal, headers: { 'X-CSRFToken': 'test-token' } });
    const options = transport.mock.calls[0][1];
    expect(options.headers.get('X-Audit-Page')).toBe('/tutor/marking');
    expect(options.headers.get('X-CSRFToken')).toBe('test-token');
    expect(options.body).toBe('{"score":7}');
    expect(options.signal).toBe(signal);
  });

  it('preserves Request headers and the original request body', async () => {
    const request = new Request(`${location.origin}/learner_api/evidence/`, { method: 'PATCH', body: 'data', headers: { 'X-CSRFToken': 'test' } });
    await fetch(request);
    expect(transport.mock.calls[0][0]).toBe(request);
    expect(transport.mock.calls[0][1].headers.get('X-CSRFToken')).toBe('test');
    expect(request.bodyUsed).toBe(false);
  });

  it('does not modify reads, non-API writes or external uploads', async () => {
    for (const [url, options] of [
      ['/coach_api/calendar/', {}],
      ['/asset', { method: 'POST' }],
      ['https://storage.example/learner_api/upload/', { method: 'PUT' }],
    ] as const) {
      await fetch(url, options);
      expect(transport).toHaveBeenLastCalledWith(url, options);
    }
  });
});
