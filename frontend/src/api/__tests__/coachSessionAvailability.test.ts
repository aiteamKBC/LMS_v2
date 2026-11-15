import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCoachSessionSlots } from '../learnerCalendar';

afterEach(() => vi.unstubAllGlobals());

describe('direct coach session availability', () => {
  it.each(['student-support', 'gateway', 'other', 'catch-up'] as const)('reads %s availability in the appointment London timezone', async sessionType => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ times: ['11:00'] }) });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    expect(await fetchCoachSessionSlots('commercial', '125', '2026-07-01', 45, {
      sessionType, excludeEventKey: 'support:125:1', signal: controller.signal,
    })).toEqual(['11:00']);
    const [url, options] = fetch.mock.calls[0];
    const query = new URL(url, 'https://example.invalid').searchParams;
    expect(query.get('purpose')).toBe(sessionType === 'catch-up' ? 'catch-up' : 'coach-session');
    expect(query.get('timezoneOffsetMinutes')).toBe('-60');
    expect(query.get('durationMinutes')).toBe('45');
    expect(query.get('excludeEventKey')).toBe('support:125:1');
    expect(options).toEqual({ credentials: 'include', signal: controller.signal });
  });

  it('surfaces calendar-read failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Calendar unavailable' }) }));
    await expect(fetchCoachSessionSlots('apprenticeship', '125', '2026-11-02', 60,
      { sessionType: 'student-support' })).rejects.toThrow('Calendar unavailable');
  });
});
