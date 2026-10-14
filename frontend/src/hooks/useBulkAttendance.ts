import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBulkAttendanceKbcHistory,
  fetchBulkAttendanceLiveHistory,
  fetchBulkAttendanceLiveRecords,
  fetchBulkAttendanceRecords,
  type BulkAttendanceKbcHistoryRecord,
  type BulkAttendanceLiveHistoryRecord,
} from "@/api/bulkAttendanceLearners";
import type { AttendanceStatus, Learner, Lecture } from "@/types/bulkAttendance";

interface UseAttendanceParams {
  learners: Learner[];
  historyLearners?: Learner[];
  kbcHistoryModuleNames?: string[];
  moduleKey: string;
  date: string;
  selectedLecture: Lecture | null;
  selectedLectureIsUnique: boolean;
  scope: {
    programmeId: string;
    cohortId: string;
    groupId: string;
    moduleCatalogueId: string;
  };
}

interface UseAttendanceResult {
  loading: boolean;
  sourceError: string | null;
  liveHistory: BulkAttendanceLiveHistoryRecord[];
  kbcHistory: BulkAttendanceKbcHistoryRecord[];
  statuses: Record<string, AttendanceStatus>;
  getStatus: (learnerId: string, day: string) => AttendanceStatus;
  setStatus: (learnerId: string, status: AttendanceStatus) => void;
  setStatusForDate: (
    learnerId: string,
    day: string,
    status: AttendanceStatus
  ) => void;
  markAll: (status: AttendanceStatus) => void;
  markSelected: (learnerIds: string[], status: AttendanceStatus) => void;
  clearMarks: (learnerIds: string[]) => void;
  presentCount: number;
  absentCount: number;
  unmarkedCount: number;
  attendanceRate: number;
  dirty: boolean;
  pendingCount: number;
  save: () => void;
  undo: () => void;
  profileGetStatus: (learnerId: string, day: string) => AttendanceStatus;
  setProfileStatusForDate: (
    learnerId: string,
    day: string,
    status: AttendanceStatus
  ) => void;
  profileDirty: boolean;
  profilePendingCount: number;
  saveProfile: () => void;
  undoProfile: () => void;
}

/**
 * Loads attendance for the given learners/module/date, exposes a loading
 * flag so the UI can show skeletons while a filter is being applied, and lets
 * the caller read or set attendance for any learner on any date.
 *
 * Edits are staged as "pending" changes first, so the UI can offer Undo and
 * Save. New records remain unmarked until an attendance value is recorded.
 */
export function useAttendance({
  learners,
  historyLearners = learners,
  kbcHistoryModuleNames = [],
  moduleKey,
  date,
  selectedLecture,
  selectedLectureIsUnique,
  scope,
}: UseAttendanceParams): UseAttendanceResult {
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [liveHistory, setLiveHistory] = useState<BulkAttendanceLiveHistoryRecord[]>([]);
  const [kbcHistory, setKbcHistory] = useState<BulkAttendanceKbcHistoryRecord[]>([]);
  const [kbcHistoryLoading, setKbcHistoryLoading] = useState(true);
  const [kbcHistoryError, setKbcHistoryError] = useState<string | null>(null);
  const [kbcSourceLoading, setKbcSourceLoading] = useState(false);
  const [liveSourceLoading, setLiveSourceLoading] = useState(false);
  const [kbcSourceError, setKbcSourceError] = useState<string | null>(null);
  const [liveSourceError, setLiveSourceError] = useState<string | null>(null);
  const [kbcSourceStatuses, setKbcSourceStatuses] = useState<Record<string, AttendanceStatus | null>>({});
  const [liveSourceStatuses, setLiveSourceStatuses] = useState<Record<string, AttendanceStatus | null>>({});
  const [records, setRecords] = useState<Record<string, AttendanceStatus>>({});
  const [pending, setPending] = useState<Record<string, AttendanceStatus>>({});
  const [profilePending, setProfilePending] = useState<
    Record<string, AttendanceStatus>
  >({});

  const learnerIdsKey = useMemo(
    () => learners.map((learner) => learner.id).join(","),
    [learners]
  );
  const kbcIdsKey = useMemo(
    () => [...new Set(learners.map((learner) => learner.kbcId).filter((id): id is string => Boolean(id)))].join(","),
    [learners]
  );
  const historyKbcIdsKey = useMemo(
    () => [...new Set(historyLearners.map((learner) => learner.kbcId).filter((id): id is string => Boolean(id)))].join(","),
    [historyLearners]
  );
  const historyCurriculumIdsKey = useMemo(
    () => [...new Set(historyLearners
      .map((learner) => learner.curriculumId)
      .filter((id): id is string => Boolean(id)))].join(","),
    [historyLearners],
  );
  const kbcHistoryModuleNamesKey = useMemo(
    () => [...new Set(kbcHistoryModuleNames.map((name) => name.trim()).filter(Boolean))].join("\u001f"),
    [kbcHistoryModuleNames]
  );
  const selectedLectureId = selectedLecture?.id ?? "";
  const selectedLectureDate = selectedLecture?.sessionDate ?? "";
  const selectedLectureModuleCatalogueId = selectedLecture?.moduleCatalogueId ?? "";
  const selectedLectureName = selectedLecture?.name ?? "";
  const selectedLectureModuleName = selectedLecture?.moduleName ?? "";
  const selectedLectureModuleAliasesKey = selectedLecture?.moduleAliases?.join("\u001f") ?? "";

  useEffect(() => {
    const learnerProfileIds = historyCurriculumIdsKey.split(",").filter(Boolean);
    if (!learnerProfileIds.length) {
      setLiveHistory([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    setLiveHistory([]);
    void fetchBulkAttendanceLiveHistory({ learnerProfileIds }, controller.signal)
      .then((history) => {
        if (!controller.signal.aborted) setLiveHistory(history);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setHistoryError(reason instanceof Error
          ? reason.message
          : "Unable to load live-session attendance history.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [historyCurriculumIdsKey]);

  useEffect(() => {
    const learnerIds = historyKbcIdsKey.split(",").filter(Boolean);
    if (!learnerIds.length) {
      setKbcHistory([]);
      setKbcHistoryError(null);
      setKbcHistoryLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setKbcHistoryLoading(true);
    setKbcHistoryError(null);
    setKbcHistory([]);
    void fetchBulkAttendanceKbcHistory({
      date,
      learnerIds,
      moduleNames: kbcHistoryModuleNamesKey.split("\u001f").filter(Boolean),
    }, controller.signal)
      .then((history) => {
        if (!controller.signal.aborted) setKbcHistory(history);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setKbcHistoryError(reason instanceof Error
          ? reason.message
          : "Unable to load KBC attendance history.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setKbcHistoryLoading(false);
      });

    return () => controller.abort();
  }, [historyKbcIdsKey, date, kbcHistoryModuleNamesKey]);

  useEffect(() => {
    setLiveSourceStatuses({});
    setLiveSourceError(null);
    if (!selectedLectureId) {
      setLiveSourceLoading(false);
      return undefined;
    }
    if (!selectedLectureModuleCatalogueId) {
      setLiveSourceLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLiveSourceLoading(true);
    void fetchBulkAttendanceLiveRecords({
      date: selectedLectureDate,
      moduleCatalogueId: selectedLectureModuleCatalogueId,
    }, controller.signal)
      .then((records) => {
        if (controller.signal.aborted) return;
        setLiveSourceStatuses(Object.fromEntries(records.map((record) => [record.learnerProfileId, record.attendance])));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setLiveSourceError(reason instanceof Error
          ? reason.message
          : "Unable to load live-session attendance for the selected lecture.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLiveSourceLoading(false);
      });

    return () => controller.abort();
  }, [selectedLectureId, selectedLectureDate, selectedLectureModuleCatalogueId]);

  useEffect(() => {
    setKbcSourceStatuses({});
    setKbcSourceError(null);
    if (!selectedLectureId) {
      setKbcSourceLoading(false);
      return undefined;
    }
    const learnerIds = kbcIdsKey.split(",").filter(Boolean);
    if (!learnerIds.length) {
      setKbcSourceLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setKbcSourceLoading(true);
    void fetchBulkAttendanceRecords({
      date: selectedLectureDate,
      moduleNames: [...new Set([
        selectedLectureModuleName,
        ...selectedLectureModuleAliasesKey.split("\u001f"),
      ].filter(Boolean))],
      lectureName: selectedLectureName,
      learnerIds,
      includeUnlabelledLecture: selectedLectureIsUnique,
    }, controller.signal)
      .then((records) => {
        if (controller.signal.aborted) return;
        setKbcSourceStatuses(Object.fromEntries(records.map((record) => [record.learnerId, record.attendance])));
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setKbcSourceError(reason instanceof Error
          ? reason.message
          : "Unable to load KBC attendance for the selected lecture.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setKbcSourceLoading(false);
      });

    return () => controller.abort();
  }, [selectedLectureId, selectedLectureDate, selectedLectureName,
    selectedLectureModuleName, selectedLectureModuleAliasesKey, selectedLectureIsUnique, kbcIdsKey]);

  const sourceStatusFor = useCallback((learnerId: string, day: string): AttendanceStatus => {
    const learner = learners.find((item) => item.id === learnerId);
    const marks: Array<AttendanceStatus | null> = [];
    let hasAmbiguousMark = false;
    if (selectedLecture && day === selectedLecture.sessionDate
      && learner?.kbcId && Object.prototype.hasOwnProperty.call(kbcSourceStatuses, learner.kbcId)) {
      const mark = kbcSourceStatuses[learner.kbcId];
      if (mark === "present" || mark === "absent") marks.push(mark);
      else hasAmbiguousMark = true;
    }
    if (selectedLecture && day === selectedLecture.sessionDate
      && learner?.curriculumId && Object.prototype.hasOwnProperty.call(liveSourceStatuses, learner.curriculumId)) {
      const mark = liveSourceStatuses[learner.curriculumId];
      if (mark === "present" || mark === "absent") marks.push(mark);
      else hasAmbiguousMark = true;
    }

    const email = learner?.email.trim().toLowerCase() ?? "";
    const selectedModuleId = selectedLecture?.moduleCatalogueId || scope.moduleCatalogueId;
    const matchingHistory = liveHistory.filter((record) => {
      const belongsToLearner = learner?.curriculumId
        ? record.learnerProfileId === learner.curriculumId
        : Boolean(email && record.learnerEmail.trim().toLowerCase() === email);
      return belongsToLearner
        && record.sessionDate === day
        && (!selectedModuleId || record.moduleCatalogueId === selectedModuleId)
        && (!scope.programmeId || record.programmeId === scope.programmeId)
        && (!scope.cohortId || record.cohortId === scope.cohortId)
        && (!scope.groupId || record.groupId === scope.groupId);
    });
    matchingHistory.forEach((record) => {
      if (record.attendance === "present" || record.attendance === "absent") marks.push(record.attendance);
      else hasAmbiguousMark = true;
    });

    if (!selectedLecture && learner?.kbcId) {
      kbcHistory
        .filter((record) => record.learnerId === learner.kbcId && record.sessionDate === day)
        .forEach((record) => {
          if (record.attendance === "present" || record.attendance === "absent") marks.push(record.attendance);
          else hasAmbiguousMark = true;
        });
    }

    const distinctMarks = new Set(marks);
    if (hasAmbiguousMark || distinctMarks.size > 1) return "unmarked";
    const status = marks[0];
    return status === "present" || status === "absent" ? status : "unmarked";
  }, [learners, selectedLecture, scope, kbcSourceStatuses, liveSourceStatuses, liveHistory, kbcHistory]);

  useEffect(() => {
    if (!learnerIdsKey) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      setLoading(false);
    }, 620);
    return () => clearTimeout(timer);
  }, [date, moduleKey, learnerIdsKey, learners]);

  const getStatus = useCallback(
    (learnerId: string, day: string): AttendanceStatus => {
      const key = `${day}__${moduleKey}__${learnerId}`;
      return (
        pending[key] ??
        records[key] ??
        sourceStatusFor(learnerId, day)
      );
    },
    [pending, records, moduleKey, sourceStatusFor]
  );

  const statuses = useMemo(() => {
    const out: Record<string, AttendanceStatus> = {};
    learners.forEach((learner) => {
      out[learner.id] = getStatus(learner.id, date);
    });
    return out;
  }, [learners, getStatus, date]);

  const setStatus = useCallback(
    (learnerId: string, status: AttendanceStatus) => {
      setPending((prev) => ({
        ...prev,
        [`${date}__${moduleKey}__${learnerId}`]: status,
      }));
    },
    [date, moduleKey]
  );

  const setStatusForDate = useCallback(
    (learnerId: string, day: string, status: AttendanceStatus) => {
      setPending((prev) => ({
        ...prev,
        [`${day}__${moduleKey}__${learnerId}`]: status,
      }));
    },
    [moduleKey]
  );

  const markAll = useCallback(
    (status: AttendanceStatus) => {
      setPending((prev) => {
        const next = { ...prev };
        learners.forEach((learner) => {
          next[`${date}__${moduleKey}__${learner.id}`] = status;
        });
        return next;
      });
    },
    [date, moduleKey, learners]
  );

  const markSelected = useCallback(
    (learnerIds: string[], status: AttendanceStatus) => {
      setPending((prev) => {
        const next = { ...prev };
        learnerIds.forEach((learnerId) => {
          next[`${date}__${moduleKey}__${learnerId}`] = status;
        });
        return next;
      });
    },
    [date, moduleKey]
  );

  // Stage the given learners as "unmarked" on the current date/module, so
  // they sit outside the Present/Absent tallies until re-marked.
  const clearMarks = useCallback(
    (learnerIds: string[]) => {
      setPending((prev) => {
        const next = { ...prev };
        learnerIds.forEach((learnerId) => {
          next[`${date}__${moduleKey}__${learnerId}`] = "unmarked";
        });
        return next;
      });
    },
    [date, moduleKey]
  );

  const save = useCallback(() => {
    setRecords((prev) => ({ ...prev, ...pending }));
    setPending({});
  }, [pending]);

  const undo = useCallback(() => {
    setPending({});
  }, []);

  // The learner profile panel keeps its own staged edits, fully separate from
  // the register's batch, so each can be saved or undone on its own.
  const profileGetStatus = useCallback(
    (learnerId: string, day: string): AttendanceStatus => {
      const key = `${day}__${moduleKey}__${learnerId}`;
      return (
        profilePending[key] ??
        records[key] ??
        sourceStatusFor(learnerId, day)
      );
    },
    [profilePending, records, moduleKey, sourceStatusFor]
  );

  const setProfileStatusForDate = useCallback(
    (learnerId: string, day: string, status: AttendanceStatus) => {
      setProfilePending((prev) => ({
        ...prev,
        [`${day}__${moduleKey}__${learnerId}`]: status,
      }));
    },
    [moduleKey]
  );

  const saveProfile = useCallback(() => {
    setRecords((prev) => ({ ...prev, ...profilePending }));
    setProfilePending({});
  }, [profilePending]);

  const undoProfile = useCallback(() => {
    setProfilePending({});
  }, []);

  const profilePendingCount = Object.keys(profilePending).length;

  const presentCount = useMemo(
    () => learners.filter((learner) => statuses[learner.id] === "present").length,
    [learners, statuses]
  );

  const absentCount = useMemo(
    () => learners.filter((learner) => statuses[learner.id] === "absent").length,
    [learners, statuses]
  );

  const unmarkedCount = learners.length - presentCount - absentCount;

  // Rate is measured against marked learners only, so clearing a mark never
  // drags the rate down as if the learner were absent.
  const markedCount = presentCount + absentCount;
  const attendanceRate = markedCount
    ? Math.round((presentCount / markedCount) * 100)
    : 0;

  const pendingCount = Object.keys(pending).length;

  return {
    loading: loading || historyLoading || kbcHistoryLoading || kbcSourceLoading || liveSourceLoading,
    sourceError: [historyError, kbcHistoryError, kbcSourceError, liveSourceError].filter(Boolean).join(" ") || null,
    liveHistory,
    kbcHistory,
    statuses,
    getStatus,
    setStatus,
    setStatusForDate,
    markAll,
    markSelected,
    clearMarks,
    presentCount,
    absentCount,
    unmarkedCount,
    attendanceRate,
    dirty: pendingCount > 0,
    pendingCount,
    save,
    undo,
    profileGetStatus,
    setProfileStatusForDate,
    profileDirty: profilePendingCount > 0,
    profilePendingCount,
    saveProfile,
    undoProfile,
  };
}
