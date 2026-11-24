import {
  type Cohort,
  type Group,
  type Module,
  type Session,
} from '@/features/curriculum/programme-detail/model/types';
import {
  type CurriculumModule,
  type CurriculumProgramme,
  type CurriculumOverview,
  type CurriculumStaffProfile,
} from '@/lib/curriculumApi';
import { normalise, slugify, clean } from '@/features/curriculum/programme-detail/model/presentation';
import { findByIdentifierThenName } from '@/pages/curriculum/shared/entities/model';
import { groupCoachNames } from '@/pages/curriculum/shared/entities/groupCoaches';

export function cohortStatus(status: string): Cohort['status'] {
  if (status === 'archived') return 'archived';
  if (status === 'planned' || status === 'completed') return status;
  return 'active';
}

export function groupStatus(status: string): Group['status'] {
  if (status === 'archived') return 'archived';
  if (status === 'completed') return 'completed';
  if (status === 'planned' || status === 'pending') return 'planned';
  return 'active';
}

/**
 * An archived module, by any of the signals the payload carries.
 *
 * Archiving a module soft-deletes it (`isProgrammeDeleted`) and leaves `status`
 * alone, so the delivery status is where it usually shows. This page fetches
 * `visibility: 'all'` so the cohort status filter can reach archived cohorts,
 * which means archived modules arrive here too and have to be dropped: archive
 * takes a module off this list and keeps its content, and the programme card
 * counts only the live ones — so counting them here made the workspace disagree
 * with the card it was opened from.
 */
export function isArchivedCurriculumModule(module: Pick<CurriculumModule, 'status' | 'authoringStatus' | 'deliveryStatus' | 'isProgrammeDeleted'>): boolean {
  if (module.isProgrammeDeleted) return true;
  return [module.status, module.authoringStatus, module.deliveryStatus]
    .some(value => normalise(value) === 'archived');
}

export function moduleStatus(status: string): Module['status'] {
  if (status === 'archived') return 'archived';
  if (status === 'published' || status === 'approved' || status === 'in-review' || status === 'draft') return status;
  return status === 'review' ? 'in-review' : 'published';
}

export type RecordStatusFilter = 'active' | 'archived' | 'all';

export function matchesRecordStatus(archived: boolean, filter: RecordStatusFilter) {
  if (filter === 'all') return true;
  return filter === 'archived' ? archived : !archived;
}

export function sessionStatus(status: string): Session['status'] {
  if (status === 'completed' || status === 'cancelled' || status === 'pending') return status;
  return 'scheduled';
}

export function isProgrammeMatch(programme: CurriculumProgramme, value: string) {
  const programmeNames = [programme.id, programme.sourceId, programme.name, programme.standard].map(normalise);
  return programmeNames.includes(normalise(value));
}

export function programmeReferenceMatches(programme: CurriculumProgramme, value: unknown) {
  const key = normalise(value);
  if (!key) return false;
  return [
    programme.id,
    programme.sourceId,
    programme.sourceId ? `program-${slugify(programme.sourceId)}` : '',
    programme.name,
    programme.standard,
  ].some(candidate => normalise(candidate) === key);
}

export function belongsToProgramme(programme: CurriculumProgramme, item: { programmeId?: string; programme?: string; programmeName?: string }) {
  return (
    (clean(item.programmeId) ? programmeReferenceMatches(programme, item.programmeId) : false) ||
    isProgrammeMatch(programme, item.programme || item.programmeName || '')
  );
}

export function findProgramme(data: CurriculumOverview | null, routeId: string) {
  if (!data) return null;
  // Ids before names: a programme named the same as another programme's id used
  // to win the route purely by sitting earlier in the list. See
  // findByIdentifierThenName.
  return findByIdentifierThenName(
    data.programmes,
    routeId,
    programme => [programme.id, programme.sourceId],
    programme => [programme.name],
    normalise,
  ) ?? null;
}

/** Staff roster plus anyone already named on a record, de-duplicated and sorted. */
export function staffNameOptions(profiles: CurriculumStaffProfile[] | undefined, assigned: Array<string | undefined>) {
  const names = new Set<string>();
  (profiles || []).forEach(profile => {
    const name = clean(profile.name) || clean(profile.email);
    if (name) names.add(name);
  });
  // A group's `coach` may name several coaches: each is its own option.
  assigned.forEach(value => groupCoachNames(value).forEach(name => names.add(name)));
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
