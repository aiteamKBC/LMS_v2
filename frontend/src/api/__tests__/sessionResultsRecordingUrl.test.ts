import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRecordingUrl } from '../sessionResults';

afterEach(() => vi.unstubAllGlobals());

describe('staff recording URL resolution', () => {
  it('requests a signed Azure download with the browser session', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ url: 'https://storage.invalid/recording.mp4?signature' }) });
    vi.stubGlobal('fetch', fetch);
    await expect(resolveRecordingUrl('series 1', 'file 2', true)).resolves.toContain('storage.invalid');
    expect(fetch).toHaveBeenCalledWith(
      '/curriculum_api/curriculum/session-results/series%201/artifacts/file%202/?download=1&resolve=1',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('surfaces an expired login without trying to navigate to JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(resolveRecordingUrl('S', 'R')).rejects.toThrow('Sign in again');
  });
});
