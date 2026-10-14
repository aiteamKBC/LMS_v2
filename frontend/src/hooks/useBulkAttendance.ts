import { useCallback, useMemo, useState } from "react";
import type { AttendanceStatus, Learner } from "@/types/bulkAttendance";

interface UseAttendanceParams {
  learners: Learner[];
  moduleKey: string;
  date: string;
}

interface UseAttendanceResult {
  loading: boolean;
  sourceError: string | null;
  statuses: Record<string, AttendanceStatus>;
  getStatus: (learnerId: string, day: string) => AttendanceStatus;
  setStatus: (learnerId: string, status: AttendanceStatus) => void;
  setStatusForDate: (learnerId: string, day: string, status: AttendanceStatus) => void;
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
  setProfileStatusForDate: (learnerId: string, day: string, status: AttendanceStatus) => void;
  profileDirty: boolean;
  profilePendingCount: number;
  saveProfile: () => void;
  undoProfile: () => void;
}

function keyFor(learnerId: string, day: string): string {
  return `${learnerId}:${day}`;
}

/**
 * Keeps the new register's unsaved, in-browser marks separate from the KBC
 * history API. Historical attendance is read only and is loaded only when the
 * user opens one learner's details.
 */
export function useAttendance({ learners, date }: UseAttendanceParams): UseAttendanceResult {
  const [records, setRecords] = useState<Record<string, AttendanceStatus>>({});
  const [pending, setPending] = useState<Record<string, AttendanceStatus>>({});
  const [profilePending, setProfilePending] = useState<Record<string, AttendanceStatus>>({});

  const getStatus = useCallback((learnerId: string, day: string): AttendanceStatus => {
    const key = keyFor(learnerId, day);
    return pending[key] ?? records[key] ?? "unmarked";
  }, [pending, records]);

  const setStatusForDate = useCallback((learnerId: string, day: string, status: AttendanceStatus) => {
    setPending((current) => ({ ...current, [keyFor(learnerId, day)]: status }));
  }, []);

  const setStatus = useCallback((learnerId: string, status: AttendanceStatus) => {
    setStatusForDate(learnerId, date, status);
  }, [date, setStatusForDate]);

  const markAll = useCallback((status: AttendanceStatus) => {
    setPending((current) => ({
      ...current,
      ...Object.fromEntries(learners.map((learner) => [keyFor(learner.id, date), status])),
    }));
  }, [date, learners]);

  const markSelected = useCallback((learnerIds: string[], status: AttendanceStatus) => {
    setPending((current) => ({
      ...current,
      ...Object.fromEntries(learnerIds.map((learnerId) => [keyFor(learnerId, date), status])),
    }));
  }, [date]);

  const clearMarks = useCallback((learnerIds: string[]) => {
    markSelected(learnerIds, "unmarked");
  }, [markSelected]);

  const statuses = useMemo(() => Object.fromEntries(
    learners.map((learner) => [learner.id, getStatus(learner.id, date)]),
  ), [date, getStatus, learners]);

  const presentCount = useMemo(
    () => Object.values(statuses).filter((status) => status === "present").length,
    [statuses],
  );
  const absentCount = useMemo(
    () => Object.values(statuses).filter((status) => status === "absent").length,
    [statuses],
  );
  const unmarkedCount = learners.length - presentCount - absentCount;
  const attendanceRate = presentCount + absentCount
    ? Math.round((presentCount / (presentCount + absentCount)) * 100)
    : 0;

  const save = useCallback(() => {
    setRecords((current) => ({ ...current, ...pending }));
    setPending({});
  }, [pending]);
  const undo = useCallback(() => setPending({}), []);

  const profileGetStatus = useCallback((learnerId: string, day: string) => {
    const key = keyFor(learnerId, day);
    return profilePending[key] ?? records[key] ?? "unmarked";
  }, [profilePending, records]);
  const setProfileStatusForDate = useCallback((learnerId: string, day: string, status: AttendanceStatus) => {
    setProfilePending((current) => ({ ...current, [keyFor(learnerId, day)]: status }));
  }, []);
  const saveProfile = useCallback(() => {
    setRecords((current) => ({ ...current, ...profilePending }));
    setProfilePending({});
  }, [profilePending]);
  const undoProfile = useCallback(() => setProfilePending({}), []);

  return {
    loading: false,
    sourceError: null,
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
    dirty: Object.keys(pending).length > 0,
    pendingCount: Object.keys(pending).length,
    save,
    undo,
    profileGetStatus,
    setProfileStatusForDate,
    profileDirty: Object.keys(profilePending).length > 0,
    profilePendingCount: Object.keys(profilePending).length,
    saveProfile,
    undoProfile,
  };
}
