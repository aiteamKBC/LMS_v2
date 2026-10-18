import { coachFetch } from '@/lib/coachFetch';

export interface BulkAttendanceDirectoryLearner {
  id: string;
  name: string;
  email: string;
  programme: string;
  group: string;
  endDate: string;
  kbcStatus?: string;
  /** LMS enrolment status when the learner is enrolled, otherwise kbcStatus. */
  status?: string;
  statusSource?: 'enrolment' | 'kbc';
}

export interface BulkAttendanceKbcHistoryRecord {
  recordKey: string;
  learnerId: string;
  sessionDate: string;
  moduleName: string;
  lectureName: string;
  sessionNumber: number | null;
  attendance: 'present' | 'absent' | null;
  /** 'kbc' = kbc_attendance; 'live' = LMS live-session register. */
  source: 'kbc' | 'live';
}

export interface BulkAttendanceRecentResult {
  recent: Record<string, BulkAttendanceKbcHistoryRecord[]>;
  /** Set when one source could not be read and the result is partial. */
  warnings: string[];
}

export interface BulkAttendanceHistoryResult {
  records: BulkAttendanceKbcHistoryRecord[];
  warnings: string[];
}

function warningsFrom(payload: { warnings?: unknown }): string[] {
  return Array.isArray(payload.warnings)
    ? payload.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
}

export interface BulkAttendanceDirectoryResult {
  learners: BulkAttendanceDirectoryLearner[];
  /** Set when enrolment statuses could not be read and KBC statuses are shown. */
  warnings: string[];
}

export async function fetchBulkAttendanceLearners(signal?: AbortSignal): Promise<BulkAttendanceDirectoryResult> {
  const response = await coachFetch('/curriculum_api/curriculum/bulk-attendance/learners/', { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load the learner directory.');
  }
  if (!Array.isArray(payload.learners)) {
    throw new Error('The learner directory returned an invalid response.');
  }
  return { learners: payload.learners, warnings: warningsFrom(payload) };
}

export interface BulkAttendanceChange {
  source: 'kbc' | 'live';
  recordKey: string;
  attendance: 'present' | 'absent';
}

export interface BulkAttendanceLiveDayInput {
  learnerIds: string[];
  moduleCatalogueId: string;
  date: string;
  attendance: 'present' | 'absent';
}

export interface BulkAttendanceLiveDayRecord {
  recordKey: string;
  learnerId: string;
  moduleCatalogueId: string;
  occurrenceId: string;
  attendance: 'present' | 'absent';
}

/** Thrown when a save failed; `saved` lists record keys that were saved before it failed. */
export class BulkAttendanceSaveError extends Error {
  readonly saved: string[];

  constructor(message: string, saved: string[] = []) {
    super(message);
    this.name = 'BulkAttendanceSaveError';
    this.saved = saved;
  }
}

/** Save present/absent corrections to KBC history and live-register records. */
export async function saveBulkAttendanceChanges(changes: BulkAttendanceChange[]): Promise<string[]> {
  const response = await coachFetch('/curriculum_api/curriculum/bulk-attendance/attendance/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new BulkAttendanceSaveError(
      payload.error || 'Attendance could not be saved. Please try again.',
      Array.isArray(payload.updated) ? payload.updated : [],
    );
  }
  if (!Array.isArray(payload.updated)) {
    throw new BulkAttendanceSaveError('Saving attendance returned an invalid response.');
  }
  return payload.updated;
}

/** Add or correct an outcome for an existing LMS live-session occurrence. */
export async function createBulkAttendanceLiveDay(
  input: BulkAttendanceLiveDayInput,
): Promise<{ created: number; updated: number }> {
  const response = await coachFetch('/curriculum_api/curriculum/bulk-attendance/live-day/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Attendance day could not be added. Please try again.');
  }
  if (!Number.isInteger(payload.created) || !Number.isInteger(payload.updated)) {
    throw new Error('Adding attendance returned an invalid response.');
  }
  return { created: payload.created, updated: payload.updated };
}

/** Read saved register outcomes for one live-session module and local date. */
export async function fetchBulkAttendanceLiveDayRecords(
  date: string,
  moduleCatalogueId: string,
  signal?: AbortSignal,
): Promise<BulkAttendanceLiveDayRecord[]> {
  const query = new URLSearchParams({ date, module_catalogue_id: moduleCatalogueId });
  const response = await coachFetch(
    `/curriculum_api/curriculum/bulk-attendance/live-day-records/?${query}`,
    { signal },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load live-session attendance for this date.');
  }
  if (!Array.isArray(payload.records)) {
    throw new Error('Live-session attendance returned an invalid response.');
  }
  return payload.records.filter((record): record is BulkAttendanceLiveDayRecord =>
    record
    && typeof record === 'object'
    && typeof record.recordKey === 'string'
    && typeof record.learnerId === 'string'
    && typeof record.moduleCatalogueId === 'string'
    && typeof record.occurrenceId === 'string'
    && (record.attendance === 'present' || record.attendance === 'absent'),
  );
}

/** Each learner's last four marked lectures (KBC + live register), oldest first, keyed by KBC id. */
export async function fetchBulkAttendanceKbcRecent(signal?: AbortSignal): Promise<BulkAttendanceRecentResult> {
  const response = await coachFetch('/curriculum_api/curriculum/bulk-attendance/kbc-recent/', { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load recent KBC attendance.');
  }
  if (!payload.recent || typeof payload.recent !== 'object' || Array.isArray(payload.recent)) {
    throw new Error('Recent KBC attendance returned an invalid response.');
  }
  return { recent: payload.recent, warnings: warningsFrom(payload) };
}

export async function fetchBulkAttendanceKbcHistory(
  learnerId: string,
  signal?: AbortSignal,
): Promise<BulkAttendanceHistoryResult> {
  if (!learnerId) return { records: [], warnings: [] };
  const query = new URLSearchParams({ learner_id: learnerId });
  const response = await coachFetch(`/curriculum_api/curriculum/bulk-attendance/kbc-history/?${query}`, { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load KBC attendance history.');
  }
  if (!Array.isArray(payload.records)) {
    throw new Error('The KBC attendance history returned an invalid response.');
  }
  return { records: payload.records, warnings: warningsFrom(payload) };
}
