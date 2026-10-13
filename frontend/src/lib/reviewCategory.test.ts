import { describe, expect, it } from 'vitest';
import { reviewCategory } from './reviewCategory';
import { latestCompletedReviewDate, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';

describe('review display categories', () => {
  it.each([
    ['Monthly Coaching Meeting', 'mcr'], [' Monthly Coaching ', 'mcr'], ['mcm', 'mcr'],
    ['Progress Review', 'progress-review'], ['Progress Review (+ Skills Radar)', 'progress-review'],
    ['Gateway Review', 'review'], ['RPL and Experience', 'review'],
    ['Eligibility Review & FS Discussion', 'review'], ['Workplace Health & Safety Declaration', 'review'],
    ['ULN Privacy Notice & Learner Acknowledgement Review', 'review'], ['Future custom type', 'review'],
  ])('classifies %s without changing booking identity', (type, category) => {
    const event = { source: 'progress-review', importedReviewType: type, eventKey: 'imported-review:synthetic' };
    expect(reviewCategory(event)).toBe(category);
    expect(event).toEqual({ source: 'progress-review', importedReviewType: type, eventKey: 'imported-review:synthetic' });
  });

  it('uses Curriculum type codes and keeps non-review sources unchanged', () => {
    expect(reviewCategory({ source: 'review', reviewTypeCode: 'progress_review' })).toBe('progress-review');
    expect(reviewCategory({ source: 'review', reviewTypeCode: 'career_review' })).toBe('review');
    expect(reviewCategory({ source: 'catch-up' })).toBe('catch-up');
  });

  it('does not count a newer other review or another learner as Last PR', () => {
    const events = [
      { learnerId: '1', source: 'progress-review', status: 'completed', reviewCompletedAt: '2026-09-10', importedReviewType: 'RPL and Experience' },
      { learnerId: '2', source: 'progress-review', status: 'completed', reviewCompletedAt: '2026-09-12', importedReviewType: 'Progress Review' },
    ] as CoachCalendarEvent[];
    expect(latestCompletedReviewDate(events, '1', 'progress-review')).toBeNull();
    events.push({ ...events[0], importedReviewType: 'Progress Review (+ Skills Radar)', reviewCompletedAt: '2026-09-01' });
    expect(latestCompletedReviewDate(events, '1', 'progress-review')).toBe('2026-09-01');
  });
});
