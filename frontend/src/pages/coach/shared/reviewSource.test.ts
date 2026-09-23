import { describe, expect, it } from 'vitest';
import type { CoachCalendarEvent } from './calendarEvents';
import { latestCompletedReviewDate, reviewScheduleAvailable } from './calendarEvents';

const event = (overrides: Partial<CoachCalendarEvent>): CoachCalendarEvent => ({
  id: 'event',
  title: 'Review',
  type: 'review',
  source: 'progress-review',
  status: 'completed',
  learnerId: '1',
  scheduledDate: '2026-09-10',
  reviewCompletedAt: '2026-09-10T09:00:00Z',
  ...overrides,
});

describe('resolved review stream dashboard helpers', () => {
  it('keeps weekly cards available when resolved reviews exist despite an unrelated issue', () => {
    expect(reviewScheduleAvailable(
      { progressReviewRows: 26, mcrRows: 93, learnersWithDates: 31 },
      [event({})],
      [{ learnerId: '2', code: 'review_schedule_unavailable' }],
    )).toBe(true);
  });

  it('keeps the audited 119-event Aptem payload available', () => {
    const events = Array.from({ length: 119 }, (_, index) => event({
      id: `review-${index}`,
      source: index < 26 ? 'progress-review' : 'mcr',
    }));

    expect(reviewScheduleAvailable(
      { progressReviewRows: 26, mcrRows: 93, learnersWithDates: 31 },
      events,
      [{ learnerId: 'native-unrelated', code: 'review_schedule_unavailable' }],
    )).toBe(true);
  });

  it('is unavailable only when there is no usable review data and generation failed', () => {
    expect(reviewScheduleAvailable(
      { progressReviewRows: 0, mcrRows: 0, learnersWithDates: 0 },
      [],
      [{ learnerId: '1', code: 'review_schedule_unavailable' }],
    )).toBe(false);
    expect(reviewScheduleAvailable(undefined, [], [])).toBe(true);
  });

  it('selects the latest completed PR and ignores newer planned or non-completed events', () => {
    const events = [
      event({ id: 'old-pr', reviewCompletedAt: '2026-09-10T10:00:00Z' }),
      event({ id: 'new-pr', reviewCompletedAt: '2026-09-15T11:00:00Z' }),
      event({ id: 'scheduled-pr', status: 'scheduled', scheduledDate: '2026-09-30', reviewCompletedAt: null }),
      event({ id: 'confirmed-pr', status: 'confirmed', scheduledDate: '2026-10-01', reviewCompletedAt: null }),
      event({ id: 'future-planned-pr', status: 'completed', scheduledDate: '2027-01-01', targetDate: '2027-01-01', reviewCompletedAt: '2026-09-12T09:00:00Z' }),
    ];

    expect(latestCompletedReviewDate(events, '1', 'progress-review')).toBe('2026-09-15T11:00:00Z');
  });

  it('selects the latest completed MCM and ignores an in-progress MCM', () => {
    const events = [
      event({ id: 'old-mcm', source: 'mcr', type: 'coaching', reviewCompletedAt: '2026-09-12T08:00:00Z' }),
      event({ id: 'new-mcm', source: 'mcr', type: 'coaching', reviewCompletedAt: '2026-09-18T14:30:00Z' }),
      event({ id: 'in-progress-mcm', source: 'mcr', type: 'coaching', status: 'in-progress', scheduledDate: '2026-09-25', reviewCompletedAt: null }),
    ];

    expect(latestCompletedReviewDate(events, '1', 'mcr')).toBe('2026-09-18T14:30:00Z');
  });

  it('isolates learners by stable learnerId without fuzzy identity matching', () => {
    const events = [
      event({ id: 'other-id', learnerId: '10', learner: 'Same Learner', email: 'same@example.invalid', reviewCompletedAt: '2026-09-20T09:00:00Z' }),
      event({ id: 'exact-id', learnerId: '1', learner: 'Different Name', email: 'different@example.invalid', reviewCompletedAt: '2026-09-14T09:00:00Z' }),
    ];

    expect(latestCompletedReviewDate(events, '1', 'progress-review')).toBe('2026-09-14T09:00:00Z');
    expect(latestCompletedReviewDate(events, 'missing', 'progress-review')).toBeNull();
  });

  it('requires a real completion date even when status is completed', () => {
    expect(latestCompletedReviewDate([
      event({ reviewCompletedAt: null, scheduledDate: '2026-09-30', targetDate: '2026-10-01' }),
    ], '1', 'progress-review')).toBeNull();
  });
});
