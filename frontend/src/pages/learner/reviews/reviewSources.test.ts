import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { isReviewSession, mergeCompletedReviewHistory } from './useReviewSessions';

const event = (fields: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id: 'review:1:REV-A:1', eventKey: 'review:1:REV-A:1', title: 'Renamed conversation',
  source: 'mcr', type: 'coaching', reviewTemplateId: 'REV-A', reviewTypeCode: 'mcm',
  sequence: 1, status: 'not-scheduled', date: '2026-10-01', targetDate: '2026-10-01',
  scheduledDate: null, scheduledTime: null, durationMinutes: 60,
  coachName: 'Coach', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '', ...fields,
});

describe('Review source ownership', () => {
  it('routes by stable type even when names and legacy source disagree', () => {
    expect(isReviewSession(event({ title: 'Progress Review' }), 'mcr')).toBe(true);
    expect(isReviewSession(event({ reviewTypeCode: 'progress_review' }), 'mcr')).toBe(false);
    expect(isReviewSession(event({ reviewTypeCode: 'progress_review' }), 'progress-review')).toBe(true);
    expect(isReviewSession(event({ reviewTypeCode: 'career_review' }), 'mcr')).toBe(false);
  });

  it('never infers a missing template type from its old source', () => {
    expect(isReviewSession(event({ reviewTypeCode: null }), 'mcr')).toBe(false);
    expect(isReviewSession(event({ reviewTemplateId: null, reviewTypeCode: null }), 'mcr')).toBe(true);
  });

  it('preserves current Curriculum events beside completed imported history only', () => {
    const current = event();
    const complete = event({ id: 'imported:1', eventKey: 'imported:1', status: 'completed' });
    const pending = event({ id: 'imported:2', eventKey: 'imported:2' });
    expect(mergeCompletedReviewHistory([current], [complete, pending])).toEqual([current, complete]);
    expect(mergeCompletedReviewHistory([current, complete], [complete])).toEqual([current, complete]);
  });
});
