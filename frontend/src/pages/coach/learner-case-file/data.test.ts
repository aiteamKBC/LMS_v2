import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { buildReviewGroups, buildReviewMeetingItems, buildUpcomingSchedule, caseFileReviewCategory } from './data';

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

describe('Learner Case File review classification', () => {
  it('uses Curriculum type codes and falls back to legacy sources only when metadata is absent', () => {
    const items = buildReviewMeetingItems({ learnerId: '42', learnerIdentityIds: ['42'] }, [
      calendarEvent({
        id: 'mcm', eventKey: 'mcm', type: 'review', source: 'review', reviewTypeCode: 'mcm',
        reviewTypeName: 'Monthly Coaching Meeting', targetDate: '2026-09-28',
        scheduledDate: '2026-10-02', scheduledTime: '09:30:00',
      }),
      calendarEvent({ id: 'pr', eventKey: 'pr', type: 'review', source: 'review', reviewTypeCode: 'progress_review', reviewTypeName: 'Progress Review' }),
      calendarEvent({ id: 'custom', eventKey: 'custom', type: 'review', source: 'mcr', reviewTypeCode: 'career_review', reviewTypeName: 'Career Review' }),
      calendarEvent({ id: 'legacy', eventKey: 'legacy', type: 'coaching', source: 'mcr', reviewTypeName: undefined }),
      calendarEvent({ id: 'legacy-pr', eventKey: 'legacy-pr', type: 'review', source: 'mcr', reviewTypeName: 'Progress Review' }),
      calendarEvent({ id: 'conflicting-pr', eventKey: 'conflicting-pr', type: 'review', source: 'mcr', reviewTypeCode: 'mcm', reviewTypeName: 'Progress Review' }),
    ]);

    expect(Object.fromEntries(items.map(item => [item.id, {
      reviewTypeCode: item.reviewTypeCode,
      category: caseFileReviewCategory(item),
    }]))).toEqual({
      mcm: { reviewTypeCode: 'mcm', category: 'mcr' },
      pr: { reviewTypeCode: 'progress_review', category: 'progress-review' },
      custom: { reviewTypeCode: 'career_review', category: 'review' },
      legacy: { reviewTypeCode: null, category: 'mcr' },
      'legacy-pr': { reviewTypeCode: null, category: 'progress-review' },
      'conflicting-pr': { reviewTypeCode: 'mcm', category: 'progress-review' },
    });
    expect(items.find(item => item.id === 'mcm')).toMatchObject({
      plannedDate: '28 Sept 2026',
      scheduledDate: '02 Oct 2026',
      scheduledTime: '09:30',
    });
    expect(items.find(item => item.id === 'legacy')).toMatchObject({
      scheduledDate: '--',
      scheduledTime: '--',
    });
  });

  it('orders Curriculum review groups by occurrence number rather than booking date', () => {
    const items = buildReviewMeetingItems({ learnerId: '42', learnerIdentityIds: ['42'] }, [
      calendarEvent({ id: 'mcm-3', eventKey: 'mcm-3', type: 'review', source: 'mcr', reviewTypeCode: 'mcm', reviewTypeName: 'Monthly Coaching Meeting', occurrenceNumber: 3, targetDate: '2026-10-16', scheduledDate: '2026-10-16', scheduledTime: '09:00' }),
      calendarEvent({ id: 'mcm-1', eventKey: 'mcm-1', type: 'review', source: 'mcr', reviewTypeCode: 'mcm', reviewTypeName: 'Monthly Coaching Meeting', occurrenceNumber: 1, targetDate: '2026-12-16', scheduledDate: '2026-09-28', scheduledTime: '09:00' }),
      calendarEvent({ id: 'mcm-2', eventKey: 'mcm-2', type: 'review', source: 'mcr', reviewTypeCode: 'mcm', reviewTypeName: 'Monthly Coaching Meeting', occurrenceNumber: 2, targetDate: '2026-11-16', scheduledDate: '2026-11-19', scheduledTime: '09:00' }),
    ]);

    const mcmGroup = buildReviewGroups(items).find(group => group.key === 'monthly coaching meeting');
    expect(mcmGroup?.items.map(item => item.occurrenceNumber)).toEqual([1, 2, 3]);
    expect(mcmGroup?.items.map(item => item.id)).toEqual(['mcm-1', 'mcm-2', 'mcm-3']);
  });
});
