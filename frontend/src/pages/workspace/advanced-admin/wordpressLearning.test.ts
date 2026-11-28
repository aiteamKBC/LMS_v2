import { describe, expect, it } from 'vitest';
import type { AdvancedAdminWordPressCourse } from '@/api/advancedAdmin';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityItem, StudentActivityResponse } from '@/api/studentActivity';
import { achievedWordPressCourses, matchedLearningSummary } from './wordpressLearning';

const activity = (course: number, id: number, completed: boolean) => ({
  activity_id: `catalogue:${course}:material:${id}`, source_activity_id: id,
  group_id: course, group_name: `Stored ${course}`, date: null, category: 'reading',
  activity: `Stored activity ${id}`, status: completed ? 'completed' : 'not_started', completed,
  actual: 0, planned: 0, planned_hours_mapped: false, hours_mapped: false,
  quiz_score: null, quiz_maximum_score: null, can_open_material: true,
}) as StudentActivityItem;

const learning = {
  current: { id: '7', modules: ['Current LMS module', 'Inactive LMS module'],
    components: [{ componentId: 'lms-done', module: 'Current LMS module', component: 'Finished LMS activity', type: 'reading' }],
    componentProgress: [{ componentId: 'lms-done', kind: 'reading', passed: true }],
    quizAttempts: [] } as unknown as LearnerDetail,
  historical: {
    progress_basis: 'catalogue_activities',
    subjects: [{ id: 10, name: 'Stored 10', catalogue_count: 2 }, { id: 99, name: 'Stale course' }],
    activities: [activity(10, 1, false), activity(99, 9, true)],
  } as StudentActivityResponse,
};

const courses = [
  { id: 10, title: 'Live course', completedActivities: 1, startedActivities: 1,
    activities: [
      { id: 1, title: 'Finished in WordPress', type: 'video', completed: true, started: true },
      { id: 2, title: 'Unstarted', type: 'audio', completed: false, started: false },
    ] },
  { id: 20, title: 'Newly verified course', completedActivities: 1, startedActivities: 1,
    activities: [{ id: 3, title: 'New completion', type: 'Reading+Quiz', completed: true, started: true }] },
] as AdvancedAdminWordPressCourse[];

describe('verified WordPress course projection', () => {
  it('keeps only selected live memberships and their source progress, including a course missing from the stored catalogue', () => {
    const summary = matchedLearningSummary(learning, courses, true);
    expect(summary.subjects.map(subject => subject.id)).toEqual(['unlinked:Current LMS module', 'legacy:10', 'legacy:20']);
    expect(summary.subjects.some(subject => subject.id === 'legacy:99')).toBe(false);
    expect(summary.subjects.some(subject => subject.id === 'unlinked:Inactive LMS module')).toBe(false);
    expect(summary.activityCount).toBe(4);
    expect(summary.completedActivityCount).toBe(3);
    const live = summary.subjects.find(subject => subject.id === 'legacy:10')!;
    expect(live.activities[0]).toMatchObject({ title: 'Finished in WordPress', completed: true });
    expect(live.activities[0].legacy?.can_open_material).toBe(true);
    expect(summary.subjects.find(subject => subject.id === 'legacy:20')?.activities[0].legacy?.can_open_material).toBe(false);
  });

  it('requires more than five completed activities in the enrolled course', () => {
    const five = { id: 50, title: 'Five completed', completedActivities: 5, startedActivities: 5,
      activities: Array.from({ length: 5 }, (_, index) => ({ id: index + 10, title: `Done ${index}`, type: 'video', completed: true, started: true })) };
    const six = { id: 60, title: 'Six completed', completedActivities: 6, startedActivities: 6,
      activities: Array.from({ length: 6 }, (_, index) => ({ id: index + 20, title: `Done ${index}`, type: 'video', completed: true, started: true })) };
    const attempted = { id: 30, title: 'Attempted', completedActivities: 0, startedActivities: 1,
      activities: [{ id: 4, title: 'Attempt', type: 'quiz', completed: false, started: true }] };
    const unstarted = { id: 40, title: 'Unstarted', completedActivities: 0, startedActivities: 0,
      activities: [{ id: 5, title: 'No result', type: 'audio', completed: false, started: false }] };
    expect(achievedWordPressCourses([...courses, five, six, attempted, unstarted]).map(course => course.id)).toEqual([60]);
  });
});
