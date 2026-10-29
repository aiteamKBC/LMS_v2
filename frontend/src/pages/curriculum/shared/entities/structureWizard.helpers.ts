import { type CurriculumCohort, type CurriculumGroup, type CurriculumModule, type CurriculumProgramme } from '@/lib/curriculumApi';
import { cleanText, programmeIdentity, sameIdentifier } from './model';
import { type SavedModuleRef } from './moduleForm';


/** What one run of the wizard actually wrote. Every field is optional: a step can be skipped. */
export interface StructureWizardCreated {
  programme?: CurriculumProgramme;
  cohort?: CurriculumCohort;
  group?: CurriculumGroup;
  module?: SavedModuleRef;
}


/** Every id a module row may carry, so a discarded module is recognised however it is keyed. */
export function moduleIdentifiers(module: CurriculumModule): string[] {
  return [module.moduleCatalogueId, module.catalogueId, module.moduleId, module.id].map(value => cleanText(value));
}


/**
 * The four collections with a discarded run's records taken out, for a host page
 * to hand straight to its `applyLocal`.
 *
 * Children go with their parent, because that is what the discard did to the
 * database: archiving a cohort takes its groups down with it, and deleting a
 * programme takes everything beneath it. Filtering only the exact rows the run
 * wrote would leave the reader looking at a group whose cohort is gone.
 */
export function withoutDiscardedRecords<T extends {
  programmes: CurriculumProgramme[];
  cohorts: CurriculumCohort[];
  groups: CurriculumGroup[];
  modules: CurriculumModule[];
}>(entities: T, discarded: StructureWizardCreated): T {
  const programmeId = discarded.programme ? cleanText(programmeIdentity(discarded.programme)) : '';
  const cohortId = cleanText(discarded.cohort?.id);
  const groupId = cleanText(discarded.group?.id);
  const moduleId = cleanText(discarded.module?.catalogueId);
  if (!programmeId && !cohortId && !groupId && !moduleId) return entities;

  const underProgramme = (value: unknown) => Boolean(programmeId) && sameIdentifier(value, programmeId);
  const underCohort = (value: unknown) => Boolean(cohortId) && sameIdentifier(value, cohortId);
  const underGroup = (value: unknown) => Boolean(groupId) && sameIdentifier(value, groupId);

  return {
    ...entities,
    programmes: entities.programmes.filter(programme => !underProgramme(programmeIdentity(programme))),
    cohorts: entities.cohorts.filter(cohort => !underProgramme(cohort.programmeId) && !underCohort(cohort.id)),
    groups: entities.groups.filter(group => (
      !underProgramme(group.programmeId) && !underCohort(group.cohortId) && !underGroup(group.id)
    )),
    modules: entities.modules.filter(module => (
      !underProgramme(module.programmeId)
      && !underCohort(module.cohortId)
      && !underGroup(module.groupId)
      && !(Boolean(moduleId) && moduleIdentifiers(module).some(value => sameIdentifier(value, moduleId)))
    )),
  };
}
