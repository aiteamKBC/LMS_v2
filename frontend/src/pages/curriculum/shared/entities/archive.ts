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
import {
  archiveCurriculumCohort,
  archiveCurriculumGroup,
  archiveCurriculumModule,
  permanentlyDeleteCurriculumCohort,
  permanentlyDeleteCurriculumGroup,
  permanentlyDeleteCurriculumModule,
  restoreCurriculumCohort,
  restoreCurriculumGroup,
  restoreCurriculumModule,
  curriculumErrorMessage,
  type CurriculumArchivedCohort,
  type CurriculumArchivedGroup,
  type CurriculumArchivedModule,
} from '@/lib/curriculumApi';

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
    text: `${module.name} leaves active planning and this programme's module list.${content} Nothing is deleted from the database, and it can be brought back from View archive on the module catalogue.`,
    icon: 'warning',
    confirmButtonText: 'Archive module',
    onConfirm: async () => {
      await archiveCurriculumModule(module.id);
      await onArchived();
    },
    successTitle: 'Module archived',
  });
}


// ----------------------------------------------------------------------------
// The way back out of the archive, and the way through it.
//
// The three confirms above put a record *into* the archive. These six take one
// out again or finish the job, and they carry the same wording wherever the
// archive is shown. Both pairs are deliberately asymmetric: a restore says what
// it cannot bring back, and a permanent delete says what it takes with it and
// that there is no undo.
// ----------------------------------------------------------------------------

// Said by both restores because it is the one thing coming back out of the
// archive cannot do. Archiving detaches every module beneath the record and
// keeps no record of which module sat where, so the record returns without its
// timetable and the modules have to be attached again.
const MODULES_RETURN_DETACHED = 'Its modules were detached when it was archived, so they have to be attached again.';

// The module restore's equivalent: the Quiz Workspace owns its own archive, and
// a module coming back cannot reach into it.
const MODULE_QUIZZES_STAY_ARCHIVED = 'Quizzes archived with it stay in the Quiz Archive - restore those from the Quiz Workspace.';

/**
 * Re-raise an API refusal as the sentence the backend actually wrote.
 *
 * `showCurriculumConfirm` puts `error.message` in the dialog, and a raw
 * `CurriculumApiError` carries the diagnostic form of it ("Curriculum API
 * returned 409 for /path: …"). Every refusal these four can hit is something
 * the reader has to act on — restore the programme first, move the learners —
 * so it has to arrive readable.
 */
async function withArchiveError<T>(fallback: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(curriculumErrorMessage(error, fallback));
  }
}

/**
 * POST /curriculum/cohorts/{id}/restore/ — the cohort comes back, and so do the
 * groups its own archive took down with it. A group that was archived on its
 * own stays archived, the same way restoring a programme leaves an
 * independently archived cohort alone.
 */
export async function restoreCohortWithConfirm(
  cohort: Pick<CurriculumArchivedCohort, 'id' | 'name' | 'groups'>,
  onRestored: () => void | Promise<void>,
): Promise<boolean> {
  return showCurriculumConfirm({
    title: 'Restore cohort?',
    text: cohort.groups
      ? `${cohort.name} and the ${cohort.groups} group${cohort.groups === 1 ? '' : 's'} archived with it go back into the active list. ${MODULES_RETURN_DETACHED}`
      : `${cohort.name} goes back into the active list. ${MODULES_RETURN_DETACHED}`,
    icon: 'question',
    confirmButtonText: 'Restore cohort',
    onConfirm: async () => {
      await withArchiveError('Unable to restore this cohort.', () => restoreCurriculumCohort(cohort.id));
      await onRestored();
    },
    successTitle: 'Cohort restored',
  });
}

/**
 * POST /curriculum/groups/{id}/restore/ — and the group goes back onto its
 * cohort's group list. A group whose cohort is still archived is refused by the
 * endpoint, so the archive view does not offer this for one.
 */
export async function restoreGroupWithConfirm(
  group: Pick<CurriculumArchivedGroup, 'id' | 'name' | 'cohort'>,
  onRestored: () => void | Promise<void>,
): Promise<boolean> {
  return showCurriculumConfirm({
    title: 'Restore group?',
    text: `${group.name} goes back into the active list${group.cohort ? ` under ${group.cohort}` : ''}. ${MODULES_RETURN_DETACHED}`,
    icon: 'question',
    confirmButtonText: 'Restore group',
    onConfirm: async () => {
      await withArchiveError('Unable to restore this group.', () => restoreCurriculumGroup(group.id));
      await onRestored();
    },
    successTitle: 'Group restored',
  });
}

/**
 * DELETE /curriculum/cohorts/{id}/?permanent=true — this one really does delete.
 *
 * The row and every group archived with it leave the database for good. Module
 * content is kept: a module outlives the delivery it was scheduled into, which
 * is the promise the plain archive already makes. The endpoint refuses while
 * live learners are still placed in the cohort, and the refusal's own sentence
 * is what the dialog shows.
 */
export async function permanentlyDeleteCohortWithConfirm(
  cohort: Pick<CurriculumArchivedCohort, 'id' | 'name' | 'groups'>,
  onDeleted: () => void | Promise<void>,
): Promise<boolean> {
  const groups = cohort.groups
    ? ` The ${cohort.groups} group${cohort.groups === 1 ? '' : 's'} archived with it go too.`
    : '';
  return showCurriculumConfirm({
    title: 'Delete permanently?',
    text: `${cohort.name} is removed from the database and cannot be restored.${groups} Module content is kept, and learner accounts and progress are never touched.`,
    icon: 'warning',
    confirmButtonText: 'Delete permanently',
    onConfirm: async () => {
      await withArchiveError('Unable to delete this cohort.', () => permanentlyDeleteCurriculumCohort(cohort.id));
      await onDeleted();
    },
    successTitle: 'Cohort deleted permanently',
  });
}

/**
 * POST /curriculum/modules/{id}/restore/ — the module and the weeks, components
 * and KSB mappings archived with it come back together.
 *
 * The one thing it cannot return is quizzes: archiving a module sends the
 * quizzes only it owned to the Quiz Archive, which is the Quiz Workspace's own
 * state, so they are restored from there. Said before the click rather than
 * discovered afterwards, the same way the two restores above name what they
 * leave behind.
 */
export async function restoreModuleWithConfirm(
  module: Pick<CurriculumArchivedModule, 'id' | 'title' | 'programme' | 'components'>,
  onRestored: () => void | Promise<void>,
): Promise<boolean> {
  const content = module.components
    ? ` Its ${module.components} component${module.components === 1 ? '' : 's'} come back with it.`
    : '';
  return showCurriculumConfirm({
    title: 'Restore module?',
    text: `${module.title} goes back into the catalogue${module.programme ? ` under ${module.programme}` : ''}.${content} ${MODULE_QUIZZES_STAY_ARCHIVED}`,
    icon: 'question',
    confirmButtonText: 'Restore module',
    onConfirm: async () => {
      await withArchiveError('Unable to restore this module.', () => restoreCurriculumModule(module.id));
      await onRestored();
    },
    successTitle: 'Module restored',
  });
}

/**
 * DELETE /curriculum/modules/{id}/?permanent=true — the only permanent delete
 * here that destroys authored content rather than a delivery record.
 *
 * The cohort and group deletes keep module content on purpose: a module outlives
 * the delivery it was scheduled into. This one *is* the module, so the weeks and
 * components go with it. The count is in the sentence because it is the whole
 * decision.
 */
export async function permanentlyDeleteModuleWithConfirm(
  module: Pick<CurriculumArchivedModule, 'id' | 'title' | 'weeks' | 'components'>,
  onDeleted: () => void | Promise<void>,
): Promise<boolean> {
  const content = module.weeks || module.components
    ? ` ${module.weeks} week${module.weeks === 1 ? '' : 's'} and ${module.components} component${module.components === 1 ? '' : 's'} are destroyed with it.`
    : '';
  return showCurriculumConfirm({
    title: 'Delete permanently?',
    text: `${module.title} is removed from the database and cannot be restored.${content} Learner accounts and progress are never touched.`,
    icon: 'warning',
    confirmButtonText: 'Delete permanently',
    onConfirm: async () => {
      await withArchiveError('Unable to delete this module.', () => permanentlyDeleteCurriculumModule(module.id));
      await onDeleted();
    },
    successTitle: 'Module deleted permanently',
  });
}

/** DELETE /curriculum/groups/{id}/?permanent=true — same finality as the cohort above. */
export async function permanentlyDeleteGroupWithConfirm(
  group: Pick<CurriculumArchivedGroup, 'id' | 'name'>,
  onDeleted: () => void | Promise<void>,
): Promise<boolean> {
  return showCurriculumConfirm({
    title: 'Delete permanently?',
    text: `${group.name} is removed from the database and cannot be restored. Module content is kept, and learner accounts and progress are never touched.`,
    icon: 'warning',
    confirmButtonText: 'Delete permanently',
    onConfirm: async () => {
      await withArchiveError('Unable to delete this group.', () => permanentlyDeleteCurriculumGroup(group.id));
      await onDeleted();
    },
    successTitle: 'Group deleted permanently',
  });
}
