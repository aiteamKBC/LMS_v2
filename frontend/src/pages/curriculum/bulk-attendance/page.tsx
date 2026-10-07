import { useCallback, useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/feature/WorkspaceShell";
import { curriculumNavItems } from "@/mocks/navigation";
import type { AttendanceStatus, Learner, Lecture } from "@/types/bulkAttendance";
import { useAttendance } from "@/hooks/useBulkAttendance";
import { useBulkAttendanceData } from "@/hooks/useBulkAttendanceData";
import { useArchivedLearners } from "@/hooks/useArchivedBulkLearners";
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
import LearnerHistoryModal from "./components/LearnerHistoryModal";
import LearnerDirectoryModal from "./components/LearnerDirectoryModal";
import ArchiveDialog from "./components/ArchiveDialog";
import ArchiveView from "./components/ArchiveView";
import ConfirmDialog from "./components/ConfirmDialog";

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
  } = useBulkAttendanceData();
  const [programmeId, setProgrammeId] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [lectureId, setLectureId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<RegisterTab>("daily");
  const [historyLearnerId, setHistoryLearnerId] = useState<string | null>(null);
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

  const { manualIds, restoredIds, archiveMany, restoreMany } =
    useArchivedLearners();

  const today = useMemo(() => todayIso(), []);

  // A learner is archived when the user archived them by hand, or once their
  // enrolment end date has passed â€” unless they were explicitly restored.
  const isArchived = useCallback(
    (learner: Learner) =>
      !restoredIds.includes(learner.id) &&
      (manualIds.includes(learner.id) || isPastEndDate(learner.endDate, today)),
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

  const groupOptions = useMemo<FilterOption[]>(() => {
    let list = groups;
    if (cohortId) {
      list = groups.filter((group) => group.cohortId === cohortId);
    } else if (programmeId) {
      const cohortIds = cohorts
        .filter((cohort) => cohort.programmeId === programmeId)
        .map((cohort) => cohort.id);
      list = groups.filter((group) => cohortIds.includes(group.cohortId));
    }
    return [
      { value: "", label: "All Groups" },
      ...list.map((group) => ({ value: group.id, label: group.name })),
    ];
  }, [programmeId, cohortId, groups, cohorts]);

  const moduleOptions = useMemo<FilterOption[]>(() => {
    const list = programmeId
      ? modules.filter((module) => module.programmeId === programmeId)
      : modules;
    return [
      { value: "", label: "All Modules" },
      ...list.map((module) => ({ value: module.id, label: module.name })),
    ];
  }, [programmeId, modules]);

  const lectureOptions = useMemo<FilterOption[]>(() => {
    const list = moduleId
      ? lectures.filter((lecture) => lecture.moduleId === moduleId)
      : lectures;
    return [
      { value: "", label: "All Lectures" },
      ...list.map((lecture) => ({
        value: lecture.id,
        label: `${lecture.name} â€” ${formatShortDate(lecture.sessionDate)}`,
      })),
    ];
  }, [moduleId, lectures]);

  const selectedLecture = useMemo(
    () => lectures.find((lecture) => lecture.id === lectureId) ?? null,
    [lectureId, lectures]
  );

  // Structured filters (Programme / Cohort / Group) applied on their own, so
  // the archive view can reuse them without the register search leaking in.
  const scopedLearners = useMemo(
    () =>
      learners.filter((learner) => {
        if (programmeId && learner.programmeId !== programmeId) return false;
        if (cohortId && learner.cohortId !== cohortId) return false;
        if (groupId && learner.groupId !== groupId) return false;
        return true;
      }),
    [programmeId, cohortId, groupId, learners]
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

  const moduleKey = moduleId || "general";

  const {
    loading: attendanceLoading,
    statuses,
    getStatus,
    setStatus,
    setStatusForDate,
    markSelected,
    clearMarks,
    presentCount,
    absentCount,
    unmarkedCount,
    attendanceRate,
    dirty,
    pendingCount,
    save,
    undo,
    profileGetStatus,
    setProfileStatusForDate,
    profileDirty,
    profilePendingCount,
    saveProfile,
    undoProfile,
  } = useAttendance({ learners: activeLearners, moduleKey, date });
  const loading = dataLoading || attendanceLoading;

  const handleSetStatus = (learnerId: string, status: AttendanceStatus) => {
    setStatus(learnerId, status);
  };

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

  const handleToggleSelectAll = () => {
    setSelectedIds((prev) => {
      const visibleIds = activeLearners.map((learner) => learner.id);
      const allSelected =
        visibleIds.length > 0 && visibleIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...prev, ...visibleIds]));
    });
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

  const groupNameMap = useMemo(
    () => Object.fromEntries(groups.map((group) => [group.id, group.name])),
    [groups]
  );
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

  const buildRows = useCallback(
    (list: typeof learners): AttendanceRow[] =>
      list.map((learner, index) => ({
        learner,
        index,
        groupName: groupNameMap[learner.groupId] ?? "â€”",
        cohortName: cohortNameMap[learner.cohortId] ?? "â€”",
      })),
    [groupNameMap, cohortNameMap]
  );

  const rows = useMemo(() => buildRows(activeLearners), [activeLearners, buildRows]);

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
      let name = "â€”";
      let lectureDate: string | null = null;
      if (selectedLecture) {
        name = selectedLecture.name;
        lectureDate = selectedLecture.sessionDate;
      } else if (pool.length > 0) {
        const latest = pool[pool.length - 1];
        name = latest.name;
        lectureDate = latest.sessionDate;
      }
      const recent = pool.slice(-4).map((lecture) => ({
        id: lecture.id,
        name: lecture.name,
        sessionDate: lecture.sessionDate,
        status: getStatus(learner.id, lecture.sessionDate),
      }));
      map[learner.id] = { name, date: lectureDate, recent };
    });
    return map;
  }, [activeLearners, learnerLectureList, selectedLecture, date, getStatus]);

  const weekDays = useMemo(() => getWeekDays(date), [date]);

  const weekLabel = useMemo(() => {
    const fmt = (value: Date) =>
      value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const start = new Date(`${weekDays[0].iso}T00:00:00`);
    const end = new Date(`${weekDays[6].iso}T00:00:00`);
    return `${fmt(start)} â€“ ${fmt(end)}`;
  }, [weekDays]);

  const handleExport = () => {
    const header = [
      "Learner",
      "Email",
      "Programme",
      "Cohort",
      "Group",
      "Module",
      "Lecture",
      "Date",
      "Status",
    ];
    const body = activeLearners.map((learner) => [
      learner.name,
      learner.email,
      programmeNameMap[learner.programmeId] ?? "",
      cohortNameMap[learner.cohortId] ?? "",
      groupNameMap[learner.groupId] ?? "",
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

  const historyRow = useMemo(
    () => rows.find((row) => row.learner.id === historyLearnerId) ?? null,
    [rows, historyLearnerId]
  );

  const historyLectureNames = useMemo(() => {
    if (!historyRow) return {};
    const map: Record<string, string> = {};
    learnerLectureList(historyRow.learner).forEach((lecture) => {
      map[lecture.sessionDate] = lecture.name;
    });
    return map;
  }, [historyRow, learnerLectureList]);

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
                  <span className="mx-2 text-foreground-300">â€¢</span>
                  Restore anyone to bring them back
                </>
              ) : (
                <>
                  {formatDateLabel(date)}
                  <span className="mx-2 text-foreground-300">â€¢</span>
                  {activeModuleLabel}
                  {selectedLecture && (
                    <>
                      <span className="mx-2 text-foreground-300">â€¢</span>
                      {selectedLecture.name} â€”{" "}
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
              <p className="mt-2 text-xs text-danger-600">{dataError}</p>
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
                onChange={(event) => setDate(event.target.value)}
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

        {/* Compact filter toolbar â€” shared by the register and the archive. */}
        <section className="mt-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
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
              }}
            />
            <FilterCard
              variant="compact"
              icon="ri-community-line"
              label="Group"
              value={groupId}
              placeholder="All Groups"
              options={groupOptions}
              onChange={setGroupId}
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
              onChange={setLectureId}
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
                  total={learners.length}
                  present={loading ? 0 : presentCount}
                  absent={loading ? 0 : absentCount}
                  unmarked={loading ? 0 : unmarkedCount}
                  rate={loading ? 0 : attendanceRate}
                  onLearnersClick={() => setShowLearnerDirectory(true)}
                />

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <SearchBar
                    value={query}
                    resultCount={activeLearners.length}
                    onChange={setQuery}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-sm text-foreground-500">
                      {loading
                        ? "Loading learnersâ€¦"
                        : selectedIds.length > 0
                        ? `${selectedIds.length} selected`
                        : `${activeLearners.length} learners`}
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
                      disabled={loading || activeLearners.length === 0}
                      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 py-2 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <i className="ri-download-2-line" />
                      Export CSV
                    </button>
                  </div>
                </div>

                <AttendanceTable
                  rows={rows}
                  statuses={statuses}
                  loading={loading}
                  selectedIds={selectedIds}
                  lectureInfo={lectureInfo}
                  onSetStatus={handleSetStatus}
                  onToggleSelect={handleToggleSelect}
                  onToggleSelectAll={handleToggleSelectAll}
                  onOpenHistory={(learner) => setHistoryLearnerId(learner.id)}
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
                      <span className="mx-2 text-foreground-300">â€¢</span>
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
          groupName={historyRow.groupName}
          cohortName={historyRow.cohortName}
          moduleLabel={activeModuleLabel}
          anchorDate={date}
          lectureNameByDate={historyLectureNames}
          getStatus={profileGetStatus}
          onToggleStatus={(day, status) =>
            setProfileStatusForDate(historyRow.learner.id, day, status)
          }
          dirty={profileDirty}
          pendingCount={profilePendingCount}
          onSave={saveProfile}
          onUndo={undoProfile}
          onClose={() => setHistoryLearnerId(null)}
        />
      )}

      {showLearnerDirectory && (
        <LearnerDirectoryModal
          learners={learners}
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
