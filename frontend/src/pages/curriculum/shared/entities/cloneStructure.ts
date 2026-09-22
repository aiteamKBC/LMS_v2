// ============================================================================
// Cloning a Group or a Cohort, with everything authored inside it.
//
// A clone is a parallel delivery, not a redate: it keeps the source's dates and
// delivery day (per the group/cohort form's own fields) and only drops the two
// things that would make it share state with the source rather than run
// alongside it — its learners, and any Teams meeting already booked on its
// modules. Module content itself (weeks, components, KSB mappings) is copied in
// full via `duplicateModuleStructure`, the same routine the module-builder's own
// "Duplicate module" button uses, with `keepDates: true` so the copy's sessions
// land on the same days the source's do.
// ============================================================================

import {
  createCohortGroup,
  createCurriculumCohort,
  fetchGroupModules,
  type CurriculumCohort,
  type CurriculumGroup,
} from '@/lib/curriculumApi';
import { duplicateModuleStructure, loadModuleStructure } from '../../module-builder/moduleAuthoringData';

/**
 * Every module attached to `group`, cloned onto `targetGroupId`/`targetCohortId`.
 * Failures on individual modules are collected rather than thrown — one module
 * with a structure that will not load must not stop the rest of the group (or
 * the rest of a cohort clone) from copying across.
 */
async function cloneGroupModules(
  group: CurriculumGroup,
  targetGroupId: string,
  targetCohortId: string,
  targetCohortName: string,
): Promise<{ moduleCount: number; failures: string[] }> {
  const modules = await fetchGroupModules(group.id);
  const failures: string[] = [];
  let moduleCount = 0;
  for (const module of modules) {
    const catalogueId = module.catalogueId || module.moduleCatalogueId;
    if (!catalogueId) continue;
    try {
      const structure = await loadModuleStructure(catalogueId);
      if (!structure) {
        failures.push(module.name || catalogueId);
        continue;
      }
      await duplicateModuleStructure(structure, {
        keepDates: true,
        renameCopy: false,
        groupId: targetGroupId,
        groupName: group.name,
        cohortId: targetCohortId,
        cohortName: targetCohortName,
      });
      moduleCount += 1;
    } catch {
      failures.push(module.name || catalogueId);
    }
  }
  return { moduleCount, failures };
}

export interface CloneGroupResult {
  group: CurriculumGroup;
  moduleCount: number;
  /** Titles of modules that could not be copied — the group still gets created. */
  failedModules: string[];
}

/**
 * A new group under `targetCohortId` (the source's own cohort, unless this is
 * running as part of a cohort clone), with the source's coach, tutor, delivery
 * day/time and color, no learners, and its own copy of every module attached to
 * the source group.
 */
export async function duplicateGroupWithModules(
  group: CurriculumGroup,
  options: { targetCohortId?: string; targetCohortName?: string } = {},
): Promise<CloneGroupResult> {
  const targetCohortId = options.targetCohortId || group.cohortId;
  const { group: created } = await createCohortGroup(targetCohortId, {
    name: `${group.name} copy`,
    programmeId: group.programmeId,
    tutor: group.tutor,
    coach: group.coach,
    color: group.color,
    weekDays: group.weekDays,
    startTime: group.startTime,
    endTime: group.endTime,
    startDate: group.startDate,
    endDate: group.endDate,
  });
  const { moduleCount, failures } = await cloneGroupModules(
    group,
    created.id,
    targetCohortId,
    options.targetCohortName || created.cohort || group.cohort,
  );
  return { group: created, moduleCount, failedModules: failures };
}

export interface CloneCohortResult {
  cohort: CurriculumCohort;
  groupCount: number;
  moduleCount: number;
  failedModules: string[];
}

/**
 * A new cohort under the same programme, with the source's dates, EPA window
 * and holiday selection, and its own copy of every group under `groups` that
 * belongs to `cohort` — each carrying its own modules across via
 * `duplicateGroupWithModules`.
 */
export async function duplicateCohortWithGroups(
  cohort: CurriculumCohort,
  groups: CurriculumGroup[],
): Promise<CloneCohortResult> {
  const { cohort: created } = await createCurriculumCohort({
    name: `${cohort.name} copy`,
    programme: cohort.programme,
    programmeId: cohort.programmeId,
    startDate: cohort.startDate,
    endDate: cohort.endDate,
    durationMonths: cohort.durationMonths == null ? undefined : Number(cohort.durationMonths),
    epaMonths: cohort.epaMonths,
    apprenticeshipEndOverride: cohort.apprenticeshipEndOverride || null,
    color: cohort.color,
    holidayIds: cohort.holidayIds,
    excludedHolidayIds: cohort.excludedHolidayIds,
  });

  const sourceGroups = groups.filter(candidate => candidate.cohortId === cohort.id);
  let moduleCount = 0;
  const failedModules: string[] = [];
  for (const group of sourceGroups) {
    const result = await duplicateGroupWithModules(group, {
      targetCohortId: created.id,
      targetCohortName: created.name,
    });
    moduleCount += result.moduleCount;
    failedModules.push(...result.failedModules);
  }
  return { cohort: created, groupCount: sourceGroups.length, moduleCount, failedModules };
}
