import type { LearnerKind } from './learnerDetail';
import type { LearnerAttendance } from './learnerAttendance';
import { invalidateLearnerReads, peekLearnerJson, readLearnerJson } from './learnerRead';

export type LectureStatus = 'completed' | 'late' | 'absent' | 'upcoming' | 'in_progress' | 'pending';
export interface LectureActivity {
  id: string; title: string; type: string; completed: boolean;
  href?: string; groupId?: number; activityId?: number;
}
export interface AttendanceLecture {
  id: string; sessionId: string; reportId: string; date: string; title: string;
  moduleId: string; module: string; source: 'kbc-attendance' | 'microsoft-teams';
  startTime: string; endTime: string; durationMinutes: number | null;
  startsAt?: string | null; endsAt?: string | null; joinUrl?: string;
  tutor?: string; coach?: string; attendanceConfirmed?: boolean; creditedMinutes?: number | null;
  contentSummary: string; ksbs: string[]; activities: LectureActivity[];
  ksbScope?: 'lecture' | 'activities' | 'module' | null;
  status: LectureStatus; catchupStatus: 'completed' | 'pending' | null;
  rawAttendanceStatus?: string;
  effectiveAttendanceStatus?: string;
  effectiveAttendance?: 0 | 1 | null;
  finalOutcome?: string;
  updatedAt: string | null; canReportAbsence: boolean; excused?: boolean;
  absenceReport: { id: number; status: string } | null;
  monthlyLog?: { month: string; sourceRef: string };
}
export interface AttendanceMode {
  available: boolean; mode: 'live' | 'lazy'; requestedMode: 'lazy' | null;
  status: string; emailSent: boolean; managerAvailable: boolean;
  remindersEnabled: boolean; updatedAt: string | null;
  plannedLiveHours?: number; plannedRecordedHours?: number;
  unmappedPlannedLectures?: number;
}
export interface AttendanceWorkspace {
  timeZone?: string;
  csrfToken?: string;
  lectures: AttendanceLecture[];
  totals: { total: number; attended: number; absent: number; covered: number; upcoming: number; attendanceRate: number | null };
  summary: LearnerAttendance | null;
  modules: { id: string; title: string }[];
  mode: AttendanceMode;
  recentActivity: { id: string; title: string; at: string; type: string }[];
}
const url = (kind: LearnerKind, id: string) => `/learner_api/attendance/${kind}/${id}/lectures/`;
export const peekAttendanceWorkspace = (kind: LearnerKind, id: string) => peekLearnerJson<AttendanceWorkspace>(url(kind, id));
export function fetchAttendanceWorkspace(kind: LearnerKind, id: string, signal?: AbortSignal, fresh = false) {
  return readLearnerJson<AttendanceWorkspace>(url(kind, id), { ttlMs: 30_000, signal, revalidate: fresh });
}
export async function confirmAttendance(kind: LearnerKind, id: string, lectureId: string): Promise<{
  lectureId: string; status: 'completed'; creditedMinutes: number; creditedHours: number; alreadyRecorded: boolean;
}> {
  const workspace = peekAttendanceWorkspace(kind, id) || await fetchAttendanceWorkspace(kind, id);
  if (!workspace.csrfToken) throw new Error('Please refresh the page before recording attendance.');
  const response = await fetch(`/learner_api/attendance/${kind}/${id}/attend/`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': workspace.csrfToken },
    body: JSON.stringify({ lectureId }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'Could not save attendance. Refresh the page and try again.');
  if (result?.lectureId !== lectureId || result?.status !== 'completed' ||
      !Number.isFinite(result?.creditedMinutes) || result.creditedMinutes <= 0 || !Number.isFinite(result?.creditedHours)) {
    throw new Error('Attendance could not be confirmed. Please refresh the page and try again.');
  }
  invalidateLearnerReads();
  return result;
}
export async function updateAttendanceMode(kind: LearnerKind, id: string, mode: 'live' | 'lazy'): Promise<AttendanceMode> {
  const response = await fetch(`/learner_api/attendance/${kind}/${id}/mode/`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ mode }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not update attendance mode.');
  invalidateLearnerReads();
  return result;
}
