import { clean } from '@/features/curriculum/programme-detail/model/presentation';
import type { CurriculumProgrammeAssignedLearner } from '@/lib/curriculumApi';

/** Two letters for the roster avatar; a person with one name keeps one letter. */
export function learnerInitials(value: string) {
  const parts = clean(value).split(/\s+/).filter(Boolean);
  if (!parts.length) return '--';
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '')).toUpperCase();
}

// Avatar tints, drawn from the brand scales rather than a rainbow: the roster is
// a list of people, and the colour is only there to make one row findable again
// after scrolling. Assigned by hashing the learner's id so it is stable across
// reloads and re-sorts -- a colour that moved would be worse than no colour.
export const LEARNER_TINTS = [
  'bg-primary-100 text-primary-800',
  'bg-secondary-100 text-secondary-800',
  'bg-accent-100 text-accent-800',
  'bg-emerald-100 text-emerald-800',
  'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-800',
];

export function learnerTint(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return LEARNER_TINTS[hash % LEARNER_TINTS.length];
}

export type RosterStatusFilter = 'all' | 'active' | 'inactive';

export type RosterSort = 'name' | 'group' | 'progress';

/** Fraction of the learner's off-the-job target that is done, or null when no target is recorded. */
export function learnerOtjhProgress(learner: CurriculumProgrammeAssignedLearner) {
  const target = Number(learner.targetHours ?? 0);
  if (!Number.isFinite(target) || target <= 0) return null;
  const raw = Number(learner.completedHours ?? 0);
  const done = Number.isFinite(raw) ? raw : 0;
  return { done, target, percent: Math.max(0, Math.min(100, Math.round((done / target) * 100))) };
}
