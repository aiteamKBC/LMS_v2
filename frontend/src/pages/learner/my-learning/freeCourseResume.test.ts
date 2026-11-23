import { describe, expect, it } from 'vitest';
import type { FreeCourseActivity, FreeCourseSummary } from '@/api/freeCourses';
import { nextFreeCourse, nextFreeCourseActivity } from './freeCourseResume';

const activity = (id: string, extra: Partial<FreeCourseActivity> = {}): FreeCourseActivity => ({
  componentId: id, title: id, type: 'reading', contentHtml: '<p>Read</p>', ...extra,
});
describe('Free Course resume', () => {
  it('resumes recent saved work ahead of an earlier incomplete activity', () => {
    expect(nextFreeCourseActivity([activity('earlier'), activity('latest', { lastActivityAt: '2026-11-22T12:00:00Z' })])?.componentId).toBe('latest');
  });
  it('moves forward after completion without converting historical hours into completion', () => {
    expect(nextFreeCourseActivity([
      activity('gap'), activity('done', { is_completed: true, lastActivityAt: '2026-11-22T12:00:00Z' }),
      activity('next', { acceptedActualSeconds: 3600 }),
    ])?.componentId).toBe('next');
  });
  it('uses viewed reading without inventing a completion date and skips unavailable content', () => {
    expect(nextFreeCourseActivity([activity('empty', { contentHtml: null }), activity('viewed', { activity_state: 'reading_viewed' })])?.componentId).toBe('viewed');
  });
  it('uses only supplied assigned courses and handles an empty catalogue', () => {
    const courses = [{ freeCourseId: 'first', activityCount: 2, completedActivities: 0 },
      { freeCourseId: 'recent', activityCount: 2, completedActivities: 0, lastActivityAt: '2026-11-22T12:00:00Z' }] as FreeCourseSummary[];
    expect(nextFreeCourse(courses)?.freeCourseId).toBe('recent');
    expect(nextFreeCourse([])).toBeUndefined();
  });
});
