import { describe, expect, it } from 'vitest';
import type { Subject, SubjectEntry } from './learningSummary';
import { nextIncompleteActivity, nextIncompleteSubject } from './resumeLearning';

const entry = (id: string, date: string, completed = false): SubjectEntry => ({
  id, title: id, category: 'reading', completed, position: 0,
  schedule: { date, date_source: 'builder_week' },
  native: { componentId: id, title: id, type: 'reading', expectedOtjh: null, contentAvailable: true },
});
const subject = (id: string, activities: SubjectEntry[]): Subject => ({ id, title: id, source: 'current', activities });

describe('resume saved learning', () => {
  it('opens an unfinished earlier week ahead of the calendar week', () => {
    const course = subject('current:M1', [entry('done', '2026-09-01', true), entry('catch-up', '2026-09-01'), entry('current', '2026-11-10')]);
    expect(nextIncompleteActivity(course)?.activity.id).toBe('catch-up');
  });
  it('advances to the next incomplete activity and does not reopen completed work', () => {
    const course = subject('current:M1', [entry('done', '2026-09-01', true), entry('next', '2026-09-08')]);
    expect(nextIncompleteActivity(course)?.activity.id).toBe('next');
    course.activities[1].completed = true;
    expect(nextIncompleteActivity(course)).toBeUndefined();
  });
  it('skips unavailable content using the existing content verdict', () => {
    const unavailable = entry('empty', '2026-09-01');
    unavailable.native!.contentAvailable = false;
    expect(nextIncompleteActivity(subject('current:M1', [unavailable, entry('ready', '2026-09-08')]))?.activity.id).toBe('ready');
  });
  it('can resume imported-only material with its original identity', () => {
    const imported = { ...entry('la:1:2', '2026-09-01'), native: undefined,
      legacy: { can_open_material: true } as SubjectEntry['legacy'] };
    expect(nextIncompleteActivity(subject('legacy:1', [imported]))?.activity.id).toBe('la:1:2');
  });
  it('continues earlier assigned modules in teaching order rather than title order', () => {
    const later = subject('current:new', [entry('new', '2026-11-10')]);
    const earlier = subject('legacy:old', [entry('old', '2026-09-01')]);
    expect(nextIncompleteSubject([later, earlier], { [later.id]: '2026-11-10', [earlier.id]: '2026-09-01' })).toBe(earlier);
  });
  it('uses saved card completion and excludes historical evidence and superseded courses', () => {
    const history = { ...subject('legacy:history', [entry('h', '')]), previousLearningFor: 'current:M1' };
    const replaced = { ...subject('current:replaced', [entry('r', '')]), replacementCourseRef: 'legacy:1' };
    const completed = { ...subject('current:done', []), card: { activityCount: 2, completedActivityCount: 2, progress: 100, status: 'Completed' as const, finalTestPassed: false } };
    const pending = { ...completed, id: 'current:pending', card: { ...completed.card, completedActivityCount: 1 } };
    expect(nextIncompleteSubject([history, replaced, completed, pending], {})).toBe(pending);
    expect(nextIncompleteSubject([completed], {})).toBeUndefined();
  });
});
