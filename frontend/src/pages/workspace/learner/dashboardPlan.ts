import type { PlanSubjectSummary } from '@/api/learnerOverview';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

/** Merge subject cards by verified Builder links; activities are already deduplicated by the API. */
export function dashboardPlanSubjects(subjects: PlanSubjectSummary[], data: TrainingPlanDashboard) {
  const groups = new Map<string, PlanSubjectSummary>();
  for (const subject of subjects) {
    const moduleId = subject.id.startsWith('current:') ? subject.id.slice(8) : null;
    const matches = moduleId ? subjects.filter(item => item.source === 'legacy' && data.moduleLinks[item.id]?.id === moduleId) : [];
    const id = matches.length === 1 ? matches[0].id : subject.id;
    const previous = groups.get(id);
    groups.set(id, {
      ...subject, id, source: id.startsWith('legacy:') ? 'legacy' : 'current',
      title: data.moduleLinks[id]?.title || subject.title,
      total: (previous?.total || 0) + subject.total,
      completed: (previous?.completed || 0) + subject.completed,
      dates: [...new Set([...(previous?.dates || []), ...subject.dates])].sort(),
      moduleIds: [...new Set([...(previous?.moduleIds || []), ...subject.moduleIds])],
      sessionTitles: [...(previous?.sessionTitles || []), ...subject.sessionTitles],
    });
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
