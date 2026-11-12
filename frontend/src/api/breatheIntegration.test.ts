import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBreatheConnection, getBreathePreview, triggerBreatheSync } from './breatheIntegration';

describe('Breathe integration API', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'job-1' });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads tenant-scoped preview with the LMS session cookie', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ connection: { id: 'c1' }, pendingMatches: [] }), { status: 200 }));

    const preview = await getBreathePreview('c1');

    expect(preview.pendingMatches).toEqual([]);
    expect(fetch).toHaveBeenCalledWith('/integrations_api/breathe/connections/c1/preview', expect.objectContaining({ credentials: 'include' }));
  });

  it('queues an idempotent sync request with the selected resources', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'test-csrf' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sync_run_id: 'run-1', connection_id: 'c1', status: 'queued' }), { status: 202 }));

    await triggerBreatheSync('c1', ['employees']);

    expect(fetch).toHaveBeenCalledWith('/integrations_api/breathe/connections/c1/sync', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-CSRFToken': 'test-csrf' }),
      body: JSON.stringify({ resources: ['employees'], idempotency_key: 'job-1' }),
    }));
  });

  it('obtains CSRF before creating a connection and never sends a credential value', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'test-csrf' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'c1' }), { status: 201 }));
    await createBreatheConnection({ tenantKey: 'demo', externalAccountId: '42', secretRef: 'env:BREATHE_API_KEY_DEMO' });
    expect(fetch).toHaveBeenNthCalledWith(1, '/integrations_api/breathe/csrf', expect.objectContaining({ credentials: 'include' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/integrations_api/breathe/connections/create', expect.objectContaining({
      headers: expect.objectContaining({ 'X-CSRFToken': 'test-csrf', 'X-Requested-With': 'XMLHttpRequest' }),
    }));
  });

  it('does not post when the CSRF request fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Connector disabled' }), { status: 503 }));
    await expect(triggerBreatheSync('c1')).rejects.toThrow('Connector disabled');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
