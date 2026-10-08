import { coachFetch } from '@/lib/coachFetch';
import type { CoachAttendanceDetailsPayload, CoachAttendancePayload, CoachAttendanceRecord, CoachAttendanceSession, ManualAttendanceInput, SourceAttendanceInput } from '../types/attendance.types';

const OVERVIEW_ENDPOINT = '/coach_api/coach/attendance';
const DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';

export interface BulkSession { id: string; occurrenceStart: string; module: string; sessionTitle: string }
export interface BulkLearner { learnerId: string; status: 'present' | 'absent' | 'unmarked' | 'upcoming' | 'in_progress' | null; version: string }
export interface AttendanceGroupOption { id: string; name: string; cohort: string }
export interface AttendanceOptions { programmes: Array<{ id: string; name: string; groups: AttendanceGroupOption[] }> }
export interface AttendanceSessionOption { id: string; date: string; title: string; time: string; status: 'scheduled' | 'completed' }
export interface AttendanceRecent { date: string; status: 'present' | 'absent' }
export interface AttendanceGroupPayload {
  programme: { id: string; name: string }; group: AttendanceGroupOption;
  learners: Array<{ id: string; name: string; email: string | null; status: 'active' | 'on-break'; attendance: { rate: number | null; present: number; absent: number; sessions: number }; recent: AttendanceRecent[] }>;
}
export interface AttendanceContextPayload {
  programme: { id: string; name: string }; group: AttendanceGroupOption;
  learners: Array<{ id: string; name: string; email: string | null; status: 'active' | 'on-break'; recent: AttendanceRecent[] }>;
  sessions: Array<Omit<AttendanceSessionOption, 'status'>>;
}
async function attendanceRead<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await coachFetch(`/coach_api/coach/attendance/${path}`, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || 'Unable to load attendance.');
  return payload;
}
export const fetchAttendanceOptions = (signal?: AbortSignal) => attendanceRead<AttendanceOptions>('options', signal);
export const fetchAttendanceContext = (programmeId: string, groupId: string, signal?: AbortSignal) =>
  attendanceRead<AttendanceContextPayload>(`context?${new URLSearchParams({ programmeId, groupId })}`, signal);
export const fetchAttendanceGroup = (programmeId: string, groupId: string, signal?: AbortSignal) =>
  attendanceRead<AttendanceGroupPayload>(`group?${new URLSearchParams({ programmeId, groupId })}`, signal);
export const fetchAttendanceSessions = (programmeId: string, groupId: string, signal?: AbortSignal) =>
  attendanceRead<{ sessions: AttendanceSessionOption[] }>(`sessions?${new URLSearchParams({ programmeId, groupId })}`, signal);
export const fetchAttendanceSession = (programmeId: string, groupId: string, sessionId: string, signal?: AbortSignal) =>
  attendanceRead<{ learners: BulkLearner[]; warnings?: BulkAttendanceWarning[] }>(`session?${new URLSearchParams({ programmeId, groupId, sessionId })}`, signal);
export interface BulkAttendanceWarning { learnerProfileId: string; code: 'learner_source_unavailable'; message: string }
export interface BulkAttendanceResult extends BulkLearner { sessionOccurrenceId: string; attendanceRecord: CoachAttendanceRecord; recent: AttendanceRecent[] }
export class BulkAttendanceSaveError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BulkAttendanceSaveError';
    this.status = status;
  }
}
export async function fetchBulkAttendance(programmeId: string, groupId: string, sessionOccurrenceId = '', signal?: AbortSignal): Promise<{ sessions?: BulkSession[]; learners?: BulkLearner[]; warnings?: BulkAttendanceWarning[] }> {
  const query = new URLSearchParams({ programmeId, groupId, sessionOccurrenceId });
  const response = await coachFetch(`/coach_api/coach/attendance/bulk?${query}`, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || 'Unable to load session attendance.');
  return payload;
}

export async function saveBulkAttendance(programmeId: string, groupId: string, sessionOccurrenceId: string, records: Array<{ learnerId: string; status: 'present' | 'absent'; version: string }>): Promise<{ results: BulkAttendanceResult[] }> {
  const response = await coachFetch('/coach_api/coach/attendance/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ programmeId, groupId, sessionOccurrenceId, records }),
  });
  const payload = await response.json();
  if (!response.ok) throw new BulkAttendanceSaveError(response.status, response.status === 409
    ? payload.detail || 'Attendance changed since loading. Reload the session before applying your changes.'
    : 'Unable to save attendance. Your pending changes have been kept. Please retry.');
  return payload;
}

export async function fetchCoachAttendance(signal?: AbortSignal): Promise<CoachAttendancePayload> {
  const response = await coachFetch(OVERVIEW_ENDPOINT, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Attendance request failed with ${response.status}`);
  return response.json() as Promise<CoachAttendancePayload>;
}

export async function saveManualAttendance(input: ManualAttendanceInput, manualId?: string): Promise<CoachAttendanceSession> {
  const response = await coachFetch(`/coach_api/coach/attendance/manual${manualId ? `/${manualId}` : ''}`, {
    method: manualId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Unable to save the attendance record.');
  return response.json() as Promise<CoachAttendanceSession>;
}

export async function deleteManualAttendance(manualId: string): Promise<void> {
  const response = await coachFetch(`/coach_api/coach/attendance/manual/${manualId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Unable to delete the attendance record.');
}

export async function updateSourceAttendance(input: SourceAttendanceInput): Promise<void> {
  const response = await coachFetch('/coach_api/coach/attendance/source', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Unable to update the attendance record.');
}

export async function deleteSourceAttendance(input: Pick<SourceAttendanceInput, 'learnerId' | 'source' | 'sourceId'>): Promise<void> {
  const response = await coachFetch('/coach_api/coach/attendance/source', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Unable to delete the attendance record.');
}

export async function fetchCoachAttendanceDetails(learnerId: string, signal?: AbortSignal, page = 1, pageSize = 20): Promise<CoachAttendanceDetailsPayload> {
  const query = new URLSearchParams({ learner_id: learnerId, page: String(page), pageSize: String(pageSize) });
  const response = await coachFetch(`${DETAILS_ENDPOINT}?${query}`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error('Unable to load attendance sessions.');
  return response.json() as Promise<CoachAttendanceDetailsPayload>;
}

