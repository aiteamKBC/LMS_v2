/** Convert legacy test fixtures to the canonical wire contract; never used by the app. */
import type { WeeklyLearningDetail, WeeklyLearningResponse, CanonicalSelectedWeek, CanonicalWeek } from '@/api/weeklyLearning';
import { completedComponentIds } from '@/utils/learnerJourney';
import { activityStatus, activityExpectedMinutes, weekComponents, weekProgress, weekKsbProgress, weekOtjhHours } from '@/pages/workspace/learner/weeklyPlanHelpers';

export function weeklyContractFixture(value: unknown): WeeklyLearningResponse {
  let detail = value as WeeklyLearningDetail & { weekId?: string; moduleId?: string };
  if (detail.weekId) detail = { ...detail, components: detail.components.map(component => ({ ...component,
    moduleId: component.moduleId ?? detail.moduleId, weekId: component.weekId ?? `W${detail.weekId!.split(':').at(-1)}` })) };
  const done = completedComponentIds(detail);
  const modules = detail.schedule?.modules ?? (detail.weekId ? [{ id: detail.moduleId!, title: 'Module', curriculumSlots: [{
    slotNumber: Number(detail.weekId.split(':').at(-1)) || 1, date: '2026-10-13', day: 'Tuesday',
    type: 'live-session' as const, sessionNumber: Number(detail.weekId.split(':').at(-1)) || 1,
    weekId: `W${detail.weekId.split(':').at(-1)}`, holidays: [] }] }] : []);
  const weeks: CanonicalWeek[] = modules.flatMap(module => (module.curriculumSlots ?? []).map(slot => {
    const components = weekComponents(detail, module.id, slot.weekId, slot.sessionNumber ?? undefined);
    const progress = weekProgress(components, done);
    const end = new Date(`${slot.date}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
    const live = detail.schedule?.sessions.find(session => session.moduleId === module.id
      && new Date(session.start).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) === slot.date);
    return { id: `${module.id}:${slot.slotNumber}`, moduleId: module.id, moduleTitle: module.title, weekId: slot.weekId,
      weekNumber: slot.sessionNumber ?? slot.slotNumber, slotNumber: slot.slotNumber, kind: slot.type, title: slot.weekTitle ?? `Week ${slot.sessionNumber}`,
      startDate: slot.date, endDate: end.toISOString().slice(0,10), status: 'current', progress: progress.percent,
      completedActivities: progress.completed, totalActivities: progress.total, attended: live?.attended ?? null,
      sessionState: live ? 'upcoming' : 'unscheduled', sessionStart: live?.start, sessionDurationMinutes: live?.minutes,
      holidayNote: slot.holidayNote ?? '', holidays: slot.holidays };
  }));
  const requestedId = detail.weekId ?? detail.selectedWeekId;
  const week = weeks.find(item => `${item.kind === 'reading-week' ? 'reading' : 'slot'}:${item.moduleId}:${item.slotNumber}` === requestedId) ?? weeks[0];
  if (!week) return { weeks, selectedWeek: null };
  const components = weekComponents(detail, week.moduleId, week.weekId, week.weekNumber);
  const ksb = weekKsbProgress(components, done);
  const hours = weekOtjhHours(components, detail.schedule?.moduleActivityHours?.[week.moduleId]);
  const session = detail.schedule?.sessions.find(item => item.moduleId === week.moduleId
    && new Date(item.start).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) === week.startDate);
  const selectedWeek: CanonicalSelectedWeek = { ...week, summary: { completedActivities: week.completedActivities,
    totalActivities: week.totalActivities, progress: week.progress, ksbCount: ksb.total, achievedKsbCount: ksb.achieved,
    otjhHours: hours.actualHours, plannedOtjhHours: hours.plannedHours, untimedActivities: hours.untimed },
    liveSession: session ? { ...session, date: week.startDate, durationMinutes: session.minutes, endTime: null,
      sessionState: 'upcoming' } : null,
    activities: components.map(component => ({ id: component.componentId!, title: component.title, type: component.type ?? 'activity',
      completed: activityStatus(component, done) === 'completed', status: activityStatus(component, done), isQuiz: !!component.isQuiz,
      expectedHours: activityExpectedMinutes(component) == null ? null : activityExpectedMinutes(component)! / 60,
      actualHours: weekOtjhHours([component], detail.schedule?.moduleActivityHours?.[week.moduleId], detail.components).actualHours,
      durationMinutes: component.durationMinutes ?? null, quizDuration: component.quizMeta?.duration ?? null,
      quizTimeUnit: component.quizMeta?.timeUnit ?? null, quizId: component.quizMeta?.quizId,
      ksbCodes: component.ksbMappings?.map(mapping => mapping.code) ?? [], contentAvailable: component.contentAvailable ?? true,
      videoUrl: component.videoUrl, sessionDate: component.sessionDate, sessionDateTimeUtc: component.sessionDateTimeUtc })),
  };
  return { weeks, selectedWeek };
}
