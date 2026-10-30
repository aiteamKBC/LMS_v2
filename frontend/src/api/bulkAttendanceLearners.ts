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
  /** LMS enrolment email for the same KBC id, sent only when it differs from `email`. */
  lmsEmail?: string;
  /** Saved learner delivery mode; learners without a saved preference are live. */
  attendanceMode?: 'live' | 'lazy';
}

export interface BulkAttendanceKbcHistoryRecord {
  recordKey: string;
  learnerId: string;
  sessionDate: string;
  moduleName: string;
  lectureName: string;
  sessionNumber: number | null;
  attendance: 'present' | 'absent' | null;
  occurrenceId?: string;
  /** Display credit from an equivalent group delivery; raw attendance remains editable. */
  effectiveAttendance?: 'present';
  recoveryOccurrenceId?: string;
  makeupForOccurrenceId?: string;
  makeupForDate?: string;
  countsAsSession?: boolean;
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

export interface BulkAttendanceHistoryReadOptions {
  /** Read only the LMS live-session register, excluding legacy KBC rows. */
  source?: 'live' | 'all';
  /** Directory email used only when a legacy KBC row has an older learner ID. */
  email?: string;
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
  occurrenceId?: string;
}

export interface BulkAttendanceLiveDayRecord {
  recordKey: string;
  learnerId: string;
  moduleCatalogueId: string;
  occurrenceId: string;
  attendance: 'present' | 'absent';
  effectiveAttendance?: 'present';
  countsAsSession?: boolean;
}

export interface BulkAttendanceMonthOccurrence {
  id: string;
  date: string;
  sessionNumber: number;
  moduleCatalogueId: string;
  moduleTitle: string;
}

export interface BulkAttendanceMonthRecord {
  recordKey: string;
  occurrenceId: string;
  moduleCatalogueId: string;
  learnerId: string;
  attendance: 'present' | 'absent';
  effectiveAttendance?: 'present';
  countsAsSession?: boolean;
}

export interface BulkAttendanceMonthResult {
  occurrences: BulkAttendanceMonthOccurrence[];
  records: BulkAttendanceMonthRecord[];
}

/** Saved KBC/live attendance rows for the selected calendar month. */
export async function fetchBulkAttendanceKbcMonthRecords(
  month: string,
  learnerIds: string[] = [],
  signal?: AbortSignal,
): Promise<BulkAttendanceKbcHistoryRecord[]> {
  const query = new URLSearchParams({ month });
  const ids = [...new Set(learnerIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length) query.set("learner_ids", ids.join(","));
  const response = await coachFetch(
    `/curriculum_api/curriculum/bulk-attendance/kbc-month-records/?${query}`,
    { signal },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Unable to load monthly KBC attendance.");
  if (!Array.isArray(payload.records) || !payload.records.every((record: BulkAttendanceKbcHistoryRecord) =>
    record && typeof record === "object"
    && typeof record.recordKey === "string"
    && typeof record.learnerId === "string"
    && /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(record.sessionDate)
    && typeof record.moduleName === "string"
    && typeof record.lectureName === "string"
    && (record.sessionNumber === null || Number.isInteger(record.sessionNumber))
    && (record.attendance === null || record.attendance === "present" || record.attendance === "absent")
    && (record.source === "kbc" || record.source === "live"),
  )) {
    throw new Error("Monthly KBC attendance returned an invalid response.");
  }
  return payload.records.map((record: BulkAttendanceKbcHistoryRecord) => ({
    ...record,
    sessionDate: record.sessionDate.slice(0, 10),
  }));
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

/** Read a module or group's scheduled live occurrences and saved marks for a calendar month. */
export async function fetchBulkAttendanceLiveMonthRecords(
  month: string,
  moduleCatalogueId: string,
  signal?: AbortSignal,
  groupId?: string,
  moduleCatalogueIds: string[] = [],
): Promise<BulkAttendanceMonthResult> {
  const query = new URLSearchParams({ month });
  if (moduleCatalogueId) query.set('module_catalogue_id', moduleCatalogueId);
  if (groupId) query.set('group_id', groupId);
  const requestedModuleIds = [...new Set(moduleCatalogueIds.map((value) => value.trim()).filter(Boolean))];
  if (requestedModuleIds.length) query.set('module_catalogue_ids', requestedModuleIds.join(','));
  const response = await coachFetch(
    `/curriculum_api/curriculum/bulk-attendance/live-month-records/?${query}`,
    { signal },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to load monthly attendance.');
  if (!Array.isArray(payload.occurrences) || !Array.isArray(payload.records)
    || !payload.occurrences.every((item: BulkAttendanceMonthOccurrence) =>
      item && typeof item.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
      && Number.isInteger(item.sessionNumber) && typeof item.moduleCatalogueId === 'string'
      && typeof item.moduleTitle === 'string')
    || !payload.records.every((item: BulkAttendanceMonthRecord) =>
      item && typeof item.recordKey === 'string' && typeof item.occurrenceId === 'string'
      && typeof item.moduleCatalogueId === 'string' && typeof item.learnerId === 'string'
      && (item.attendance === 'present' || item.attendance === 'absent'))) {
    throw new Error('Monthly attendance returned an invalid response.');
  }
  return { occurrences: payload.occurrences, records: payload.records };
}

/** Learners with any saved KBC or live attendance on this exact calendar day. */
export async function fetchBulkAttendanceDayLearners(date: string, signal?: AbortSignal): Promise<string[]> {
  const query = new URLSearchParams({ date });
  const response = await coachFetch(`/curriculum_api/curriculum/bulk-attendance/day-learners/?${query}`, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to load attendance for this date.');
  if (payload.date !== date || !Array.isArray(payload.learnerIds)
    || !payload.learnerIds.every((id: unknown) => typeof id === 'string')) {
    throw new Error('Attendance for this date returned an invalid response.');
  }
  return payload.learnerIds;
}

/** Each learner's last four saved attendance lectures, oldest first, keyed by KBC id. */
export async function fetchBulkAttendanceKbcRecent(
  signal?: AbortSignal,
  options: BulkAttendanceHistoryReadOptions = { source: 'live' },
): Promise<BulkAttendanceRecentResult> {
  const query = options.source ? `?source=${encodeURIComponent(options.source)}` : '';
  const response = await coachFetch(`/curriculum_api/curriculum/bulk-attendance/kbc-recent/${query}`, { signal });
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
  options: BulkAttendanceHistoryReadOptions = { source: 'live' },
): Promise<BulkAttendanceHistoryResult> {
  if (!learnerId) return { records: [], warnings: [] };
  const query = new URLSearchParams({ learner_id: learnerId });
  if (options.source) query.set('source', options.source);
  if (options.email?.trim()) query.set('learner_email', options.email.trim());
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
