import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/feature/WorkspaceShell";
import { curriculumNavItems } from "@/mocks/navigation";
import type { AttendanceStatus, Learner, Lecture } from "@/types/bulkAttendance";
import { useAttendance } from "@/hooks/useBulkAttendance";
import { useBulkAttendanceData } from "@/hooks/useBulkAttendanceData";
import { useArchivedLearners } from "@/hooks/useArchivedBulkLearners";
import {
  fetchCurriculumScopeLearnerRoster,
  type CurriculumProgrammeAssignedLearner,
} from "@/lib/curriculumApi";
import {
  fetchBulkAttendanceKbcHistory,
  fetchBulkAttendanceLiveHistory,
  updateBulkAttendanceKbcRecord,
  updateBulkAttendanceLiveRecord,
  type BulkAttendanceKbcHistoryRecord,
  type BulkAttendanceLiveHistoryRecord,
} from "@/api/bulkAttendanceLearners";
import {
  formatDateLabel,
  formatShortDate,
  getWeekDays,
  isPastEndDate,
  todayIso,
} from "@/utils/bulkAttendance";
import { downloadCsv, slugify } from "@/utils/bulkCsv";
import StatCards from "./components/StatCards";
import FilterCard, { type FilterOption } from "./components/FilterCard";
import RegisterTabs, { type RegisterTab } from "./components/RegisterTabs";
import SearchBar from "./components/SearchBar";
import AttendanceTable, {
  type AttendanceRow,
  type LectureInfo,
} from "./components/AttendanceTable";
import WeeklyGrid from "./components/WeeklyGrid";
import SummaryReport from "./components/SummaryReport";
import LearnerHistoryModal, {
  type LearnerHistoryRecord,
} from "./components/LearnerHistoryModal";
import LearnerDirectoryModal from "./components/LearnerDirectoryModal";
import ArchiveDialog from "./components/ArchiveDialog";
import ArchiveView from "./components/ArchiveView";
import ConfirmDialog from "./components/ConfirmDialog";

function statusLabel(status: AttendanceStatus): string {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  return "Unmarked";
}

interface AttendanceHistoryEntry {
  id: string;
  sessionDate: string;
  moduleCatalogueId?: string;
  moduleName: string;
  lectureName: string;
  cohortName?: string;
  sessionNumber: number | null;
  attendance: "present" | "absent" | null;
  source: "live" | "kbc" | "merged";
  recordKey?: string;
  occurrenceId?: string;
  learnerProfileId?: string;
}

function normalizeHistoryLabel(value: string, lecture = false): string {
  let normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (lecture) {
    normalized = normalized.replace(/^(?:lecture|lec|l)\s*\.?\s*\d+\s*[:.\-]?\s*/, "");
    normalized = normalized.replace(
      /\s+(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|[a-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\s*$/,
      "",
    );
  }
  return normalized.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function moduleLabelsMatch(left: string, right: string): boolean {
  const first = normalizeHistoryLabel(left);
  const second = normalizeHistoryLabel(right);
  return Boolean(first && second && (` ${first} `.includes(` ${second} `) || ` ${second} `.includes(` ${first} `)));
}

function lectureNumber(value: string): number | null {
  const match = value.match(/^\s*(?:lecture|lec|l)\s*\.?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function mergeHistoryStatus(
  first: AttendanceHistoryEntry["attendance"],
  second: AttendanceHistoryEntry["attendance"],
): AttendanceHistoryEntry["attendance"] {
  return first && first === second ? first : null;
}

export default function AttendancePage() {
  const { manualIds, restoredIds, archiveMany, restoreMany } =
    useArchivedLearners();
  const legacyArchiveIds = useMemo(
    () => [...new Set([...manualIds, ...restoredIds])],
    [manualIds, restoredIds],
  );
  const {
    programmes,
    cohorts,
    learners,
    lectures,
    modules,
    loading: dataLoading,
    error: dataError,
    retry: retryData,
  } = useBulkAttendanceData(legacyArchiveIds);
  const [programmeId, setProgrammeId] = useState("");
  const [cohortId, setCohortId] = useState("");
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
  const [detailLiveHistory, setDetailLiveHistory] = useState<BulkAttendanceLiveHistoryRecord[]>([]);
  const [detailHistoryLoading, setDetailHistoryLoading] = useState(false);
  const [detailHistoryError, setDetailHistoryError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [view, setView] = useState<"register" | "archive">("register");
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showLearnerDirectory, setShowLearnerDirectory] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{
    ids: string[];
    label: string;
  } | null>(null);

  const today = useMemo(() => todayIso(), []);
  const selectedLecture = useMemo(
    () => lectures.find((lecture) => lecture.id === lectureId) ?? null,
    [lectureId, lectures]
  );

  useEffect(() => {
    const scopedModuleId = moduleId || selectedLecture?.moduleId || "";
    const scope = scopedModuleId ? "module" : cohortId ? "cohort" : programmeId ? "programme" : null;
    const identifier = scopedModuleId
      ? modules.find((module) => module.id === scopedModuleId)?.rosterId || scopedModuleId
      : cohortId || programmeId;
    if (!scope) {
      setScopeLearnerEmails((previous) => previous === null ? previous : null);
      setScopeLearnersByEmail((previous) => previous.size === 0 ? previous : new Map());
      setScopeRosterLoading(false);
      setScopeRosterError(null);
      return;
    }

    const controller = new AbortController();
    setScopeLearnerEmails(null);
    setScopeLearnersByEmail(new Map());
    setScopeRosterLoading(true);
    setScopeRosterError(null);
    void fetchCurriculumScopeLearnerRoster(
      scope,
      identifier,
      { learnerStatus: "all" },
      controller.signal,
    )
      .then((roster) => {
        if (controller.signal.aborted) return;
        const rowsByEmail = new Map<string, CurriculumProgrammeAssignedLearner[]>();
        roster.assignedLearners.forEach((learner) => {
          const email = learner.email.trim().toLowerCase();
          if (!email) return;
          rowsByEmail.set(email, [...(rowsByEmail.get(email) ?? []), learner]);
        });
        setScopeLearnerEmails(new Set(rowsByEmail.keys()));
        setScopeLearnersByEmail(new Map(
          [...rowsByEmail.entries()]
            .filter(([, assignments]) => assignments.length === 1)
            .map(([email, assignments]) => [email, assignments[0]]),
        ));
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
  }, [programmeId, cohortId, moduleId, modules, selectedLecture]);

  // A learner is archived when the user archived them by hand, or once their
  // enrolment end date has passed — unless they were explicitly restored.
  const isArchived = useCallback(
    (learner: Learner) => {
      const ids = [learner.id, learner.curriculumId].filter((id): id is string => Boolean(id));
      return !ids.some((id) => restoredIds.includes(id)) &&
        (ids.some((id) => manualIds.includes(id)) || isPastEndDate(learner.endDate, today));
    },
    [manualIds, restoredIds, today]
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

  const moduleOptions = useMemo<FilterOption[]>(() => {
    const list = modules.filter((module) => {
      if (programmeId && module.programmeId !== programmeId) return false;
      if (cohortId && module.cohortId && module.cohortId !== cohortId) return false;
      return true;
    });
    return [
      { value: "", label: "All Modules" },
      ...list.map((module) => ({ value: module.id, label: module.name })),
    ];
  }, [programmeId, cohortId, modules]);

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
        const hasScopeFilter = Boolean(programmeId || cohortId || moduleId || selectedLecture);
        if (hasScopeFilter) {
          if (!scopeLearnerEmails) return false;
          return scopeLearnerEmails.has(learner.email.trim().toLowerCase());
        }
        return true;
      }),
    [programmeId, cohortId, moduleId, selectedLecture, scopeLearnerEmails, scopeLearnersByEmail, learners]
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

  const attendanceLecture = useMemo(() => {
    if (!selectedLecture) return null;
    return {
      ...selectedLecture,
      moduleName: selectedLecture.moduleName
        || modules.find((module) => module.id === selectedLecture.moduleId)?.name
        || "",
    };
  }, [selectedLecture, modules]);
  const moduleKey = selectedLecture
    ? `${selectedLecture.moduleId}:${selectedLecture.id}`
    : moduleId || "general";
  const selectedModuleCatalogueId = modules.find((module) => module.id === moduleId)?.rosterId ?? "";
  const attendanceScope = useMemo(() => ({
    programmeId,
    cohortId,
    groupId: "",
    moduleCatalogueId: selectedModuleCatalogueId,
  }), [programmeId, cohortId, selectedModuleCatalogueId]);
  const kbcHistoryModuleNames = useMemo(() => {
    const hasCurriculumScope = Boolean(programmeId || cohortId || moduleId || selectedLecture);
    if (!hasCurriculumScope) return [];

    const scopedModules = modules.filter((module) => {
      if (moduleId && module.id !== moduleId) return false;
      if (selectedLecture && !moduleId
        && module.id !== selectedLecture.moduleId
        && module.rosterId !== selectedLecture.moduleCatalogueId) return false;
      if (programmeId && module.programmeId && module.programmeId !== programmeId) return false;
      if (cohortId && module.cohortId && module.cohortId !== cohortId) return false;
      return true;
    });
    const lectureNames = selectedLecture
      ? [selectedLecture.moduleName, ...(selectedLecture.moduleAliases ?? [])]
      : [];
    return [...new Set([...scopedModules.map((module) => module.name), ...lectureNames]
      .map((name) => name.trim())
      .filter(Boolean))];
  }, [programmeId, cohortId, moduleId, selectedLecture, modules]);
  const selectedLectureIsUnique = useMemo(() => {
    if (!selectedLecture) return false;
    return lectures.filter((lecture) => {
      if (lecture.sessionDate !== selectedLecture.sessionDate) return false;
      return lecture.moduleId === selectedLecture.moduleId
        || Boolean(lecture.moduleCatalogueId && selectedLecture.moduleCatalogueId
          && lecture.moduleCatalogueId === selectedLecture.moduleCatalogueId);
    }).length === 1;
  }, [selectedLecture, lectures]);

  const {
    loading: attendanceLoading,
    sourceError: attendanceSourceError,
    liveHistory,
    kbcHistory,
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
    historyLearners: scopedLearners,
    kbcHistoryModuleNames,
    moduleKey,
    date: selectedLecture?.sessionDate || date,
    selectedLecture: attendanceLecture,
    selectedLectureIsUnique,
    scope: attendanceScope,
  });
  const loading = dataLoading || attendanceLoading || scopeRosterLoading;

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

  const handleDeleteConfirm = () => {
    archiveMany(selectedIds);
    setSelectedIds([]);
    setShowDeleteConfirm(false);
  };

  const cohortNameMap = useMemo(
    () => Object.fromEntries(cohorts.map((cohort) => [cohort.id, cohort.name])),
    [cohorts]
  );
  const moduleNameMap = useMemo(
    () => Object.fromEntries(modules.map((module) => [module.id, module.name])),
    [modules]
  );
  const programmeNameMap = useMemo(
    () => Object.fromEntries(programmes.map((programme) => [programme.id, programme.name])),
    [programmes]
  );

  const historyForLearner = useCallback((
    learner: Learner,
    options?: {
      allDates?: boolean;
      kbcHistoryRecords?: BulkAttendanceKbcHistoryRecord[];
    },
  ) => {
    const allDates = options?.allDates ?? false;
    const historyRecords = options?.kbcHistoryRecords ?? kbcHistory;
    const email = learner.email.trim().toLowerCase();
    const matchedLive = liveHistory.filter((record) => {
      const belongsToLearner = learner.curriculumId
        ? record.learnerProfileId === learner.curriculumId
        : Boolean(email && record.learnerEmail.trim().toLowerCase() === email);
      if (!belongsToLearner) return false;
      if (allDates) return true;
      return record.sessionDate <= date
        && (!programmeId || record.programmeId === programmeId)
        && (!cohortId || record.cohortId === cohortId)
        && (!selectedModuleCatalogueId || record.moduleCatalogueId === selectedModuleCatalogueId);
    });

    const liveEntries: AttendanceHistoryEntry[] = matchedLive.map((record) => ({
      id: `live:${record.occurrenceId}`,
      sessionDate: record.sessionDate,
      moduleCatalogueId: record.moduleCatalogueId,
      moduleName: record.moduleTitle || moduleNameMap[record.moduleCatalogueId] || "",
      lectureName: `${record.moduleTitle || moduleNameMap[record.moduleCatalogueId] || "Live session"}${record.sessionNumber ? ` · Session ${record.sessionNumber}` : ""}`,
      cohortName: record.cohortName,
      sessionNumber: record.sessionNumber,
      attendance: record.attendance,
      source: "live",
      occurrenceId: record.occurrenceId,
      learnerProfileId: record.learnerProfileId,
    }));
    const matchedKbc: AttendanceHistoryEntry[] = historyRecords
      .filter((record) => record.learnerId === learner.kbcId && (allDates || record.sessionDate <= date))
      .map((record) => ({
        id: `kbc:${record.learnerId}:${record.sessionDate}:${record.sessionNumber ?? ""}:${normalizeHistoryLabel(record.moduleName)}:${normalizeHistoryLabel(record.lectureName, true)}`,
        sessionDate: record.sessionDate,
        moduleName: record.moduleName,
        lectureName: record.lectureName || record.moduleName || "Lecture title not recorded",
        sessionNumber: record.sessionNumber,
        attendance: record.attendance,
        source: "kbc",
        recordKey: record.recordKey,
      }));

    const combined = [...liveEntries];
    matchedKbc.forEach((kbcRecord) => {
      const sameModuleAndDay = (record: AttendanceHistoryEntry) =>
        record.sessionDate === kbcRecord.sessionDate
        && moduleLabelsMatch(record.moduleName, kbcRecord.moduleName)
        && (!record.sessionNumber || !kbcRecord.sessionNumber || record.sessionNumber === kbcRecord.sessionNumber);
      const liveMatches = combined
        .map((record, index) => ({ record, index }))
        .filter(({ record }) => record.source === "live" && sameModuleAndDay(record));
      const kbcMatches = matchedKbc.filter((record) => sameModuleAndDay(record));

      if (liveMatches.length === 1 && kbcMatches.length === 1) {
        const { record: liveRecord, index } = liveMatches[0];
        combined[index] = {
          ...liveRecord,
          lectureName: kbcRecord.lectureName || liveRecord.lectureName,
          attendance: mergeHistoryStatus(liveRecord.attendance, kbcRecord.attendance),
          source: "merged",
        };
      } else {
        combined.push(kbcRecord);
      }
    });

    const byOccurrence = new Map<string, AttendanceHistoryEntry>();
    combined.forEach((record) => {
      const existing = byOccurrence.get(record.id);
      if (!existing) byOccurrence.set(record.id, record);
      else byOccurrence.set(record.id, {
        ...existing,
        attendance: mergeHistoryStatus(existing.attendance, record.attendance),
      });
    });
    return [...byOccurrence.values()].sort((a, b) =>
      a.sessionDate.localeCompare(b.sessionDate)
      || (a.sessionNumber ?? 0) - (b.sessionNumber ?? 0)
      || normalizeHistoryLabel(a.moduleName).localeCompare(normalizeHistoryLabel(b.moduleName))
      || normalizeHistoryLabel(a.lectureName, true).localeCompare(normalizeHistoryLabel(b.lectureName, true)),
    );
  }, [
    liveHistory,
    kbcHistory,
    date,
    programmeId,
    cohortId,
    selectedModuleCatalogueId,
    moduleNameMap,
  ]);

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

  // Anyone still in the register can be archived early / by hand.
  const eligibleRows = useMemo(
    () => buildRows(activeLearners),
    [activeLearners, buildRows]
  );

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

  const lectureInfo = useMemo(() => {
    const map: Record<string, LectureInfo> = {};
    activeLearners.forEach((learner) => {
      const list = learnerLectureList(learner);
      const upToDate = list.filter((lecture) => lecture.sessionDate <= date);
      const pool = upToDate.length > 0 ? upToDate : list;
      const history = historyForLearner(learner);
      const recentHistory = history.slice(-4).map((record) => ({
        id: record.id,
        name: record.lectureName || record.moduleName || "Lecture title not recorded",
        sessionDate: record.sessionDate,
        status: record.attendance ?? "unmarked" as AttendanceStatus,
      }));
      let name = "—";
      let moduleName = "";
      let lectureDate: string | null = null;
      if (selectedLecture) {
        name = selectedLecture.name;
        moduleName = selectedLecture.moduleName || moduleNameMap[selectedLecture.moduleId] || "";
        lectureDate = selectedLecture.sessionDate;
      } else if (history.length > 0) {
        const latest = history[history.length - 1];
        name = latest.lectureName || latest.moduleName || "Attendance record";
        moduleName = latest.moduleName;
        lectureDate = latest.sessionDate;
      } else if (pool.length > 0) {
        const latest = pool[pool.length - 1];
        name = latest.name;
        moduleName = latest.moduleName || moduleNameMap[latest.moduleId] || "";
        lectureDate = latest.sessionDate;
      }
      let recent = recentHistory;
      const selectedModuleNames = selectedLecture
        ? [selectedLecture.moduleName, ...(selectedLecture.moduleAliases ?? []), moduleNameMap[selectedLecture.moduleId] ?? ""]
        : [];
      const selectedLectureHasHistory = selectedLecture && history.some((record) => {
        if (record.sessionDate !== selectedLecture.sessionDate) return false;
        if (record.moduleCatalogueId && selectedLecture.moduleCatalogueId
          && record.moduleCatalogueId === selectedLecture.moduleCatalogueId) return true;
        if (record.source !== "kbc" || !selectedModuleNames.some((name) => moduleLabelsMatch(record.moduleName, name))) return false;
        if (record.sessionNumber && lectureNumber(selectedLecture.name)) {
          return record.sessionNumber === lectureNumber(selectedLecture.name);
        }
        if (record.lectureName && record.lectureName !== record.moduleName) {
          return normalizeHistoryLabel(record.lectureName, true) === normalizeHistoryLabel(selectedLecture.name, true);
        }
        return selectedLectureIsUnique;
      });
      if (selectedLecture && !selectedLectureHasHistory) {
        recent = [...recent, {
          id: selectedLecture.id,
          name: selectedLecture.name,
          sessionDate: selectedLecture.sessionDate,
          status: getStatus(learner.id, selectedLecture.sessionDate),
        }].slice(-4);
      }
      if (recent.length === 0) recent = pool.slice(-4).map((lecture) => ({
        id: lecture.id,
        name: lecture.name,
        sessionDate: lecture.sessionDate,
        status: getStatus(learner.id, lecture.sessionDate),
      }));
      map[learner.id] = { name, moduleName, date: lectureDate, recent };
    });
    return map;
  }, [activeLearners, learnerLectureList, selectedLecture, selectedLectureIsUnique, date, getStatus, historyForLearner, moduleNameMap]);

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

    const scopeName = cohortId
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
    const scopeName = cohortId
      ? cohortNameMap[cohortId]
      : programmeId
      ? programmeNameMap[programmeId]
      : "all-learners";
    return slugify(scopeName ?? "all-learners");
  }, [
    cohortId,
    programmeId,
    cohortNameMap,
    programmeNameMap,
  ]);

  useEffect(() => {
    if (!historyRow) {
      setDetailKbcHistory([]);
      setDetailLiveHistory([]);
      setDetailHistoryLoading(false);
      setDetailHistoryError(null);
      return undefined;
    }

    const controller = new AbortController();
    setDetailKbcHistory([]);
    setDetailLiveHistory([]);
    setDetailHistoryLoading(true);
    setDetailHistoryError(null);
    const requests: Promise<void>[] = [];
    if (historyRow.learner.kbcId) {
      requests.push(fetchBulkAttendanceKbcHistory({
        learnerIds: [historyRow.learner.kbcId],
        moduleNames: [],
        allHistory: true,
      }, controller.signal).then((records) => {
        if (!controller.signal.aborted) setDetailKbcHistory(records);
      }));
    }
    if (historyRow.learner.email) {
      requests.push(fetchBulkAttendanceLiveHistory({
        learnerProfileIds: historyRow.learner.curriculumId ? [historyRow.learner.curriculumId] : [],
        learnerEmail: historyRow.learner.email,
      }, controller.signal).then((records) => {
        if (!controller.signal.aborted) setDetailLiveHistory(records);
      }));
    }
    if (!requests.length) {
      setDetailHistoryLoading(false);
      return undefined;
    }
    void Promise.allSettled(requests)
      .then((results) => {
        if (controller.signal.aborted) return;
        const messages = results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason instanceof Error
            ? result.reason.message
            : "Unable to load this learner's full attendance history.");
        if (messages.length) setDetailHistoryError([...new Set(messages)].join(" "));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailHistoryLoading(false);
      });

    return () => controller.abort();
  }, [historyRow?.learner.id, historyRow?.learner.kbcId, historyRow?.learner.curriculumId, historyRow?.learner.email]);

  const detailHistory = useMemo<LearnerHistoryRecord[]>(() => {
    const kbcRecords: LearnerHistoryRecord[] = detailKbcHistory.map((record) => ({
      id: `kbc:${record.recordKey ?? `${record.learnerId}:${record.sessionDate}:${record.lectureName}`}`,
      source: "kbc",
      recordKey: record.recordKey,
      sessionDate: record.sessionDate,
      moduleName: record.moduleName,
      lectureName: record.lectureName || record.moduleName || "Lecture title not recorded",
      attendance: record.attendance ?? ("unmarked" as AttendanceStatus),
    }));
    const liveRecords: LearnerHistoryRecord[] = detailLiveHistory.map((record) => ({
      id: `live:${record.occurrenceId}:${record.learnerProfileId}`,
      source: "live",
      occurrenceId: record.occurrenceId,
      learnerProfileId: record.learnerProfileId,
      sessionDate: record.sessionDate,
      moduleName: record.moduleTitle || moduleNameMap[record.moduleCatalogueId] || "Module not recorded",
      lectureName: `${record.moduleTitle || moduleNameMap[record.moduleCatalogueId] || "Live session"}${record.sessionNumber ? ` · Session ${record.sessionNumber}` : ""}`,
      attendance: record.attendance ?? ("unmarked" as AttendanceStatus),
    }));
    return [...kbcRecords, ...liveRecords]
      .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate)
        || left.moduleName.localeCompare(right.moduleName)
        || left.lectureName.localeCompare(right.lectureName));
  }, [detailKbcHistory, detailLiveHistory, moduleNameMap]);

  const handleDetailStatusToggle = useCallback(async (entry: LearnerHistoryRecord) => {
    if (entry.attendance !== "present" && entry.attendance !== "absent") return;
    const attendance = entry.attendance === "present" ? "absent" : "present";
    try {
      if (entry.source === "kbc" && entry.recordKey) {
        await updateBulkAttendanceKbcRecord({ recordKey: entry.recordKey, attendance });
        setDetailKbcHistory((records) => records.map((record) =>
          record.recordKey === entry.recordKey ? { ...record, attendance } : record,
        ));
      } else if (entry.source === "live" && entry.occurrenceId && entry.learnerProfileId) {
        await updateBulkAttendanceLiveRecord({
          occurrenceId: entry.occurrenceId,
          learnerProfileId: entry.learnerProfileId,
          attendance,
        });
        setDetailLiveHistory((records) => records.map((record) =>
          record.occurrenceId === entry.occurrenceId
            && record.learnerProfileId === entry.learnerProfileId
            ? { ...record, attendance }
            : record,
        ));
      } else {
        throw new Error("This attendance record cannot be updated.");
      }
      setDetailHistoryError(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to save the attendance update.";
      setDetailHistoryError(message);
      throw new Error(message);
    }
  }, []);

  const handleArchiveConfirm = (learnerIds: string[]) => {
    archiveMany(learnerIds);
    setShowArchiveDialog(false);
  };

  const requestRestore = (learnerId: string) => {
    const target = archivedRows.find((row) => row.learner.id === learnerId);
    setRestoreTarget({
      ids: [learnerId],
      label: target ? target.learner.name : "this learner",
    });
  };

  const requestRestoreAll = () => {
    if (archivedRows.length === 0) return;
    setRestoreTarget({
      ids: archivedRows.map((row) => row.learner.id),
      label:
        archivedRows.length === 1
          ? archivedRows[0].learner.name
          : `${archivedRows.length} learners`,
    });
  };

  const confirmRestore = () => {
    if (restoreTarget) restoreMany(restoreTarget.ids);
    setRestoreTarget(null);
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
                  Restore anyone to bring them back
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
            {!selectedLecture && (
              <p className="mt-2 text-xs text-foreground-500">Choose a lecture to focus the register; saved live-session history is shown below.</p>
            )}
            {scopeRosterLoading && (
              <p className="mt-2 text-xs text-foreground-500">Loading learners for this selection…</p>
            )}
            {scopeRosterError && (
              <p className="mt-2 text-xs text-danger-600">{scopeRosterError}</p>
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
            <ArchiveView
              rows={archivedRows}
              archivableCount={eligibleRows.length}
              onArchive={() => setShowArchiveDialog(true)}
              onRestore={requestRestore}
              onRestoreAll={requestRestoreAll}
            />
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
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setShowActions(false);
                                setShowDeleteConfirm(true);
                              }}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-red-700 transition-colors hover:bg-red-100"
                            >
                              <i className="ri-delete-bin-line" />
                              Delete selected
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
          learner={historyRow.learner}
          index={historyRow.index}
          moduleLabel={activeModuleLabel}
          cohortName={historyRow.cohortName}
          history={detailHistory}
          loading={detailHistoryLoading}
          error={detailHistoryError}
          onToggleAttendance={handleDetailStatusToggle}
          onClose={() => setHistoryRow(null)}
        />
      )}

      {showLearnerDirectory && (
        <LearnerDirectoryModal
          learners={activeLearners}
          loading={dataLoading}
          onClose={() => setShowLearnerDirectory(false)}
        />
      )}

      <ArchiveDialog
        open={showArchiveDialog}
        rows={eligibleRows}
        onClose={() => setShowArchiveDialog(false)}
        onConfirm={handleArchiveConfirm}
      />

      <ConfirmDialog
        open={restoreTarget !== null}
        title={
          restoreTarget && restoreTarget.ids.length > 1
            ? "Restore all learners?"
            : "Restore this learner?"
        }
        description={
          restoreTarget
            ? `Are you sure you want to restore ${restoreTarget.label}? They will be moved back to the active register.`
            : ""
        }
        confirmLabel="Restore"
        onConfirm={confirmRestore}
        onClose={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        icon="ri-delete-bin-line"
        title={`Delete ${selectedIds.length} ${
          selectedIds.length === 1 ? "learner" : "learners"
        }?`}
        description={`${
          selectedIds.length === 1 ? "This learner" : "These learners"
        } will be removed from the active register. You can restore them anytime from the Archived view.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
      />
      </div>
    </WorkspaceShell>
  );
}
