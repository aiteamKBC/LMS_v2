import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import {
  coachMeetingArtifactContentUrl,
  fetchCoachMeetingArtifacts,
  type CoachMeetingArtifact,
  type CoachMeetingAttendanceRecord,
  type CoachMeetingAttendanceSummary,
  type CoachMeetingAttendanceTrackerRow,
} from './calendarEvents';

interface CoachMeetingArtifactEvent {
  id: string;
  eventKey?: string;
  title?: string;
  source?: string;
  status?: string;
  meetingLink?: string;
  graphWebLink?: string;
}

type ArtifactState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; artifacts: CoachMeetingArtifact[]; attendance: CoachMeetingAttendanceSummary | null; errors: string[] }
  | { status: 'error'; message: string };

type PreviewSelection = {
  artifact: CoachMeetingArtifact;
  artifactId: string;
  type: string;
  url: string;
};

type TranscriptPreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error'; message: string };

function artifactLabel(type: string) {
  if (type === 'transcript') return 'Transcript';
  if (type === 'recording') return 'Recording';
  return type.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function artifactIcon(type: string) {
  if (type === 'transcript') return 'ri-file-text-line';
  if (type === 'recording') return 'ri-video-download-line';
  return 'ri-attachment-2';
}

function artifactDate(value?: string) {
  if (!value) return 'Microsoft Teams artifact';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Microsoft Teams artifact';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sourceLabel(value?: string) {
  if (value === 'mcr') return 'MCM';
  if (value === 'progress-review') return 'PR';
  if (value === 'catch-up') return 'Catch-up';
  if (value === 'student-support') return 'Support';
  return value ? value.replace(/[-_]+/g, ' ') : 'Coach meeting';
}

function artifactKey(artifact: CoachMeetingArtifact) {
  const type = artifact.artifact_type || 'artifact';
  return `${type}-${artifact.graph_artifact_id || artifact.id}`;
}

function durationLabel(seconds?: number) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  if (!totalSeconds) return '0 min';
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function roleLabel(role?: string) {
  const normalized = (role || '').toLowerCase();
  if (normalized === 'coach') return 'Coach';
  if (normalized === 'learner') return 'Learner';
  if (normalized === 'employer') return 'Employer';
  if (normalized === 'presenter') return 'Presenter';
  return role ? role.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : 'Attendee';
}

function trackerStatusClass(status?: string) {
  if (status === 'attended') return 'bg-emerald-50 text-emerald-700';
  if (status === 'absent') return 'bg-red-50 text-red-700';
  if (status === 'pending') return 'bg-amber-50 text-amber-700';
  if (status === 'extra') return 'bg-blue-50 text-blue-700';
  return 'bg-background-100 text-foreground-600';
}

function trackerStatusLabel(status?: string) {
  if (status === 'attended') return 'Attended';
  if (status === 'absent') return 'Absent';
  if (status === 'pending') return 'Pending';
  if (status === 'extra') return 'Extra';
  return status ? status.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : 'Unknown';
}

function actualRecordsAsTracker(records: CoachMeetingAttendanceRecord[]): CoachMeetingAttendanceTrackerRow[] {
  return records.map((record, index) => ({
    id: record.id || `actual-${index}`,
    role: record.role || 'attendee',
    name: record.displayName || record.email || 'Unknown attendee',
    displayName: record.displayName,
    email: record.email,
    expected: false,
    required: false,
    attended: record.attended,
    status: record.attended ? 'extra' : 'absent',
    totalAttendanceSeconds: record.totalAttendanceSeconds || 0,
    actualDisplayName: record.displayName,
    actualRecordIds: record.id ? [record.id] : [],
    reportIds: record.reportId ? [record.reportId] : [],
  }));
}

function transcriptPreviewText(raw: string) {
  const lines = raw.replace(/\r/g, '').split('\n');
  const visible: string[] = [];
  let skippingNote = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      skippingNote = false;
      if (visible.length && visible[visible.length - 1] !== '') visible.push('');
      continue;
    }
    if (skippingNote) continue;
    if (/^WEBVTT/i.test(trimmed)) continue;
    if (/^(Kind|Language):/i.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (trimmed.includes('-->')) continue;
    if (/^NOTE\b/i.test(trimmed)) {
      skippingNote = true;
      continue;
    }

    visible.push(trimmed.replace(/<[^>]+>/g, ''));
  }

  return visible.join('\n').replace(/\n{3,}/g, '\n\n').trim() || raw.trim() || 'Transcript content is empty.';
}

function AttendanceTracker({ attendance }: { attendance: CoachMeetingAttendanceSummary | null }) {
  const records = attendance?.records || [];
  const hasReport = Boolean(attendance?.reportCount);
  const trackerRows = attendance?.tracker?.length ? attendance.tracker : actualRecordsAsTracker(records);
  const expectedRows = trackerRows.filter(row => row.expected);
  const attendedExpected = attendance?.expectedAttendedCount ?? expectedRows.filter(row => row.status === 'attended').length;
  const expectedCount = attendance?.expectedCount ?? expectedRows.length;
  const absentExpected = attendance?.expectedAbsentCount ?? expectedRows.filter(row => row.status === 'absent').length;
  const pendingExpected = attendance?.expectedPendingCount ?? expectedRows.filter(row => row.status === 'pending').length;
  const extraCount = attendance?.extraCount ?? trackerRows.filter(row => !row.expected && row.status === 'extra').length;
  const totalDuration = trackerRows.reduce(
    (sum, row) => sum + (row.attended ? Math.max(0, Number(row.totalAttendanceSeconds || 0)) : 0),
    0,
  );

  return (
    <div className="mt-3 rounded-lg border border-background-200 bg-background-50 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-foreground-900">
            <AppIcon className="ri-user-follow-line text-emerald-600"></AppIcon>
            Attendance tracking
          </p>
          <p className="mt-0.5 text-[12px] text-foreground-500">
            Expected people are matched against Microsoft Teams attendance reports.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
          {expectedCount ? (
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{attendedExpected}/{expectedCount} expected attended</span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{records.filter(record => record.attended).length} actual attended</span>
          )}
          {hasReport ? (
            <span className={cn('rounded-full px-2 py-1', absentExpected > 0 ? 'bg-red-50 text-red-700' : 'bg-background-100 text-foreground-600')}>
              {absentExpected} absent
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{pendingExpected || expectedCount || 0} pending</span>
          )}
          {extraCount > 0 ? (
            <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">{extraCount} extra</span>
          ) : null}
          <span className="rounded-full bg-background-100 px-2 py-1 text-foreground-600">{attendance?.reportCount || 0} reports</span>
          <span className="rounded-full bg-primary-50 px-2 py-1 text-primary-700">{durationLabel(totalDuration)} total</span>
        </div>
      </div>

      {!hasReport ? (
        <p className="mt-2 rounded-md border border-background-200 bg-white px-3 py-2 text-[12px] text-foreground-500">
          The expected list is ready. Teams attendance will be matched here after the meeting ends and the report is returned.
        </p>
      ) : null}

      {hasReport && records.length === 0 ? (
        <p className="mt-2 rounded-md border border-background-200 bg-white px-3 py-2 text-[12px] text-foreground-500">
          Teams returned an attendance report, but no attendee rows were included.
        </p>
      ) : null}

      {trackerRows.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded-md border border-background-200 bg-white">
          {trackerRows.slice(0, 12).map((row, index) => (
            <div key={`${row.expected ? 'expected' : 'actual'}-${row.id}-${index}`} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-background-100 px-3 py-2 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-foreground-800">{row.displayName || row.name || row.email || 'Unknown attendee'}</p>
                {row.email ? <p className="truncate text-[11px] text-foreground-400">{row.email}</p> : null}
              </div>
              <span className="rounded-full bg-background-100 px-2 py-1 text-[11px] font-bold text-foreground-600">
                {row.expected ? roleLabel(row.role) : `Extra ${roleLabel(row.role)}`}
              </span>
              <span className={cn(
                'rounded-full px-2 py-1 text-[11px] font-bold',
                trackerStatusClass(row.status),
              )}>
                {trackerStatusLabel(row.status)}
              </span>
              <span className="text-[11px] font-semibold text-foreground-500">{durationLabel(row.totalAttendanceSeconds)}</span>
            </div>
          ))}
          {trackerRows.length > 12 ? (
            <p className="px-3 py-2 text-[11px] font-semibold text-foreground-400">
              +{trackerRows.length - 12} more attendance rows
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TranscriptPreview({ preview }: { preview: TranscriptPreviewState }) {
  if (preview.status === 'loading') {
    return (
      <div className="flex min-h-32 items-center justify-center gap-2 rounded-lg bg-white text-[12px] font-semibold text-primary-700">
        <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
        Loading transcript preview
      </div>
    );
  }
  if (preview.status === 'error') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
        {preview.message}
      </div>
    );
  }
  if (preview.status === 'ready') {
    return (
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-[12px] leading-5 text-foreground-700">
        {preview.text}
      </pre>
    );
  }
  return null;
}

export function CoachMeetingArtifactsPanel({
  event,
  className,
}: {
  event: CoachMeetingArtifactEvent;
  className?: string;
}) {
  const eventKey = event.eventKey || '';
  const hasTeamsLink = Boolean(event.meetingLink || event.graphWebLink);
  const [state, setState] = useState<ArtifactState>({ status: 'idle' });
  const [preview, setPreview] = useState<PreviewSelection | null>(null);
  const [transcriptPreview, setTranscriptPreview] = useState<TranscriptPreviewState>({ status: 'idle' });

  useEffect(() => {
    setPreview(null);
    if (!eventKey || !hasTeamsLink || event.source === 'live-session') {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchCoachMeetingArtifacts(eventKey, controller.signal)
      .then(result => {
        setState({
          status: 'ready',
          artifacts: result.artifacts || [],
          attendance: result.attendance || null,
          errors: result.errors || [],
        });
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to load Teams artifacts.',
        });
      });
    return () => controller.abort();
  }, [event.source, eventKey, hasTeamsLink]);

  useEffect(() => {
    if (!preview || preview.type !== 'transcript') {
      setTranscriptPreview({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    setTranscriptPreview({ status: 'loading' });
    fetch(preview.url, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        const text = await response.text();
        if (!response.ok) {
          throw new Error(text || `Transcript preview failed with ${response.status}`);
        }
        setTranscriptPreview({ status: 'ready', text: transcriptPreviewText(text) });
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setTranscriptPreview({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to preview transcript.',
        });
      });

    return () => controller.abort();
  }, [preview]);

  const grouped = useMemo(() => {
    if (state.status !== 'ready') return { transcripts: [], recordings: [] };
    return {
      transcripts: state.artifacts.filter(artifact => artifact.artifact_type === 'transcript'),
      recordings: state.artifacts.filter(artifact => artifact.artifact_type === 'recording'),
    };
  }, [state]);

  if (event.source === 'live-session' || !eventKey || !hasTeamsLink) return null;

  const artifacts = state.status === 'ready' ? state.artifacts : [];
  const attendance = state.status === 'ready' ? state.attendance : null;
  const hasArtifacts = artifacts.length > 0;

  return (
    <div className={cn('rounded-lg border border-background-200 bg-white p-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-foreground-500">
            <AppIcon className="ri-folder-video-line text-primary-500"></AppIcon>
            Recording, Transcript & Attendance
          </p>
          <p className="mt-1 text-[12px] leading-5 text-foreground-500">
            {sourceLabel(event.source)} artifacts from Microsoft Teams.
          </p>
        </div>
        {state.status === 'loading' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-[12px] font-semibold text-primary-700">
            <AppIcon className="ri-loader-4-line animate-spin"></AppIcon>
            Checking
          </span>
        ) : null}
      </div>

      {state.status === 'error' ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
          {state.message}
        </div>
      ) : null}

      {state.status === 'ready' ? <AttendanceTracker attendance={attendance} /> : null}

      {state.status === 'ready' && !hasArtifacts ? (
        <div className="mt-3 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[12px] leading-5 text-foreground-500">
          No recording or transcript has been returned by Teams yet. They usually appear after the meeting ends and Teams finishes processing.
        </div>
      ) : null}

      {hasArtifacts ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {[...grouped.transcripts, ...grouped.recordings].map(artifact => {
            const type = artifact.artifact_type || 'artifact';
            const artifactId = artifact.graph_artifact_id || artifact.id;
            const previewUrl = coachMeetingArtifactContentUrl(eventKey, type, artifactId, { preview: true });
            const downloadUrl = coachMeetingArtifactContentUrl(eventKey, type, artifactId);
            const selected = preview?.type === type && preview.artifactId === artifactId;
            return (
              <div key={artifactKey(artifact)} className="rounded-lg border border-background-200 bg-background-50 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <AppIcon className={artifactIcon(type)}></AppIcon>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-foreground-900">{artifactLabel(type)}</p>
                    <p className="mt-0.5 truncate text-[12px] text-foreground-500">
                      {artifactDate(artifact.end_datetime || artifact.created_datetime)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setPreview({ artifact, artifactId, type, url: previewUrl })}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-semibold transition',
                          selected
                            ? 'border-primary-400 bg-primary-50 text-primary-800'
                            : 'border-primary-200 bg-white text-primary-700 hover:border-primary-300 hover:bg-primary-50',
                        )}
                      >
                        <AppIcon className={type === 'recording' ? 'ri-play-circle-line' : 'ri-eye-line'}></AppIcon>
                        {type === 'recording' ? 'Play' : 'Preview'}
                      </button>
                      <a
                        href={downloadUrl}
                        className="inline-flex items-center gap-1 rounded-md border border-background-300 bg-white px-2 py-1 text-[12px] font-semibold text-foreground-700 transition hover:border-background-400 hover:bg-background-100"
                      >
                        <AppIcon className="ri-download-2-line"></AppIcon>
                        Download
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {preview ? (
        <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-bold text-primary-900">
                {artifactLabel(preview.type)} preview
              </p>
              <p className="truncate text-[11px] text-primary-700">
                {artifactDate(preview.artifact.end_datetime || preview.artifact.created_datetime)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-primary-200 bg-white px-2 text-[12px] font-semibold text-primary-700 hover:bg-primary-50"
            >
              <AppIcon className="ri-close-line"></AppIcon>
              Close
            </button>
          </div>
          {preview.type === 'recording' ? (
            <video
              key={preview.url}
              src={preview.url}
              controls
              preload="metadata"
              className="max-h-[420px] w-full rounded-lg bg-black"
            >
              <track kind="captions" />
            </video>
          ) : preview.type === 'transcript' ? (
            <TranscriptPreview preview={transcriptPreview} />
          ) : (
            <div className="rounded-lg border border-background-200 bg-white px-3 py-2 text-[12px] text-foreground-500">
              Inline preview is not available for this artifact type.
            </div>
          )}
        </div>
      ) : null}

      {state.status === 'ready' && state.errors.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
          {state.errors.join(' ')}
        </div>
      ) : null}
    </div>
  );
}
