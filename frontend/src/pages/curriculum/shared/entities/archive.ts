// ============================================================================
// The cohort/group archive confirm, in one place.
//
// Every page that lists cohorts or groups — their own pages, and a programme
// workspace scoped to one — offers the same action with the same wording and
// the same API call. Before this file it was written out three times (Cohorts,
// Groups, and the confirm the Programme workspace would otherwise have needed a
// fourth copy of); a wording change or a new cascade warning had to be made in
// every copy or the pages would start disagreeing about what "archive" does.
//
// What differs between callers is only what happens *after* the archive call
// succeeds — a standalone page drops the row from its own list state, a scoped
// workspace drops it from a locally-filtered view — so that part stays the
// caller's `onArchived` callback rather than being folded in here.
// ============================================================================

import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { archiveCurriculumCohort, archiveCurriculumGroup, archiveCurriculumModule } from '@/lib/curriculumApi';

/**
 * DELETE /curriculum/cohorts/{id}/ archives, it does not delete — the cascade
 * takes every group beneath the cohort with it, but nothing is removed from the
 * database. `groupCount` is said up front so the confirm names what else is
 * affected before the click, not after.
 */
export async function archiveCohortWithConfirm(
  cohort: { id: string; name: string },
  groupCount: number,
  onArchived: () => void | Promise<void>,
): Promise<boolean> {
  return showCurriculumConfirm({
    title: 'Archive cohort?',
    text: groupCount
      ? `${cohort.name} has ${groupCount} group${groupCount === 1 ? '' : 's'}. Archiving hides the cohort and its groups; nothing is deleted.`
      : `${cohort.name} will be hidden from the active list. Nothing is deleted.`,
    icon: 'warning',
    confirmButtonText: 'Archive cohort',
    onConfirm: async () => {
      await archiveCurriculumCohort(cohort.id);
      await onArchived();
    },
    successTitle: 'Cohort archived',
  });
}

/**
 * DELETE /curriculum/groups/{id}/ — same soft-archive shape as the cohort call
 * above. `moduleCount` names what the group's modules go through: unassigned
 * from the group and kept, not archived with it.
 */
export async function archiveGroupWithConfirm(
  group: { id: string; name: string },
  moduleCount: number,
  onArchived: () => void | Promise<void>,
): Promise<boolean> {
  return showCurriculumConfirm({
    title: 'Archive group?',
    text: moduleCount
      ? `${group.name} has ${moduleCount} module${moduleCount === 1 ? '' : 's'}. Archiving detaches them from the group; the module content is kept.`
      : `${group.name} will be hidden from the active list. Nothing is deleted.`,
    icon: 'warning',
    confirmButtonText: 'Archive group',
    onConfirm: async () => {
      await archiveCurriculumGroup(group.id);
      await onArchived();
    },
    successTitle: 'Group archived',
  });
}

/**
 * DELETE /curriculum/modules/{id}/ — an archive, like the two above. Archiving
 * is as far as a module goes: the weeks, components and KSB mappings authored
 * under it are kept, and there is no permanent delete for one. That is the
 * answer to "how do I delete a module", so the confirm says it outright rather
 * than leaving the reader to discover it after the click.
 *
 * It also says what cannot be undone from here. A programme has a Restore in
 * the archive; a module has no restore endpoint at all, so an archived module
 * only comes back through the database. Saying so before the click is the whole
 * difference between a reversible action and a lost one.
 */
export async function archiveModuleWithConfirm(
  module: { id: string; name: string },
  componentCount: number,
  onArchived: () => void | Promise<void>,
): Promise<boolean> {
  const content = componentCount
    ? ` Its ${componentCount} authored component${componentCount === 1 ? '' : 's'} and every week beneath it are kept.`
    : ' Anything authored under it is kept.';
  return showCurriculumConfirm({
    title: 'Archive module?',
    text: `${module.name} leaves active planning and this programme's module list.${content} Nothing is deleted from the database — archiving is as far as a module goes, and there is no permanent delete for one. There is also no undo: unlike a programme, an archived module cannot be restored from the app.`,
    icon: 'warning',
    confirmButtonText: 'Archive module',
    onConfirm: async () => {
      await archiveCurriculumModule(module.id);
      await onArchived();
    },
    successTitle: 'Module archived',
  });
}
