import type { AdvancedAdminWordPressCourse } from '@/api/advancedAdmin';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityItem, StudentActivityResponse } from '@/api/studentActivity';
import {
  buildUnifiedLearningSummary, type Subject, type SubjectEntry, type UnifiedLearningSummary,
} from '@/pages/learner/my-learning/learningSummary';

type Learning = { current: LearnerDetail; historical: StudentActivityResponse };

/** The review list requires more than five completed activities in an enrolled course. */
export function achievedWordPressCourses(courses: AdvancedAdminWordPressCourse[]) {
  return courses.filter(course => course.completedActivities > 5);
}

/** Project live WordPress membership once for both Advanced Admin learning views. */
export function matchedLearningSummary(
  learning: Learning, courses: AdvancedAdminWordPressCourse[], includeCurrent: boolean,
): UnifiedLearningSummary {
  const stored = buildUnifiedLearningSummary(learning.historical, learning.current);
  const subjects: Subject[] = includeCurrent
    ? stored.subjects.filter(subject => subject.source === 'current' && subject.activities.some(activity => activity.completed))
    : [];

  for (const course of courses) {
    const saved = stored.subjects.find(subject => subject.id === `legacy:${course.id}`);
    const activities: SubjectEntry[] = course.activities.map((activity, position) => {
      const matches = saved?.activities.filter(entry => entry.legacy?.source_activity_id === activity.id) || [];
      const prior = matches.find(entry => entry.legacy?.can_open_material === true) || matches.find(entry => entry.native) || matches[0];
      const id = `wordpress:${course.id}:${activity.id}`;
      const legacy: StudentActivityItem = prior?.legacy ? {
        ...prior.legacy,
        activity_id: id,
        group_id: course.id,
        group_name: course.title,
        source_activity_id: activity.id,
        activity: activity.title,
        category: activity.type,
        status: activity.completed ? 'completed' : activity.started ? 'in_progress' : 'not_started',
        completed: activity.completed,
        has_result: activity.started,
      } : {
        activity_id: id,
        source_activity_id: activity.id,
        group_id: course.id,
        group_name: course.title,
        date: null,
        category: activity.type,
        activity: activity.title,
        status: activity.completed ? 'completed' : activity.started ? 'in_progress' : 'not_started',
        completed: activity.completed,
        actual: 0,
        planned: 0,
        planned_hours_mapped: false,
        hours_mapped: false,
        quiz_score: null,
        quiz_maximum_score: null,
        has_result: activity.started,
        can_open_material: false,
      };
      return {
        id,
        title: activity.title,
        category: activity.type,
        completed: activity.completed,
        position,
        schedule: prior?.schedule || { date: null, month: 'undated' },
        week: prior?.week,
        bestScorePercent: prior?.bestScorePercent,
        native: prior?.native,
        legacy,
      };
    });
    subjects.push({
      id: `legacy:${course.id}`, title: course.title, source: 'legacy', activities,
      catalogueProgress: true, catalogueCount: activities.length,
      acceptedHours: saved?.acceptedHours,
    });
  }

  subjects.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const activityCount = subjects.reduce((sum, subject) => sum + subject.activities.length, 0);
  const completedActivityCount = subjects.reduce((sum, subject) =>
    sum + subject.activities.filter(activity => activity.completed).length, 0);
  return {
    subjects,
    subjectCount: subjects.length,
    activityCount,
    completedActivityCount,
    percent: activityCount ? Math.round(completedActivityCount / activityCount * 100) : 0,
  };
}
