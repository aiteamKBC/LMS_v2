import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBulkAttendanceLearners, type BulkAttendanceDirectoryLearner } from "@/api/bulkAttendanceLearners";
import {
  fetchCurriculumOverview,
  fetchCurriculumSessions,
  fetchCurriculumScopeLearnerRoster,
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

function normalizeLabel(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function overviewFailureHint(reason: unknown): string {
  if (reason instanceof Error && reason.message.toLowerCase().includes("timed out")) {
    return " The curriculum API timed out; check its server database/network connection and retry.";
  }
  if (typeof reason === "object" && reason !== null && "status" in reason) {
    const status = reason.status;
    if (typeof status === "number") {
      return ` The curriculum API returned HTTP ${status}; check the server response and retry.`;
    }
  }
  return " Check the curriculum API/database connection and retry.";
}

function toBulkData(
  overview: CurriculumOverview | null,
  sessions: CurriculumOverview["sessions"],
  rosters: Map<string, CurriculumProgrammeAssignedLearner[]>,
  directory: BulkAttendanceDirectoryLearner[],
) {
  const programmes: Programme[] = (overview?.programmes ?? []).map((programme) => ({
    id: String(programme.id),
    name: programme.name,
    code: programme.sourceId || String(programme.id),
  }));

  const programmeByName = new Map(
    programmes.map((programme) => [normalizeLabel(programme.name), programme.id]),
  );
  const programmeById = new Map(programmes.map((programme) => [programme.id, programme]));

  const resolveProgrammeId = (rawId: unknown, name: unknown): string => {
    const candidate = String(rawId ?? "");
    return (candidate && programmeById.has(candidate))
      ? candidate
      : programmeByName.get(normalizeLabel(name)) || candidate;
  };

  const cohorts: Cohort[] = (overview?.cohorts ?? []).map((cohort) => ({
    id: String(cohort.id),
    name: cohort.name,
    programmeId: resolveProgrammeId(cohort.programmeId, cohort.programme),
    startDate: asDate(cohort.startDate),
    endDate: asDate(cohort.endDate),
  }));

  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
  const cohortByName = new Map(
    cohorts.map((cohort) => [`${cohort.programmeId}:${normalizeLabel(cohort.name)}`, cohort]),
  );

  const resolveCohortId = (rawId: unknown, programmeId: string, name: unknown): string => {
    const candidate = String(rawId ?? "");
    const byId = candidate ? cohortById.get(candidate) : undefined;
    if (byId && (!programmeId || byId.programmeId === programmeId)) return candidate;
    return cohortByName.get(`${programmeId}:${normalizeLabel(name)}`)?.id || candidate;
  };

  const groups: Group[] = (overview?.groups ?? []).map((group) => {
    const programmeFromCohort = cohortById.get(String(group.cohortId || ""))?.programmeId;
    const programmeId = resolveProgrammeId(group.programmeId || programmeFromCohort, group.programme);
    const cohortId = resolveCohortId(group.cohortId, programmeId, group.cohort);
    return {
      id: String(group.id),
      name: group.name,
      cohortId,
      programmeId,
      moduleIds: (group.moduleIds ?? []).map(String),
    };
  });

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupByName = new Map(
    groups.map((group) => [`${group.cohortId}:${normalizeLabel(group.name)}`, group]),
  );

  const resolveGroupId = (rawId: unknown, cohortId: string, name: unknown): string => {
    const candidate = String(rawId ?? "");
    const byId = candidate ? groupById.get(candidate) : undefined;
    if (byId && (!cohortId || byId.cohortId === cohortId)) return candidate;
    return groupByName.get(`${cohortId}:${normalizeLabel(name)}`)?.id || candidate;
  };

  const moduleIdsByAlias = new Map<string, string | null>();
  const moduleRows = overview?.modules ?? [];
  moduleRows.forEach((module) => {
    const id = String(module.id);
    [
      module.id,
      module.moduleId,
      module.moduleCatalogueId,
      module.deliveryModuleId,
      module.deliveryRowId,
      module.legacyModuleId,
      module.invalidModuleCatalogueId,
      module.catalogueId,
    ]
      .filter(Boolean)
      .forEach((alias) => {
        const key = String(alias);
        if (!moduleIdsByAlias.has(key)) moduleIdsByAlias.set(key, id);
        else if (moduleIdsByAlias.get(key) !== id) moduleIdsByAlias.set(key, null);
      });
  });

  const modules: Module[] = moduleRows.map((module) => {
    const programmeId = resolveProgrammeId(module.programmeId, module.programme);
    const cohortId = resolveCohortId(module.cohortId, programmeId, module.cohort);
    return {
      id: String(module.id),
      rosterId: String(module.moduleCatalogueId || module.id),
      name: module.name,
      programmeId,
      programmeName: module.programme,
      cohortId: cohortId || undefined,
      cohortName: module.cohort,
      groupId: resolveGroupId(module.groupId, cohortId, module.group) || undefined,
      groupName: module.group,
    };
  });

  // Some curriculum rows carry the module membership on the Group instead of
  // repeating groupId on every module. Resolve those memberships once so the
  // cascading filters still work for both payload shapes.
  groups.forEach((group) => {
    group.moduleIds?.forEach((alias) => {
      const moduleId = moduleIdsByAlias.get(alias);
      const module = moduleId ? modules.find((item) => item.id === moduleId) : undefined;
      if (module && !module.groupId) module.groupId = group.id;
    });
  });

  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const lectures: Lecture[] = sessions.map((session) => {
    const numberedSession = /-session-(\d+)$/.exec(String(session.id));
    const aliases = [
      session.moduleCatalogueId,
      session.moduleId,
      session.deliveryModuleId,
      session.deliveryRowId,
      session.legacyModuleId,
      session.invalidModuleCatalogueId,
    ].filter(Boolean).map(String);
    const mappedModuleId = aliases
      .map((alias) => moduleIdsByAlias.get(alias))
      .find((id): id is string => Boolean(id));
    const mappedModule = moduleById.get(mappedModuleId ?? "");
    const curriculumModuleName = mappedModule?.name || "";
    const programmeId = mappedModule?.programmeId || resolveProgrammeId(session.programmeId, session.programme);
    const cohortId = mappedModule?.cohortId || resolveCohortId(session.cohortId, programmeId, session.cohort);
    const groupId = mappedModule?.groupId || resolveGroupId(session.groupId, cohortId, session.group);
    return {
      id: String(session.id),
      name: session.title,
      sessionNumber: numberedSession ? Number(numberedSession[1]) : session.week,
      moduleId: mappedModuleId ?? aliases[0] ?? "",
      moduleCatalogueId: mappedModule?.rosterId || (session.moduleCatalogueId ? String(session.moduleCatalogueId) : undefined),
      moduleName: session.module || curriculumModuleName,
      moduleAliases: [session.module, curriculumModuleName].filter(Boolean),
      programmeId,
      cohortId,
      groupId,
      sessionDate: asDate(session.date),
    };
  });

  const placements: Learner[] = [];

  rosters.forEach((assignedLearners, programmeId) => {
    assignedLearners.forEach((assigned) => {
      const cohort = assigned.cohortId
        ? cohortById.get(String(assigned.cohortId))
        : cohortByName.get(`${programmeId}:${assigned.cohort}`);
      const group = assigned.groupId
        ? groupById.get(String(assigned.groupId))
        : groupByName.get(`${cohort?.id ?? ""}:${assigned.group}`);
      const id = String(assigned.id);
      placements.push({
        id,
        name: assigned.name || assigned.email,
        email: assigned.email,
        programmeId,
        cohortId: cohort?.id ?? String(assigned.cohortId ?? ""),
        groupId: group?.id ?? String(assigned.groupId ?? ""),
        endDate: asDate(overview?.cohorts.find((item) => String(item.id) === cohort?.id)?.endDate),
      });
    });
  });

  const normalize = (value: string) => value.trim().toLowerCase();
  const placementsByEmail = new Map<string, Learner[]>();
  placements.forEach((placement) => {
    const email = normalize(placement.email);
    if (email) placementsByEmail.set(email, [...(placementsByEmail.get(email) ?? []), placement]);
  });
  const learners: Learner[] = directory.map((learner) => {
    // Only an unambiguous email match may supply curriculum placement. KBC
    // IDs and curriculum learner IDs belong to different databases.
    // The LMS email covers learners whose KBC directory email differs.
    const matches = [learner.email, learner.lmsEmail ?? ""]
      .map(normalize)
      .filter(Boolean)
      .flatMap((email) => placementsByEmail.get(email) ?? []);
    const memberships = [...new Map(matches.map((item) => [
      `${item.programmeId}:${item.cohortId}:${item.groupId}`,
      item,
    ])).values()];
    const placement = memberships.length === 1 ? memberships[0] : undefined;
    const matchingProgrammes = programmes.filter((item) => normalize(item.name) === normalize(learner.programme));
    const programmeId = placement?.programmeId ?? (matchingProgrammes.length === 1 ? matchingProgrammes[0].id : "");
    const matchingGroups = groups.filter((item) =>
      programmeId && cohortById.get(item.cohortId)?.programmeId === programmeId
      && normalize(item.name) === normalize(learner.group),
    );
    const group = matchingGroups.length === 1 ? matchingGroups[0] : undefined;
    const cohortId = placement?.cohortId || group?.cohortId || "";
    return {
      // Keep the KBC key stable; the separate curriculumId retains matches
      // for archive entries saved before the KBC directory became the source.
      id: `kbc:${learner.id}`,
      kbcId: String(learner.id),
      curriculumId: placement?.id,
      name: learner.name || learner.email,
      email: learner.email,
      lmsEmail: learner.lmsEmail,
      programme: learner.programme,
      group: learner.group,
      programmeId,
      cohortId,
      groupId: placement?.groupId || group?.id || "",
      endDate: placement?.endDate || cohortById.get(cohortId)?.endDate || learner.endDate,
      status: learner.status || learner.kbcStatus || "",
        attendanceMode: learner.attendanceMode === "lazy" ? "lazy" : "live",
    };
  });

  return { programmes, cohorts, groups, modules, lectures, learners };
}

export function useBulkAttendanceData(archiveIds: string[] = []): BulkAttendanceData & { retry: () => void } {
  const [overview, setOverview] = useState<CurriculumOverview | null>(null);
  const [sessions, setSessions] = useState<CurriculumOverview["sessions"]>([]);
  const [rosters, setRosters] = useState<Map<string, CurriculumProgrammeAssignedLearner[]>>(new Map());
  const [directory, setDirectory] = useState<BulkAttendanceDirectoryLearner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const archiveIdsKey = useMemo(() => [...new Set(archiveIds.filter(Boolean))].join(","), [archiveIds]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.allSettled([
      // The register only needs the entity lists here. The full overview also
      // builds authoring details, components and generated sessions; fetch
      // lectures separately below so a cold/large overview cannot blank every
      // filter while the independent learner read succeeds.
      // The compact payload is the fast path for these filters. If it fails,
      // retry once with the full overview so a projection-specific failure does
      // not leave the programme and cohort selectors empty.
      // Filter choices must include archived/planned curriculum rows as well as
      // active rows. Attendance itself is still scoped by the selected date
      // and the live-session register; visibility here only controls the
      // entities available in the cascading selectors.
      fetchCurriculumOverview(controller.signal, { compact: true, visibility: "all" }).catch(() =>
        fetchCurriculumOverview(controller.signal, { visibility: "all" }),
      ),
      fetchBulkAttendanceLearners(controller.signal),
      fetchCurriculumSessions(controller.signal, { visibility: "all" }),
    ])
      .then(async ([overviewResult, directoryResult, sessionsResult]) => {
        const nextOverview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
        const nextDirectory = directoryResult.status === "fulfilled"
          ? directoryResult.value.learners
          : [];
        if (controller.signal.aborted) return;
        setOverview(nextOverview);
        setSessions(sessionsResult.status === "fulfilled" && sessionsResult.value.length > 0
          ? sessionsResult.value
          : nextOverview?.sessions ?? []);
        setRosters(new Map());
        setDirectory(nextDirectory);
        const directoryFailed = directoryResult.status === "rejected";
        const loadErrors: string[] = [];
        if (overviewResult.status === "rejected") {
          loadErrors.push(
            `Programme and cohort filters could not be loaded.${overviewFailureHint(overviewResult.reason)}`,
          );
        }
        if (sessionsResult.status === "rejected" && !nextOverview?.sessions?.length) {
          loadErrors.push("The lecture list could not be loaded. Try again to refresh it.");
        }
        if (directoryFailed) {
          loadErrors.unshift(directoryResult.reason instanceof Error
            ? directoryResult.reason.message
            : "Unable to load the learner directory.");
        } else {
          loadErrors.push(...directoryResult.value.warnings);
        }
        setError(loadErrors.length > 0 ? loadErrors.join(" ") : null);
        // With a healthy KBC directory, render as soon as the filter requests
        // finish; the page loads scope rosters only after a filter is selected.
        // Resolve legacy archive IDs with targeted programme roster reads.
        setLoading(false);
        if (directoryFailed) return;
        const requestedArchiveIds = new Set(archiveIdsKey.split(",").filter(Boolean));
        const directoryIds = new Set(nextDirectory.flatMap((learner) => [
          String(learner.id),
          `kbc:${learner.id}`,
        ]));
        const unresolvedArchiveIds = new Set(
          [...requestedArchiveIds].filter((id) => !directoryIds.has(id)),
        );
        if (!unresolvedArchiveIds.size) return;

        const nextRosters = new Map<string, CurriculumProgrammeAssignedLearner[]>();
        let rosterFailed = false;
        for (const programme of nextOverview?.programmes ?? []) {
          try {
            const roster = await fetchCurriculumScopeLearnerRoster(
              "programme",
              String(programme.id),
              { learnerStatus: "all" },
              controller.signal,
            );
            if (controller.signal.aborted) return;
            nextRosters.set(String(programme.id), roster.assignedLearners);
            setRosters(new Map(nextRosters));
            roster.assignedLearners.forEach((learner) => unresolvedArchiveIds.delete(String(learner.id)));
            if (!unresolvedArchiveIds.size) break;
          } catch {
            if (controller.signal.aborted) return;
            rosterFailed = true;
          }
        }
        if (!controller.signal.aborted && (rosterFailed || unresolvedArchiveIds.size > 0)) {
          setError((previous) => [
            previous,
            "Some older archived learner IDs could not be matched to the KBC directory. Their archive status may need a selected curriculum filter to refresh.",
          ].filter(Boolean).join(" "));
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Unable to load curriculum data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [archiveIdsKey, retryVersion]);

  const retry = useCallback(() => setRetryVersion((version) => version + 1), []);

  return useMemo(() => {
    if (!overview && !directory.length && !sessions.length) return { ...EMPTY_DATA, loading, error, retry };
    return { ...toBulkData(overview, sessions, rosters, directory), loading, error, retry };
  }, [overview, sessions, rosters, directory, loading, error, retry]);
}
