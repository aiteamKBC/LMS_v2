import { describe, expect, it } from 'vitest';
import type { FreeCourseActivity } from '@/api/freeCourses';
import { computeLocks } from './freeCourseAccess';

// ============================================================================
// Free-course access no longer depends on completion.
//
// A learner may open activity 1, leave it unfinished, open activity 2 and come
// back later. The quiz prerequisite that used to hold a quiz shut until its
// section's materials were done has been removed. Completion is still recorded;
// it just does not hand out access.
// ============================================================================

const material = (id: string, done = false): FreeCourseActivity => ({
  componentId: id, title: id, type: 'reading', contentHtml: '<p>body</p>', completed: done,
});
const quiz = (id: string, overrides: Partial<FreeCourseActivity> = {}): FreeCourseActivity => ({
  componentId: id, title: id, type: 'quiz', quizId: '10', ...overrides,
});
const emptyActivity = (id: string): FreeCourseActivity => ({ componentId: id, title: id, type: 'reading' });

describe('free-course activity access', () => {
  it('opens a quiz whose preceding materials are all unfinished', () => {
    const locks = computeLocks([material('m1'), material('m2'), quiz('q1')]);
    expect(locks.get('q1')?.locked).toBe(false);
    expect(locks.get('q1')?.reason).toBeNull();
  });

  it('opens a later activity while an earlier one stays incomplete', () => {
    const locks = computeLocks([material('m1'), material('m2'), material('m3')]);
    expect([...locks.values()].every(lock => lock.locked === false)).toBe(true);
  });

  it('lets the learner return to an earlier activity at any time', () => {
    const locks = computeLocks([material('m1', true), material('m2'), quiz('q1')]);
    expect(locks.get('m1')?.locked).toBe(false);
  });

  it('opens a second quiz although the first was never attempted', () => {
    const locks = computeLocks([material('m1'), quiz('q1'), material('m2'), quiz('q2')]);
    expect(locks.get('q1')?.locked).toBe(false);
    expect(locks.get('q2')?.locked).toBe(false);
  });

  it('still reports an unlinked quiz as having no content, not as locked', () => {
    const locks = computeLocks([quiz('q1', { quizId: null })]);
    expect(locks.get('q1')).toEqual({ locked: false, reason: 'content' });
  });

  it('still reports an activity with nothing authored as having no content', () => {
    const locks = computeLocks([emptyActivity('e1')]);
    expect(locks.get('e1')).toEqual({ locked: false, reason: 'content' });
  });

  it('treats an author-unlocked quiz the same as any other', () => {
    const locks = computeLocks([material('m1'), quiz('q1', { manualUnlock: true })]);
    expect(locks.get('q1')?.locked).toBe(false);
  });

  it('never locks anything, whatever the completion state', () => {
    const activities = [material('m1'), quiz('q1'), material('m2', true), quiz('q2'), emptyActivity('e1')];
    const locks = computeLocks(activities);
    expect([...locks.values()].filter(lock => lock.locked)).toHaveLength(0);
  });
});
