import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { syncTeamsCalendarState } from '../calendarState';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';

vi.mock('@/lib/curriculumApi', () => ({ clearCurriculumGetCache: vi.fn() }));
const transport = vi.fn();
const result = { changed: true, seriesStatus: 'active', cancelledSessions: [2], errors: [] };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', transport); });
afterEach(() => vi.unstubAllGlobals());

it('uses session and CSRF protection, sends only the stored series identity and clears stale curriculum caches', async () => {
  transport.mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'synthetic-csrf' }) });
  transport.mockResolvedValueOnce({ ok: true, json: async () => result });
  expect(await syncTeamsCalendarState('LIVE/ONE')).toEqual(result);
  const [url, options] = transport.mock.calls[1];
  expect(url).toBe('/curriculum_api/curriculum/teams-meetings/LIVE%2FONE/calendar-state/');
  expect(options.credentials).toBe('include');
  expect(options.headers.get('X-CSRFToken')).toBe('synthetic-csrf');
  expect(JSON.parse(options.body)).toEqual({});
  expect(clearCurriculumGetCache).toHaveBeenCalledOnce();
});

it('keeps partial results visible when a legacy session cannot be matched', async () => {
  transport.mockResolvedValue({ ok: true, json: async () => ({ ...result, errors: ['Session 3 could not be matched.'] }) });
  expect((await syncTeamsCalendarState('LIVE-ONE')).errors).toEqual(['Session 3 could not be matched.']);
});

it('does not turn a failed request into success or invalidate caches', async () => {
  transport.mockResolvedValue({ ok: false, json: async () => ({ error: 'Microsoft is unavailable.' }) });
  await expect(syncTeamsCalendarState('LIVE-ONE')).rejects.toThrow('Microsoft is unavailable');
  expect(clearCurriculumGetCache).not.toHaveBeenCalled();
});

it('rejects malformed cancellation evidence', async () => {
  transport.mockResolvedValue({ ok: true, json: async () => ({ ...result, cancelledSessions: ['2'] }) });
  await expect(syncTeamsCalendarState('LIVE-ONE')).rejects.toThrow('status could not be read');
  expect(clearCurriculumGetCache).not.toHaveBeenCalled();
});
