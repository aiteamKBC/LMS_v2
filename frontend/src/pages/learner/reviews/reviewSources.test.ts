import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { isMigratedContinuationEvent, isReviewSession, isReviewSessionWrite } from './useReviewSessions';

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

  it('keeps Curriculum Reviews in their own learner section', () => {
    const curriculum = event({
      id: 'review:1:CAREER_REVIEW:1', eventKey: 'review:1:CAREER_REVIEW:1',
      source: 'review', type: 'review', reviewTemplateId: 'CAREER_REVIEW',
      reviewTypeCode: 'career_review', reviewTypeName: 'Career Review',
    });
    expect(isReviewSession(curriculum, 'review')).toBe(true);
    expect(isReviewSession(curriculum, 'mcr')).toBe(false);
    expect(isReviewSession(curriculum, 'progress-review')).toBe(false);
    expect(isReviewSession({ ...curriculum, reviewTemplateId: null }, 'review')).toBe(false);
  });

  it.each(['completed', 'scheduled', 'not-scheduled', 'in-progress', 'awaiting-signature'])('keeps imported %s occurrences in their source family', status => {
    expect(isReviewSession(event({ reviewSource: 'aptem', reviewTemplateId: null, status }), 'mcr')).toBe(true);
    for (const importedReviewType of ['Progress Review', 'Progress Review (+ Skills Radar)']) {
      expect(isReviewSession(event({ reviewSource: 'aptem', reviewTemplateId: null,
        reviewTypeCode: 'progress_review', importedReviewType, status }), 'progress-review')).toBe(true);
    }
  });

  it('routes only an LMS calendar continuation to the migrated form', () => {
    const key = 'imported-review:C5-TEST-MCM-20261002-001';
    expect(isMigratedContinuationEvent(event({ eventKey: key, migratedForm: true }))).toBe(true);
    expect(isMigratedContinuationEvent(event({ eventKey: key, migratedForm: true, status: 'completed' }))).toBe(true);
    expect(isMigratedContinuationEvent(event({ eventKey: key, importedReview: { id: '1' } as LearnerCalendarEvent['importedReview'] }))).toBe(false);
    expect(isMigratedContinuationEvent(event({ eventKey: key }))).toBe(false);
    expect(isMigratedContinuationEvent(event())).toBe(false);
  });

  it('refreshes review pages for both Review architectures', () => {
    expect(isReviewSessionWrite('/curriculum/reviews/REV-A/')).toBe(true);
    expect(isReviewSessionWrite('/curriculum/programmes/PROG-A/reviews/')).toBe(true);
    expect(isReviewSessionWrite('/coach/migrated-reviews/imported-review:A-1/sign/')).toBe(true);
    expect(isReviewSessionWrite('/curriculum/modules/MOD-A/')).toBe(false);
    expect(isReviewSessionWrite('/curriculum/groups/GROUP-A/')).toBe(false);
  });
});
