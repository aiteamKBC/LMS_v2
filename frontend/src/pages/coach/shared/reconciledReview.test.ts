import { describe, expect, it } from 'vitest';
import type { CoachCalendarEvent } from './calendarEvents';
import { canRescheduleReconciledReview, normalizeResolvedReviews, reviewActionMatrix } from './resolvedReviewRows';

const event: CoachCalendarEvent = {
  id: 'imported-review:A501', eventKey: 'imported-review:A501', title: 'MCM', type: 'review',
  reviewSource: 'aptem', aptemReviewId: 'A501', source: 'mcr', status: 'scheduled',
  calendarEventKey: 'review:21:legacy:1', reconciledReview: true, hasReviewForm: true,
};

describe('explicitly reconciled imported booking', () => {
  it('offers reschedule using the saved calendar identity and keeps the imported form identity', () => {
    expect(canRescheduleReconciledReview(event)).toBe(true);
    expect(reviewActionMatrix(event)).toMatchObject({ schedule: 'Reschedule', viewForm: true });
    const [row] = normalizeResolvedReviews([event]);
    expect(row.eventKey).toBe('imported-review:A501');
    expect(row.calendarEventKey).toBe('review:21:legacy:1');
  });
  it('requires the server association and an existing booking', () => {
    for (const fields of [{ reconciledReview: false }, { calendarEventKey: null }, { reviewSource: 'curriculum' }]) {
      expect(canRescheduleReconciledReview({ ...event, ...fields })).toBe(false);
    }
    expect(reviewActionMatrix({ ...event, reconciledReview: false }).schedule).toBeNull();
  });
  it('does not turn closed or started imported reviews into bookable Native reviews', () => {
    for (const status of ['not-scheduled', 'in-progress', 'awaiting-signature', 'completed', 'cancelled'] as const) {
      expect(canRescheduleReconciledReview({ ...event, status })).toBe(false);
      expect(reviewActionMatrix({ ...event, status }).schedule).toBeNull();
    }
  });
});
