import { coachFetch } from '@/lib/coachFetch';
import type { CoachAttendanceDetailsPayload, CoachAttendancePayload } from '../types/attendance.types';

const OVERVIEW_ENDPOINT = '/coach_api/coach/attendance';
const DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';

export async function fetchCoachAttendance(signal?: AbortSignal): Promise<CoachAttendancePayload> {
  const response = await coachFetch(OVERVIEW_ENDPOINT, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Attendance request failed with ${response.status}`);
  return response.json() as Promise<CoachAttendancePayload>;
}

export async function fetchCoachAttendanceDetails(learnerId: string): Promise<CoachAttendanceDetailsPayload> {
  const query = new URLSearchParams({ learner_id: learnerId });
  const response = await coachFetch(`${DETAILS_ENDPOINT}?${query}`);
  if (!response.ok) throw new Error('Unable to load attendance sessions.');
  return response.json() as Promise<CoachAttendanceDetailsPayload>;
}

