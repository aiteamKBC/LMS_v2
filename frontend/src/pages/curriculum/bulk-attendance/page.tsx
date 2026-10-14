import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceShell } from "@/components/feature/WorkspaceShell";
import { curriculumNavItems } from "@/mocks/navigation";
import type { AttendanceStatus, Learner, Lecture } from "@/types/bulkAttendance";
import { useAttendance } from "@/hooks/useBulkAttendance";
import { useBulkAttendanceData } from "@/hooks/useBulkAttendanceData";
import {
  fetchCurriculumScopeLearnerRoster,
  type CurriculumLearnerScope,
  type CurriculumProgrammeAssignedLearner,
} from "@/lib/curriculumApi";

const ROSTER_TIMEOUT_MS = 180_000;
import {
  fetchBulkAttendanceKbcHistory,
  fetchBulkAttendanceKbcRecent,
  BulkAttendanceSaveError,
  saveBulkAttendanceChanges,
  type BulkAttendanceChange,
  type BulkAttendanceKbcHistoryRecord,
} from "@/api/bulkAttendanceLearners";
import {
  formatDateLabel,
  formatShortDate,
  getWeekDays,
  todayIso,
} from "@/utils/bulkAttendance";
import { downloadCsv, slugify } from "@/utils/bulkCsv";
import StatCards from "./components/StatCards";
import FilterCard, { type FilterOption } from "./components/FilterCard";
import RegisterTabs, { type RegisterTab } from "./components/RegisterTabs";
import SearchBar from "./components/SearchBar";
import AttendanceTable, {
  type AttendanceRow,
  type EditableRecord,
  type LectureInfo,
} from "./components/AttendanceTable";
import WeeklyGrid from "./components/WeeklyGrid";
import SummaryReport from "./components/SummaryReport";
import LearnerHistoryModal, {
  type LearnerHistoryRecord,
} from "./components/LearnerHistoryModal";
import LearnerDirectoryModal from "./components/LearnerDirectoryModal";
import ArchiveView from "./components/ArchiveView";
import { isArchivedStatus } from "./learnerStatus";

function statusLabel(status: AttendanceStatus): string {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  return "Unmarked";
}

export default function AttendancePage() {
  const {
    programmes,
    cohorts,
    groups,
    learners,
    lectures,
    modules,
    loading: dataLoading,
    error: dataError,
    retry: retryData,
  } = useBulkAttendanceData();
  const [programmeId, setProgrammeId] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [lectureId, setLectureId] = useState("");
  const [scopeLearnerEmails, setScopeLearnerEmails] = useState<Set<string> | null>(null);
  const [scopeLearnersByEmail, setScopeLearnersByEmail] = useState<Map<string, CurriculumProgrammeAssignedLearner>>(new Map());
  const [scopeRosterLoading, setScopeRosterLoading] = useState(false);
  const [scopeRosterError, setScopeRosterError] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<RegisterTab>("daily");
  const [historyRow, setHistoryRow] = useState<AttendanceRow | null>(null);
  const [detailKbcHistory, setDetailKbcHistory] = useState<BulkAttendanceKbcHistoryRecord[]>([]);
  const [detailHistoryLoading, setDetailHistoryLoading] = useState(false);
  const [detailHistoryError, setDetailHistoryError] = useState<string | null>(null);
  const [kbcRecent, setKbcRecent] = useState<Record<string, BulkAttendanceKbcHistoryRecord[]>>({});
  const [kbcRecentError, setKbcRecentError] = useState<string | null>(null);
  const [kbcRecentWarnings, setKbcRecentWarnings] = useState<string[]>([]);
  const [detailHistoryWarnings, setDetailHistoryWarnings] = useState<string[]>([]);
  const [detailHistoryVersion, setDetailHistoryVersion] = useState(0);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailSaveError, setDetailSaveError] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, BulkAttendanceChange>>({});
  const [kbcRecentVersion, setKbcRecentVersion] = useState(0);
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [view, setView] = useState<"register" | "archive">("register");
  const [showLearnerDirectory, setShowLearnerDirectory] = useState(false);

  const selectedLecture = useMemo(
    () => lectures.find((lecture) => lecture.id === lectureId) ?? null,
    [lectureId, lectures]
  );

  // Which roster the current filters need, reduced to plain strings so the
  // request only re-runs when the selection itself changes.
  const scopedModuleId = moduleId || selectedLecture?.moduleId || "";
  const rosterScope: CurriculumLearnerScope | null = scopedModuleId
    ? "module" : groupId ? "group" : cohortId ? "cohort" : programmeId ? "programme" : null;
  const rosterIdentifier = scopedModuleId
    ? modules.find((module) => module.id === scopedModuleId)?.rosterId || scopedModuleId
    : groupId || cohortId || programmeId;
  // Rosters already loaded on this page; going back to a filter is instant.
  const rosterCache = useRef(new Map<string, CurriculumProgrammeAssignedLearner[]>());
  const [rosterRetry, setRosterRetry] = useState(0);

  useEffect(() => {
    if (!rosterScope) {
      setScopeLearnerEmails((previous) => previous === null ? previous : null);
      setScopeLearnersByEmail((previous) => previous.size === 0 ? previous : new Map());
      setScopeRosterLoading(false);
      setScopeRosterError(null);
      return;
    }

    const apply = (assigned: CurriculumProgrammeAssignedLearner[]) => {
      const rowsByEmail = new Map<string, CurriculumProgrammeAssignedLearner[]>();
      assigned.forEach((learner) => {
        const email = learner.email.trim().toLowerCase();
        if (!email) return;
        // A module roster spans every group; keep only the chosen one.
        if (rosterScope === "module" && groupId && String(learner.groupId ?? "") !== groupId) return;
        rowsByEmail.set(email, [...(rowsByEmail.get(email) ?? []), learner]);
      });
      setScopeLearnerEmails(new Set(rowsByEmail.keys()));
      setScopeLearnersByEmail(new Map(
        [...rowsByEmail.entries()]
          .filter(([, assignments]) => assignments.length === 1)
          .map(([email, assignments]) => [email, assignments[0]]),
      ));
      setScopeRosterError(null);
    };

    const cacheKey = `${rosterScope}:${rosterIdentifier}`;
    const cached = rosterCache.current.get(cacheKey);
    if (cached) {
      apply(cached);
      setScopeRosterLoading(false);
      return;
    }

    const controller = new AbortController();
    setScopeLearnerEmails(null);
    setScopeLearnersByEmail(new Map());
    setScopeRosterLoading(true);
    setScopeRosterError(null);
    void fetchCurriculumScopeLearnerRoster(
      rosterScope,
      rosterIdentifier,
      { learnerStatus: "all" },
      controller.signal,
      // Programme and module rosters are built from the whole curriculum and
      // can take well over the default minute.
      { timeoutMs: ROSTER_TIMEOUT_MS },
    )
      .then((roster) => {
        rosterCache.current.set(cacheKey, roster.assignedLearners);
        if (!controller.signal.aborted) apply(roster.assignedLearners);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setScopeRosterError(reason instanceof Error
          ? reason.message
          : "Unable to load learners for this selection.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setScopeRosterLoading(false);
      });

    return () => controller.abort();
  }, [rosterScope, rosterIdentifier, groupId, rosterRetry]);

  // Only the programme status archives a learner: Completed, EnteredEpa or Withdrawn.
  const isArchived = useCallback(
    (learner: Learner) => isArchivedStatus(learner.status),
    []
  );

  const cohortOptions = useMemo<FilterOption[]>(() => {
    const list = programmeId
      ? cohorts.filter((cohort) => cohort.programmeId === programmeId)
      : cohorts;
    return [
      { value: "", label: "All Cohorts" },
      ...list.map((cohort) => ({ value: cohort.id, label: cohort.name })),
    ];
  }, [programmeId, cohorts]);

  const groupOptions = useMemo<FilterOption[]>(() => {
    const cohortIds = cohortId
      ? new Set([cohortId])
      : programmeId
      ? new Set(cohorts.filter((cohort) => cohort.programmeId === programmeId).map((cohort) => cohort.id))
      : null;
    const list = cohortIds ? groups.filter((group) => cohortIds.has(group.cohortId)) : groups;
    return [
      { value: "", label: "All Groups" },
      ...list.map((group) => ({ value: group.id, label: group.name })),
    ];
  }, [programmeId, cohortId, groups, cohorts]);

  const moduleOptions = useMemo<FilterOption[]>(() => {
    const list = modules.filter((module) => {
      if (programmeId && module.programmeId !== programmeId) return false;
      if (cohortId && module.cohortId && module.cohortId !== cohortId) return false;
      if (groupId && module.groupId && module.groupId !== groupId) return false;
      return true;
    });
    return [
      { value: "", label: "All Modules" },
      ...list.map((module) => ({ value: module.id, label: module.name })),
    ];
  }, [programmeId, cohortId, groupId, modules]);

  const lectureOptions = useMemo<FilterOption[]>(() => {
    const allowedModuleIds = new Set(moduleOptions.slice(1).map((option) => option.value));
    const list = lectures.filter((lecture) =>
      allowedModuleIds.has(lecture.moduleId)
      && (!moduleId || lecture.moduleId === moduleId),
    );
    return [
      { value: "", label: "All Lectures" },
      ...list.map((lecture) => ({
        value: lecture.id,
        label: `${lecture.name} — ${formatShortDate(lecture.sessionDate)}`,
      })),
    ];
  }, [moduleId, moduleOptions, lectures]);

  // Structured filters (Programme / Cohort / Module) applied on their own, so
  // the archive view can reuse them without the register search leaking in.
  const scopedLearners = useMemo(
    () =>
      learners.map((learner) => {
        const placement = scopeLearnersByEmail.get(learner.email.trim().toLowerCase());
        return placement ? { ...learner, curriculumId: String(placement.id) } : learner;
      }).filter((learner) => {
        const hasScopeFilter = Boolean(programmeId || cohortId || groupId || moduleId || selectedLecture);
        if (hasScopeFilter) {
          if (!scopeLearnerEmails) return false;
          return scopeLearnerEmails.has(learner.email.trim().toLowerCase());
        }
        return true;
      }),
    [programmeId, cohortId, groupId, moduleId, selectedLecture, scopeLearnerEmails, scopeLearnersByEmail, learners]
  );

  const filteredLearners = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return scopedLearners;
    return scopedLearners.filter(
      (learner) =>
        learner.name.toLowerCase().includes(term) ||
        learner.email.toLowerCase().includes(term)
    );
  }, [scopedLearners, query]);

  const activeLearners = useMemo(
    () => filteredLearners.filter((learner) => !isArchived(learner)),
    [filteredLearners, isArchived]
  );

  const moduleKey = selectedLecture
    ? `${selectedLecture.moduleId}:${selectedLecture.id}`
    : moduleId || "general";
  const {
    loading: attendanceLoading,
    sourceError: attendanceSourceError,
    statuses,
    getStatus,
    setStatusForDate,
    markSelected,
    clearMarks,
    presentCount,
    absentCount,
    unmarkedCount,
    dirty,
    pendingCount,
    save,
    undo,
  } = useAttendance({
    learners: activeLearners,
    moduleKey,
    date: selectedLecture?.sessionDate || date,
  });  const loading = dataLoading || attendanceLoading || scopeRosterLoading;

  const handleGridToggle = (learnerId: string, day: string) => {
    const current = getStatus(learnerId, day);
    setStatusForDate(learnerId, day, current === "present" ? "absent" : "present");
  };

  const handleToggleSelect = (learnerId: string) => {
    setSelectedIds((prev) =>
      prev.includes(learnerId)
        ? prev.filter((id) => id !== learnerId)
        : [...prev, learnerId]
    );
  };

  const handleMarkSelected = (status: AttendanceStatus) => {
    if (selectedIds.length === 0) return;
    markSelected(selectedIds, status);
  };

  const handleClearMarks = () => {
    if (selectedIds.length === 0) return;
    clearMarks(selectedIds);
    setShowActions(false);
  };

  const cohortNameMap = useMemo(
    () => Object.fromEntries(cohorts.map((cohort) => [cohort.id, cohort.name])),
    [cohorts]
  );
  const groupNameMap = useMemo(
    () => Object.fromEntries(groups.map((group) => [group.id, group.name])),
    [groups]
  );
  const moduleNameMap = useMemo(
    () => Object.fromEntries(modules.map((module) => [module.id, module.name])),
    [modules]
  );
  const programmeNameMap = useMemo(
    () => Object.fromEntries(programmes.map((programme) => [programme.id, programme.name])),
    [programmes]
  );

  const buildRows = useCallback(
    (list: typeof learners): AttendanceRow[] =>
      list.map((learner, index) => {
        const email = learner.email.trim().toLowerCase();
        const placement = scopeLearnersByEmail.get(email);
        const placementIsAmbiguous = Boolean(scopeLearnerEmails?.has(email) && !placement);
        const cohortName = placementIsAmbiguous
          ? "—"
          : placement
          ? (placement.cohortId ? cohortNameMap[String(placement.cohortId)] : "") || placement.cohort || "—"
          : cohortNameMap[learner.cohortId] ?? "—";
        return {
          learner,
          index,
          cohortName,
        };
      }),
    [cohortNameMap, scopeLearnersByEmail, scopeLearnerEmails]
  );

  const rows = useMemo(() => buildRows(activeLearners), [activeLearners, buildRows]);
  const visibleRows = useMemo(
    () => statusFilter
      ? rows.filter((row) => (statuses[row.learner.id] ?? "unmarked") === statusFilter)
      : rows,
    [rows, statusFilter, statuses]
  );
  const visibleLearners = useMemo(() => visibleRows.map((row) => row.learner), [visibleRows]);

  const handleToggleSelectAll = () => {
    setSelectedIds((previous) => {
      const visibleIds = visibleRows.map((row) => row.learner.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => previous.includes(id));
      if (allSelected) return previous.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...previous, ...visibleIds]));
    });
  };

  const handleStatusCardClick = (nextStatus: AttendanceStatus) => {
    setStatusFilter((previous) => previous === nextStatus ? null : nextStatus);
    setSelectedIds([]);
  };


  const archivedRows = useMemo(
    () => buildRows(scopedLearners.filter((learner) => isArchived(learner))),
    [scopedLearners, isArchived, buildRows]
  );

  const archivedTotal = useMemo(
    () => learners.filter((learner) => isArchived(learner)).length,
    [learners, isArchived]
  );

  const activeModuleLabel = moduleId
    ? moduleNameMap[moduleId] ?? "All Modules"
    : "General attendance";

  const activeLectureLabel = selectedLecture
    ? `${selectedLecture.name} (${formatShortDate(selectedLecture.sessionDate)})`
    : "All Lectures";

  const moduleIdsByProgramme = useMemo(() => {
    const map = new Map<string, string[]>();
    modules.forEach((module) => {
      const list = map.get(module.programmeId) ?? [];
      list.push(module.id);
      map.set(module.programmeId, list);
    });
    return map;
  }, [modules]);

  const lecturesByModule = useMemo(() => {
    const map = new Map<string, Lecture[]>();
    lectures.forEach((lecture) => {
      const list = map.get(lecture.moduleId) ?? [];
      list.push(lecture);
      map.set(lecture.moduleId, list);
    });
    return map;
  }, [lectures]);

  const learnerLectureList = useCallback(
    (learner: Learner): Lecture[] => {
      const moduleIds = moduleIdsByProgramme.get(learner.programmeId) ?? [];
      return moduleIds
        .flatMap((moduleId) => lecturesByModule.get(moduleId) ?? [])
        .slice()
        .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
    },
    [moduleIdsByProgramme, lecturesByModule]
  );

  useEffect(() => {
    const controller = new AbortController();
    setKbcRecentError(null);
    void fetchBulkAttendanceKbcRecent(controller.signal)
      .then(({ recent, warnings }) => {
        if (controller.signal.aborted) return;
        setKbcRecent(recent);
        setKbcRecentWarnings(warnings);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setKbcRecentError(reason instanceof Error
          ? reason.message
          : "Unable to load recent KBC attendance.");
      });
    return () => controller.abort();
  }, [kbcRecentVersion]);

  const lectureInfo = useMemo(() => {
    const map: Record<string, LectureInfo> = {};
    activeLearners.forEach((learner) => {
      const list = learnerLectureList(learner);
      const completedOrCurrent = list.filter((lecture) => lecture.sessionDate <= date);
      const recentLectures = completedOrCurrent.length > 0 ? completedOrCurrent : list;
      // Saved KBC attendance is the record of what happened; marks made on
      // this page are unsaved, so they only fill in for learners KBC lacks.
      const kbcLectures = learner.kbcId ? kbcRecent[learner.kbcId] ?? [] : [];
      if (kbcLectures.length > 0) {
        const current = selectedLecture ?? recentLectures[recentLectures.length - 1];
        const latest = kbcLectures[kbcLectures.length - 1];
        map[learner.id] = {
          name: current?.name ?? "—",
          // The module of the learner's latest saved attendance record.
          moduleName: latest.moduleName
            || current?.moduleName || (current ? moduleNameMap[current.moduleId] : "") || "",
          date: current?.sessionDate ?? null,
          recent: kbcLectures.slice(-4).map((record) => {
            const saved: AttendanceStatus = record.attendance ?? "unmarked";
            return {
              id: `${record.source}:${record.recordKey}`,
              name: `${record.lectureName || record.moduleName || "Lecture title not recorded"} (${record.source === "live" ? "Live register" : "KBC"})`,
              sessionDate: record.sessionDate,
              status: pendingEdits[`${record.source}:${record.recordKey}`]?.attendance ?? saved,
              editable: { source: record.source, recordKey: record.recordKey, attendance: saved },
            };
          }),
        };
        return;
      }
      const recent = recentLectures.slice(-4).map((lecture) => ({
        id: lecture.id,
        name: lecture.name,
        sessionDate: lecture.sessionDate,
        status: getStatus(learner.id, lecture.sessionDate),
      }));
      const current = selectedLecture ?? recentLectures[recentLectures.length - 1];
      if (selectedLecture && !recent.some((lecture) => lecture.id === selectedLecture.id)) {
        recent.push({
          id: selectedLecture.id,
          name: selectedLecture.name,
          sessionDate: selectedLecture.sessionDate,
          status: getStatus(learner.id, selectedLecture.sessionDate),
        });
      }
      map[learner.id] = {
        name: current?.name ?? "—",
        moduleName: current?.moduleName || (current ? moduleNameMap[current.moduleId] : "") || "",
        date: current?.sessionDate ?? null,
        recent: recent.slice(-4),
      };
    });
    return map;
  }, [activeLearners, learnerLectureList, selectedLecture, date, getStatus, moduleNameMap, kbcRecent, pendingEdits]);

  const weekDays = useMemo(() => getWeekDays(date), [date]);

  const weekLabel = useMemo(() => {
    const fmt = (value: Date) =>
      value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const start = new Date(`${weekDays[0].iso}T00:00:00`);
    const end = new Date(`${weekDays[6].iso}T00:00:00`);
    return `${fmt(start)} – ${fmt(end)}`;
  }, [weekDays]);

  const handleExport = () => {
    const header = [
      "Learner",
      "Email",
      "Programme",
      "Cohort",
      "Module",
      "Lecture",
      "Date",
      "Status",
    ];
    const body = visibleLearners.map((learner) => [
      learner.name,
      learner.email,
      programmeNameMap[learner.programmeId] ?? "",
      cohortNameMap[learner.cohortId] ?? "",
      activeModuleLabel,
      activeLectureLabel,
      date,
      statusLabel(statuses[learner.id] ?? "present"),
    ]);

    const scopeName = groupId
      ? groupNameMap[groupId]
      : cohortId
      ? cohortNameMap[cohortId]
      : programmeId
      ? programmeNameMap[programmeId]
      : "all-learners";

    downloadCsv(
      `attendance_${slugify(scopeName ?? "all-learners")}_${date}.csv`,
      [header, ...body]
    );
  };

  const exportScope = useMemo(() => {
    const scopeName = groupId
      ? groupNameMap[groupId]
      : cohortId
      ? cohortNameMap[cohortId]
      : programmeId
      ? programmeNameMap[programmeId]
      : "all-learners";
    return slugify(scopeName ?? "all-learners");
  }, [
    groupId,
    cohortId,
    programmeId,
    groupNameMap,
    cohortNameMap,
    programmeNameMap,
  ]);

  useEffect(() => {
    if (!historyRow) {
      setDetailKbcHistory([]);
      setDetailHistoryLoading(false);
      setDetailHistoryError(null);
      return undefined;
    }

    const learnerId = historyRow.learner.kbcId;
    if (!learnerId) {
      setDetailKbcHistory([]);
      setDetailHistoryLoading(false);
      setDetailHistoryError("This learner has no KBC identifier.");
      return undefined;
    }

    const controller = new AbortController();
    setDetailKbcHistory([]);
    setDetailHistoryWarnings([]);
    setDetailHistoryLoading(true);
    setDetailHistoryError(null);
    void fetchBulkAttendanceKbcHistory(learnerId, controller.signal)
      .then(({ records, warnings }) => {
        if (controller.signal.aborted) return;
        setDetailKbcHistory(records);
        setDetailHistoryWarnings(warnings);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setDetailHistoryError(reason instanceof Error
          ? reason.message
          : "Unable to load this learner's attendance history.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailHistoryLoading(false);
      });

    return () => controller.abort();
  }, [historyRow?.learner.id, historyRow?.learner.kbcId, detailHistoryVersion]);

  const detailHistory = useMemo<LearnerHistoryRecord[]>(() => detailKbcHistory
    .map((record) => ({
      id: `${record.source}:${record.recordKey}`,
      recordKey: record.recordKey,
      sessionDate: record.sessionDate,
      moduleName: record.moduleName || "Module not recorded",
      lectureName: record.lectureName || record.moduleName || "Lecture title not recorded",
      attendance: record.attendance ?? ("unmarked" as AttendanceStatus),
      source: record.source,
    }))
    .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate)
      || left.moduleName.localeCompare(right.moduleName)
      || left.lectureName.localeCompare(right.lectureName)),
  [detailKbcHistory]);
  // One set of unsaved present/absent corrections, shared by View details and
  // the Last 4 badges. Each change is saved to its own source (KBC or live register).
  const toggleRecord = useCallback((record: EditableRecord) => {
    const key = `${record.source}:${record.recordKey}`;
    setDetailSaveError(null);
    setPendingEdits((current) => {
      const now = current[key]?.attendance ?? record.attendance;
      const next: "present" | "absent" = now === "present" ? "absent" : "present";
      const updated = { ...current };
      if (next === record.attendance) delete updated[key];
      else updated[key] = { source: record.source, recordKey: record.recordKey, attendance: next };
      return updated;
    });
  }, []);

  const pendingStatus = useCallback(
    (source: "kbc" | "live", recordKey: string): AttendanceStatus | undefined =>
      pendingEdits[`${source}:${recordKey}`]?.attendance,
    [pendingEdits],
  );

  const pendingEditCount = Object.keys(pendingEdits).length;

  const saveEdits = async () => {
    const changes = Object.values(pendingEdits);
    if (changes.length === 0) return;
    setDetailSaving(true);
    setDetailSaveError(null);
    try {
      await saveBulkAttendanceChanges(changes);
      setPendingEdits({});
    } catch (reason) {
      const saved = reason instanceof BulkAttendanceSaveError ? new Set(reason.saved) : new Set<string>();
      if (saved.size) {
        setPendingEdits((current) => Object.fromEntries(
          Object.entries(current).filter(([, edit]) => !saved.has(edit.recordKey)),
        ));
      }
      setDetailSaveError(reason instanceof Error ? reason.message : "Attendance could not be saved. Please try again.");
    } finally {
      setDetailSaving(false);
      setDetailHistoryVersion((version) => version + 1);
      setKbcRecentVersion((version) => version + 1);
    }
  };

  const isArchiveView = view === "archive";

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Bulk Attendance" pageSubtitle="Record attendance across learners, cohorts and modules" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="min-h-screen bg-background-100">
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground-950 md:text-2xl">
              {isArchiveView ? "Learner archive" : "Attendance register"}
            </h2>
            <p className="mt-1 text-sm text-foreground-500">
              {isArchiveView ? (
                <>
                  {archivedTotal}{" "}
                  {archivedTotal === 1 ? "learner" : "learners"}
                  <span className="mx-2 text-foreground-300">•</span>
                  Completed, EnteredEpa and Withdrawn
                </>
              ) : (
                <>
                  {formatDateLabel(date)}
                  <span className="mx-2 text-foreground-300">•</span>
                  {activeModuleLabel}
                  {selectedLecture && (
                    <>
                      <span className="mx-2 text-foreground-300">•</span>
                      {selectedLecture.name} —{" "}
                      {formatShortDate(selectedLecture.sessionDate)}
                    </>
                  )}
                </>
              )}
            </p>
            {dataLoading && (
              <p className="mt-2 text-xs text-foreground-500">Loading current curriculum data…</p>
            )}
            {dataError && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-danger-600" role="alert">
                <span>{dataError}</span>
                <button
                  type="button"
                  onClick={retryData}
                  disabled={dataLoading}
                  className="font-medium underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Retry loading data
                </button>
              </div>
            )}
            {attendanceSourceError && (
              <p className="mt-2 text-xs text-danger-600">{attendanceSourceError}</p>
            )}
            {kbcRecentError && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-danger-600" role="alert">
                <span>{kbcRecentError}</span>
                <button
                  type="button"
                  onClick={() => setKbcRecentVersion((version) => version + 1)}
                  className="font-medium underline underline-offset-2"
                >
                  Retry recent attendance
                </button>
              </div>
            )}
            {kbcRecentWarnings.map((warning) => (
              <p key={warning} className="mt-2 text-xs text-warning-700" role="status">{warning}</p>
            ))}
            {!selectedLecture && (
              <p className="mt-2 text-xs text-foreground-500">Open View details to see this learner's saved KBC attendance history.</p>
            )}
            {scopeRosterLoading && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-600" role="status">
                <i className="ri-loader-4-line animate-spin" />
                Loading the learners for this selection. Large programmes and modules can take up to a minute;
                the result is remembered, so choosing it again is instant.
              </p>
            )}
            {scopeRosterError && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-danger-600" role="alert">
                <span>{scopeRosterError}</span>
                <button
                  type="button"
                  onClick={() => setRosterRetry((attempt) => attempt + 1)}
                  className="font-medium underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="flex h-11 items-center gap-2 rounded-md border border-background-300 bg-background-50 px-3">
              <i className="ri-calendar-line text-base text-foreground-500" />
              <span className="font-label text-xs uppercase tracking-wide text-foreground-500">
                Date
              </span>
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setLectureId("");
                }}
                className="cursor-pointer bg-transparent text-sm text-foreground-950 outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => setView(isArchiveView ? "register" : "archive")}
              className="flex h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-3 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600"
            >
              <i
                className={
                  isArchiveView
                    ? "ri-arrow-left-line text-base"
                    : "ri-archive-2-line text-base"
                }
              />
              {isArchiveView ? "Back to register" : `Archived (${archivedTotal})`}
            </button>
          </div>
        </div>

        {/* Compact filter toolbar — shared by the register and the archive. */}
        <section className="mt-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <FilterCard
              variant="compact"
              icon="ri-stack-line"
              label="Programme"
              value={programmeId}
              placeholder="All Programmes"
              options={[
                { value: "", label: "All Programmes" },
                ...programmes.map((programme) => ({
                  value: programme.id,
                  label: programme.name,
                })),
              ]}
              onChange={(value) => {
                setProgrammeId(value);
                setCohortId("");
                setGroupId("");
                setModuleId("");
                setLectureId("");
              }}
            />
            <FilterCard
              variant="compact"
              icon="ri-group-line"
              label="Cohort"
              value={cohortId}
              placeholder="All Cohorts"
              options={cohortOptions}
              onChange={(value) => {
                setCohortId(value);
                setGroupId("");
                setModuleId("");
                setLectureId("");
              }}
            />
            <FilterCard
              variant="compact"
              icon="ri-community-line"
              label="Group"
              value={groupId}
              placeholder="All Groups"
              options={groupOptions}
              onChange={(value) => {
                setGroupId(value);
                setModuleId("");
                setLectureId("");
              }}
            />
            <FilterCard
              variant="compact"
              icon="ri-book-2-line"
              label="Module"
              value={moduleId}
              placeholder="All Modules"
              options={moduleOptions}
              onChange={(value) => {
                setModuleId(value);
                setLectureId("");
              }}
            />
            <FilterCard
              variant="compact"
              icon="ri-presentation-line"
              label="Lecture"
              value={lectureId}
              placeholder="All Lectures"
              options={lectureOptions}
              onChange={(value) => {
                setLectureId(value);
                const lecture = lectures.find((item) => item.id === value);
                if (lecture?.sessionDate) setDate(lecture.sessionDate);
              }}
            />
          </div>
        </section>

        {isArchiveView ? (
          <section className="mt-5">
            <ArchiveView rows={archivedRows} onOpenHistory={setHistoryRow} />
          </section>
        ) : (
          <>
            <div className="mt-5">
              <RegisterTabs active={tab} onChange={setTab} />
            </div>

            {tab === "daily" && (
              <section className="mt-5 space-y-4">
                <StatCards
                  total={activeLearners.length}
                  present={loading ? 0 : presentCount}
                  absent={loading ? 0 : absentCount}
                  unmarked={loading ? 0 : unmarkedCount}
                  selectedStatus={statusFilter}
                  onLearnersClick={() => setShowLearnerDirectory(true)}
                  onStatusClick={handleStatusCardClick}
                />

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <SearchBar
                    value={query}
                    resultCount={visibleRows.length}
                    onChange={setQuery}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-sm text-foreground-500">
                      {loading
                        ? "Loading learners…"
                        : selectedIds.length > 0
                        ? `${selectedIds.length} selected`
                        : `${visibleRows.length} learners`}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleMarkSelected("present")}
                      disabled={loading || selectedIds.length === 0}
                      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-green-300 bg-green-100 px-3 py-2 text-sm font-medium text-green-800 transition-colors hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <i className="ri-check-double-line" />
                      Mark selected present
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMarkSelected("absent")}
                      disabled={loading || selectedIds.length === 0}
                      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-red-300 bg-red-100 px-3 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <i className="ri-close-line" />
                      Mark selected absent
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowActions((prev) => !prev)}
                        disabled={loading || selectedIds.length === 0}
                        aria-haspopup="menu"
                        aria-expanded={showActions}
                        className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <i className="ri-more-2-fill" />
                        Action
                        <i
                          className={`text-xs ${
                            showActions
                              ? "ri-arrow-up-s-line"
                              : "ri-arrow-down-s-line"
                          }`}
                        />
                      </button>
                      {showActions && (
                        <>
                          <button
                            type="button"
                            aria-label="Close menu"
                            tabIndex={-1}
                            onClick={() => setShowActions(false)}
                            className="fixed inset-0 z-10 cursor-default"
                          />
                          <div
                            role="menu"
                            className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-background-300 bg-background-50 py-1"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={handleClearMarks}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-foreground-800 transition-colors hover:bg-background-100"
                            >
                              <i className="ri-eraser-line text-foreground-500" />
                              Clear marks
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleExport}
                      disabled={loading || visibleRows.length === 0}
                      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 py-2 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <i className="ri-download-2-line" />
                      Export CSV
                    </button>
                  </div>
                </div>

                <AttendanceTable
                  rows={visibleRows}
                  loading={loading}
                  selectedIds={selectedIds}
                  lectureInfo={lectureInfo}
                  onToggleSelect={handleToggleSelect}
                  onToggleSelectAll={handleToggleSelectAll}
                  onOpenHistory={setHistoryRow}
                  onToggleRecord={toggleRecord}
                />
              </section>
            )}

            {tab === "weekly" && (
              <section className="mt-5">
                <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground-950">
                      Weekly overview
                    </h3>
                    <p className="mt-0.5 text-xs text-foreground-500">
                      {weekLabel}
                      <span className="mx-2 text-foreground-300">•</span>
                      Tap any day to update it
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-foreground-500">
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-sm bg-green-100 ring-1 ring-green-200" />
                      Present
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-sm bg-red-100 ring-1 ring-red-200" />
                      Absent
                    </span>
                  </div>
                </div>
                <WeeklyGrid
                  rows={rows}
                  days={weekDays}
                  today={todayIso()}
                  loading={loading}
                  getStatus={getStatus}
                  onToggle={handleGridToggle}
                />
              </section>
            )}

            {tab === "report" && (
              <section className="mt-5">
                <SummaryReport
                  rows={rows}
                  defaultStart={weekDays[0].iso}
                  defaultEnd={weekDays[6].iso}
                  loading={loading}
                  getStatus={getStatus}
                  scopeLabel={exportScope}
                />
              </section>
            )}
          </>
        )}
      </main>

      {!historyRow && (pendingEditCount > 0 || detailSaveError) && (
        <div className={`fixed inset-x-0 z-40 flex justify-center px-4 ${dirty ? "bottom-28 sm:bottom-24" : "bottom-0 pb-5"}`}>
          <div className="w-full max-w-md rounded-lg border border-primary-200 bg-background-50 p-3 shadow-lg" role="region" aria-label="Unsaved attendance corrections">
            {detailSaveError && <p className="mb-2 text-sm text-red-700" role="alert">{detailSaveError}</p>}
            {pendingEditCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-foreground-800">
                  {pendingEditCount} attendance {pendingEditCount === 1 ? "correction" : "corrections"} not saved
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingEdits({})}
                    disabled={detailSaving}
                    className="cursor-pointer rounded-md border border-background-300 bg-background-50 px-3 py-1.5 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEdits()}
                    disabled={detailSaving}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary-500 px-3 py-1.5 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <i className="ri-save-3-line" />
                    {detailSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5">
          <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-background-300 bg-background-50 p-3 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700">
                <i className="ri-edit-2-line" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-medium text-foreground-950">
                  Unsaved changes
                </p>
                <p className="text-xs text-foreground-500">
                  {pendingCount} change{pendingCount === 1 ? "" : "s"} not saved
                  yet
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={undo}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200"
              >
                <i className="ri-arrow-go-back-line" />
                Undo
              </button>
              <button
                type="button"
                onClick={save}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 py-2 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600"
              >
                <i className="ri-save-3-line" />
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {historyRow && (
        <LearnerHistoryModal
          key={historyRow.learner.id}
          learner={historyRow.learner}
          index={historyRow.index}
          moduleLabel=""
          cohortName={historyRow.cohortName}
          history={detailHistory}
          loading={detailHistoryLoading}
          error={detailHistoryError}
          warnings={detailHistoryWarnings}
          saving={detailSaving}
          saveError={detailSaveError}
          pendingCount={pendingEditCount}
          pendingStatus={pendingStatus}
          onToggleRecord={toggleRecord}
          onSave={() => void saveEdits()}
          onDiscard={() => setPendingEdits({})}
          onClose={() => setHistoryRow(null)}
        />
      )}

      {showLearnerDirectory && (
        <LearnerDirectoryModal
          learners={activeLearners}
          loading={dataLoading}
          onClose={() => setShowLearnerDirectory(false)}
          onOpenLearner={(learner) => {
            setShowLearnerDirectory(false);
            setHistoryRow(rows.find((row) => row.learner.id === learner.id) ?? buildRows([learner])[0]);
          }}
        />
      )}
      </div>
    </WorkspaceShell>
  );
}
