import type { LearnerKind } from '@/api/learnerDetail';

const BASE = '/learner_api/absence-reports';

export interface LearnerAbsenceReport {
  id: number;
  reference: string;
  sessionTitle: string;
  sessionDate: string;
  sessionTime: string;
  reasonCategory: string;
  reason: string;
  status: string;
  evidenceProvided: boolean;
  evidenceKind: string;
  evidenceUrl: string;
  evidenceText: string;
  coachNote: string;
  attendanceRate: number | null;
  previousAbsences: number;
  createdAt: string;
  updatedAt: string;
}

export interface MissedAttendanceSession {
  id: string;
  sessionId: string;
  title: string;
  sessionType: string;
  dateIso: string;
  startTime: string;
  endTime: string;
  coach: string;
  module: string;
}

export interface AbsenceReportData {
  count: number;
  results: LearnerAbsenceReport[];
  missedSessions: MissedAttendanceSession[];
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`The server returned an invalid response (${response.status}).`);
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data
      ? String((data as { error?: string }).error)
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchAbsenceReports(kind: LearnerKind, learnerId: string): Promise<AbsenceReportData> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${kind}/${learnerId}/`);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  return parseResponse<AbsenceReportData>(response);
}

export async function submitAbsenceReport(
  kind: LearnerKind,
  learnerId: string,
  form: FormData,
): Promise<LearnerAbsenceReport> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${kind}/${learnerId}/`, { method: 'POST', body: form });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }
  return parseResponse<LearnerAbsenceReport>(response);
}
