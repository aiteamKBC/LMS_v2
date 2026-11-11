import { afterEach, expect, it, vi } from 'vitest';
import { progressReviewCalendarContent } from './progressReviewCalendar';

afterEach(() => vi.unstubAllEnvs());

it.each(['Europe/London', 'Africa/Cairo', 'America/Los_Angeles'])(
  'exports the same PR instant from a device in %s', zone => {
    vi.stubEnv('TZ', zone);
    const event = { scheduledTime: '09:00', durationMinutes: 60,
      title: 'Progress Review', meetingLink: 'https://example.test/meeting' };
    const summer = progressReviewCalendarContent({ ...event, scheduledDate: '2026-07-01' });
    const winter = progressReviewCalendarContent({ ...event, scheduledDate: '2026-11-02' });
    expect(summer).toContain('DTSTART:20260701T080000Z\r\nDTEND:20260701T090000Z');
    expect(winter).toContain('DTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z');
    expect(winter).toContain('SUMMARY:Progress Review\r\nURL:https://example.test/meeting');
  },
);

it('adds the meeting duration to the UTC instant when the date changes', () => {
  const content = progressReviewCalendarContent({ scheduledDate: '2026-11-02',
    scheduledTime: '16:30', durationMinutes: 90, title: 'Progress Review' });
  expect(content).toContain('DTSTART:20261102T163000Z\r\nDTEND:20261102T180000Z');
});
