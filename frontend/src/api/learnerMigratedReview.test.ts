import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent } from './learnerCalendar';
import { needsLearnerMigratedForm } from './learnerMigratedReview';

function event(changes: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent {
  return { eventKey: 'imported-review:synthetic', status: 'not-scheduled',
    sourceStatus: 'Not Scheduled', importedReviewType: 'Monthly Coaching Meeting', ...changes } as LearnerCalendarEvent;
}

describe('learner imported form preparation', () => {
  it.each(['Monthly Coaching Meeting', 'Progress Review', 'Progress Review (+ Skills Radar)'])('prepares an unfinished %s', type => {
    expect(needsLearnerMigratedForm(event({ importedReviewType: type }))).toBe(true);
  });
  it('does not initialize history, existing forms, or another review type', () => {
    expect(needsLearnerMigratedForm(event({ status: 'completed' }))).toBe(false);
    expect(needsLearnerMigratedForm(event({ migratedForm: true }))).toBe(false);
    expect(needsLearnerMigratedForm(event({ importedReviewType: 'Gateway Review' }))).toBe(false);
    expect(needsLearnerMigratedForm(event({ eventKey: 'native:synthetic' }))).toBe(false);
    expect(needsLearnerMigratedForm(event({ importedReview: {
      sections: [{ id: 1, name: 'Captured', order: 0, fields: [{ label: 'Existing', value: 'saved' }], tables: [], rawText: '' }],
    } as LearnerCalendarEvent['importedReview'] }))).toBe(false);
  });
});
