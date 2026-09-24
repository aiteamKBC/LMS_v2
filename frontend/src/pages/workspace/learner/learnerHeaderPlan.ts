import type { PlanModule, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { dateKey } from '@/pages/learner/training-plan-timeline/model';

type Placement = { programme?: string; cohort?: string; group?: string };
const normalise = (value?: string) => (value || '').trim().toLowerCase();

/** Resolve `current` when opening learning, after activity delivery dates have loaded. */
export function learnerModuleHref(kind?: string, learnerId?: string, moduleId?: string, links: TrainingPlanDashboard['moduleLinks'] = {}) {
  const base = kind && learnerId ? `/learner/my-learning/${encodeURIComponent(kind)}/${encodeURIComponent(learnerId)}` : '/learner/my-learning';
  if (!moduleId) return `${base}?week=current`;
  const imported = Object.entries(links).filter(([subject, module]) => subject.startsWith('legacy:') && module.id === moduleId);
  const subject = imported.length === 1 ? imported[0][0] : `current:${moduleId}`;
  return `${base}?subject=${encodeURIComponent(subject)}&week=current`;
}

/** The header follows the learner's current placement and teaching dates, not creation order. */
export function learnerHeaderPlan(modules: PlanModule[], placement: Placement, today: string) {
  const fields = [['programme_name', placement.programme], ['cohort_name', placement.cohort], ['group_name', placement.group]] as const;
  const compatible = modules.filter(module => fields.every(([key, expected]) =>
    !normalise(expected) || !normalise(module[key]) || normalise(module[key]) === normalise(expected)));
  const exact = compatible.filter(module => fields.every(([key, expected]) =>
    !normalise(expected) || normalise(module[key]) === normalise(expected)));
  // The dashboard schedule is already scoped to this learner's assignments.
  // Imported Aptem subjects may carry catalogue placement labels that differ
  // from the learner identity, so keep those assigned modules visible when no
  // placement-labelled candidate matches.
  const placementCandidates = (exact.length ? exact : compatible).filter(module => module.title.trim());
  const candidates = (placementCandidates.length ? placementCandidates : modules).filter(module => module.title.trim());
  const sorted = [...candidates].sort((a, b) => (dateKey(a.start_date) || '9999').localeCompare(dateKey(b.start_date) || '9999')
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const active = sorted.filter(module => dateKey(module.start_date) && dateKey(module.end_date)
    && dateKey(module.start_date) <= today && dateKey(module.end_date) >= today);
  if (active.length) return { label: active.length > 1 ? 'Current modules' : 'Current module', modules: active };
  const next = sorted.find(module => dateKey(module.start_date) > today);
  if (next) return { label: 'Next module', modules: [next] };
  const past = [...sorted].filter(module => dateKey(module.end_date) && dateKey(module.end_date) < today)
    .sort((a, b) => dateKey(b.end_date).localeCompare(dateKey(a.end_date)) || a.id.localeCompare(b.id));
  if (past.length) return { label: 'Last module', modules: [past[0]] };
  return { label: candidates.length > 1 ? 'Modules' : 'Module', modules: sorted };
}
