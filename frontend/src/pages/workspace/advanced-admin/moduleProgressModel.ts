import type { AdvancedAdminModuleProgress, AdvancedAdminWordPressCourse } from '@/api/advancedAdmin';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { buildUnifiedLearningSummary, type Subject } from '@/pages/learner/my-learning/learningSummary';
import { matchedLearningSummary } from './wordpressLearning';

export type Learning = { current: LearnerDetail; historical: StudentActivityResponse };
export type ModuleView = {
  subject: Subject;
  moduleId: string | null;
  code: string | null;
  done: number;
  total: number;
  hoursActual: number | null;
  hoursPlanned: number | null;
  ksbDone: number | null;
  ksbTotal: number | null;
  lastActivity: string | null;
};

export function buildModuleViews(learning: Learning, progress: AdvancedAdminModuleProgress,
  wordpressCourses?: AdvancedAdminWordPressCourse[]): ModuleView[] {
  const summary = wordpressCourses
    ? matchedLearningSummary(learning, wordpressCourses, true)
    : buildUnifiedLearningSummary(learning.historical, learning.current);
  const historicIds = new Map((learning.historical.subjects || []).map(item => [`legacy:${item.id}`, item.module_id || null]));
  const subjects = [...summary.subjects];
  const represented = new Set(subjects.map(subject => progress.moduleLinks[subject.id]?.id ||
    (subject.id.startsWith('current:') ? subject.id.slice(8) : historicIds.get(subject.id))));
  if (!wordpressCourses) for (const module of progress.modules) {
    if (!represented.has(module.id)) subjects.push({ id: `current:${module.id}`, title: module.title, source: 'current', activities: [] });
  }
  return subjects.map(subject => {
    const moduleId = progress.moduleLinks[subject.id]?.id ||
      (subject.id.startsWith('current:') ? subject.id.slice(8) : historicIds.get(subject.id)) || null;
    const module = progress.modules.find(item => item.id === moduleId);
    const canonical = moduleId ? progress.moduleProgress?.[moduleId] : undefined;
    const done = subject.activities.filter(item => item.completed).length;
    const total = Math.max(subject.activities.length, subject.catalogueCount || 0);
    const feed = (learning.current.activityFeed || []).filter(item =>
      (moduleId && item.module === module?.title) || item.module === subject.title)
      .map(item => item.at).filter(Boolean).sort();
    const componentIds = new Set(subject.activities.map(item => item.native?.componentId).filter(Boolean));
    const accepted = (learning.historical.canonical_otjh_activities || [])
      .filter(item => item.componentId && componentIds.has(item.componentId))
      .map(item => item.submittedAt).filter((value): value is string => Boolean(value));
    return {
      subject, moduleId, code: moduleId,
      done, total,
      hoursActual: canonical?.hours.actual ?? subject.acceptedHours ?? null,
      hoursPlanned: module?.total_otjh ?? null,
      ksbDone: canonical?.ksb.completed ?? null,
      ksbTotal: canonical?.ksb.total ?? null,
      lastActivity: [...feed, ...accepted].sort().at(-1) || null,
    };
  });
}

export function defaultModuleId(modules: ModuleView[], progress: AdvancedAdminModuleProgress): string | null {
  const inProgress = modules.filter(module => module.done > 0 && module.done < module.total);
  const completed = modules.filter(module => module.done > 0);
  const candidates = inProgress.length ? inProgress : completed.length ? completed : modules;
  const startDates = new Map(progress.modules.map(module => [module.id, module.start_date || '']));
  return [...candidates].sort((a, b) => {
    const aDate = a.lastActivity || (a.moduleId && startDates.get(a.moduleId)) || '';
    const bDate = b.lastActivity || (b.moduleId && startDates.get(b.moduleId)) || '';
    return bDate.localeCompare(aDate) || b.done - a.done || a.subject.title.localeCompare(b.subject.title);
  })[0]?.subject.id || null;
}
