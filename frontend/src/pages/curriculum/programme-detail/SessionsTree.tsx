// The Sessions tab's delivery view: a collapsible Module → Month → Week → session
// tree rather than one flat list, so a programme with dozens of sessions reads as
// a small set of modules that open on demand. A completed live session expands
// further to the attendance / transcript / recording the sync service captured.
//
// Statuses shown here (scheduled / completed / cancelled) are authored by the
// Graph artifact-sync service and read straight off the occurrence — this view
// never decides a status from a date. See `deliverySessions` in page.tsx.
import { useCallback, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  fetchLiveSessionArtifacts,
  liveSessionArtifactContentUrl,
  type LiveSessionArtifactOccurrence,
} from '@/lib/curriculumApi';
import { syncTeamsMeetingArtifacts } from '../module-builder/moduleAuthoringData';
import { formatDateLabel } from '../shared/entities/model';
import { StatusBadge } from '../shared/entities/ui';
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

// ------------------------------------------------------------------- tree model

interface WeekGroup {
  key: string;
  week: number;
  weekTitle: string;
  weekStartDate: string;
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
      weekGroup = { key: weekKey, week: session.week, weekTitle: session.weekTitle, weekStartDate: session.weekStartDate, sessions: [] };
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
  if (!state || state.status === 'loading') {
    return <p className="px-4 py-3 text-[12px] text-foreground-500">Loading attendance and recordings…</p>;
  }
  if (state.status === 'error') {
    return <p className="px-4 py-3 text-[12px] text-red-600">{state.message}</p>;
  }
  const occurrence = state.occurrence;
  const attendance = occurrence?.attendance || [];
  const artifacts = occurrence?.artifacts || [];
  const transcripts = artifacts.filter(item => (item.artifact_type || '').toLowerCase() === 'transcript');
  const recordings = artifacts.filter(item => (item.artifact_type || '').toLowerCase() === 'recording');

  return (
    <div className="space-y-4 px-4 py-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-foreground-500">
        {session.actualStart && <span><span className="font-semibold text-foreground-700">Started</span> {formatSessionDate(session.actualStart, '')}</span>}
        <span><span className="font-semibold text-foreground-700">Attendees</span> {session.participantCount || attendance.length}</span>
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
        <div className="flex flex-wrap gap-2">
          {recordings.map(item => (
            <a
              key={item.id}
              href={liveSessionArtifactContentUrl(session.liveSessionId, item.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-2.5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
            >
              <AppIcon className="ri-play-circle-line text-sm"></AppIcon>
              Watch recording
            </a>
          ))}
          {transcripts.map(item => (
            <a
              key={item.id}
              href={liveSessionArtifactContentUrl(session.liveSessionId, item.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-2.5 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100"
            >
              <AppIcon className="ri-file-text-line text-sm"></AppIcon>
              View transcript
            </a>
          ))}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground-400">Attendance</p>
        {attendance.length === 0 ? (
          <p className="text-[12px] text-foreground-500">No attendance was captured for this session.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-background-200">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-background-100 text-[10px] uppercase tracking-wide text-foreground-500">
                <tr>
                  <th className="px-3 py-2 font-bold">Attendee</th>
                  <th className="px-3 py-2 font-bold">Role</th>
                  <th className="px-3 py-2 text-right font-bold">Time in session</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map(person => (
                  <tr key={person.id} className="border-t border-background-200">
                    <td className="px-3 py-2">
                      <span className="font-semibold text-foreground-800">{person.display_name || person.email || 'Unknown'}</span>
                      {person.email && person.display_name && <span className="ml-1 text-foreground-400">· {person.email}</span>}
                    </td>
                    <td className="px-3 py-2 capitalize text-foreground-600">{person.role || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground-700">{formatSeconds(person.total_attendance_seconds || 0)}</td>
                  </tr>
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
  expanded,
  onSynced,
}: {
  session: DeliverySession;
  moduleHref: string;
  artifactState: ArtifactState | undefined;
  onToggle: () => void;
  expanded: boolean;
  /** Re-read the occurrences after a sync, so the row leaves its unsynced state
   *  on the same data every other row is drawn from rather than a local guess. */
  onSynced: () => void;
}) {
  const isCompleted = statusClass(session.status) === 'completed';
  const isMissing = statusClass(session.status) === 'missing';
  // A completed occurrence nothing has been pulled from Graph for yet — distinct
  // from one that was pulled and genuinely held no recording. Expanding it would
  // only fetch an artifacts payload that is not there, so the row offers the pull
  // itself instead.
  const isUnsynced = session.kind === 'live' && isCompleted && !session.artifactsSyncedAt;
  const canExpand = session.kind === 'live' && isCompleted && Boolean(session.liveSessionId) && Boolean(session.artifactsSyncedAt);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const runSync = useCallback(async () => {
    if (syncing || !session.liveSessionId) return;
    setSyncing(true);
    setSyncError(null);
    setSyncNotice(null);
    try {
      const result = await syncTeamsMeetingArtifacts(session.liveSessionId);
      // A pull that found nothing is not a failure — Teams may hold no recording
      // for this meeting — so it reports what it found either way, and the reload
      // is what decides whether the row is still unsynced.
      setSyncNotice(
        `Pulled ${result.synced.attendanceRecords} attendance record${result.synced.attendanceRecords === 1 ? '' : 's'},`
        + ` ${result.synced.recordings} recording${result.synced.recordings === 1 ? '' : 's'}`
        + ` and ${result.synced.transcripts} transcript${result.synced.transcripts === 1 ? '' : 's'}.`,
      );
      if (result.errors.length) setSyncError(result.errors.join(' · '));
      onSynced();
    } catch (reason) {
      setSyncError(reason instanceof Error ? reason.message : 'Unable to sync this session from Microsoft Teams.');
    } finally {
      setSyncing(false);
    }
  }, [onSynced, session.liveSessionId, syncing]);

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
        {/* Live sessions carry a real scheduling status (scheduled/completed/
            cancelled) from the sync service, worth showing here. Recorded
            content's `status` is its authoring publish state (draft/published/
            ...) from Module Builder — this view is about watch requirements,
            not authoring workflow, so it stays out of the row. A week with no
            meeting at all has its own icon and message already; the status
            badge would only print the literal "not-created" beside them. */}
        {session.kind === 'live' && !isMissing && <StatusBadge status={session.status} />}
        {isMissing && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            No Teams meeting
          </span>
        )}

        {isMissing ? (
          moduleHref && (
            <a
              href={moduleHref}
              title="Create this week's Teams meeting in the Module Builder"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-primary-600 px-2.5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
            >
              <AppIcon className="ri-add-line text-sm"></AppIcon>
              Create meeting
            </a>
          )
        ) : (
          <>
            {session.url && !isUnsynced && (
              <a
                href={session.url}
                target="_blank"
                rel="noreferrer"
                title={session.kind === 'live' ? (isCompleted ? 'Open this meeting in Microsoft Teams' : 'Join this meeting in Microsoft Teams') : 'Open this recording'}
                className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-bold transition-smooth ${session.kind === 'live' ? 'meeting-join-action' : 'bg-primary-600 text-white hover:bg-primary-700'}`}
              >
                <AppIcon className={`${session.kind === 'live' ? 'ri-microsoft-teams-line' : 'ri-play-circle-line'} text-sm`}></AppIcon>
                {session.kind === 'live' ? (isCompleted ? 'Open in Teams' : 'Join') : 'Watch'}
              </a>
            )}
            {session.url && !isUnsynced && (
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
          </>
        )}
        {moduleHref && !isMissing && (
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
  onSynced,
}: {
  group: WeekGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
  onSynced: () => void;
}) {
  const [open, setOpen] = useState(true);
  const weekDateLabel = useMemo(() => {
    const label = formatDateLabel(group.weekStartDate);
    return label === '—' ? '' : label;
  }, [group.weekStartDate]);
  return (
    <div className="rounded-lg border border-background-200 bg-background-50">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <AppIcon className={`${open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-sm text-foreground-400`}></AppIcon>
        {/* The number lives in its own badge, exactly as the Module Builder's
            week rail carries it, so the heading is the authored title alone --
            "Week 1 · Week name Test" printed the number twice, and read as two
            names for one week. An untitled week falls back to "Week N", which is
            the Builder's own fallback (`weekHeadingTitle`). */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[10px] font-extrabold text-white">
          {group.week}
        </span>
        <span className="min-w-0 truncate text-[12px] font-bold text-foreground-700">
          {group.weekTitle || `Week ${group.week}`}
        </span>
        {/* `formatDateLabel` answers "—" for a week whose module has no dated
            session yet; a dash beside the title says nothing, so it is left off
            entirely and the rows below carry their own dates. */}
        {weekDateLabel && (
          <span className="shrink-0 text-[11px] font-semibold text-foreground-400">{weekDateLabel}</span>
        )}
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
              onSynced={onSynced}
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
  onSynced,
}: {
  group: MonthGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
  onSynced: () => void;
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
              onSynced={onSynced}
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
  onSynced,
  defaultOpen,
}: {
  group: ModuleGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
  onSynced: () => void;
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
              onSynced={onSynced}
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
}: {
  sessions: DeliverySession[];
  moduleHrefFor: (session: DeliverySession) => string;
  empty: React.ReactNode;
  /** Called after a row pulls its artifacts from Teams, so the page re-reads the
   *  occurrences the rows are built from. */
  onSynced: () => void;
}) {
  const tree = useMemo(() => buildSessionTree(sessions), [sessions]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const [artifacts, setArtifacts] = useState<Map<string, ArtifactState>>(() => new Map());

  const loadArtifacts = useCallback(async (session: DeliverySession) => {
    if (!session.liveSessionId) return;
    setArtifacts(prev => new Map(prev).set(session.id, { status: 'loading' }));
    try {
      const response = await fetchLiveSessionArtifacts(session.liveSessionId);
      const rowInstant = Date.parse(session.dateIso);
      const occurrence = response.occurrences.find(item =>
        (session.occurrenceId && item.id === session.occurrenceId)
        || (session.sessionNumber && item.session_number === session.sessionNumber)
        || (Number.isFinite(rowInstant) && Date.parse(item.scheduled_start || '') === rowInstant),
      ) || null;
      setArtifacts(prev => new Map(prev).set(session.id, { status: 'ready', occurrence }));
    } catch (error) {
      setArtifacts(prev => new Map(prev).set(session.id, {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to load session details.',
      }));
    }
  }, []);

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
      {tree.map((group, index) => (
        <ModuleBlock
          key={group.key}
          group={group}
          moduleHrefFor={moduleHrefFor}
          artifacts={artifacts}
          expandedRows={expandedRows}
          onToggleRow={onToggleRow}
          onSynced={handleSynced}
          defaultOpen={tree.length === 1 || index === 0}
        />
      ))}
    </div>
  );
}
