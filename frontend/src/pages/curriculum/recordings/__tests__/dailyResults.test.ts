import { beforeEach, expect, it, vi } from 'vitest';
import { learningFetch } from '@/lib/personalLearning';
import { loadDailyResults } from '../dailyResults';
vi.mock('@/lib/personalLearning', () => ({ learningFetch: vi.fn() }));
const lecture = { moduleId: 'M', occurrenceId: 'O', seriesId: 'S', sessionNumber: 2, date: '2026-10-14' };
beforeEach(() => vi.resetAllMocks());
it('requests exact module/occurrence/date/zone context', async () => {
  vi.mocked(learningFetch).mockResolvedValue({ ok: true, json: async () => ({ date: lecture.date, timeZone: 'Africa/Cairo' }) } as Response);
  const signal = new AbortController().signal;
  await loadDailyResults(lecture, 'Africa/Cairo', signal);
  const [url, options] = vi.mocked(learningFetch).mock.calls[0];
  const parsed = new URL(String(url), 'https://example.invalid');
  expect(parsed.pathname).toBe('/curriculum_api/curriculum/session-results/S/sessions/2/day-results/');
  expect(Object.fromEntries(parsed.searchParams)).toEqual({ moduleId: 'M', occurrenceId: 'O', date: '2026-10-14', timeZone: 'Africa/Cairo' });
  expect(options).toEqual(expect.objectContaining({ credentials: 'include', cache: 'no-store', signal }));
});
it('rejects other-day results instead of displaying them', async () => {
  vi.mocked(learningFetch).mockResolvedValue({ ok: true, json: async () => ({ date: '2026-10-13', timeZone: 'Africa/Cairo' }) } as Response);
  await expect(loadDailyResults(lecture, 'Africa/Cairo', new AbortController().signal)).rejects.toThrow('does not match');
});
it('preserves server errors including authorization failures', async () => {
  vi.mocked(learningFetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Forbidden' }) } as Response);
  await expect(loadDailyResults(lecture, 'UTC', new AbortController().signal)).rejects.toThrow('Forbidden');
});
