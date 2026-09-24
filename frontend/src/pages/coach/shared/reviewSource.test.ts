import { describe, expect, it } from 'vitest';
import type { CoachCalendarEvent } from './calendarEvents';
import { latestCompletedReviewDate, reviewScheduleAvailable } from './calendarEvents';
import { normalizeResolvedReviews, normalizedReviewStatus, reviewActionMatrix } from './resolvedReviewRows';

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
  it('normalizes Aptem and Curriculum Scheduled rows to the same action matrix', () => {
    const aptem = event({
      id: 'imported-review:A-1', eventKey: 'imported-review:A-1', reviewSource: 'aptem',
      aptemReviewId: 'A-1', status: 'confirmed', scheduledTime: '10:00', hasReviewForm: true,
      enrolmentId: 'ENR-A-1',
    });
    const native = event({
      id: 'native-1', eventKey: 'native-1', reviewSource: 'curriculum', status: 'scheduled',
      scheduledTime: '10:00', reviewInstanceId: 'REVI-1', enrolmentId: 'ENR-1',
    });

    expect(normalizedReviewStatus(aptem)).toBe('scheduled');
    expect(normalizedReviewStatus(native)).toBe('scheduled');
    expect(reviewActionMatrix(aptem)).toEqual(reviewActionMatrix(native));
    expect(reviewActionMatrix(aptem)).toEqual({
      schedule: 'Reschedule', view: true, viewForm: true, presentation: true, join: false,
    });
  });

  it('keeps Completed source rows aligned and never offers Reschedule', () => {
    const aptem = event({ reviewSource: 'aptem', aptemReviewId: 'A-2', hasReviewForm: true });
    const native = event({ reviewSource: 'curriculum', reviewInstanceId: 'REVI-2' });
    expect(reviewActionMatrix(aptem)).toMatchObject({ schedule: null, view: true, viewForm: true });
    expect(reviewActionMatrix(native)).toMatchObject({ schedule: null, view: true, viewForm: true });
  });

  it('shows Schedule consistently for unbooked rows and never treats confirmed as completed', () => {
    const aptem = event({ status: 'confirmed', scheduledDate: '2026-09-20', scheduledTime: null });
    const native = event({ status: 'not-scheduled', scheduledDate: null, scheduledTime: null });
    expect(normalizedReviewStatus(aptem)).toBe('not-scheduled');
    expect(reviewActionMatrix(aptem).schedule).toBe('Schedule');
    expect(reviewActionMatrix(native).schedule).toBe('Schedule');
  });

  it('deduplicates only by stable event identity and does no fuzzy learner matching', () => {
    const rows = normalizeResolvedReviews([
      event({ id: 'stable-1', eventKey: 'stable-1', learner: 'Same Name' }),
      event({ id: 'duplicate-copy', eventKey: 'stable-1', learner: 'Renamed Learner' }),
      event({ id: 'stable-2', eventKey: 'stable-2', learner: 'Same Name', email: 'same@example.invalid' }),
    ]);
    expect(rows.map(row => row.id)).toEqual(['stable-1', 'stable-2']);
  });

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
