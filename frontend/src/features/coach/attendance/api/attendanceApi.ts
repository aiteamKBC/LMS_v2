import { coachFetch } from '@/lib/coachFetch';
import type { CoachAttendanceDetailsPayload, CoachAttendancePayload, CoachAttendanceRecord, CoachAttendanceSession, ManualAttendanceInput, SourceAttendanceInput } from '../types/attendance.types';

const OVERVIEW_ENDPOINT = '/coach_api/coach/attendance';
const DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';

export interface BulkSession { id: string; occurrenceStart: string; module: string; sessionTitle: string }
export interface BulkLearner { learnerId: string; status: 'present' | 'absent' | 'unmarked' | 'upcoming' | 'in_progress'; version: string }
export interface BulkAttendanceWarning { learnerProfileId: string; code: 'learner_source_unavailable'; message: string }
export interface BulkAttendanceResult extends BulkLearner { sessionOccurrenceId: string; attendanceRecord: CoachAttendanceRecord }
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

export async function fetchCoachAttendanceDetails(learnerId: string, signal?: AbortSignal): Promise<CoachAttendanceDetailsPayload> {
  const query = new URLSearchParams({ learner_id: learnerId });
  const response = await coachFetch(`${DETAILS_ENDPOINT}?${query}`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error('Unable to load attendance sessions.');
  return response.json() as Promise<CoachAttendanceDetailsPayload>;
}

