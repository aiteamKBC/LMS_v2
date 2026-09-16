// The recording, transcript and attendance a live Teams session leaves behind.
//
// One panel, two doors: the programme's Sessions tab opens it under a completed
// row, and the Live Teams Session component's own editor opens it under the
// meeting it belongs to — so a tutor who authored the session can download its
// recording (to split and re-upload as recorded components) without leaving the
// builder. Everything here reads what the Graph sync service already captured;
// nothing on this panel decides a status or a date of its own.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { formatSystemTimestamp, SYSTEM_TIME_ZONE, systemDateParts } from '@/lib/format';
import {
  fetchLiveSessionArtifacts,
  liveSessionArtifactContentUrl,
  liveSessionArtifactPreviewUrl,
  type LiveSessionAttendance,
  type LiveSessionArtifactOccurrence,
} from '@/lib/curriculumApi';
import { syncTeamsMeetingArtifacts } from '../../module-builder/moduleAuthoringData';

/** What the panel needs to know about the session it is drawn for. Both the
 *  Sessions tab's `DeliverySession` and a live-session component satisfy it. */
export interface LiveSessionArtifactTarget {
  /** The Teams series id (`component.settings.teamsLiveSessionId`). */
  liveSessionId: string;
  title: string;
  /** Sortable instant for this occurrence; used to name the attendance sheet. */
  dateIso: string;
  date: string;
  /** Set only once the sync service has seen the meeting run. */
  actualStart: string;
  artifactsSyncedAt: string;
}

export function formatSessionDate(dateIso: string, fallback: string): string {
  const trimmed = (dateIso || '').trim();
  if (!trimmed) return fallback;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = new Date(dateOnly ? `${trimmed}T12:00:00Z` : trimmed);
  if (Number.isNaN(date.getTime())) return fallback || trimmed;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: dateOnly ? 'UTC' : SYSTEM_TIME_ZONE,
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
    const timestampOptions: Intl.DateTimeFormatOptions = {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'short',
    };
    const joins = intervals.map(item => formatSystemTimestamp(String(item.joinDateTime || ''), timestampOptions)).filter(Boolean).join('; ');
    const leaves = intervals.map(item => formatSystemTimestamp(String(item.leaveDateTime || ''), timestampOptions)).filter(Boolean).join('; ');
    const seconds = Math.max(0, Number(person.total_attendance_seconds) || 0);
    return {
      'Attendee name': person.display_name || '',
      Email: person.email || '',
      'Meeting started (UK)': person.attendance_report_start
        ? formatSystemTimestamp(person.attendance_report_start, timestampOptions)
        : '',
      Status: person.attended === false ? 'Absent' : 'Attended',
      Expected: person.expected === false ? 'No' : 'Yes',
      Role: person.role || '',
      'Join sessions': person.join_count ?? intervals.length,
      'Time in session': formatSeconds(seconds),
      'Attendance seconds': Math.round(seconds),
      'Joined at (UK)': joins,
      'Left at (UK)': leaves,
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
    const parts = source ? systemDateParts(source) : null;
    const valid = Boolean(parts);
    const dateKey = parts
      ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
      : 'undated';
    const sheetName = valid
      ? formatSystemTimestamp(source, { day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, '')
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

async function downloadAttendanceSheet(session: LiveSessionArtifactTarget, attendance: LiveSessionAttendance[]) {
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

// --------------------------------------------------------------- artifact panel

export type ArtifactState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; occurrence: LiveSessionArtifactOccurrence | null };

export function CompletedSessionPanel({ session, state }: { session: LiveSessionArtifactTarget; state: ArtifactState | undefined }) {
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

// ------------------------------------------------- component-editor entry point

/**
 * The same panel, loading its own occurrence, for the Live Teams Session
 * component editor. The Sessions tab owns its artifact cache across a whole
 * tree of rows; a component editor shows exactly one meeting, so it fetches on
 * mount and offers the same manual Teams pull the Sessions tab offers.
 */
export function LiveSessionArtifactsPanel({
  session,
  occurrenceId,
  sessionNumber,
}: {
  session: LiveSessionArtifactTarget;
  /** The occurrence this component stands for, when either is known. Without
   *  them the panel falls back to matching on the scheduled instant. */
  occurrenceId?: string;
  sessionNumber?: number;
}) {
  const [state, setState] = useState<ArtifactState>({ status: 'loading' });
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async (skipCache = false) => {
    if (!session.liveSessionId) return null;
    setState({ status: 'loading' });
    try {
      const response = await fetchLiveSessionArtifacts(session.liveSessionId, { skipCache });
      const occurrence = matchArtifactOccurrence(response.occurrences, {
        occurrenceId, sessionNumber, dateIso: session.dateIso,
      });
      setState({ status: 'ready', occurrence });
      return occurrence;
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to load session details.',
      });
      return null;
    }
  }, [occurrenceId, sessionNumber, session.dateIso, session.liveSessionId]);

  useEffect(() => { void load(); }, [load]);

  const sync = useCallback(async () => {
    if (!session.liveSessionId || syncing) return;
    setSyncing(true);
    setNotice('');
    try {
      const result = await syncTeamsMeetingArtifacts(session.liveSessionId);
      // Past the GET cache: the POST has just written rows this panel would
      // otherwise redraw from the payload fetched before the pull.
      const occurrence = await load(true);
      if (result.partial || result.errors.length) {
        setNotice(result.errors.join(' · ') || 'Some meeting files are not available from Microsoft yet.');
      } else if (!occurrence) {
        setNotice('Microsoft returned data for this Teams series, but none could be matched to this session.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Attendance, transcripts and recordings could not be synced.');
    } finally {
      setSyncing(false);
    }
  }, [load, session.liveSessionId, syncing]);

  if (!session.liveSessionId) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-background-200 bg-background-50/60">
      <div className="flex flex-wrap items-center gap-3 border-b border-background-200 px-4 py-2.5">
        <AppIcon className="ri-video-download-line text-primary-600"></AppIcon>
        <span className="flex-1 text-[12px] font-bold text-foreground-800">Recording, transcript and attendance</span>
        <button
          type="button"
          onClick={() => { void sync(); }}
          disabled={syncing}
          title="Ask Microsoft Graph now for attendance, transcripts and recordings."
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-2 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-100 disabled:cursor-wait disabled:opacity-60"
        >
          <AppIcon className={`${syncing ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} text-sm`}></AppIcon>
          {syncing ? 'Syncing…' : 'Sync from Teams'}
        </button>
      </div>
      {notice && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] font-semibold text-amber-800">{notice}</p>}
      {state.status === 'ready' && !state.occurrence ? (
        <p className="px-4 py-3 text-[12px] text-foreground-500">
          Microsoft holds nothing for this session yet. It appears here once the meeting has run and been synced.
        </p>
      ) : (
        <CompletedSessionPanel session={session} state={state} />
      )}
    </div>
  );
}

/** Pick this component's occurrence out of the series' artifacts payload: its
 *  own id first, then its session number, then the instant it is scheduled for. */
export function matchArtifactOccurrence(
  occurrences: LiveSessionArtifactOccurrence[],
  match: { occurrenceId?: string; sessionNumber?: number; dateIso?: string },
): LiveSessionArtifactOccurrence | null {
  const instant = Date.parse(match.dateIso || '');
  return occurrences.find(item => (
    (match.occurrenceId && item.id === match.occurrenceId)
    || (match.sessionNumber && item.session_number === match.sessionNumber)
    || (Number.isFinite(instant) && Date.parse(item.scheduled_start || '') === instant)
  )) || null;
}
