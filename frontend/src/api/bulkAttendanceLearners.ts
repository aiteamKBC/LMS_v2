import { coachFetch } from '@/lib/coachFetch';

export interface BulkAttendanceDirectoryLearner {
  id: string;
  name: string;
  email: string;
  programme: string;
  group: string;
  endDate: string;
}

export interface BulkAttendanceRecord {
  learnerId: string;
  attendance: 'present' | 'absent' | null;
}

export interface BulkAttendanceKbcHistoryRecord extends BulkAttendanceRecord {
  recordKey?: string;
  sessionDate: string;
  moduleName: string;
  lectureName: string;
  sessionNumber: number | null;
}

export interface BulkAttendanceLiveRecord {
  learnerProfileId: string;
  attendance: 'present' | 'absent' | null;
}

export interface BulkAttendanceLiveHistoryRecord extends BulkAttendanceLiveRecord {
  attendanceId: string;
  learnerEmail: string;
  occurrenceId: string;
  liveSessionId: string;
  sessionNumber: number;
  sessionDate: string;
  moduleCatalogueId: string;
  moduleTitle: string;
  programmeId: string;
  programmeName: string;
  cohortId: string;
  cohortName: string;
  groupId: string;
  groupName: string;
}

export async function fetchBulkAttendanceLearners(signal?: AbortSignal): Promise<BulkAttendanceDirectoryLearner[]> {
  const response = await coachFetch('/curriculum_api/curriculum/bulk-attendance/learners/', { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load the learner directory.');
  }
  if (!Array.isArray(payload.learners)) {
    throw new Error('The learner directory returned an invalid response.');
  }
  return payload.learners;
}

export async function fetchBulkAttendanceRecords(options: {
  date: string;
  moduleNames: string[];
  lectureName: string;
  learnerIds: string[];
  includeUnlabelledLecture?: boolean;
}, signal?: AbortSignal): Promise<BulkAttendanceRecord[]> {
  if (options.learnerIds.length === 0) return [];
  const query = new URLSearchParams();
  query.set('date', options.date);
  options.moduleNames.filter(Boolean).forEach((moduleName) => query.append('module_names', moduleName));
  query.set('lecture_name', options.lectureName);
  query.set('learner_ids', options.learnerIds.join(','));
  if (options.includeUnlabelledLecture) query.set('include_unlabelled', 'true');
  const response = await coachFetch(`/curriculum_api/curriculum/bulk-attendance/records/?${query}`, { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load attendance records for this lecture.');
  }
  if (!Array.isArray(payload.records)) {
    throw new Error('The attendance lookup returned an invalid response.');
  }
  return payload.records;
}

export async function fetchBulkAttendanceKbcHistory(options: {
  date?: string;
  learnerIds: string[];
  moduleNames: string[];
  allHistory?: boolean;
}, signal?: AbortSignal): Promise<BulkAttendanceKbcHistoryRecord[]> {
  if (options.learnerIds.length === 0) return [];
  const query = new URLSearchParams({
    learner_ids: options.learnerIds.join(','),
  });
  if (options.date) query.set('date', options.date);
  if (options.allHistory) query.set('all_history', 'true');
  options.moduleNames.filter(Boolean).forEach((moduleName) => query.append('module_names', moduleName));
  const response = await coachFetch(`/curriculum_api/curriculum/bulk-attendance/kbc-history/?${query}`, { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load KBC attendance history.');
  }
  if (!Array.isArray(payload.records)) {
    throw new Error('The KBC attendance history returned an invalid response.');
  }
  return payload.records;
}

export async function fetchBulkAttendanceLiveRecords(options: {
  date: string;
  moduleCatalogueId: string;
}, signal?: AbortSignal): Promise<BulkAttendanceLiveRecord[]> {
  if (!options.moduleCatalogueId) return [];
  const query = new URLSearchParams({
    date: options.date,
    module_catalogue_id: options.moduleCatalogueId,
  });
  const response = await coachFetch(`/curriculum_api/curriculum/bulk-attendance/live-records/?${query}`, { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load live-session attendance for this lecture.');
  }
  if (!Array.isArray(payload.records)) {
    throw new Error('The live-session attendance lookup returned an invalid response.');
  }
  return payload.records;
}

export async function fetchBulkAttendanceLiveHistory(options: {
  learnerProfileIds?: string[];
  learnerEmail?: string;
}, signal?: AbortSignal): Promise<BulkAttendanceLiveHistoryRecord[]> {
  const query = new URLSearchParams();
  const learnerProfileIds = [...new Set(options.learnerProfileIds?.filter(Boolean) ?? [])];
  if (learnerProfileIds.length > 0) query.set('learner_profile_ids', learnerProfileIds.join(','));
  if (options.learnerEmail?.trim()) query.set('learner_email', options.learnerEmail.trim());
  if (![...query.keys()].length) return [];
  const response = await coachFetch(`/curriculum_api/curriculum/bulk-attendance/live-history/?${query}`, { signal });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load live-session attendance history.');
  }
  if (!Array.isArray(payload.records)) {
    throw new Error('The live-session history lookup returned an invalid response.');
  }
  return payload.records;
}

async function patchAttendanceRecord(
  path: string,
  body: Record<string, string>,
): Promise<{ attendance: 'present' | 'absent' }> {
  const response = await coachFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to save the attendance update.');
  }
  if (!payload.record || (payload.record.attendance !== 'present' && payload.record.attendance !== 'absent')) {
    throw new Error('The attendance update returned an invalid response.');
  }
  return payload.record;
}

export function updateBulkAttendanceKbcRecord(options: {
  recordKey: string;
  attendance: 'present' | 'absent';
}): Promise<{ attendance: 'present' | 'absent' }> {
  return patchAttendanceRecord(
    '/curriculum_api/curriculum/bulk-attendance/kbc-record-status/',
    options,
  );
}

export function updateBulkAttendanceLiveRecord(options: {
  occurrenceId: string;
  learnerProfileId: string;
  attendance: 'present' | 'absent';
}): Promise<{ attendance: 'present' | 'absent' }> {
  return patchAttendanceRecord(
    '/curriculum_api/curriculum/bulk-attendance/live-record-status/',
    options,
  );
}
