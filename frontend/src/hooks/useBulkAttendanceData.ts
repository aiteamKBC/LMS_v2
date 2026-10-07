import { useEffect, useMemo, useState } from "react";
import { fetchBulkAttendanceLearners, type BulkAttendanceDirectoryLearner } from "@/api/bulkAttendanceLearners";
import {
  fetchCurriculumGroups,
  fetchCurriculumOverview,
  fetchCurriculumScopeLearnerRoster,
  type CurriculumGroup,
  type CurriculumProgrammeAssignedLearner,
  type CurriculumOverview,
} from "@/lib/curriculumApi";
import type {
  Cohort,
  Group,
  Learner,
  Lecture,
  Module,
  Programme,
} from "@/types/bulkAttendance";

export interface BulkAttendanceData {
  programmes: Programme[];
  cohorts: Cohort[];
  groups: Group[];
  modules: Module[];
  lectures: Lecture[];
  learners: Learner[];
  loading: boolean;
  error: string | null;
}

const EMPTY_DATA: Omit<BulkAttendanceData, "loading" | "error"> = {
  programmes: [],
  cohorts: [],
  groups: [],
  modules: [],
  lectures: [],
  learners: [],
};

function asDate(value: string | undefined): string {
  return value?.slice(0, 10) ?? "";
}

function toBulkData(
  overview: CurriculumOverview,
  curriculumGroups: CurriculumGroup[],
  rosters: Map<string, CurriculumProgrammeAssignedLearner[]>,
  directory: BulkAttendanceDirectoryLearner[],
) {
  const programmes: Programme[] = overview.programmes.map((programme) => ({
    id: String(programme.id),
    name: programme.name,
    code: programme.sourceId || String(programme.id),
  }));

  const cohorts: Cohort[] = overview.cohorts.map((cohort) => ({
    id: String(cohort.id),
    name: cohort.name,
    programmeId: String(cohort.programmeId),
    startDate: asDate(cohort.startDate),
  }));

  const groups: Group[] = curriculumGroups.map((group) => ({
    id: String(group.id),
    name: group.name,
    cohortId: String(group.cohortId),
  }));

  const modules: Module[] = overview.modules.map((module) => ({
    id: String(module.id),
    name: module.name,
    programmeId: String(module.programmeId ?? ""),
  }));

  const moduleIdsByAlias = new Map<string, string>();
  overview.modules.forEach((module) => {
    const id = String(module.id);
    [module.id, module.moduleId, module.moduleCatalogueId, module.deliveryModuleId]
      .filter(Boolean)
      .forEach((alias) => moduleIdsByAlias.set(String(alias), id));
  });

  const lectures: Lecture[] = overview.sessions.map((session) => ({
    id: String(session.id),
    name: session.title,
    moduleId: moduleIdsByAlias.get(String(session.moduleId ?? session.moduleCatalogueId ?? ""))
      ?? String(session.moduleId ?? session.moduleCatalogueId ?? ""),
    sessionDate: asDate(session.date),
  }));

  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
  const cohortByName = new Map(cohorts.map((cohort) => [`${cohort.programmeId}:${cohort.name}`, cohort]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupByName = new Map(groups.map((group) => [`${group.cohortId}:${group.name}`, group]));
  const placements: Learner[] = [];
  const seenLearners = new Set<string>();

  rosters.forEach((assignedLearners, programmeId) => {
    assignedLearners.forEach((assigned) => {
      const cohort = assigned.cohortId
        ? cohortById.get(String(assigned.cohortId))
        : cohortByName.get(`${programmeId}:${assigned.cohort}`);
      const group = assigned.groupId
        ? groupById.get(String(assigned.groupId))
        : groupByName.get(`${cohort?.id ?? ""}:${assigned.group}`);
      const id = String(assigned.id);
      if (seenLearners.has(id)) return;
      seenLearners.add(id);
      placements.push({
        id,
        name: assigned.name || assigned.email,
        email: assigned.email,
        programmeId,
        cohortId: cohort?.id ?? String(assigned.cohortId ?? ""),
        groupId: group?.id ?? String(assigned.groupId ?? ""),
        endDate: asDate(overview.cohorts.find((item) => String(item.id) === cohort?.id)?.endDate),
      });
    });
  });

  const normalize = (value: string) => value.trim().toLowerCase();
  const learners: Learner[] = directory.map((learner) => {
    // Only an unambiguous email match may supply curriculum placement. KBC
    // IDs and curriculum learner IDs belong to different databases.
    const matches = learner.email
      ? placements.filter((item) => normalize(item.email) === normalize(learner.email))
      : [];
    const placement = matches.length === 1 ? matches[0] : undefined;
    const matchingProgrammes = programmes.filter((item) => normalize(item.name) === normalize(learner.programme));
    const programmeId = placement?.programmeId ?? (matchingProgrammes.length === 1 ? matchingProgrammes[0].id : "");
    const matchingGroups = groups.filter((item) =>
      programmeId && cohortById.get(item.cohortId)?.programmeId === programmeId
      && normalize(item.name) === normalize(learner.group),
    );
    const group = matchingGroups.length === 1 ? matchingGroups[0] : undefined;
    return {
      id: placement?.id ?? `kbc:${learner.id}`,
      name: learner.name || learner.email,
      email: learner.email,
      programmeId,
      cohortId: placement?.cohortId || group?.cohortId || "",
      groupId: placement?.groupId || group?.id || "",
      endDate: placement?.endDate ?? learner.endDate,
    };
  });

  return { programmes, cohorts, groups, modules, lectures, learners };
}

export function useBulkAttendanceData(): BulkAttendanceData {
  const [overview, setOverview] = useState<CurriculumOverview | null>(null);
  const [curriculumGroups, setCurriculumGroups] = useState<CurriculumGroup[]>([]);
  const [rosters, setRosters] = useState<Map<string, CurriculumProgrammeAssignedLearner[]>>(new Map());
  const [directory, setDirectory] = useState<BulkAttendanceDirectoryLearner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.allSettled([
      fetchCurriculumOverview(controller.signal),
      fetchCurriculumGroups(controller.signal),
      fetchBulkAttendanceLearners(controller.signal),
    ])
      .then(async ([overviewResult, groupsResult, directoryResult]) => {
        if (overviewResult.status === "rejected") {
          throw overviewResult.reason;
        }
        const nextOverview = overviewResult.value;
        const nextGroups = groupsResult.status === "fulfilled"
          ? groupsResult.value
          : nextOverview.groups;
        const nextDirectory = directoryResult.status === "fulfilled"
          ? directoryResult.value
          : [];
        const results = await Promise.allSettled(
          nextOverview.programmes.map(async (programme) => {
            const roster = await fetchCurriculumScopeLearnerRoster(
              "programme",
              String(programme.id),
              { learnerStatus: "all" },
              controller.signal,
            );
            return [String(programme.id), roster.assignedLearners] as const;
          }),
        );
        if (controller.signal.aborted) return;
        const entries = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        setOverview(nextOverview);
        setCurriculumGroups(nextGroups);
        setRosters(new Map(entries));
        setDirectory(nextDirectory);
        const loadErrors: string[] = [];
        if (groupsResult.status === "rejected") {
          loadErrors.push("The latest group filter could not be loaded; showing the curriculum groups instead.");
        }
        if (directoryResult.status === "rejected") {
          loadErrors.push(directoryResult.reason instanceof Error
            ? directoryResult.reason.message
            : "Unable to load the learner directory.");
        }
        if (results.some((result) => result.status === "rejected")) {
          loadErrors.push("Some learner rosters could not be loaded. Try again to refresh them.");
        }
        setError(loadErrors.length > 0 ? loadErrors.join(" ") : null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Unable to load curriculum data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return useMemo(() => {
    if (!overview) return { ...EMPTY_DATA, loading, error };
    return { ...toBulkData(overview, curriculumGroups, rosters, directory), loading, error };
  }, [overview, curriculumGroups, rosters, directory, loading, error]);
}
