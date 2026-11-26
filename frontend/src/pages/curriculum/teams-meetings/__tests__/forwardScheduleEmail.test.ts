import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { forwardScheduleEmail } from '../forwardScheduleEmail';

const transport = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', transport); });
afterEach(() => vi.unstubAllGlobals());

it('posts the selected recipients to the forwarding endpoint', async () => {
  transport.mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'synthetic-csrf' }) });
  transport.mockResolvedValueOnce({ ok: true, json: async () => ({ total: 2, accepted: 2, queued: 0, failed: 0, uncertain: 0, status: 'complete' }) });
  await forwardScheduleEmail('LIVE/ONE', ['one@example.com', 'two@example.com']);
  const [url, options] = transport.mock.calls[1];
  expect(url).toBe('/curriculum_api/curriculum/teams-meetings/LIVE%2FONE/forward-email/');
  expect(options.credentials).toBe('include');
  expect(options.headers.get('X-CSRFToken')).toBe('synthetic-csrf');
  expect(JSON.parse(options.body)).toEqual({ recipients: ['one@example.com', 'two@example.com'] });
});

it('rejects an invalid delivery status', async () => {
  transport.mockResolvedValue({ ok: true, json: async () => ({ total: 1, accepted: 2, queued: 0, failed: 0, uncertain: 0 }) });
  await expect(forwardScheduleEmail('LIVE-ONE', ['one@example.com'])).rejects.toThrow('status could not be read');
});
