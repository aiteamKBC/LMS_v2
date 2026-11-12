import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBreathePreview, triggerBreatheSync } from './breatheIntegration';

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
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sync_run_id: 'run-1', connection_id: 'c1', status: 'queued' }), { status: 202 }));

    await triggerBreatheSync('c1', ['employees']);

    expect(fetch).toHaveBeenCalledWith('/integrations_api/breathe/connections/c1/sync', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ resources: ['employees'], idempotency_key: 'job-1' }),
    }));
  });
});
