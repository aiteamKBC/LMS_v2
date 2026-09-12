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
  contentSummary: string; ksbs: string[]; activities: LectureActivity[];
  ksbScope?: 'lecture' | 'activities' | 'module' | null;
  status: LectureStatus; catchupStatus: 'completed' | 'pending' | null;
  updatedAt: string | null; canReportAbsence: boolean;
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
