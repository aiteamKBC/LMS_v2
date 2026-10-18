import type { CanonicalSelectedWeek, CanonicalWeek } from '@/api/weeklyLearning';
import type { CurriculumRow } from '@/pages/learner/training-plan-timeline/model';
import type { JourneyComponent } from '@/utils/learnerJourney';

/** Presentation props only: no calendar, completion or hours calculation. */
export function canonicalWeekRow(week: CanonicalWeek, live?: CanonicalSelectedWeek['liveSession']): CurriculumRow {
  if (week.kind === 'reading-week') return { kind: 'reading-week', slotNumber: week.slotNumber,
    date: week.startDate, holidays: week.holidays };
  return { kind: 'session', slotNumber: week.slotNumber, date: week.startDate, sessionNumber: week.weekNumber,
    weekId: week.weekId, weekTitle: week.title, title: live?.title ?? week.title,
    start: live?.start ?? week.sessionStart ?? null, minutes: live?.durationMinutes ?? week.sessionDurationMinutes ?? null,
    attended: live?.attended ?? week.attended, joinUrl: live?.joinUrl ?? null,
    holidays: week.holidays, holidayNote: week.holidayNote };
}

/** Thin table props; reuse the existing links and time formatting exactly. */
export function canonicalActivityRows(week: CanonicalSelectedWeek): JourneyComponent[] {
  return week.activities.map(activity => ({
    componentId: activity.id, component: activity.title, title: activity.title, type: activity.type,
    isQuiz: activity.isQuiz, quizMeta: activity.isQuiz && activity.quizId != null
      ? { quizId: activity.quizId, questions: null, duration: activity.quizDuration, timeUnit: activity.quizTimeUnit } : undefined,
    durationMinutes: activity.durationMinutes, expectedOtjh: activity.expectedHours,
    contentAvailable: activity.contentAvailable, videoUrl: activity.videoUrl,
    weeklyCompleted: activity.completed, weeklyStatus: activity.status, ksbCodes: activity.ksbCodes,
  }));
}
