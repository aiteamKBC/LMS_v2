import { learningFetch } from '@/lib/personalLearning';
import { coachFetch } from '@/lib/coachFetch';
import { createCachedResource } from './cachedRequest';
import { withCallerSignal } from './learnerRead';

export type RecordingState = 'ready' | 'pending' | 'failed' | 'missing' | 'unavailable' | 'unlinked';
export interface CoachingMedia {
  state: RecordingState;
  readyCount: number;
  recordings: { id: string; state: RecordingState; startsAt?: string | null; endsAt?: string | null;
    source?: 'microsoft' | null }[];
}
export interface CoachingSessionDetails {
  eventKey: string;
  reference?: string;
  media: CoachingMedia;
  partial: boolean;
  evidence?: SavedCoachingEvidence;
  attendance: {
    state: 'available' | 'pending' | 'unavailable';
    reportCount: number;
    syncedAt?: string | null;
    source?: 'coaching-session';
    rows: { name?: string; displayName?: string; email?: string; role?: string; status?: string; totalAttendanceSeconds?: number; expected?: boolean }[];
  };
}

export interface SavedCoachingEvidence {
  metadataOnly?: boolean;
  completion?: { state: 'action-required' | 'completed' | 'awaiting-signature' | 'unverified' | 'unavailable' | 'mixed'; source: 'aptem'; checkedAt?: string };
  state: 'matched' | 'not-found' | 'ambiguous' | 'unavailable';
  source: 'coaching-session';
  analysisState?: 'matched' | 'not-found' | 'ambiguous' | 'unavailable';
  transcriptCheck?: { state: 'available' | 'missing' | 'unavailable'; code: string };
  transcript: { content?: string; partCount?: number; durationSeconds: number | null; updatedAt: string | null; source?: 'lms' | 'microsoft' } | null;
  analyses: { id: string; learnerName: string; type: string; status: string; report?: unknown; reportAvailable?: boolean; updatedAt: string | null;
    sourceSessionId?: string | null }[];
}

export interface CoachingMeeting {
  meetingId?: string;
  calendarEventId: string;
  coachEmail: string;
  eventKey: string | null;
  candidateEventKeys: string[];
  learnerIds: string[];
  family: 'MCM' | 'PR' | 'SUPPORT' | null;
  category?: 'MCM' | 'PR' | 'SUPPORT' | 'OTHER' | 'LECTURE';
  categorySource?: 'lms-booking' | 'calendar-title' | 'curriculum' | 'other';
  title?: string;
  cancellationSources?: ('microsoft' | 'lms')[];
  analysisContext?: string;
  recordingsReference?: string;
  startsAt: string;
  endsAt: string;
  phase: 'cancelled' | 'ended' | 'upcoming' | 'in-progress';
  match: 'matched' | 'mismatch' | 'ambiguous' | 'candidate' | 'external';
  media: CoachingMedia;
  readyToAction: boolean;
}
export interface CoachingCalendar {
  start: string;
  end: string;
  timeZone: string;
  scope: 'all' | 'own';
  coaches: { email: string; name: string }[];
  learners: { id: string; name: string; coachEmail: string; learnerType: string | null }[];
  meetings: CoachingMeeting[];
  lmsOnly: { eventKey: string; learnerId: string; coachEmail: string; startsAt: string; endsAt: string }[];
  cancelledBookings: { eventKey: string; learnerId: string; coachEmail: string; family: 'MCM' | 'PR' | 'SUPPORT';
    startsAt: string | null; endsAt: string | null; recordUpdatedAt: string | null;
    dateBasis: 'session' | 'record-updated'; sources: ['lms'] }[];
  errors: { coachEmail: string; code: string; invalidEvents?: number; retryable?: boolean }[];
  partial: boolean;
  coverage: { checkedCoachEmails: string[]; totalCoaches: number; nextOffset: number | null };
  sync?: { pending: boolean; pendingCalendars: number; pendingEvidence: number; lastSuccessfulAt: string | null;
    initialPendingCalendars?: number; initialPendingEvidence?: number;
    directoryHash: string; directoryUnchanged: boolean; version?: string };
}
export interface CoachingCalendarQuery {
  start: string; end: string; timeZone: string; coachEmail?: string; learnerId?: string;
}

export interface CoachingBooking {
  eventKey: string;
  eventType: string;
  sequence: number;
  status: string;
  syncState: string;
  cancelled: boolean;
  targetDate: string | null;
  scheduledDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  reviewCompletedAt: string | null;
  periodBasis: 'session' | 'scheduled-date' | 'target' | 'record-updated';
  recordUpdatedAt: string | null;
}
export interface CoachLearners {
  coach: { email: string; name: string };
  scope: 'all' | 'own';
  source: 'lms';
  start: string;
  end: string;
  timeZone: string;
  search: string;
  learners: { id: string; name: string; learnerType: string | null; bookings: CoachingBooking[] }[];
  coverage: { offset: number; totalLearners: number; nextOffset: number | null };
}
export interface CoachLearnersQuery extends CoachingCalendarQuery {
  coachEmail: string;
  offset?: number;
  search?: string;
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalInstant = (value: unknown) => value === null || instant(value);
const optionalDay = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));

export async function loadCoachLearners(query: CoachLearnersQuery, signal?: AbortSignal): Promise<CoachLearners> {
  const offset = query.offset ?? 0;
  const search = query.search?.trim() ?? '';
  const params = new URLSearchParams({ start: query.start, end: query.end, timeZone: query.timeZone,
    coachEmail: query.coachEmail, offset: String(offset), limit: '50', search });
  const response = await learningFetch(`/coach_api/coaching-recordings/learners?${params}`, {
    credentials: 'include', cache: 'no-store', signal,
  });
  if (response.status === 401 || response.status === 403) {
    const error = new Error('You do not have access to these coach learners.');
    error.name = 'CoachingLearnersAccessError';
    throw error;
  }
  const data: unknown = await response.json();
  if (!response.ok) throw new Error('Coach learners and saved bookings could not be loaded. Please retry.');
  if (!object(data) || !object(data.coach) || data.coach.email !== query.coachEmail.trim().toLowerCase()
    || typeof data.coach.name !== 'string' || !['all', 'own'].includes(String(data.scope)) || data.source !== 'lms'
    || data.start !== query.start || data.end !== query.end || data.timeZone !== query.timeZone || data.search !== search
    || !Array.isArray(data.learners) || !data.learners.every(row => object(row) && typeof row.id === 'string'
      && typeof row.name === 'string' && (row.learnerType === null || typeof row.learnerType === 'string')
      && Array.isArray(row.bookings) && row.bookings.every(item => object(item) && typeof item.eventKey === 'string'
        && typeof item.eventType === 'string' && Number.isInteger(item.sequence) && Number(item.sequence) > 0
        && typeof item.status === 'string' && typeof item.syncState === 'string' && typeof item.cancelled === 'boolean'
        && optionalDay(item.targetDate) && optionalDay(item.scheduledDate) && optionalInstant(item.startsAt)
        && optionalInstant(item.endsAt) && optionalInstant(item.reviewCompletedAt) && optionalInstant(item.recordUpdatedAt)
        && ['session', 'scheduled-date', 'target', 'record-updated'].includes(String(item.periodBasis))
        && ((item.startsAt === null && item.endsAt === null)
          || (instant(item.startsAt) && instant(item.endsAt) && Date.parse(String(item.endsAt)) > Date.parse(String(item.startsAt))))))
    || !object(data.coverage) || data.coverage.offset !== offset || !Number.isInteger(data.coverage.totalLearners)
    || Number(data.coverage.totalLearners) < offset + data.learners.length
    || (data.coverage.nextOffset !== null && (data.coverage.nextOffset !== offset + data.learners.length || !data.learners.length
      || Number(data.coverage.nextOffset) >= Number(data.coverage.totalLearners)))
    || (data.coverage.nextOffset === null && offset + data.learners.length !== data.coverage.totalLearners)
    || new Set(data.learners.map(row => row.id)).size !== data.learners.length) {
    throw new Error('Coach learners returned a different scope or an invalid response. Refresh and retry.');
  }
  return data as unknown as CoachLearners;
}
function isMedia(value: unknown): value is CoachingMedia {
  const states = ['ready', 'pending', 'failed', 'missing', 'unavailable', 'unlinked'];
  return object(value) && states.includes(String(value.state)) && Array.isArray(value.recordings)
    && value.recordings.every(row => object(row) && typeof row.id === 'string' && states.includes(String(row.state))
      && (row.source === undefined || [null, 'microsoft'].includes(row.source as string | null)))
    && value.readyCount === value.recordings.filter(row => row.state === 'ready').length;
}
function isMeeting(row: unknown): row is CoachingMeeting {
  return object(row) && typeof row.calendarEventId === 'string' && typeof row.coachEmail === 'string'
    && (row.meetingId === undefined || (typeof row.meetingId === 'string' && /^[a-f0-9]{32}$/.test(row.meetingId)))
    && (row.eventKey === null || typeof row.eventKey === 'string') && strings(row.learnerIds) && strings(row.candidateEventKeys)
    && [null, 'MCM', 'PR', 'SUPPORT'].includes(row.family as string | null) && instant(row.startsAt) && instant(row.endsAt)
    && (row.category === undefined || ['MCM', 'PR', 'SUPPORT', 'OTHER', 'LECTURE'].includes(String(row.category)))
    && (row.title === undefined || typeof row.title === 'string')
    && (row.analysisContext === undefined || typeof row.analysisContext === 'string')
    && (row.recordingsReference === undefined || typeof row.recordingsReference === 'string')
    && (row.cancellationSources === undefined || (strings(row.cancellationSources) && row.cancellationSources.every(value => ['lms', 'microsoft'].includes(value))))
    && ['cancelled', 'ended', 'upcoming', 'in-progress'].includes(String(row.phase))
    && ['matched', 'mismatch', 'ambiguous', 'candidate', 'external'].includes(String(row.match))
    && isMedia(row.media) && typeof row.readyToAction === 'boolean';
}

export interface LinkedCoachingMeeting { meeting: CoachingMeeting; coach: { email: string; name: string }; learners: { id: string; name: string }[]; syncedAt: string }
const linkedMeetings = createCachedResource<LinkedCoachingMeeting>('coaching-linked-meetings', async url => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await learningFetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(object(data) && typeof data.error === 'string' ? data.error : 'This saved meeting could not be loaded.');
    if (!object(data) || !isMeeting(data.meeting) || !object(data.coach) || data.coach.email !== data.meeting.coachEmail || typeof data.coach.name !== 'string'
      || !Array.isArray(data.learners) || !data.learners.every(row => object(row) && typeof row.id === 'string' && typeof row.name === 'string') || !instant(data.syncedAt)
      || data.meeting.meetingId !== new URL(url, 'http://localhost').pathname.split('/').at(-1) || !data.meeting.recordingsReference) throw new Error('The service returned a different or invalid meeting.');
    return data as unknown as LinkedCoachingMeeting;
  } finally { clearTimeout(timer); }
}, 15000, 12);
export function loadLinkedCoachingMeeting(id: string, date: string, timeZone: string, signal?: AbortSignal, refresh = false) {
  if (!/^[a-f0-9]{32}$/.test(id)) return Promise.reject(new Error('This meeting link has an invalid ID.'));
  const url = `/coach_api/coaching-recordings/meetings/${id}?${new URLSearchParams({ date, timeZone })}`;
  if (refresh) linkedMeetings.invalidate(url);
  return withCallerSignal(linkedMeetings.read(url), signal);
}

function isCalendar(value: unknown): value is CoachingCalendar {
  if (!object(value) || !object(value.coverage)) return false;
  return ['all', 'own'].includes(String(value.scope))
    && (value.sync === undefined || (object(value.sync) && typeof value.sync.pending === 'boolean'
      && Number.isInteger(value.sync.pendingCalendars) && Number(value.sync.pendingCalendars) >= 0
      && Number.isInteger(value.sync.pendingEvidence) && Number(value.sync.pendingEvidence) >= 0
      && (value.sync.initialPendingCalendars === undefined || (Number.isInteger(value.sync.initialPendingCalendars) && Number(value.sync.initialPendingCalendars) >= 0))
      && (value.sync.initialPendingEvidence === undefined || (Number.isInteger(value.sync.initialPendingEvidence) && Number(value.sync.initialPendingEvidence) >= 0))
      && optionalInstant(value.sync.lastSuccessfulAt) && typeof value.sync.directoryHash === 'string'
      && typeof value.sync.directoryUnchanged === 'boolean'
      && (value.sync.version === undefined || (typeof value.sync.version === 'string' && /^[a-f0-9]{64}$/.test(value.sync.version)))))
    && typeof value.start === 'string' && typeof value.end === 'string' && typeof value.timeZone === 'string'
    && typeof value.partial === 'boolean'
    && Array.isArray(value.coaches) && value.coaches.every(row => object(row) && typeof row.email === 'string' && typeof row.name === 'string')
    && Array.isArray(value.learners) && value.learners.every(row => object(row) && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.coachEmail === 'string')
    && Array.isArray(value.meetings) && value.meetings.every(isMeeting)
    && Array.isArray(value.lmsOnly) && value.lmsOnly.every(row => object(row)
      && typeof row.eventKey === 'string' && typeof row.learnerId === 'string' && typeof row.coachEmail === 'string'
      && instant(row.startsAt) && instant(row.endsAt))
    && Array.isArray(value.cancelledBookings) && value.cancelledBookings.every(row => object(row)
      && typeof row.eventKey === 'string' && typeof row.learnerId === 'string' && typeof row.coachEmail === 'string'
      && ['MCM', 'PR', 'SUPPORT'].includes(String(row.family))
      && (row.startsAt === null || instant(row.startsAt)) && (row.endsAt === null || instant(row.endsAt))
      && (row.recordUpdatedAt === null || instant(row.recordUpdatedAt)) && ['session', 'record-updated'].includes(String(row.dateBasis))
      && Array.isArray(row.sources) && row.sources.length === 1 && row.sources[0] === 'lms')
    && Array.isArray(value.errors) && value.errors.every(row => object(row) && typeof row.coachEmail === 'string' && typeof row.code === 'string'
      && (row.retryable === undefined || typeof row.retryable === 'boolean'))
    && strings(value.coverage.checkedCoachEmails) && Number.isInteger(value.coverage.totalCoaches)
    && (value.coverage.nextOffset === null || (Number.isInteger(value.coverage.nextOffset) && Number(value.coverage.nextOffset) >= 0));
}

export interface CalendarLoadOptions {
  background?: boolean;
  refresh?: boolean;
  onDirectory?: (data: Pick<CoachingCalendar, 'coaches' | 'learners' | 'scope'>) => void;
  onProgress?: (data: CoachingCalendar) => void;
  previous?: { query: CoachingCalendarQuery; data: CoachingCalendar };
}

export const COACHING_CALENDAR_REQUEST_TIMEOUT = 20_000;

type CalendarReply = { status: number; ok: boolean; data: unknown };

// Share only an in-flight snapshot read (including StrictMode remounts).
// TTL zero means the next completed poll still revalidates server-side access
// and job state. The shared resource is cleared on account/role changes.
const calendarReads = createCachedResource<CalendarReply>('coaching-calendar-read', async key => {
  const [url, version] = JSON.parse(key) as [string, string | null];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COACHING_CALENDAR_REQUEST_TIMEOUT);
  try {
    const response = await learningFetch(url, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
      ...(version ? { headers: { 'If-None-Match': `"${version}"`, 'X-Coaching-Delta': '1' } } : {}),
    });
    if (response.status === 401 || response.status === 403) calendarReads.invalidate();
    return { status: response.status, ok: response.ok,
      data: [304, 401, 403].includes(response.status) ? null : await response.json() as unknown };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('This calendar is taking too long. Choose one coach or retry.');
    throw error;
  } finally { clearTimeout(timer); }
}, 0, 1);

async function readCalendarPage(query: CoachingCalendarQuery, offset: number, limit: number, signal?: AbortSignal, options: { refresh?: boolean; directoryOnly?: boolean; background?: boolean; directoryHash?: string; previous?: CoachingCalendar } = {}): Promise<CoachingCalendar> {
  const params = new URLSearchParams({ start: query.start, end: query.end, timeZone: query.timeZone,
    offset: String(offset), limit: String(limit) });
  if (options.refresh) params.set('refresh', '1');
  if (options.directoryOnly) params.set('directoryOnly', '1');
  if (options.background) params.set('background', '1');
  if (options.directoryHash) params.set('directoryHash', options.directoryHash);
  if (query.coachEmail) params.set('coachEmail', query.coachEmail);
  if (query.learnerId) params.set('learnerId', query.learnerId);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, COACHING_CALENDAR_REQUEST_TIMEOUT);
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = `/coach_api/coaching-recordings/calendar?${params}`;
    let reply: CalendarReply;
    if (options.background) {
      reply = await withCallerSignal(calendarReads.read(JSON.stringify([url,
        !options.refresh && options.previous?.sync?.version || null])), controller.signal);
    } else {
      const response = await learningFetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      reply = { status: response.status, ok: response.ok,
        data: [304, 401, 403].includes(response.status) ? null : await response.json() as unknown };
    }
    if (reply.status === 401 || reply.status === 403) throw new Error('You do not have access to this coaching calendar.');
    if (reply.status === 304) {
      if (!options.previous?.sync?.version || !isCalendar(options.previous)) throw new Error('The calendar snapshot could not be verified.');
      return options.previous;
    }
    let data: unknown = reply.data;
    if (object(data) && data.delta !== undefined) {
      const previous = options.previous;
      if (!previous?.sync || !isCalendar(data) || data.scope !== previous.scope || !object(data.delta)
          || data.delta.baseVersion !== previous.sync.version || !strings(data.delta.removedMeetingKeys)) {
        throw new Error('The calendar changes could not be verified.');
      }
      const key = (row: CoachingMeeting) => JSON.stringify([row.coachEmail, row.calendarEventId, row.startsAt, row.endsAt]);
      const merged = new Map(previous.meetings.map(row => [key(row), row]));
      for (const removed of data.delta.removedMeetingKeys) {
        if (!merged.delete(removed)) throw new Error('The calendar changes could not be verified.');
      }
      for (const row of data.meetings) merged.set(key(row), row);
      data = { ...data, meetings: [...merged.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.coachEmail.localeCompare(b.coachEmail)) };
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!isCalendar(data) || (!reply.ok && reply.status !== 503)) {
      throw new Error('Coaching calendars could not be loaded. Please retry.');
    }
    if (data.start !== query.start || data.end !== query.end || data.timeZone !== query.timeZone) {
      throw new Error('The calendar returned a different date range. Please retry.');
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('This calendar is taking too long. Choose one coach or retry.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Publish the first coach immediately, then read bounded batches of three. */
export async function loadCoachingCalendar(query: CoachingCalendarQuery, signal?: AbortSignal, options: CalendarLoadOptions = {}): Promise<CoachingCalendar> {
  if (options.background) return loadBackgroundCalendar(query, signal, options);
  let result: CoachingCalendar | null = null;
  let offset: number | null = 0;
  const seen = new Set<number>();
  let directory: CoachingCalendar | null = null;
  if (options.onDirectory) {
    directory = await readCalendarPage(query, 0, 1, signal, { directoryOnly: true });
    options.onDirectory(directory);
  }
  while (offset !== null) {
    try {
      if (seen.has(offset) || seen.size >= 200) throw new Error('Calendar paging could not be completed.');
      seen.add(offset);
      const data = await readCalendarPage(query, offset, result ? 3 : 1, signal, { refresh: options.refresh });
      if (directory && data.scope !== directory.scope) throw new Error('You do not have access to the previous calendar scope. Please refresh.');
      if (result && data.scope !== result.scope) throw new Error('You do not have access to the previous calendar scope. Please refresh.');
      if (result && (data.coverage.totalCoaches !== result.coverage.totalCoaches
        || data.coaches.map(row => row.email).join('\n') !== result.coaches.map(row => row.email).join('\n'))) {
        throw new Error('The coach directory changed while loading. Please refresh.');
      }
      result = result ? { ...data, meetings: [...result.meetings, ...data.meetings],
        cancelledBookings: [...result.cancelledBookings, ...data.cancelledBookings],
        lmsOnly: [...result.lmsOnly, ...data.lmsOnly], errors: [...result.errors, ...data.errors],
        partial: result.partial || data.partial,
        coverage: { ...data.coverage, checkedCoachEmails: [...new Set([...result.coverage.checkedCoachEmails, ...data.coverage.checkedCoachEmails])] },
      } : data;
      offset = data.coverage.nextOffset;
      options.onProgress?.(result);
    } catch (error) {
      if (signal?.aborted || !result || (error instanceof Error && error.message.startsWith('You do not have access'))) throw error;
      return { ...result, partial: true, errors: [...result.errors, { coachEmail: '', code: 'remaining_calendars_unavailable' }] };
    }
  }
  if (!result) throw new Error('Coaching calendars could not be loaded.');
  if (!result.partial && result.coverage.checkedCoachEmails.length < result.coverage.totalCoaches) {
    return { ...result, partial: true, errors: [...result.errors, { coachEmail: '', code: 'remaining_calendars_unavailable' }] };
  }
  return result;
}

async function loadBackgroundCalendar(query: CoachingCalendarQuery, signal: AbortSignal | undefined, options: CalendarLoadOptions): Promise<CoachingCalendar> {
  const queryKey = (value: CoachingCalendarQuery) => JSON.stringify([value.start, value.end, value.timeZone, value.coachEmail || '', value.learnerId || '']);
  const current = options.previous && queryKey(options.previous.query) === queryKey(query) ? options.previous.data : undefined;
  const next = await readCalendarPage(query, 0, 10, signal, { background: true,
    refresh: options.refresh, directoryHash: current?.sync?.directoryHash, previous: current });
  if (!next.sync || (current && current.scope !== next.scope)) throw new Error('You do not have access to the previous calendar scope. Please refresh.');
  if (next.sync.directoryUnchanged) {
    if (!current || current.sync?.directoryHash !== next.sync.directoryHash) throw new Error('The calendar directory could not be verified.');
    next.coaches = current.coaches; next.learners = current.learners;
  }
  options.onDirectory?.(next);
  options.onProgress?.(next);
  return next;
}

export function coachingRecordingUrl(eventKey: string, recordingId: string, preview = false, reference?: string) {
  const params = new URLSearchParams({ eventKey, recordingId, preview: preview ? '1' : '0' });
  if (reference) params.set('reference', reference);
  return `/coach_api/coaching-recordings/recording?${params}`;
}

export function coachingEvidenceUrl(eventKey: string, kind: 'transcript' | 'analysis' | 'attendance', reference?: string, analysisId?: string) {
  const params = new URLSearchParams({ eventKey, kind });
  if (reference) params.set('reference', reference);
  if (analysisId) params.set('analysisId', analysisId);
  return `/coach_api/coaching-recordings/evidence?${params}`;
}

// Private bytes live only in memory. Account/role changes and logout already
// clear registered resources. Bound both retention and memory (four PDFs).
const pdfFiles = createCachedResource('coaching-evidence-pdf', fetchCoachingPdf, 30_000, 4);

export function invalidateCoachingPdfs(): void { pdfFiles.invalidate(); }

async function fetchCoachingPdf(url: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await learningFetch(url, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) pdfFiles.invalidate();
    if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().startsWith('application/pdf')) {
      let message = 'The PDF could not be prepared. Please retry.';
      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const error: unknown = await response.json();
        if (object(error) && typeof error.error === 'string') message = error.error;
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    if (blob.size > 20 * 1024 * 1024 || await blob.slice(0, 5).text() !== '%PDF-') {
      throw new Error('The service did not return a valid PDF. Please retry.');
    }
    return blob;
  } finally { clearTimeout(timer); }
}

export function loadCoachingPdf(eventKey: string, kind: 'transcript' | 'analysis', reference?: string,
  analysisId?: string, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  const params = new URLSearchParams({ eventKey, kind });
  if (reference) params.set('reference', reference);
  if (analysisId) params.set('analysisId', analysisId);
  if (kind === 'transcript') params.set('checkMicrosoft', '1');
  // Closing one panel cancels its subscriber, not another subscriber's fetch.
  // A bounded shared read also survives StrictMode and accordion remounts.
  return withCallerSignal(pdfFiles.read(`/coach_api/coaching-recordings/pdf?${params}`), signal);
}

function isSavedEvidence(value: unknown): value is SavedCoachingEvidence {
  return object(value) && value.source === 'coaching-session'
    && (value.metadataOnly === undefined || value.metadataOnly === true)
    && (value.completion === undefined || (object(value.completion) && value.completion.source === 'aptem'
      && ['action-required', 'completed', 'awaiting-signature', 'unverified', 'unavailable', 'mixed'].includes(String(value.completion.state))
      && (value.completion.checkedAt === undefined || instant(value.completion.checkedAt))))
    && ['matched', 'not-found', 'ambiguous', 'unavailable'].includes(String(value.state))
    && (value.analysisState === undefined || ['matched', 'not-found', 'ambiguous', 'unavailable'].includes(String(value.analysisState)))
    && (value.transcriptCheck === undefined || (object(value.transcriptCheck)
      && ['available', 'missing', 'unavailable'].includes(String(value.transcriptCheck.state)) && typeof value.transcriptCheck.code === 'string'))
    && (value.transcript === null || (object(value.transcript) && (typeof value.transcript.content === 'string' || (value.metadataOnly === true && value.transcript.content === undefined))
      && (value.transcript.durationSeconds === null || (typeof value.transcript.durationSeconds === 'number' && value.transcript.durationSeconds >= 0))
      && optionalInstant(value.transcript.updatedAt)
      && (value.transcript.partCount === undefined || (Number.isInteger(value.transcript.partCount) && Number(value.transcript.partCount) > 0))
      && (value.transcript.source === undefined || ['lms', 'microsoft'].includes(String(value.transcript.source)))))
    && Array.isArray(value.analyses) && value.analyses.every(row => object(row) && typeof row.id === 'string'
      && typeof row.learnerName === 'string' && typeof row.type === 'string' && typeof row.status === 'string'
      && (row.reportAvailable === undefined || (typeof row.reportAvailable === 'boolean' && (!row.reportAvailable || row.status === 'completed')))
      && (row.sourceSessionId == null || (typeof row.sourceSessionId === 'string' && /^[a-f0-9]{32}$/.test(row.sourceSessionId)))
      && optionalInstant(row.updatedAt) && (row.status === 'completed' || row.report === null || (value.metadataOnly === true && row.report === undefined && row.reportAvailable === false)))
    && (value.state === 'matched' || (value.transcript === null && value.analyses.length === 0));
}

const sessionReads = createCachedResource<unknown>('coaching-session-details', async url => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await learningFetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Saved meeting details could not be loaded. Please retry.');
    return await response.json() as unknown;
  } finally { clearTimeout(timer); }
}, 15000, 16);
export function invalidateCoachingDetails() { sessionReads.invalidate(); }

export async function loadCoachingSession(eventKey: string, signal?: AbortSignal, reference?: string, part: 'all' | 'attendance' = 'all'): Promise<CoachingSessionDetails> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const params = new URLSearchParams({ eventKey });
  if (part !== 'all') params.set('part', part);
  if (reference) params.set('reference', reference);
  const url = `/coach_api/coaching-recordings/session?${params}`;
  const data = await withCallerSignal(sessionReads.read(url), signal);
  if (!object(data) || typeof data.eventKey !== 'string' || (reference ? data.reference !== reference : data.eventKey !== eventKey) || !isMedia(data.media)
      || typeof data.partial !== 'boolean' || (data.evidence !== undefined && !isSavedEvidence(data.evidence)) || !object(data.attendance)
      || !['available', 'pending', 'unavailable'].includes(String(data.attendance.state))
      || !Array.isArray(data.attendance.rows) || !data.attendance.rows.every(row => object(row)
        && ['name', 'displayName', 'email', 'role', 'status'].every(key => row[key] == null || typeof row[key] === 'string')
        && (row.totalAttendanceSeconds == null || (typeof row.totalAttendanceSeconds === 'number' && row.totalAttendanceSeconds >= 0)))) {
    sessionReads.invalidate(url); throw new Error('Recordings and attendance could not be loaded. Please retry.');
  }
  return data as unknown as CoachingSessionDetails;
}

export async function loadSavedCoachingEvidence(eventKey: string, signal?: AbortSignal, reference?: string, checkMicrosoft = false): Promise<SavedCoachingEvidence> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const params = new URLSearchParams({ eventKey, part: 'evidence', metadataOnly: '1' });
  if (checkMicrosoft) params.set('checkMicrosoft', '1');
  if (reference) params.set('reference', reference);
  const url = `/coach_api/coaching-recordings/session?${params}`;
  const data = await withCallerSignal(sessionReads.read(url), signal);
  if (!object(data) || typeof data.eventKey !== 'string'
    || (reference ? data.reference !== reference : data.eventKey !== eventKey) || !isSavedEvidence(data.evidence)) {
    sessionReads.invalidate(url); throw new Error('Saved transcript and AI analysis could not be loaded. Refresh and retry.');
  }
  return data.evidence;
}

export interface CoachingQuality {
  eventKey: string;
  state: 'not-analysed' | 'running' | 'failed' | 'complete';
  reviewOnly: true;
  retryAfter: number;
  sampled: boolean;
  unlinkedTranscriptExcluded: boolean;
  updatedAt: string | null;
  result: null | {
    title: string; model: string; mixed: boolean; insufficientEvidence: boolean; uncertainty: string;
    sampled: boolean; unlinkedTranscriptExcluded: boolean; reviewOnly: true;
    types: { type: 'MCM' | 'PR' | 'SUPPORT'; confidence: 'low' | 'medium' | 'high'; reason: string;
      evidence: string[]; referenceIds: string[]; templateBased: boolean }[];
    references: { id: string; name: string; family: string; linked: boolean }[];
  };
}

export async function loadCoachingQuality(eventKey: string, context: string, generate = false, signal?: AbortSignal): Promise<CoachingQuality> {
  const url = `/coach_api/coaching-recordings/quality?${new URLSearchParams({ eventKey })}`;
  const response = await (generate ? coachFetch : learningFetch)(url, {
    method: generate ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', signal,
    headers: { 'X-Coaching-Context': context },
  });
  return readCoachingQuality(response, eventKey);
}

async function readCoachingQuality(response: Response, eventKey: string): Promise<CoachingQuality> {
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = new Error(object(data) && typeof data.error === 'string' ? data.error : 'Meeting analysis could not be loaded.');
    if (response.status === 409 && object(data) && data.code === 'analysis_prerequisite') error.name = 'CoachingQualityPrerequisiteError';
    throw error;
  }
  if (!object(data) || data.eventKey !== eventKey || data.reviewOnly !== true
      || !['not-analysed', 'running', 'failed', 'complete'].includes(String(data.state))
      || typeof data.retryAfter !== 'number' || data.retryAfter < 0
      || typeof data.sampled !== 'boolean' || typeof data.unlinkedTranscriptExcluded !== 'boolean'
      || (data.updatedAt !== null && !instant(data.updatedAt))
      || (data.state !== 'complete' ? data.result !== null : !isQualityResult(data.result))) {
    throw new Error('Meeting analysis returned an invalid response.');
  }
  return data as unknown as CoachingQuality;
}

export interface CoachingKeywordQuality extends CoachingQuality {
  method: 'keywords';
  result: NonNullable<CoachingQuality['result']> & {
    analysedCharacters: number;
    keywordSignals: { type: 'MCM' | 'PR' | 'SUPPORT'; topicCount: number; matchedTerms: string[]; evidence: string[];
      templateBased: boolean; transcriptMentioned: boolean; titleMentioned: boolean }[];
  };
}

/** Read the full saved transcript locally. No AI generation or cache writes. */
export async function loadCoachingKeywords(eventKey: string, context: string, signal?: AbortSignal): Promise<CoachingKeywordQuality> {
  const response = await learningFetch(`/coach_api/coaching-recordings/quality?${new URLSearchParams({ eventKey, method: 'keywords' })}`, {
    credentials: 'include', cache: 'no-store', signal, headers: { 'X-Coaching-Context': context },
  });
  const data = await readCoachingQuality(response, eventKey) as CoachingKeywordQuality;
  if (data.method !== 'keywords' || data.state !== 'complete' || !data.result || data.sampled || data.result.sampled
      || !Number.isInteger(data.result.analysedCharacters) || data.result.analysedCharacters < 0
      || !Array.isArray(data.result.keywordSignals) || data.result.keywordSignals.length > 3
      || !data.result.keywordSignals.every(row => object(row) && ['MCM', 'PR', 'SUPPORT'].includes(String(row.type))
        && Number.isInteger(row.topicCount) && row.topicCount >= 0 && strings(row.matchedTerms) && strings(row.evidence)
        && typeof row.templateBased === 'boolean' && typeof row.transcriptMentioned === 'boolean' && typeof row.titleMentioned === 'boolean')) {
    throw new Error('Keyword analysis returned an invalid response.');
  }
  return data;
}

function isQualityResult(value: unknown): boolean {
  return object(value) && value.reviewOnly === true && typeof value.title === 'string' && typeof value.model === 'string'
    && typeof value.mixed === 'boolean' && typeof value.insufficientEvidence === 'boolean' && typeof value.uncertainty === 'string'
    && typeof value.sampled === 'boolean' && typeof value.unlinkedTranscriptExcluded === 'boolean'
    && Array.isArray(value.references) && value.references.every(row => object(row) && typeof row.id === 'string'
      && typeof row.name === 'string' && typeof row.family === 'string' && typeof row.linked === 'boolean')
    && Array.isArray(value.types) && value.types.length <= 3 && value.types.every(row => object(row)
      && ['MCM', 'PR', 'SUPPORT'].includes(String(row.type)) && ['low', 'medium', 'high'].includes(String(row.confidence))
      && typeof row.reason === 'string' && strings(row.evidence) && strings(row.referenceIds) && typeof row.templateBased === 'boolean');
}
