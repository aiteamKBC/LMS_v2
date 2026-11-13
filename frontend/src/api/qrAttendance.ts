export interface QRModule { id: string; title: string; group: string; cohort: string }
export interface QRLecture {
  id: string; moduleId: string; title: string; startsAt: string; endsAt: string | null;
  group: string; cohort: string; current: boolean;
  matchingModuleIds?: string[];
}
export interface QRConfiguration { csrfToken: string; url: string; timeZone: string; serverNow: string }
export interface QRConfirmation { recorded: boolean; alreadyRecorded: boolean; confirmedAt: string; message: string }
export interface QRLookup {
  modules: QRModule[];
  suggestions: QRLecture[];
  // Optional during a rolling frontend/backend update. Null means no clear match.
  selection?: { moduleId: string | null; occurrenceId: string | null };
  moduleCandidates?: string[];
  otherGroupLectures?: QRLecture[];
}

const BASE = '/curriculum_api/qr-attendance/';

async function request<T>(init?: RequestInit): Promise<T> {
  const result = await fetch(BASE, { credentials: 'same-origin', cache: 'no-store', ...init });
  const body = await result.json().catch(() => null);
  if (!result.ok || !body) throw new Error(body?.error || 'Attendance is temporarily unavailable. Please try again.');
  return body as T;
}

function post<T>(csrf: string, payload: Record<string, string>) {
  return request<T>({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }, body: JSON.stringify(payload) });
}

export const qrAttendanceApi = {
  configuration: () => request<QRConfiguration>(),
  lookup: (csrf: string, email: string) => post<QRLookup>(csrf, { action: 'lookup', email }),
  lectures: (csrf: string, email: string, moduleId: string) => post<{ lectures: QRLecture[]; suggestedOccurrenceId?: string | null }>(csrf, { action: 'lectures', email, moduleId }),
  confirm: (csrf: string, email: string, moduleId: string, occurrenceId: string) => post<QRConfirmation>(csrf, { action: 'confirm', email, moduleId, occurrenceId }),
};
