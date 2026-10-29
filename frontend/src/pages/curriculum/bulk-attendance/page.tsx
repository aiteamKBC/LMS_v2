import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import SessionPicker from './components/SessionPicker';
import RegisterSummary from './components/RegisterSummary';
import styles from './bulkAttendance.module.css';
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

const ROSTER_TIMEOUT_MS = 60_000;

// Curriculum rosters list learners by LMS email. A learner whose KBC
// directory email differs is matched through the LMS email for the same KBC id.
function rosterEmailFor(learner: Learner, rosterEmails?: { has: (email: string) => boolean } | null): string {
  const emails = [learner.email, learner.lmsEmail ?? ""]
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return emails.find((email) => rosterEmails?.has(email)) ?? emails[0] ?? "";
}
// A Programme -> Cohort -> Group -> Module selection is usually made in quick
// succession. Waiting briefly avoids requests for every intermediate choice,
// while the selected filter label still updates at once.
const ROSTER_DEBOUNCE_MS = 80;
import {
  createBulkAttendanceLiveDay,
  fetchBulkAttendanceLiveDayRecords,
  fetchBulkAttendanceKbcHistory,
  fetchBulkAttendanceKbcRecent,
  fetchBulkAttendanceDayLearners,
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
import { downloadAttendanceSummaryPdf } from "./attendancePdf";
import FilterCard, { type FilterOption } from "./components/FilterCard";
import RegisterTabs, { type RegisterTab } from "./components/RegisterTabs";
import HighlightsTab from "./components/HighlightsTab";
import { HighlightLegend } from "./components/HighlightControls";
import { highlightKey, useLearnerHighlights } from "./components/highlights";
import SearchBar from "./components/SearchBar";
import AttendanceTable, {
  type AttendanceRow,
  type EditableRecord,
  type LectureInfo,
} from "./components/AttendanceTable";
import WeeklyGrid from "./components/WeeklyGrid";
import MonthlyGrid from "./components/MonthlyGrid";
import SummaryReport from "./components/SummaryReport";
import LearnerHistoryModal, {
  type LearnerHistoryRecord,
} from "./components/LearnerHistoryModal";
import LearnerDirectoryModal from "./components/LearnerDirectoryModal";
import AddAttendanceDayDialog, {
  type AddAttendanceDayValues,
} from "./components/AddAttendanceDayDialog";
import ArchiveView from "./components/ArchiveView";
import { isArchivedStatus } from "./learnerStatus";

function statusLabel(status: AttendanceStatus): string {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  return "Unmarked";
}

function normalizeText(value: string | undefined): string {
  return (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const HIDDEN_FILTER_NAME_PARTS = ["test", "rewan", "osama", "copy"];
const HIDDEN_FILTER_EXACT_NAMES = new Set([
  "gg", "tgtr", "progmon", "333", "3333", "dddd", "mm1", "m1", "m2", "m3", "m4",
  "mm21", "mm232", "mmmm1", "mo1", "mod1", "fcv", "gdgv", "ghd", "hhj", "hjf",
  "latestmod", "ayhaga", "ayamodual",
]);

function isHiddenFilterName(value: string | undefined): boolean {
  const normalized = normalizeText(value);
  return HIDDEN_FILTER_EXACT_NAMES.has(normalized)
    || HIDDEN_FILTER_NAME_PARTS.some((part) => normalized.includes(part));
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
  const [attendanceModeFilter, setAttendanceModeFilter] = useState<"" | "live" | "lazy">("");
  const [scopeLearnerEmails, setScopeLearnerEmails] = useState<Set<string> | null>(null);
  const [scopeLearnersByEmail, setScopeLearnersByEmail] = useState<Map<string, CurriculumProgrammeAssignedLearner>>(new Map());
  const [scopeRosterLoading, setScopeRosterLoading] = useState(false);
  const [scopeRosterError, setScopeRosterError] = useState<string | null>(null);
  // No date is selected initially: the register shows the full active roster.
  // Selecting a day turns on the saved-attendance membership filter.
  const [date, setDate] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<RegisterTab>("daily");
  const { highlights, setHighlight } = useLearnerHighlights();
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
  const [registerSaving, setRegisterSaving] = useState(false);
  const [registerSaveError, setRegisterSaveError] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, BulkAttendanceChange>>({});
  const [kbcRecentVersion, setKbcRecentVersion] = useState(0);
  const [dayMembership, setDayMembership] = useState<{ date: string; ids: Set<string> } | null>(null);
  const [dayLoading, setDayLoading] = useState(true);
  const [dayError, setDayError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [view, setView] = useState<"register" | "archive">("register");
  const [showLearnerDirectory, setShowLearnerDirectory] = useState(false);
  const [showAddAttendanceDay, setShowAddAttendanceDay] = useState(false);
  const [addAttendanceSaving, setAddAttendanceSaving] = useState(false);
  const [addAttendanceError, setAddAttendanceError] = useState<string | null>(null);
  const [liveDayError, setLiveDayError] = useState<string | null>(null);
  const [savingLiveLearnerIds, setSavingLiveLearnerIds] = useState<string[]>([]);
  const liveSaveLock = useRef(false);
  const [liveDayRead, setLiveDayRead] = useState({ key: '', loading: false, success: false });

  const selectedLecture = useMemo(
    () => lectures.find((lecture) => lecture.id === lectureId) ?? null,
    [lectureId, lectures]
  );
  const soleDateLecture = useMemo(() => {
    const onDate = lectures.filter((lecture) => lecture.sessionDate === date);
    return onDate.length === 1 ? onDate[0] : null;
  }, [lectures, date]);

  // Which roster the current filters need, reduced to plain strings so the
  // request only re-runs when the selection itself changes.
  // Only an explicit module/lecture selection needs a roster request. A lone
  // session on the selected date is enough to read attendance, but it should
  // not blank the learner table while its roster is being fetched.
  const scopedModuleId = moduleId || selectedLecture?.moduleId || "";
  const rosterScope: CurriculumLearnerScope | null = scopedModuleId
    ? "module" : groupId ? "group" : cohortId ? "cohort" : programmeId ? "programme" : null;
  const rosterIdentifier = scopedModuleId
    ? modules.find((module) => module.id === scopedModuleId)?.rosterId || scopedModuleId
    : groupId || cohortId || programmeId;
  // Rosters already loaded on this page; going back to a filter is instant.
  const rosterCache = useRef(new Map<string, CurriculumProgrammeAssignedLearner[]>());
  const [rosterRetry, setRosterRetry] = useState(0);

  // Use the placement already present in the directory as an immediate view
  // while the authoritative curriculum roster request is in flight. The
  // response below replaces this set, so incomplete legacy placement data can
  // never become the saved source of truth.
  const optimisticRosterEmails = useMemo(() => {
    if (!rosterScope) return null;
    const targetModule = scopedModuleId
      ? modules.find((module) => module.id === scopedModuleId)
      : undefined;
    const targetGroupId = targetModule?.groupId || groupId;
    const targetCohortId = targetModule?.cohortId
      || groups.find((group) => group.id === targetGroupId)?.cohortId
      || cohortId;
    const targetProgrammeId = targetModule?.programmeId
      || cohorts.find((cohort) => cohort.id === targetCohortId)?.programmeId
      || programmeId;
    const targetGroupName = targetGroupId
      ? groups.find((group) => group.id === targetGroupId)?.name
      : "";
    const targetCohortName = targetCohortId
      ? cohorts.find((cohort) => cohort.id === targetCohortId)?.name
      : "";
    const targetProgrammeName = targetProgrammeId
      ? programmes.find((programme) => programme.id === targetProgrammeId)?.name
      : "";
    const emails = learners
      .filter((learner) => {
        const programmeMatches = targetProgrammeId
          ? learner.programmeId === targetProgrammeId
            || normalizeText(learner.programme) === normalizeText(targetProgrammeName)
          : true;
        const cohortMatches = targetCohortId
          ? learner.cohortId === targetCohortId
            || normalizeText(learner.cohort) === normalizeText(targetCohortName)
          : true;
        const groupMatches = targetGroupId
          ? learner.groupId === targetGroupId
            || normalizeText(learner.group) === normalizeText(targetGroupName)
          : true;
        return programmeMatches && cohortMatches && groupMatches && Boolean(learner.email.trim());
      })
      .map((learner) => learner.email.trim().toLowerCase());
    return new Set(emails);
  }, [cohortId, cohorts, groupId, groups, learners, modules, programmes, programmeId, rosterScope, scopedModuleId]);

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
        // The curriculum roster endpoint has already narrowed module learners
        // to the module's Group. Do not repeat that check here: legacy
        // enrolment rows can have a Group name without a resolved groupId.
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
    setScopeLearnerEmails(optimisticRosterEmails);
    setScopeLearnersByEmail(new Map());
    setScopeRosterLoading(true);
    setScopeRosterError(null);
    const requestTimer = window.setTimeout(() => {
      void fetchCurriculumScopeLearnerRoster(
        rosterScope,
        rosterIdentifier,
        { learnerStatus: "all" },
        controller.signal,
        { timeoutMs: ROSTER_TIMEOUT_MS, compact: true },
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
    }, ROSTER_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(requestTimer);
      controller.abort();
    };
  }, [optimisticRosterEmails, rosterScope, rosterIdentifier, rosterRetry]);

  // Only the programme status archives a learner: Completed, EnteredEpa or Withdrawn.
  const isArchived = useCallback(
    (learner: Learner) => isArchivedStatus(learner.status),
    []
  );

  const scopedModules = useMemo(() => {
    const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    return modules.filter((module) => {
      if (isHiddenFilterName(module.name)) return false;
      // Older module rows sometimes only retain their group. Resolve the
      // group’s cohort so the cascade remains correct for both row shapes.
      const moduleCohortId = module.cohortId || groupById.get(module.groupId ?? "")?.cohortId;
      const moduleProgrammeId = module.programmeId || cohortById.get(moduleCohortId ?? "")?.programmeId;
      if (programmeId && moduleProgrammeId !== programmeId) return false;
      if (cohortId && moduleCohortId !== cohortId) return false;
      if (groupId && module.groupId !== groupId) return false;
      return true;
    });
  }, [programmeId, cohortId, groupId, modules, cohorts, groups]);

  const cohortOptions = useMemo<FilterOption[]>(() => {
    const list = programmeId
      ? cohorts.filter((cohort) => cohort.programmeId === programmeId)
      : cohorts;
    return [
      { value: "", label: "All Cohorts" },
      ...list
        .filter((cohort) => !isHiddenFilterName(cohort.name))
        .map((cohort) => ({ value: cohort.id, label: cohort.name })),
    ];
  }, [programmeId, cohorts]);

  const groupOptions = useMemo<FilterOption[]>(() => {
    const programmeCohortIds = new Set(
      cohorts.filter((cohort) => cohort.programmeId === programmeId).map((cohort) => cohort.id),
    );
    const list = groups.filter((group) => {
      if (cohortId) return group.cohortId === cohortId;
      if (programmeId) {
        return group.programmeId === programmeId || programmeCohortIds.has(group.cohortId);
      }
      return true;
    });
    return [
      { value: "", label: "All Groups" },
      ...list
        .filter((group) => !isHiddenFilterName(group.name))
        .map((group) => ({ value: group.id, label: group.name })),
    ];
  }, [programmeId, cohortId, groups, cohorts]);

  const moduleOptions = useMemo<FilterOption[]>(() => {
    return [
      { value: "", label: "All Modules" },
      ...scopedModules.map((module) => ({ value: module.id, label: module.name })),
    ];
  }, [scopedModules]);

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

  const dateLectures = useMemo(() => {
    const allowedModuleIds = new Set(moduleOptions.slice(1).map((option) => option.value));
    return lectures.filter((lecture) =>
      allowedModuleIds.has(lecture.moduleId)
      && (!moduleId || lecture.moduleId === moduleId)
      && lecture.sessionDate === date,
    );
  }, [moduleId, moduleOptions, lectures, date]);

  // A module with one live session on the date is unambiguous, so its register
  // can be viewed and corrected without requiring another lecture click.
  const attendanceTargetLecture = selectedLecture
    ?? (dateLectures.length === 1 ? dateLectures[0] : null);
  const attendanceTargetKey = attendanceTargetLecture
    ? `${attendanceTargetLecture.id}:${attendanceTargetLecture.moduleCatalogueId}:${attendanceTargetLecture.sessionDate}` : '';
  const currentAttendanceTarget = useRef(attendanceTargetKey);
  currentAttendanceTarget.current = attendanceTargetKey;
  const ambiguousTarget = Boolean(attendanceTargetLecture && lectures.filter(lecture =>
    lecture.moduleCatalogueId === attendanceTargetLecture.moduleCatalogueId && lecture.sessionDate === attendanceTargetLecture.sessionDate,
  ).length > 1);

  const addAttendanceLectures = useMemo(
    () => lectures
      .filter((lecture) => scopedModules.some((module) => module.id === lecture.moduleId))
      .map((lecture) => ({
        id: lecture.id,
        name: lecture.name,
        moduleName: lecture.moduleName || "Module",
        moduleCatalogueId: lecture.moduleCatalogueId,
        sessionDate: lecture.sessionDate,
      })),
    [lectures, scopedModules],
  );

  const pickerLectures = useMemo(() => {
    if (!moduleId) return addAttendanceLectures;
    const moduleLectureIds = new Set(lectures.filter(lecture => lecture.moduleId === moduleId).map(lecture => lecture.id));
    return addAttendanceLectures.filter(lecture => moduleLectureIds.has(lecture.id));
  }, [addAttendanceLectures, lectures, moduleId]);

  const handleDateChange = useCallback((nextDate: string, nextLectureId = "") => {
    setDate(nextDate);
    setLectureId(nextLectureId);
    setSelectedIds([]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (!date) {
      setDayMembership(null);
      setDayError(null);
      setDayLoading(false);
      return () => controller.abort();
    }
    setDayLoading(true);
    setDayError(null);
    setDayMembership(null);
    void fetchBulkAttendanceDayLearners(date, controller.signal)
      .then((ids) => {
        if (!controller.signal.aborted) setDayMembership({ date, ids: new Set(ids) });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setDayError(
          reason instanceof Error ? reason.message : "Unable to load attendance for this date.",
        );
      })
      .finally(() => { if (!controller.signal.aborted) setDayLoading(false); });
    return () => controller.abort();
  }, [date, kbcRecentVersion]);

  // Structured filters (Programme / Cohort / Module) applied on their own, so
  // the archive view can reuse them without the register search leaking in.
  const scopedLearners = useMemo(
    () =>
      learners.map((learner) => {
        const placement = scopeLearnersByEmail.get(rosterEmailFor(learner, scopeLearnersByEmail));
        return placement ? { ...learner, curriculumId: String(placement.id) } : learner;
      }).filter((learner) => {
        const hasScopeFilter = Boolean(programmeId || cohortId || groupId || moduleId || selectedLecture);
        if (hasScopeFilter) {
          if (!scopeLearnerEmails) return false;
          if (!scopeLearnerEmails.has(rosterEmailFor(learner, scopeLearnerEmails))) return false;
        }
        return !attendanceModeFilter || learner.attendanceMode === attendanceModeFilter;
      }),
    [programmeId, cohortId, groupId, moduleId, selectedLecture, scopeLearnerEmails, scopeLearnersByEmail, learners, attendanceModeFilter]
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
    () => filteredLearners.filter((learner) => !isArchived(learner)
      && (!date || (dayMembership?.date === date && Boolean(learner.kbcId && dayMembership.ids.has(learner.kbcId))))),
    [filteredLearners, isArchived, dayMembership, date]
  );

  const moduleKey = selectedLecture
    ? `${selectedLecture.moduleId}:${selectedLecture.id}`
    : moduleId || "general";
  const {
    loading: attendanceLoading,
    sourceError: attendanceSourceError,
    statuses,
    getStatus,
    setStatusForDate, dirty, pendingCount, pendingStatuses, save, undo,
    applySavedStatuses,
    replaceSavedStatusesForDate,
  } = useAttendance({
    learners: activeLearners,
    moduleKey,
    date: attendanceTargetLecture?.sessionDate || date,
  });
  // A slow roster must never block changing another filter. The current
  // selection is rendered immediately while only its learner results load.
  const pageLoading = dataLoading || attendanceLoading || dayLoading;
  const registerLoading = pageLoading || scopeRosterLoading;
  const liveDayReadKey = `${attendanceTargetKey}:${activeLearners.map(learner => learner.id).join('|')}`;

  const handleGridToggle = (learnerId: string, day: string) => {
    setRegisterSaveError(null);
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

  const handleMarkSelected = async (status: Extract<AttendanceStatus, "present" | "absent">, targetIds = selectedIds) => {
    if (targetIds.length === 0 || liveSaveLock.current) return;
    const target = attendanceTargetLecture;
    if (!target?.moduleCatalogueId) {
      setAddAttendanceError("Choose one live session, or a module with one live session on this date, before changing attendance.");
      setShowAddAttendanceDay(true);
      return;
    }
    liveSaveLock.current = true;
    const targetKey = attendanceTargetKey;
    setSavingLiveLearnerIds((current) => Array.from(new Set([...current, ...targetIds])));
    setLiveDayError(null);
    try {
      const sessionLearners = await learnersAssignedToLiveLecture(target);
      const targets = sessionLearners.filter(
        (learner) => targetIds.includes(learner.id) && Boolean(learner.kbcId),
      );
      if (!targets.length) {
        if (currentAttendanceTarget.current === targetKey) setLiveDayError("None of the selected learners is assigned to this live session.");
        return;
      }
      await createBulkAttendanceLiveDay({
        learnerIds: targets.map((learner) => learner.kbcId!),
        moduleCatalogueId: target.moduleCatalogueId,
        date: target.sessionDate,
        attendance: status,
      });
      if (currentAttendanceTarget.current === targetKey) applySavedStatuses(targets.map((learner) => learner.id), target.sessionDate, status);
      setKbcRecentVersion((version) => version + 1);
      setDetailHistoryVersion((version) => version + 1);
    } catch (reason) {
      if (currentAttendanceTarget.current === targetKey) setLiveDayError(
        reason instanceof Error ? reason.message : "Attendance could not be saved. Please try again.",
      );
    } finally {
      liveSaveLock.current = false;
      setSavingLiveLearnerIds((current) => current.filter((id) => !targetIds.includes(id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
    setShowActions(false);
  };

  useEffect(() => {
    const sessionDate = attendanceTargetLecture?.sessionDate || date;
    const moduleCatalogueId = attendanceTargetLecture?.moduleCatalogueId;
    if (!moduleCatalogueId) {
      setLiveDayRead({ key: '', loading: false, success: false });
      replaceSavedStatusesForDate(sessionDate, {});
      setLiveDayError(null);
      return undefined;
    }

    const controller = new AbortController();
    const readKey = `${attendanceTargetLecture?.id}:${moduleCatalogueId}:${sessionDate}:${activeLearners.map(learner => learner.id).join('|')}`;
    setLiveDayRead({ key: readKey, loading: true, success: false });
    setLiveDayError(null);
    replaceSavedStatusesForDate(sessionDate, {});
    void fetchBulkAttendanceLiveDayRecords(sessionDate, moduleCatalogueId, controller.signal)
      .then((records) => {
        if (controller.signal.aborted) return;
        const learnerIdByKbcId = new Map(
          activeLearners
            .filter((learner) => learner.kbcId)
            .map((learner) => [learner.kbcId!, learner.id]),
        );
        const nextStatuses: Record<string, AttendanceStatus> = {};
        records.forEach((record) => {
          const learnerId = learnerIdByKbcId.get(record.learnerId);
          if (learnerId) nextStatuses[learnerId] = record.attendance;
        });
        replaceSavedStatusesForDate(sessionDate, nextStatuses);
        setLiveDayRead({ key: readKey, loading: false, success: true });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setLiveDayError(
          reason instanceof Error
            ? reason.message
            : "Unable to load live-session attendance for this date.",
        );
      }).finally(() => {
        if (!controller.signal.aborted) setLiveDayRead(current => ({ ...current, loading: false }));
      });
    return () => controller.abort();
  }, [
    attendanceTargetLecture?.id,
    attendanceTargetLecture?.moduleCatalogueId,
    attendanceTargetLecture?.sessionDate,
    date,
    activeLearners,
    replaceSavedStatusesForDate,
  ]);

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
        const email = rosterEmailFor(learner, scopeLearnerEmails);
        const placement = scopeLearnersByEmail.get(email);
        const placementIsAmbiguous = Boolean(scopeLearnerEmails?.has(email) && !placement);
        const cohortName = placementIsAmbiguous
          ? "—"
          : placement
          ? (placement.cohortId ? cohortNameMap[String(placement.cohortId)] : "") || placement.cohort || "—"
          : cohortNameMap[learner.cohortId] ?? "—";
        const groupName = placementIsAmbiguous
          ? "—"
          : placement
          ? groupNameMap[placement.groupId] ?? "—"
          : groupNameMap[learner.groupId] ?? "—";
        return {
          learner,
          index,
          groupName,
          cohortName,
        };
      }),
    [cohortNameMap, groupNameMap, scopeLearnersByEmail, scopeLearnerEmails]
  );

  const rows = useMemo(() => buildRows(activeLearners), [activeLearners, buildRows]);
  const monthlyRows = useMemo(
    () => buildRows(filteredLearners.filter((learner) => !isArchived(learner))),
    [buildRows, filteredLearners, isArchived],
  );
  const monthlyModuleCatalogueIds = useMemo(() => {
    if (moduleId) {
      const selected = modules.find((module) => module.id === moduleId);
      return selected ? [selected.rosterId || selected.id] : [];
    }
    return scopedModules.map((module) => module.rosterId || module.id).filter(Boolean);
  }, [moduleId, modules, scopedModules]);
  const visibleRows = rows;
  const visibleLearners = useMemo(() => visibleRows.map((row) => row.learner), [visibleRows]);

  const handleToggleSelectAll = () => {
    setSelectedIds((previous) => {
      const visibleIds = visibleRows.map((row) => row.learner.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => previous.includes(id));
      if (allSelected) return previous.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...previous, ...visibleIds]));
    });
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

  const learnersAssignedToLiveLecture = useCallback(async (lecture: Lecture) => {
    if (!lecture.moduleCatalogueId) return [];
    const cacheKey = `module:${lecture.moduleCatalogueId}`;
    let assigned = rosterCache.current.get(cacheKey);
    if (!assigned) {
      const roster = await fetchCurriculumScopeLearnerRoster(
        "module",
        lecture.moduleCatalogueId,
        { learnerStatus: "all" },
        undefined,
        { timeoutMs: ROSTER_TIMEOUT_MS, compact: true },
      );
      assigned = roster.assignedLearners;
      rosterCache.current.set(cacheKey, assigned);
    }
    const sessionEmails = new Set(
      assigned.map((learner) => learner.email.trim().toLowerCase()).filter(Boolean),
    );
    return learners.filter((learner) =>
      !isArchived(learner) && sessionEmails.has(rosterEmailFor(learner, sessionEmails)),
    );
  }, [learners, isArchived]);

  const saveRegisterChanges = async () => {
    const entries = Object.entries(pendingStatuses)
      .filter(([, status]) => status === "present" || status === "absent");
    if (entries.length === 0) {
      save();
      return;
    }

    setRegisterSaving(true);
    setRegisterSaveError(null);
    try {
      const byDay = new Map<string, Array<[string, Extract<AttendanceStatus, "present" | "absent">]>>();
      entries.forEach(([key, status]) => {
        const separator = key.lastIndexOf(":");
        const learnerId = separator >= 0 ? key.slice(0, separator) : key;
        const day = separator >= 0 ? key.slice(separator + 1) : date;
        const list = byDay.get(day) ?? [];
        list.push([learnerId, status as Extract<AttendanceStatus, "present" | "absent">]);
        byDay.set(day, list);
      });

      for (const [day, changes] of byDay) {
        const dayLectures = lectures.filter((lecture) => lecture.sessionDate === day);
        const lecture = selectedLecture?.sessionDate === day
          ? selectedLecture
          : dayLectures.length === 1 ? dayLectures[0] : null;
        if (!lecture?.moduleCatalogueId) {
          throw new Error(
            dayLectures.length > 1
              ? `Choose one lecture for ${formatShortDate(day)} before saving attendance.`
              : "Choose a live session before saving attendance.",
          );
        }

        const assigned = await learnersAssignedToLiveLecture(lecture);
        const assignedById = new Map(assigned.map((learner) => [learner.id, learner]));
        for (const status of ["present", "absent"] as const) {
          const targets = changes
            .filter(([, nextStatus]) => nextStatus === status)
            .map(([learnerId]) => assignedById.get(learnerId))
            .filter((learner): learner is Learner => Boolean(learner?.kbcId));
          if (targets.length === 0) continue;
          await createBulkAttendanceLiveDay({
            learnerIds: targets.map((learner) => learner.kbcId!),
            moduleCatalogueId: lecture.moduleCatalogueId,
            date: day,
            attendance: status,
          });
        }
      }

      save();
      setKbcRecentVersion((version) => version + 1);
      setDetailHistoryVersion((version) => version + 1);
    } catch (reason) {
      setRegisterSaveError(
        reason instanceof Error ? reason.message : "Attendance could not be saved. Please try again.",
      );
    } finally {
      setRegisterSaving(false);
    }
  };

  const addAttendanceDay = async ({
    date: attendanceDate,
    lectureId: targetLectureId,
    status,
    scope,
  }: AddAttendanceDayValues) => {
    const targetLecture = lectures.find((lecture) => lecture.id === targetLectureId);
    if (!targetLecture?.moduleCatalogueId) {
      setAddAttendanceError("Choose a live session linked to a curriculum module first.");
      return;
    }

    setAddAttendanceSaving(true);
    setAddAttendanceError(null);
    try {
      const sessionLearners = await learnersAssignedToLiveLecture(targetLecture);
      const sourceLearners = scope === "selected"
        ? sessionLearners.filter((learner) => selectedIds.includes(learner.id))
        : sessionLearners;
      const targets = sourceLearners.filter((learner) => Boolean(learner.kbcId));
      if (targets.length === 0) {
        setAddAttendanceError(
          scope === "selected"
            ? "None of the selected learners is assigned to this live session."
            : "No active learners assigned to this live session have a KBC learner ID.",
        );
        return;
      }

      await createBulkAttendanceLiveDay({
        learnerIds: targets.map((learner) => learner.kbcId!),
        moduleCatalogueId: targetLecture.moduleCatalogueId,
        date: attendanceDate,
        attendance: status,
      });
      applySavedStatuses(targets.map((learner) => learner.id), attendanceDate, status);
      setDate(attendanceDate);
      setModuleId(targetLecture.moduleId);
      setLectureId(targetLecture.id);
      setShowAddAttendanceDay(false);
      setKbcRecentVersion((version) => version + 1);
      setDetailHistoryVersion((version) => version + 1);
    } catch (reason) {
      setAddAttendanceError(
        reason instanceof Error ? reason.message : "Attendance day could not be added. Please try again.",
      );
    } finally {
      setAddAttendanceSaving(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setKbcRecentError(null);
    // Last 4 is an attendance-record view. Load the merged database result so
    // the column never invents a date or status from the curriculum schedule;
    // the live register wins on dates covered by both sources.
    void fetchBulkAttendanceKbcRecent(controller.signal, { source: "all" })
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
      // Preserve the server's chronological order, including its tie-break
      // for multiple saved records on the same date.
      const databaseRecords = learner.kbcId ? kbcRecent[learner.kbcId] ?? [] : [];
      // Do not use curriculum lecture dates as placeholders here. A missing
      // attendance row is not a lecture record, so it must not appear as one
      // of the learner's last four database sessions.
      const recent = databaseRecords.slice(-4).map((record) => {
        const saved: AttendanceStatus = record.attendance ?? "unmarked";
        return {
          id: `${record.source}:${record.recordKey}`,
          name: `${record.lectureName || record.moduleName || "Lecture title not recorded"} (${record.source === "live" ? "Live register" : "KBC"})`,
          sessionDate: record.sessionDate,
          status: pendingEdits[`${record.source}:${record.recordKey}`]?.attendance ?? saved,
          editable: {
            source: record.source,
            recordKey: record.recordKey,
            attendance: record.attendance ?? ("unmarked" as AttendanceStatus),
          },
        };
      });
      const latestRecord = databaseRecords.at(-1);
      map[learner.id] = {
        name: latestRecord?.lectureName || latestRecord?.moduleName || selectedLecture?.name || "—",
        moduleName: latestRecord?.moduleName || "",
        date: latestRecord?.sessionDate || null,
        recent,
      };
    });
    return map;
  }, [activeLearners, selectedLecture, kbcRecent, pendingEdits]);

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

  const handlePdfExport = () => {
    const present = visibleRows.filter((row) => getStatus(row.learner.id, date) === "present").length;
    const absent = visibleRows.filter((row) => getStatus(row.learner.id, date) === "absent").length;
    const marked = present + absent;
    const scopeName = selectedLecture?.name
      || (moduleId ? moduleNameMap[moduleId] : "")
      || (groupId ? groupNameMap[groupId] : "")
      || (cohortId ? cohortNameMap[cohortId] : "")
      || (programmeId ? programmeNameMap[programmeId] : "")
      || "All learners";

    downloadAttendanceSummaryPdf({
      rows: visibleRows,
      entries: [{
        name: activeLectureLabel === "All Lectures" ? "Selected date" : activeLectureLabel,
        learners: visibleRows.length,
        present,
        absent,
        total: marked,
        rate: marked ? Math.round((present / marked) * 100) : 0,
      }],
      breakdownLabel: "Register",
      start: date,
      end: date,
      scopeLabel: scopeName,
      dayIsos: [date],
      getStatus,
    });
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
    // Details is the historical audit view: include both the legacy KBC rows
    // and the newer live-session register. The register's recent/current reads
    // stay live-only, but a learner's history must not lose older KBC records.
    void fetchBulkAttendanceKbcHistory(learnerId, controller.signal, {
      source: "all",
      email: historyRow.learner.email,
    })
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

  // History and Last 4 share the server's saved-record merge and ordering.
  // Today's curriculum cannot invalidate an older saved attendance record.
  const detailHistory = useMemo<LearnerHistoryRecord[]>(() => detailKbcHistory.map((record) => ({
      id: `${record.source}:${record.recordKey}`,
      recordKey: record.recordKey,
      sessionDate: record.sessionDate,
      moduleName: record.moduleName || "Module not recorded",
      lectureName: record.lectureName || record.moduleName || "Lecture title not recorded",
      attendance: record.attendance ?? ("unmarked" as AttendanceStatus),
      source: record.source,
  })), [detailKbcHistory]);
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
  const currentRegisterReady = Boolean(selectedLecture && attendanceTargetLecture?.moduleCatalogueId)
    && !ambiguousTarget && !registerLoading && !dataError && !scopeRosterError && !dirty
    && liveDayRead.key === liveDayReadKey && !liveDayRead.loading && liveDayRead.success;
  const currentCounts = visibleRows.reduce((counts, row) => {
    counts[getStatus(row.learner.id, date)] += 1;
    return counts;
  }, { present: 0, absent: 0, unmarked: 0 });

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Bulk Attendance" pageSubtitle="Record attendance across learners, cohorts and modules" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className={styles.page}>
      <main id="curriculum-bulk-attendance">
        <section className={styles.intro}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/workspace/curriculum">Curriculum</Link><AppIcon className="ri-arrow-right-s-line" /><span>Bulk Attendance</span></nav>
          <div className={styles.introLine}><div>
            <h1>{isArchiveView ? 'Learner archive' : 'Bulk attendance'}</h1>
            <p>Choose a live session, review its learners and record attendance. Saved history remains available in learner details.</p>
            <div className={styles.introTotals}><span className={styles.scopeBadge}>{dataLoading ? 'Loading learners...' : dataError ? 'Learner count unavailable' : `${activeLearners.length} learners in scope`}</span><span>Delivered-register total unavailable</span><span>Attendance-mark total unavailable</span><span>Sync time unavailable</span></div>
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
            {liveDayError && (
              <p className="mt-2 text-xs text-danger-600" role="alert">{liveDayError}</p>
            )}
            {dayError && (
              <div className="mt-2 flex items-center gap-2 text-xs text-danger-600" role="alert">
                <span>{dayError}</span>
                <button type="button" className="underline" onClick={() => setKbcRecentVersion((version) => version + 1)}>
                  Retry attendance date
                </button>
              </div>
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
              <p className="mt-2 text-xs text-foreground-500">Open View details to see this learner's saved attendance history.</p>
            )}
            {scopeRosterLoading && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-600" role="status">
                <i className="ri-loader-4-line animate-spin" />
                Loading learners for the selected filters. You can continue changing the filters while it loads.
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

          </div><div className={styles.introActions}>
            {(isArchiveView || tab !== 'daily') && <label className={styles.dateJump}><AppIcon className="ri-calendar-line" /><span>Jump to date</span><input type="date" aria-label="Jump to date" value={date} onChange={event => handleDateChange(event.target.value)} /></label>}
            <button type="button" disabled={dataLoading} onClick={() => { retryData(); setKbcRecentVersion(version => version + 1); }}><AppIcon className="ri-refresh-line" />Refresh</button>
            <button type="button" className={styles.archiveAction} onClick={() => setView(isArchiveView ? 'register' : 'archive')}><AppIcon className={isArchiveView ? 'ri-arrow-left-line' : 'ri-archive-line'} />{isArchiveView ? 'Back to register' : `Archived (${archivedTotal})`}</button>
          </div></div>
        </section>

        {!isArchiveView && (
            <div className={styles.toolbar}>
              <RegisterTabs active={tab} onChange={setTab} />
              <span className={styles.scopeCount}>{registerLoading ? 'Loading learners…' : dataError || scopeRosterError ? 'Learner scope unavailable' : `${visibleRows.length} learners in scope`}</span>
              <button
                type="button"
                onClick={() => {
                  setAddAttendanceError(null);
                  setShowAddAttendanceDay(true);
                }}
                disabled={dataLoading || scopeRosterLoading || !scopedLearners.some((learner) => !isArchived(learner))}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-primary-200 bg-background-50 px-4 py-2.5 text-sm font-semibold text-primary-700 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <i className="ri-calendar-event-line text-base" />
                Add attendance day
              </button>
            </div>
        )}
        {/* Compact filter toolbar — shared by the register and the archive. */}
        <details className={styles.filters} open>
          <summary>Filters</summary>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <FilterCard
              variant="compact"
              icon="ri-stack-line"
              label="Programme"
              value={programmeId}
              placeholder="All Programmes"
              options={[
                { value: "", label: "All Programmes" },
                ...programmes.filter((programme) => !isHiddenFilterName(programme.name)).map((programme) => ({
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
                const lecture = lectures.find((item) => item.id === value);
                if (lecture?.sessionDate) handleDateChange(lecture.sessionDate, value);
                else setLectureId(value);
              }}
            />
            <FilterCard
              variant="compact"
              icon="ri-checkbox-circle-line"
              label="Attendance mode"
              value={attendanceModeFilter}
              placeholder="All modes"
              options={[
                { value: "", label: "All modes" },
                { value: "live", label: "Live Sessions" },
                { value: "lazy", label: "Recorded" },
              ]}
              onChange={(value) => {
                setAttendanceModeFilter(value as "" | "live" | "lazy");
                setSelectedIds([]);
              }}
            />
          </div>
        </details>

        {isArchiveView ? (
          <section className="mt-5">
            <ArchiveView rows={archivedRows} onOpenHistory={setHistoryRow} />
          </section>
        ) : (
          <>

            {tab === "daily" && (
              <section className="mt-4 space-y-3">
                <SessionPicker sessions={pickerLectures} selectedId={selectedLecture?.id} date={date} loading={dataLoading} eligibleCount={currentRegisterReady ? visibleRows.length : null} markedCount={currentRegisterReady ? currentCounts.present + currentCounts.absent : null} onChange={handleDateChange} />
                <section className={styles.register}>
                <RegisterSummary title={`${date ? formatDateLabel(date) : 'All dates'}${selectedLecture ? ` - ${selectedLecture.name}` : ''}`} ready={currentRegisterReady} {...currentCounts} />
                {!currentRegisterReady && <p className={styles.registerNotice}>{ambiguousTarget ? 'More than one session shares this module and date. The current save workflow cannot distinguish them; use an existing saved history record for corrections.' : dirty ? 'Save or undo existing register changes before using the current-session controls.' : selectedLecture ? 'Waiting for a complete session roster and saved register. Resolve any loading errors before marking.' : 'Choose a session above to view and mark its register. Recent history can still be reviewed below.'}</p>}

                <div className={styles.registerToolbar}>
                  <SearchBar
                    value={query}
                    resultCount={visibleRows.length}
                    onChange={setQuery}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={styles.directoryButton} onClick={() => setShowLearnerDirectory(true)} disabled={pageLoading || activeLearners.length === 0} aria-label={`View all ${activeLearners.length} learners`}><AppIcon className="ri-user-line" />Directory</button>
                    {selectedIds.length > 0 && (
                      <span className="mr-1 text-sm text-foreground-500">
                        {selectedIds.length} selected
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleMarkSelected("present")}
                      disabled={registerLoading || savingLiveLearnerIds.length > 0 || selectedIds.length === 0}
                      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-green-300 bg-green-100 px-3 py-2 text-sm font-medium text-green-800 transition-colors hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <i className="ri-check-double-line" />
                      Mark selected present
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleMarkSelected("absent")}
                      disabled={registerLoading || savingLiveLearnerIds.length > 0 || selectedIds.length === 0}
                      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-red-300 bg-red-100 px-3 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <i className="ri-close-line" />
                      Mark selected absent
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowActions((prev) => !prev)}
                        disabled={registerLoading || visibleRows.length === 0}
                        aria-haspopup="menu"
                        aria-expanded={showActions}
                        className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <i className="ri-more-2-fill" />
                        Actions
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
                            className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-md border border-background-300 bg-background-50 py-1"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                handlePdfExport();
                                setShowActions(false);
                              }}
                              disabled={registerLoading || visibleRows.length === 0}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-foreground-800 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <i className="ri-file-pdf-2-line text-secondary-600" />
                              Export PDF
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                handleExport();
                                setShowActions(false);
                              }}
                              disabled={registerLoading || visibleRows.length === 0}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-foreground-800 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <i className="ri-file-excel-2-line text-secondary-600" />
                              Export CSV
                            </button>
                            <div className="my-1 border-t border-background-200" />
                            <button
                              type="button"
                              role="menuitem"
                              onClick={handleClearSelection}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-foreground-800 transition-colors hover:bg-background-100"
                            >
                              <i className="ri-eraser-line text-foreground-500" />
                              Clear selection
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <HighlightLegend
                  highlights={highlights}
                  learnerKeys={visibleRows.map((row) => highlightKey(row.learner))}
                />
                <AttendanceTable
                  rows={visibleRows}
                  loading={pageLoading}
                  selectedIds={selectedIds}
                  lectureInfo={lectureInfo}
                  onToggleSelect={handleToggleSelect}
                  onToggleSelectAll={handleToggleSelectAll}
                  onOpenHistory={setHistoryRow}
                  onToggleRecord={toggleRecord}
                  highlights={highlights}
                  onHighlightChange={setHighlight}
                  currentRegister={{ ready: currentRegisterReady, statuses, savingIds: savingLiveLearnerIds, onMark: (learnerId, status) => { void handleMarkSelected(status, [learnerId]); } }}
                />
                <p className={styles.registerNotice}>Bulk actions save selected learners assigned to the chosen session. Selection can include learners hidden by search. Individual buttons save immediately; recent-history corrections use the existing Save action.</p>
                </section>
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
                  loading={registerLoading}
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
                  loading={registerLoading}
                  getStatus={getStatus}
                  scopeLabel={exportScope}
                />
              </section>
            )}

            {tab === "highlights" && (
              <HighlightsTab
                rows={rows}
                loading={dataLoading || scopeRosterLoading}
                highlights={highlights}
                onHighlightChange={setHighlight}
              />
            )}
          </>
        )}
        <MonthlyGrid
          rows={monthlyRows}
          lectures={lectures}
          selectedLecture={selectedLecture}
          moduleCatalogueId={selectedLecture?.moduleCatalogueId
            || (moduleId ? modules.find((module) => module.id === moduleId)?.rosterId || moduleId : "")}
          groupId={groupId}
          moduleCatalogueIds={monthlyModuleCatalogueIds}
          date={date}
          active={!isArchiveView && tab === "monthly"}
          loading={dataLoading || scopeRosterLoading}
          onSaved={() => {
            setKbcRecentVersion((version) => version + 1);
            setDetailHistoryVersion((version) => version + 1);
          }}
        />
      </main>

      {!historyRow && (pendingEditCount > 0 || detailSaveError) && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-5">
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
            {registerSaveError && <p className="w-full text-sm text-red-700" role="alert">{registerSaveError}</p>}
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
                onClick={() => void saveRegisterChanges()}
                disabled={registerSaving}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 py-2 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <i className="ri-save-3-line" />
                {registerSaving ? "Saving…" : "Save changes"}
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
      {showAddAttendanceDay && (
        <AddAttendanceDayDialog
          initialDate={date}
          initialLectureId={selectedLecture?.sessionDate === date ? selectedLecture.id : ""}
          lectures={addAttendanceLectures}
          selectedCount={activeLearners.filter((learner) => selectedIds.includes(learner.id)).length}
          saving={addAttendanceSaving}
          error={addAttendanceError}
          onClose={() => {
            if (addAttendanceSaving) return;
            setShowAddAttendanceDay(false);
            setAddAttendanceError(null);
          }}
          onSave={(values) => void addAttendanceDay(values)}
        />
      )}
      </div>
    </WorkspaceShell>
  );
}
