import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { buildUnifiedLearningSummary } from '@/pages/learner/my-learning/learningSummary';
import type { AssignedAssessment } from './ReviewSections';

export function assignedAssessments(learning: { current: LearnerDetail; historical: StudentActivityResponse }): AssignedAssessment[] {
  const recorded = learning.historical.canonical_otjh_activities || [];
  return buildUnifiedLearningSummary(learning.historical, learning.current).subjects.flatMap(subject =>
    subject.activities.filter(activity => /assignment|assessment/i.test(activity.category || '')).map(activity => {
      const componentId = activity.native?.componentId || undefined;
      const achieved = componentId ? recorded.filter(row => row.componentId === componentId) : [];
      const mappedHours = activity.legacy?.hours_mapped ? activity.legacy.actual : null;
      return {
        id: `${subject.id}:${activity.id}`,
        activityId: componentId,
        subjectId: subject.id,
        title: activity.title,
        subject: subject.title,
        month: activity.schedule.month || 'Undated',
        completed: activity.completed || achieved.length > 0,
        brief: activity.native?.assignmentBrief || '',
        plannedHours: activity.native?.expectedOtjh ?? (activity.legacy?.planned_hours_mapped ? activity.legacy.planned : null),
        achievedHours: achieved.length ? achieved.reduce((sum, row) => sum + row.actualSeconds, 0) / 3600
          : activity.completed ? mappedHours : null,
        ksbCodes: [...new Set((activity.native?.ksbMappings || []).map(mapping => mapping.code))],
        achievedKsbCodes: [...new Set(achieved.flatMap(row => row.ksbs))],
      };
    }));
}
