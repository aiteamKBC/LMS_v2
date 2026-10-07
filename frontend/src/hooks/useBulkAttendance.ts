import { useCallback, useEffect, useMemo, useState } from "react";
import type { AttendanceStatus, Learner } from "@/types/bulkAttendance";

interface UseAttendanceParams {
  learners: Learner[];
  moduleKey: string;
  date: string;
}

interface UseAttendanceResult {
  loading: boolean;
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
  moduleKey,
  date,
}: UseAttendanceParams): UseAttendanceResult {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<Record<string, AttendanceStatus>>({});
  const [pending, setPending] = useState<Record<string, AttendanceStatus>>({});
  const [profilePending, setProfilePending] = useState<
    Record<string, AttendanceStatus>
  >({});

  const learnerIdsKey = useMemo(
    () => learners.map((learner) => learner.id).join(","),
    [learners]
  );

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
        "unmarked"
      );
    },
    [pending, records, moduleKey]
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
        "unmarked"
      );
    },
    [profilePending, records, moduleKey]
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
    loading,
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
