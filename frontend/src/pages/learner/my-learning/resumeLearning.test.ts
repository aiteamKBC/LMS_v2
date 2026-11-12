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
  it('resumes later saved work while leaving an unfinished masterclass available', () => {
    const active = { ...entry('lecture-4', '2026-10-21'), lastActivityAt: '2026-11-11T10:00:00Z' };
    const course = subject('current:M1', [entry('masterclass', '2026-09-01'), active, entry('next', '2026-10-21')]);
    expect(nextIncompleteActivity(course)?.activity.id).toBe('lecture-4');
    active.completed = true;
    expect(nextIncompleteActivity(course)?.activity.id).toBe('next');
    expect(course.activities[0].completed).toBe(false);
  });
  it('keeps authored teaching order after the latest completion and skips unavailable work', () => {
    const finished = { ...entry('finished', '2026-10-21', true), lastActivityAt: '2026-11-11T10:00:00Z' };
    const unavailable = entry('empty', '2026-10-21');
    unavailable.native!.contentAvailable = false;
    const course = subject('current:M1', [entry('old-gap', '2026-09-01'), finished, unavailable, entry('next', '2026-10-28')]);
    expect(nextIncompleteActivity(course)?.activity.id).toBe('next');
  });
  it('uses UTC instants for offsets and ignores invalid saved timestamps', () => {
    const older = { ...entry('older', '2026-09-01'), lastActivityAt: '2026-11-11T12:30:00+03:00' };
    const latest = { ...entry('latest', '2026-10-21'), lastActivityAt: '2026-11-11T10:00:00' };
    const invalid = { ...entry('invalid', '2026-11-10'), lastActivityAt: 'invalid' };
    expect(nextIncompleteActivity(subject('current:M1', [older, latest, invalid]))?.activity.id).toBe('latest');
  });
  it('chooses the recently studied module before older incomplete modules', () => {
    const old = { ...subject('current:old', [entry('old', '2026-09-01')]), card: {
      activityCount: 2, completedActivityCount: 1, progress: 50, status: 'In progress' as const, finalTestPassed: false,
      lastActivityAt: '2026-10-01T10:00:00Z',
    } };
    const recent = { ...old, id: 'current:recent', card: { ...old.card, lastActivityAt: '2026-11-11T10:00:00Z' } };
    expect(nextIncompleteSubject([old, recent], { [old.id]: '2026-09-01', [recent.id]: '2026-09-30' })).toBe(recent);
    recent.card.completedActivityCount = 2;
    const following = subject('current:following', [entry('new', '2026-12-01')]);
    expect(nextIncompleteSubject([old, recent, following], { [old.id]: '2026-09-01', [recent.id]: '2026-09-30', [following.id]: '2026-12-01' })).toBe(following);
  });
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
