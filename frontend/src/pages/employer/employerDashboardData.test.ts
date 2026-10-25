import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { greeting, orderReviewJourney, progressReviews, relativeReviewDate, reviewMatches, reviewState } from './employerDashboardData';

const review = (values: Partial<LearnerCalendarEvent> = {}) => ({
  id: 'pr', eventKey: 'pr', source: 'progress-review', status: 'scheduled', sequence: 1,
  importedReviewType: 'Progress Review', targetDate: '2026-10-31', scheduledDate: null, ...values,
} as LearnerCalendarEvent);

describe('employer dashboard review facts', () => {
  it('keeps Progress Review aliases and excludes other types and cancelled bookings', () => {
    const events = [review(), review({ importedReviewType: 'Progress Review (+ Skills Radar)', eventKey: 'radar' }),
      review({ importedReviewType: 'Gateway Review' }), review({ importedReviewType: 'Personal Support Plan' }),
      review({ bookingStatus: 'cancelled' })];
    expect(progressReviews(events).map(event => event.eventKey)).toEqual(['pr', 'radar']);
  });
  it('uses the moved appointment date for month and upcoming filters', () => {
    const events = [review({ scheduledDate: '2026-11-02' })];
    expect(reviewMatches(events, 'month', '2026-10-21')).toBe(false);
    expect(reviewMatches(events, '30', '2026-10-21')).toBe(true);
    expect(reviewMatches(events, 'overdue', '2026-10-21')).toBe(false);
  });
  it('keeps the source plan order after rescheduling or completion, leaving undated reviews last', () => {
    const later = Object.freeze(review({ eventKey: 'later', targetDate: '2026-11-01', scheduledDate: '2026-09-01', date: '2026-08-01', status: 'completed' }));
    const first = Object.freeze(review({ eventKey: 'first', targetDate: '2026-10-01', scheduledDate: '2026-12-01' }));
    const undated = Object.freeze(review({ eventKey: 'undated', targetDate: null, scheduledDate: '2026-01-01' }));
    const events = Object.freeze([later, undated, first]);
    expect(orderReviewJourney(events)).toEqual([first, later, undated]);
    expect(events).toEqual([later, undated, first]);
  });
  it('uses occurrence or sequence to break planned-date ties and otherwise preserves source order', () => {
    const tiedZ = review({ eventKey: 'z', sequence: 3 });
    const tiedA = review({ eventKey: 'a', sequence: 3 });
    const second = review({ eventKey: 'second', occurrenceNumber: 2, sequence: 1 });
    const first = review({ eventKey: 'first', occurrenceNumber: 1, sequence: 20 });
    expect(orderReviewJourney([tiedZ, second, tiedA, first])).toEqual([first, second, tiedZ, tiedA]);
  });
  it('distinguishes a signature task from an upcoming or completed review', () => {
    const event = review({ status: 'completed', employerSignatureRequired: true, employerSigned: false });
    expect(reviewState(event)).toBe('signature');
    expect(reviewMatches([event], 'month', '2026-10-21')).toBe(false);
    expect(reviewMatches([event], 'signature', '2026-10-21')).toBe(true);
    expect(reviewState({ ...event, employerSigned: true })).toBe('completed');
  });
  it('does not call undated reviews overdue and does not count completed reviews as due', () => {
    expect(reviewMatches([review({ targetDate: null })], 'overdue', '2026-10-21')).toBe(false);
    expect(reviewMatches([review({ status: 'completed' })], 'month', '2026-10-21')).toBe(false);
    expect(reviewMatches([review({ targetDate: null })], 'none', '2026-10-21')).toBe(true);
  });
  it('uses business calendar days across daylight saving and month/year boundaries', () => {
    expect(relativeReviewDate('2026-10-26', '2026-10-24')).toBe('In 2 days');
    expect(relativeReviewDate('2027-01-01', '2026-12-31')).toBe('Tomorrow');
    expect(relativeReviewDate('2026-10-20', '2026-10-21')).toBe('1 day overdue');
    expect(greeting(new Date('2026-07-01T11:00:00Z'))).toBe('Good afternoon,');
    expect(greeting(new Date('2026-12-01T11:00:00Z'))).toBe('Good morning,');
  });
});
