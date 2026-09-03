// The Sessions tab's delivery view: a collapsible Module → Month → Week → session
// tree rather than one flat list, so a programme with dozens of sessions reads as
// a small set of modules that open on demand. A live session with synced data
// expands further to the attendance / transcript / recording captured for it.
//
// Statuses shown here (scheduled / completed / cancelled) are authored by the
// Graph artifact-sync service and read straight off the occurrence — this view
// never decides a status from a date. See `deliverySessions` in page.tsx.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  fetchLiveSessionArtifacts,
  liveSessionArtifactContentUrl,
  liveSessionArtifactPreviewUrl,
  liveSessionJoinUrl,
  type LiveSessionAttendance,
  type LiveSessionArtifactOccurrence,
} from '@/lib/curriculumApi';
import { syncTeamsMeetingArtifacts } from '../module-builder/moduleAuthoringData';
import { StatusBadge } from '../shared/entities/ui';
import { syncTeamsMeetingArtifacts } from '../module-builder/moduleAuthoringData';
import type { DeliverySession } from './page';

// --------------------------------------------------------------- date helpers

/** Month bucket for a session, from its best instant. Sessions with no instant
 *  at all collapse into one "Unscheduled" bucket that always sorts last. For a
 *  recording that instant is its week's start date — see `buildSessionTree`. */
export function sessionMonthBucket(dateIso: string): { key: string; label: string; order: number } {
  const trimmed = (dateIso || '').trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}/.test(trimmed);
  const date = trimmed ? new Date(dateOnly ? `${trimmed.slice(0, 10)}T12:00:00Z` : trimmed) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { key: 'unscheduled', label: 'Unscheduled', order: Number.MAX_SAFE_INTEGER };
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const label = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { key: `${year}-${String(month + 1).padStart(2, '0')}`, label, order: year * 12 + month };
}

function formatSessionDate(dateIso: string, fallback: string): string {
  const trimmed = (dateIso || '').trim();
  if (!trimmed) return fallback;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = new Date(dateOnly ? `${trimmed}T12:00:00Z` : trimmed);
  if (Number.isNaN(date.getTime())) return fallback || trimmed;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
}

function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  if (!seconds) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

export interface ReadableTranscriptCue {
  start: string;
  speaker: string;
  text: string;
}

function formatTranscriptTimestamp(value: string): string {
  const match = /^(\d+):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const [, hours, minutes, seconds] = match;
  return hours === '00' ? `${minutes}:${seconds}` : `${hours}:${minutes}:${seconds}`;
}

/** Turn Microsoft's WEBVTT response into lines a normal user can read. */
export function parseTeamsTranscriptVtt(vtt: string): ReadableTranscriptCue[] {
  return String(vtt || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n\s*\n+/)
    .map((block): ReadableTranscriptCue | null => {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
      const timeIndex = lines.findIndex(line => line.includes('-->'));
      if (timeIndex === -1) return null;
      const start = formatTranscriptTimestamp(lines[timeIndex].split('-->')[0]);
      const rawText = lines.slice(timeIndex + 1).join(' ');
      const speakerMatch = /<v\s+([^>]+)>/i.exec(rawText);
      const text = rawText
        .replace(/<\/?v[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      return text ? { start, speaker: speakerMatch?.[1]?.trim() || 'Speaker', text } : null;
    })
    .filter((cue): cue is ReadableTranscriptCue => cue !== null);
}

export function attendanceSheetRows(attendance: LiveSessionAttendance[]) {
  return attendance.map(person => {
    const intervals = Array.isArray(person.intervals) ? person.intervals : [];
    const joins = intervals.map(item => String(item.joinDateTime || '')).filter(Boolean).join('; ');
    const leaves = intervals.map(item => String(item.leaveDateTime || '')).filter(Boolean).join('; ');
    const seconds = Math.max(0, Number(person.total_attendance_seconds) || 0);
    return {
      'Attendee name': person.display_name || '',
      Email: person.email || '',
      'Meeting started': person.attendance_report_start || '',
      Status: person.attended === false ? 'Absent' : 'Attended',
      Expected: person.expected === false ? 'No' : 'Yes',
      Role: person.role || '',
      'Join sessions': person.join_count ?? intervals.length,
      'Time in session': formatSeconds(seconds),
      'Attendance seconds': Math.round(seconds),
      'Joined at': joins,
      'Left at': leaves,
    };
  });
}

export interface AttendanceSheetGroup {
  dateKey: string;
  sheetName: string;
  attendance: LiveSessionAttendance[];
}

/** Group exported attendance by the calendar date shown to the user. Multiple
 * Teams reports from the same day share one worksheet and remain distinguishable
 * through the existing "Meeting started" column. */
export function attendanceSheetGroups(attendance: LiveSessionAttendance[]): AttendanceSheetGroup[] {
  const groups = new Map<string, AttendanceSheetGroup>();
  attendance.forEach(person => {
    const firstInterval = Array.isArray(person.intervals) ? person.intervals[0] : undefined;
    const source = String(person.attendance_report_start || firstInterval?.joinDateTime || '').trim();
    const parsed = source ? new Date(source) : null;
    const valid = Boolean(parsed && !Number.isNaN(parsed.getTime()));
    const dateKey = valid
      ? `${parsed!.getFullYear()}-${String(parsed!.getMonth() + 1).padStart(2, '0')}-${String(parsed!.getDate()).padStart(2, '0')}`
      : 'undated';
    const sheetName = valid
      ? parsed!.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, '')
      : 'Undated attendance';
    const group = groups.get(dateKey) || { dateKey, sheetName, attendance: [] };
    group.attendance.push(person);
    groups.set(dateKey, group);
  });
  return Array.from(groups.values()).sort((left, right) => {
    if (left.dateKey === 'undated') return 1;
    if (right.dateKey === 'undated') return -1;
    return left.dateKey.localeCompare(right.dateKey);
  });
}

async function downloadAttendanceSheet(session: DeliverySession, attendance: LiveSessionAttendance[]) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const sheetGroups = attendanceSheetGroups(attendance);
  sheetGroups.forEach(group => {
    const worksheet = XLSX.utils.json_to_sheet(attendanceSheetRows(group.attendance));
    worksheet['!cols'] = [
      { wch: 28 }, { wch: 36 }, { wch: 24 }, { wch: 14 }, { wch: 12 },
      { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 20 },
      { wch: 32 }, { wch: 32 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, group.sheetName.slice(0, 31));
  });
  const safeTitle = (session.title || 'teams-session').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');
  const onlyRunDate = sheetGroups.length === 1 && sheetGroups[0].dateKey !== 'undated'
    ? sheetGroups[0].dateKey
    : '';
  const date = onlyRunDate || (session.dateIso || session.date || '').slice(0, 10);
  XLSX.writeFile(workbook, `${safeTitle || 'teams-session'}${date ? `-${date}` : ''}-attendance.xlsx`, { compression: true });
}

// ------------------------------------------------------------------- tree model

interface WeekGroup {
  key: string;
  week: number;
  weekTitle: string;
  sessions: DeliverySession[];
}
interface MonthGroup {
  key: string;
  label: string;
  order: number;
  weeks: WeekGroup[];
  count: number;
}
export interface ModuleGroup {
  key: string;
  module: string;
  count: number;
  scheduled: number;
  completed: number;
  cancelled: number;
  missing: number;
  months: MonthGroup[];
}

function statusClass(status: string): 'scheduled' | 'completed' | 'cancelled' | 'missing' | 'other' {
  const value = status.toLowerCase();
  if (value === 'completed') return 'completed';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  if (value === 'scheduled') return 'scheduled';
  if (value === 'not-created') return 'missing';
  return 'other';
}

/** Group flat sessions into the Module → Month → Week tree, preserving the
 *  programme's module order and sorting months/weeks/sessions chronologically. */
export function buildSessionTree(sessions: DeliverySession[]): ModuleGroup[] {
  const modules = new Map<string, ModuleGroup>();
  for (const session of sessions) {
    const moduleName = session.module || 'Unassigned module';
    let moduleGroup = modules.get(moduleName);
    if (!moduleGroup) {
      moduleGroup = { key: moduleName, module: moduleName, count: 0, scheduled: 0, completed: 0, cancelled: 0, missing: 0, months: [] };
      modules.set(moduleName, moduleGroup);
    }
    moduleGroup.count += 1;
    const bucketClass = statusClass(session.status);
    if (bucketClass === 'completed') moduleGroup.completed += 1;
    else if (bucketClass === 'cancelled') moduleGroup.cancelled += 1;
    else if (bucketClass === 'scheduled') moduleGroup.scheduled += 1;
    else if (bucketClass === 'missing') moduleGroup.missing += 1;

    // A recording has no date of its own — it is authored into a week, not
    // onto a day — so its place in the calendar is that week's first teaching
    // date. A live session is the opposite: its own date *is* the schedule, so
    // an undated one stays in Unscheduled, where the empty month is a real gap
    // — except a "no meeting yet" placeholder, which has no schedule to lose but
    // does belong to a real week, and sorting it into Unscheduled would scatter
    // the very gaps this view exists to surface away from the week they're in.
    const bucketDateIso = session.dateIso || (session.kind === 'recorded' || session.status === 'not-created' ? session.weekStartDate : '');
    const bucket = sessionMonthBucket(bucketDateIso);
    let monthGroup = moduleGroup.months.find(item => item.key === bucket.key);
    if (!monthGroup) {
      monthGroup = { key: bucket.key, label: bucket.label, order: bucket.order, weeks: [], count: 0 };
      moduleGroup.months.push(monthGroup);
    }
    monthGroup.count += 1;
    const weekKey = String(session.week);
    let weekGroup = monthGroup.weeks.find(item => item.key === weekKey);
    if (!weekGroup) {
      weekGroup = { key: weekKey, week: session.week, weekTitle: session.weekTitle, sessions: [] };
      monthGroup.weeks.push(weekGroup);
    }
    weekGroup.sessions.push(session);
  }

  for (const moduleGroup of modules.values()) {
    moduleGroup.months.sort((a, b) => a.order - b.order);
    for (const monthGroup of moduleGroup.months) {
      monthGroup.weeks.sort((a, b) => a.week - b.week);
      for (const weekGroup of monthGroup.weeks) {
        weekGroup.sessions.sort((a, b) => (a.dateIso || '').localeCompare(b.dateIso || '') || a.title.localeCompare(b.title));
      }
    }
  }
  return [...modules.values()];
}

// --------------------------------------------------------------- artifact panel

type ArtifactState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; occurrence: LiveSessionArtifactOccurrence | null };

function CompletedSessionPanel({ session, state }: { session: DeliverySession; state: ArtifactState | undefined }) {
  const [recordingPreviewId, setRecordingPreviewId] = useState('');
  const [transcriptPreviewId, setTranscriptPreviewId] = useState('');
  const [transcriptState, setTranscriptState] = useState<
    | { status: 'idle' | 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; cues: ReadableTranscriptCue[] }
  >({ status: 'idle' });
  const [sheetError, setSheetError] = useState('');

  useEffect(() => {
    if (!transcriptPreviewId) {
      setTranscriptState({ status: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    setTranscriptState({ status: 'loading' });
    fetch(liveSessionArtifactPreviewUrl(session.liveSessionId, transcriptPreviewId), { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Transcript could not be loaded (${response.status}).`);
        return response.text();
      })
      .then(text => setTranscriptState({ status: 'ready', cues: parseTeamsTranscriptVtt(text) }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTranscriptState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Transcript could not be loaded.',
        });
      });
    return () => controller.abort();
  }, [session.liveSessionId, transcriptPreviewId]);

  if (!state || state.status === 'loading') {
    return <p className="px-4 py-3 text-[12px] text-foreground-500">Loading attendance and recordings…</p>;
  }
  if (state.status === 'error') {
    return <p className="px-4 py-3 text-[12px] text-red-600">{state.message}</p>;
  }
  const occurrence = state.occurrence;
  const attendance = occurrence?.attendance || [];
  const attendanceRuns = Array.from(attendance.reduce((groups, person) => {
    const key = person.attendance_report_id || person.attendance_report_start || 'legacy';
    const group = groups.get(key) || {
      key,
      startedAt: person.attendance_report_start || '',
      rows: [] as LiveSessionAttendance[],
    };
    group.rows.push(person);
    groups.set(key, group);
    return groups;
  }, new Map<string, { key: string; startedAt: string; rows: LiveSessionAttendance[] }>()).values());
  const attendedCount = attendance.filter(person => person.attended !== false).length;
  const expectedCount = Math.max(0, ...attendanceRuns.map(run => run.rows.filter(person => person.expected !== false).length));
  const artifacts = occurrence?.artifacts || [];
  const transcripts = artifacts.filter(item => (item.artifact_type || '').toLowerCase() === 'transcript');
  const recordings = artifacts.filter(item => (item.artifact_type || '').toLowerCase() === 'recording');

  return (
    <div className="space-y-4 px-4 py-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-foreground-500">
        {session.actualStart && <span><span className="font-semibold text-foreground-700">Started</span> {formatSessionDate(session.actualStart, '')}</span>}
        <span><span className="font-semibold text-foreground-700">Attended</span> {attendedCount}</span>
        <span><span className="font-semibold text-foreground-700">Expected per run</span> {expectedCount}</span>
        {attendanceRuns.length > 1 && <span><span className="font-semibold text-foreground-700">Attendance runs</span> {attendanceRuns.length}</span>}
        <span><span className="font-semibold text-foreground-700">Recordings</span> {recordings.length}</span>
        <span><span className="font-semibold text-foreground-700">Transcripts</span> {transcripts.length}</span>
      </div>

      {/* This panel only opens for an occurrence the sync service has already
          pulled (see `canExpand`), so nothing here is "still coming" — an empty
          result is a meeting Teams holds no recording for. */}
      {recordings.length === 0 && transcripts.length === 0 && (
        <p className="text-[12px] text-foreground-500">
          Teams held no recording or transcript for this session when it was last synced
          {session.artifactsSyncedAt ? ` (${formatSessionDate(session.artifactsSyncedAt, '')})` : ''}.
        </p>
      )}

      {(recordings.length > 0 || transcripts.length > 0) && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {recordings.map((item, index) => (
              <div key={item.id} className="inline-flex overflow-hidden rounded-lg border border-primary-200 bg-background-50">
                <button
                  type="button"
                  onClick={() => {
                    setTranscriptPreviewId('');
                    setRecordingPreviewId(current => current === item.id ? '' : item.id);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 bg-primary-600 px-2.5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
                >
                  <AppIcon className="ri-play-circle-line text-sm"></AppIcon>
                  Preview recording {recordings.length > 1 ? index + 1 : ''}
                </button>
                <a
                  href={liveSessionArtifactContentUrl(session.liveSessionId, item.id)}
                  download
                  className="inline-flex h-8 items-center gap-1.5 border-l border-primary-200 px-2.5 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-50"
                >
                  <AppIcon className="ri-download-line text-sm"></AppIcon>
                  Download
                </a>
              </div>
            ))}
            {transcripts.map((item, index) => (
              <div key={item.id} className="inline-flex overflow-hidden rounded-lg border border-background-200 bg-background-50">
                <button
                  type="button"
                  onClick={() => {
                    setRecordingPreviewId('');
                    setTranscriptPreviewId(current => current === item.id ? '' : item.id);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
                >
                  <AppIcon className="ri-file-text-line text-sm"></AppIcon>
                  Preview transcript {transcripts.length > 1 ? index + 1 : ''}
                </button>
                <a
                  href={liveSessionArtifactContentUrl(session.liveSessionId, item.id)}
                  download
                  className="inline-flex h-8 items-center gap-1.5 border-l border-background-200 px-2.5 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-50"
                >
                  <AppIcon className="ri-download-line text-sm"></AppIcon>
                  Download
                </a>
              </div>
            ))}
          </div>

          {recordingPreviewId && (
            <div className="rounded-xl border border-background-200 bg-black p-2">
              <video
                controls
                preload="metadata"
                className="max-h-[480px] w-full rounded-lg bg-black"
                src={liveSessionArtifactPreviewUrl(session.liveSessionId, recordingPreviewId)}
              />
            </div>
          )}

          {transcriptPreviewId && (
            <div className="max-h-[420px] overflow-y-auto rounded-xl border border-background-200 bg-background-50 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-bold text-foreground-800">Meeting transcript</p>
                  <p className="text-[10px] text-foreground-400">Speaker, timestamp and spoken text</p>
                </div>
                <button type="button" onClick={() => setTranscriptPreviewId('')} className="text-[11px] font-bold text-foreground-500 hover:text-foreground-800">
                  Close preview
                </button>
              </div>
              {transcriptState.status === 'loading' && <p className="text-[12px] text-foreground-500">Loading transcript…</p>}
              {transcriptState.status === 'error' && <p className="text-[12px] text-red-600">{transcriptState.message}</p>}
              {transcriptState.status === 'ready' && transcriptState.cues.length === 0 && (
                <p className="text-[12px] text-foreground-500">The transcript file contains no readable speech.</p>
              )}
              {transcriptState.status === 'ready' && transcriptState.cues.length > 0 && (
                <div className="space-y-2">
                  {transcriptState.cues.map((cue, index) => (
                    <div key={`${cue.start}-${index}`} className="grid grid-cols-[54px_minmax(110px,180px)_1fr] gap-3 rounded-lg bg-background-100 px-3 py-2 text-[12px]">
                      <span className="font-mono text-[10px] text-foreground-400">{cue.start}</span>
                      <span className="font-bold text-foreground-700">{cue.speaker}</span>
                      <span className="leading-relaxed text-foreground-700">{cue.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Attendance</p>
        </div>
        {sheetError && <p className="mb-2 text-[11px] font-semibold text-red-600">{sheetError}</p>}
        {attendance.length === 0 ? (
          <p className="text-[12px] text-foreground-500">No attendance was captured for this session.</p>
        ) : (
          <div className="max-h-[360px] overflow-auto rounded-xl border border-background-200">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-background-100 text-[10px] uppercase tracking-wide text-foreground-500 shadow-[0_1px_0_var(--color-background-200)]">
                <tr>
                  <th className="px-3 py-2 font-bold">Attendee</th>
                  <th className="px-3 py-2 font-bold">Attendance</th>
                  <th className="px-3 py-2 font-bold">Role</th>
                  <th className="px-3 py-2 text-center font-bold">Join sessions</th>
                  <th className="px-3 py-2 text-right font-bold">Time in session</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRuns.map(run => (
                  <Fragment key={run.key}>
                    <tr className="border-t border-primary-100 bg-primary-50/70">
                      <td colSpan={5} className="px-3 py-2 text-[11px] font-bold text-primary-800">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <AppIcon className="ri-calendar-event-line mr-1.5"></AppIcon>
                            {run.startedAt ? formatSessionDate(run.startedAt, run.startedAt) : 'Attendance report'}
                            <span className="ml-2 font-semibold text-primary-600">
                              {run.rows.filter(person => person.attended !== false).length} attended / {run.rows.filter(person => person.expected !== false).length} expected
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSheetError('');
                              void downloadAttendanceSheet(session, run.rows).catch(error => {
                                setSheetError(error instanceof Error ? error.message : 'Attendance sheet could not be downloaded.');
                              });
                            }}
                            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[10px] font-bold text-emerald-700 transition-smooth hover:bg-emerald-100"
                          >
                            <AppIcon className="ri-file-excel-2-line text-sm"></AppIcon>
                            Download
                          </button>
                        </div>
                      </td>
                    </tr>
                    {run.rows.map(person => (
                  <tr key={person.id} className="border-t border-background-200">
                    <td className="px-3 py-2">
                      <span className="font-semibold text-foreground-800">{person.display_name || person.email || 'Unknown'}</span>
                      {person.email && person.display_name && <span className="ml-1 text-foreground-400">· {person.email}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
                        person.attended === false
                          ? 'bg-red-50 text-red-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        <AppIcon className={person.attended === false ? 'ri-close-circle-fill' : 'ri-checkbox-circle-fill'}></AppIcon>
                        {person.attended === false ? 'Absent' : 'Attended'}
                      </span>
                    </td>
                    <td className="px-3 py-2 capitalize text-foreground-600">{person.role || '—'}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-foreground-700">
                      {person.join_count ?? person.intervals?.length ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground-700">
                      {person.attended === false ? '—' : formatSeconds(person.total_attendance_seconds || 0)}
                    </td>
                  </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- session row

function SessionRow({
  session,
  moduleHref,
  artifactState,
  onToggle,
  onSync,
  syncing,
  expanded,
  onSynced,
}: {
  session: DeliverySession;
  moduleHref: string;
  artifactState: ArtifactState | undefined;
  onToggle: () => void;
  onSync: () => void;
  syncing: boolean;
  expanded: boolean;
  /** Re-read the occurrences after a sync, so the row leaves its unsynced state
   *  on the same data every other row is drawn from rather than a local guess. */
  onSynced: () => void;
}) {
  const hasLoadedOccurrence = artifactState?.status === 'ready' && Boolean(artifactState.occurrence);
  const isCompleted = statusClass(session.status) === 'completed';
  const canExpand = session.kind === 'live' && Boolean(session.liveSessionId) && (isCompleted || hasLoadedOccurrence);
  const [copied, setCopied] = useState(false);
  const launchUrl = session.kind === 'live' && session.liveSessionId && session.occurrenceId
    ? liveSessionJoinUrl(session.liveSessionId, session.occurrenceId)
    : session.url;

  const copyLink = useCallback(() => {
    if (!session.url) return;
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(session.url).then(done).catch(() => done());
    } else {
      // Fallback for insecure/legacy contexts where the async clipboard is absent.
      const field = document.createElement('textarea');
      field.value = session.url;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { document.execCommand('copy'); } catch { /* no-op */ }
      document.body.removeChild(field);
      done();
    }
  }, [session.url]);

  return (
    <div className="border-t border-background-200 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <button
          type="button"
          onClick={canExpand ? onToggle : undefined}
          aria-expanded={canExpand ? expanded : undefined}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${canExpand ? 'text-foreground-500 hover:bg-background-100' : 'cursor-default text-transparent'}`}
        >
          <AppIcon className={`${expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-base`}></AppIcon>
        </button>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${isMissing ? 'bg-amber-50 text-amber-600' : session.kind === 'live' ? 'bg-primary-50 text-primary-600' : 'bg-sky-50 text-sky-700'}`}>
          <AppIcon className={`${isMissing ? 'ri-calendar-close-line' : session.kind === 'live' ? 'ri-microsoft-teams-line' : 'ri-film-line'} text-[11px]`}></AppIcon>
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground-800">{session.title}</span>

        {!isMissing && (
          <span className="text-[11px] text-foreground-500">
            {session.kind === 'live'
              ? (formatSessionDate(session.dateIso, session.date || 'Date not set') + (session.time ? ` · ${session.time}` : ''))
              : (session.provider || 'Provider not set')}
          </span>
        )}
        {session.durationMinutes > 0 && (
          <span className="text-[11px] tabular-nums text-foreground-400">{session.durationMinutes}m</span>
        )}
        <StatusBadge status={session.status} />

        {session.kind === 'live' && session.liveSessionId && (
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            title="Ask Microsoft Graph now for attendance, transcripts and recordings."
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-2 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-100 disabled:cursor-wait disabled:opacity-60"
          >
            <AppIcon className={`${syncing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} text-sm`}></AppIcon>
            {syncing ? 'Syncing&' : 'Sync'}
          </button>
        )}

        {session.url && (
          <a
            href={launchUrl}
            target="_blank"
            rel="noreferrer"
            title={session.kind === 'live' ? 'Join this meeting in Microsoft Teams' : 'Open this recording'}
            className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-bold transition-smooth ${session.kind === 'live' ? 'meeting-join-action' : 'bg-primary-600 text-white hover:bg-primary-700'}`}
          >
            <AppIcon className={`${session.kind === 'live' ? 'ri-microsoft-teams-line' : 'ri-play-circle-line'} text-sm`}></AppIcon>
            {session.kind === 'live' ? 'Join' : 'Watch'}
          </a>
        )}
        {session.url && (
          <button
            type="button"
            onClick={copyLink}
            title={copied ? 'Link copied' : session.kind === 'live' ? 'Copy the meeting link' : 'Copy the recording link'}
            aria-label="Copy link"
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-smooth ${copied ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100'}`}
          >
            <AppIcon className={`${copied ? 'ri-check-line' : 'ri-file-copy-line'} text-sm`}></AppIcon>
          </button>
        )}
        {moduleHref && (
          <a
            href={moduleHref}
            title="Open the owning module in the Module Builder"
            aria-label="Open in Module Builder"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-500 transition-smooth hover:bg-background-100"
          >
            <AppIcon className="ri-edit-box-line text-sm"></AppIcon>
          </a>
        )}
      </div>
      {/* Ended, but nothing has been pulled from Graph for it yet — nothing to
          lazy-load, so this is not gated behind the expand click the way a synced
          session's artifacts panel is. The button runs the same pull the Module
          Builder's Teams panel runs (POST .../artifacts/), then reloads the row. */}
      {isUnsynced && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-50/60 px-4 py-2.5 text-[12px] text-amber-800">
          <AppIcon className="ri-time-line shrink-0 text-sm"></AppIcon>
          <span className="flex-1">
            {syncError
              || syncNotice
              || 'This session ended, but its recording, transcript and attendance have not been pulled from Microsoft Teams yet.'}
          </span>
          <button
            type="button"
            onClick={runSync}
            disabled={syncing}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-2.5 text-[11px] font-bold text-white transition-smooth hover:bg-amber-700 disabled:opacity-70"
          >
            <AppIcon className={`${syncing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} text-sm`}></AppIcon>
            {syncing ? 'Syncing…' : 'Sync from Teams'}
          </button>
          {session.url && (
            <a
              href={session.url}
              target="_blank"
              rel="noreferrer"
              title="Open this meeting in Microsoft Teams"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 text-[11px] font-bold text-amber-800 transition-smooth hover:bg-amber-100"
            >
              <AppIcon className="ri-microsoft-teams-line text-sm"></AppIcon>
              Open in Teams
            </a>
          )}
        </div>
      )}
      {canExpand && expanded && (
        <div className="bg-background-50/60">
          <CompletedSessionPanel session={session} state={artifactState} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ collapsibles

function WeekBlock({
  group,
  moduleHrefFor,
  artifacts,
  expandedRows,
  onToggleRow,
  onSync,
  syncingSessionIds,
}: {
  group: WeekGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
  onSync: (session: DeliverySession) => void;
  syncingSessionIds: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-background-200 bg-background-50">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <AppIcon className={`${open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-sm text-foreground-400`}></AppIcon>
        <span className="text-[12px] font-bold text-foreground-700">
          Week {group.week}{group.weekTitle ? ` · ${group.weekTitle}` : ''}
        </span>
        <span className="ml-auto rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">{group.sessions.length}</span>
      </button>
      {open && (
        <div>
          {group.sessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              moduleHref={moduleHrefFor(session)}
              artifactState={artifacts.get(session.id)}
              expanded={expandedRows.has(session.id)}
              onToggle={() => onToggleRow(session)}
              onSync={() => onSync(session)}
              syncing={syncingSessionIds.has(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthBlock({
  group,
  moduleHrefFor,
  artifacts,
  expandedRows,
  onToggleRow,
  onSync,
  syncingSessionIds,
}: {
  group: MonthGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
  onSync: (session: DeliverySession) => void;
  syncingSessionIds: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <AppIcon className={`${open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-sm text-foreground-400`}></AppIcon>
        <AppIcon className="ri-calendar-2-line text-sm text-foreground-400"></AppIcon>
        <span className="text-[12px] font-bold uppercase tracking-wide text-foreground-600">{group.label}</span>
        <span className="ml-auto rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-500">{group.count}</span>
      </button>
      {open && (
        <div className="space-y-2 pl-4">
          {group.weeks.map(week => (
            <WeekBlock
              key={week.key}
              group={week}
              moduleHrefFor={moduleHrefFor}
              artifacts={artifacts}
              expandedRows={expandedRows}
              onToggleRow={onToggleRow}
              onSync={onSync}
              syncingSessionIds={syncingSessionIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleBlock({
  group,
  moduleHrefFor,
  artifacts,
  expandedRows,
  onToggleRow,
  onSync,
  syncingSessionIds,
  defaultOpen,
}: {
  group: ModuleGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
  onSync: (session: DeliverySession) => void;
  syncingSessionIds: Set<string>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-foreground-200/60 bg-background-50">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <AppIcon className={`${open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-base text-foreground-500`}></AppIcon>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          <AppIcon className="ri-stack-line text-sm"></AppIcon>
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-foreground-900">{group.module}</span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold">
          {group.completed > 0 && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">{group.completed} completed</span>}
          {group.scheduled > 0 && <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">{group.scheduled} scheduled</span>}
          {group.cancelled > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">{group.cancelled} cancelled</span>}
          {group.missing > 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">{group.missing} need a meeting</span>}
          <span className="rounded-full bg-background-100 px-2 py-0.5 text-foreground-500">{group.count}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-background-200 p-4">
          {group.months.map(month => (
            <MonthBlock
              key={month.key}
              group={month}
              moduleHrefFor={moduleHrefFor}
              artifacts={artifacts}
              expandedRows={expandedRows}
              onToggleRow={onToggleRow}
              onSync={onSync}
              syncingSessionIds={syncingSessionIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------ export

export function SessionsTree({
  sessions,
  moduleHrefFor,
  empty,
  onSynced,
  onSynced,
}: {
  sessions: DeliverySession[];
  moduleHrefFor: (session: DeliverySession) => string;
  empty: React.ReactNode;
  onSynced?: () => void | Promise<void>;
}) {
  const tree = useMemo(() => buildSessionTree(sessions), [sessions]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const [artifacts, setArtifacts] = useState<Map<string, ArtifactState>>(() => new Map());
  const [syncingSessionIds, setSyncingSessionIds] = useState<Set<string>>(() => new Set());
  const [syncNotice, setSyncNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const syncInFlight = useRef<Set<string>>(new Set());

  const loadArtifacts = useCallback(async (session: DeliverySession, skipCache = false) => {
    if (!session.liveSessionId) return null;
    setArtifacts(prev => new Map(prev).set(session.id, { status: 'loading' }));
    try {
      const response = await fetchLiveSessionArtifacts(session.liveSessionId, { skipCache });
      const rowInstant = Date.parse(session.dateIso);
      const occurrence = response.occurrences.find(item =>
        (session.occurrenceId && item.id === session.occurrenceId)
        || (session.sessionNumber && item.session_number === session.sessionNumber)
        || (Number.isFinite(rowInstant) && Date.parse(item.scheduled_start || '') === rowInstant),
      ) || null;
      setArtifacts(prev => new Map(prev).set(session.id, { status: 'ready', occurrence }));
      return occurrence;
    } catch (error) {
      setArtifacts(prev => new Map(prev).set(session.id, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to load session details.',
      }));
      return null;
    }
  }, []);

  const syncSession = useCallback(async (session: DeliverySession) => {
    if (!session.liveSessionId || syncInFlight.current.has(session.id)) return;
    syncInFlight.current.add(session.id);
    setSyncingSessionIds(current => new Set(current).add(session.id));
    setSyncNotice(null);
    try {
      const result = await syncTeamsMeetingArtifacts(session.liveSessionId);
      // Manual sync must bypass the ordinary GET cache. Otherwise the POST can
      // save new Graph rows while this panel still renders its old empty payload.
      const occurrence = await loadArtifacts(session, true);
      await onSynced?.();
      if (result.partial || result.errors.length) {
        setSyncNotice({ tone: 'warning', text: result.errors.join(' � ') || 'Some meeting files are not available from Microsoft yet.' });
      } else if (!occurrence) {
        setSyncNotice({ tone: 'warning', text: 'Microsoft returned data for this Teams series, but none could be matched to this session.' });
      } else {
        const attendanceCount = occurrence.attendance?.filter(person => person.attended !== false).length || 0;
        const artifactCount = occurrence.artifacts?.length || 0;
        const total = attendanceCount + artifactCount;
        setExpandedRows(current => new Set(current).add(session.id));
        setSyncNotice({
          tone: 'success',
          text: total
            ? `This session refreshed: ${attendanceCount} attendance record${attendanceCount === 1 ? '' : 's'} and ${artifactCount} transcript/recording file${artifactCount === 1 ? '' : 's'}.`
            : 'Microsoft has not published attendance or files for this session yet.',
        });
      }
    } catch (error) {
      setSyncNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Attendance, transcripts and recordings could not be synced.' });
    } finally {
      syncInFlight.current.delete(session.id);
      setSyncingSessionIds(current => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  }, [loadArtifacts, onSynced]);

  const onToggleRow = useCallback((session: DeliverySession) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(session.id)) {
        next.delete(session.id);
      } else {
        next.add(session.id);
        // Lazy-load the first time a completed row is opened; keep it after.
        setArtifacts(current => {
          if (!current.has(session.id)) void loadArtifacts(session);
          return current;
        });
      }
      return next;
    });
  }, [loadArtifacts]);

  // A sync rewrites what the artifacts endpoint would answer, so the lazily
  // cached panels are dropped with it — otherwise reopening a row it just filled
  // would redraw the empty payload fetched before the pull.
  const handleSynced = useCallback(() => {
    setArtifacts(new Map());
    onSynced();
  }, [onSynced]);

  if (!sessions.length) {
    return <>{empty}</>;
  }

  return (
    <div className="space-y-3">
      {syncNotice && (
        <div className={`rounded-xl border px-3 py-2 text-[12px] font-semibold ${
          syncNotice.tone === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : syncNotice.tone === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {syncNotice.text}
        </div>
      )}
      {tree.map((group, index) => (
        <ModuleBlock
          key={group.key}
          group={group}
          moduleHrefFor={moduleHrefFor}
          artifacts={artifacts}
          expandedRows={expandedRows}
          onToggleRow={onToggleRow}
          onSync={session => void syncSession(session)}
          syncingSessionIds={syncingSessionIds}
          defaultOpen={tree.length === 1 || index === 0}
        />
      ))}
    </div>
  );
}
