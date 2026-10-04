import { describe, expect, it } from 'vitest';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { nextReviewMeetings } from './nextReviewMeetings';

const event = (overrides: Partial<CoachCalendarEvent>): CoachCalendarEvent => ({
  id: 'review', title: 'Review', type: 'review', learnerId: '42', status: 'scheduled',
  reviewTypeCode: 'progress_review', scheduledDate: '2026-10-04', scheduledTime: '11:30', ...overrides,
});

describe('Case File next PR and MCM cards', () => {
  it('selects each nearest booked meeting by date and time, excluding past, unbooked, completed, cancelled and other learners', () => {
    const events = [
      event({ scheduledTime: '13:00' }),
      event({ scheduledTime: '11:00' }),
      event({ scheduledTime: '11:29:59' }),
      event({ learnerId: '99', scheduledTime: '11:30' }),
      event({ status: 'completed', scheduledTime: '11:30' }),
      event({ status: 'cancelled', scheduledTime: '11:30' }),
      event({ status: 'not-scheduled', scheduledTime: null, targetDate: '2026-10-04' }),
      event({ reviewTypeCode: 'career_review', scheduledTime: '11:30' }),
      event({ scheduledTime: '12:00' }),
      event({ reviewTypeCode: 'mcm', scheduledDate: '2026-10-06', scheduledTime: '09:15' }),
      event({ reviewTypeName: 'Monthly Coaching Meeting', reviewTypeCode: null, scheduledDate: '2026-10-05', scheduledTime: '10:00' }),
    ];
    // 10:30 UTC is 11:30 in the LMS business timezone (BST).
    expect(nextReviewMeetings(events, '42', new Date('2026-10-04T10:30:00Z'))).toEqual({
      pr: '04 Oct 2026 · 12:00', mcm: '05 Oct 2026 · 10:00',
    });
  });

  it('uses GMT after the daylight-saving transition and leaves missing bookings empty', () => {
    expect(nextReviewMeetings([
      event({ scheduledDate: '2026-10-26', scheduledTime: '10:45' }),
    ], '42', new Date('2026-10-26T10:30:00Z'))).toEqual({ pr: '26 Oct 2026 · 10:45', mcm: '--' });
    expect(nextReviewMeetings([], '42')).toEqual({ pr: '--', mcm: '--' });
  });
});
