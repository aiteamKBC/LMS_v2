import { coachFetch } from '@/lib/coachFetch';
import type { CoachAttendanceDetailsPayload, CoachAttendancePayload, CoachAttendanceSession, ManualAttendanceInput, SourceAttendanceInput } from '../types/attendance.types';

const OVERVIEW_ENDPOINT = '/coach_api/coach/attendance';
const DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';

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

