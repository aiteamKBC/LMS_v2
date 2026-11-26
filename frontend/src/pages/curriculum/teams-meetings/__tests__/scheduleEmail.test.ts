import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendScheduleEmailBatch } from '../scheduleEmail';

const transport = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', transport); });
afterEach(() => vi.unstubAllGlobals());

it('uses session and CSRF protection and sends only the saved calendar ID plus retry flag', async () => {
  transport.mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'synthetic-csrf' }) });
  transport.mockResolvedValueOnce({ ok: true, json: async () => ({ total: 1, accepted: 1, queued: 0, failed: 0, uncertain: 0, status: 'complete' }) });
  await sendScheduleEmailBatch('LIVE/ONE');
  const [url, options] = transport.mock.calls[1];
  expect(url).toBe('/curriculum_api/curriculum/teams-meetings/LIVE%2FONE/schedule-email/');
  expect(options.credentials).toBe('include');
  expect(options.headers.get('X-CSRFToken')).toBe('synthetic-csrf');
  expect(JSON.parse(options.body)).toEqual({ retryFailed: false });
});

it('rejects impossible status counts instead of showing successful delivery', async () => {
  transport.mockResolvedValue({ ok: true, json: async () => ({ total: 1, accepted: 3, queued: 0, failed: 0, uncertain: 0 }) });
  await expect(sendScheduleEmailBatch('LIVE-ONE')).rejects.toThrow('status could not be read');
});
