import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { buildUpcomingSchedule } from './data';

function calendarEvent(overrides: Partial<CoachCalendarEvent>): CoachCalendarEvent {
  return {
    id: 'event-1',
    title: 'Calendar event',
    type: 'coaching',
    date: '2026-09-21',
    status: 'scheduled',
    learnerId: '42',
    ...overrides,
  };
}

describe('Learner Case File upcoming schedule', () => {
  afterEach(() => vi.useRealTimers());

  it("includes matching live sessions and reviews but excludes another learner's records", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 19, 12));

    const items = buildUpcomingSchedule(['42', '142'], [
      calendarEvent({ id: 'live-1', eventKey: 'live-1', source: 'live-session', title: 'Data workshop' }),
      calendarEvent({ id: 'review-1', eventKey: 'review-1', type: 'review', source: 'progress-review', title: 'Progress review', date: '2026-09-22' }),
      calendarEvent({ id: 'review-other', eventKey: 'review-other', type: 'review', source: 'progress-review', learnerId: '99', title: 'Other learner review', date: '2026-09-23' }),
    ]);

    expect(items.map((item) => [item.id, item.kind, item.statusLabel])).toEqual([
      ['live-1', 'live', 'Scheduled'],
      ['review-1', 'review', 'Scheduled'],
    ]);
  });
});
