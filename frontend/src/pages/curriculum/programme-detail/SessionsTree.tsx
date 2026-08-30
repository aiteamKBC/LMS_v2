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
import { StatusBadge } from '../shared/entities/ui';
import type { DeliverySession } from './page';

// --------------------------------------------------------------- date helpers

/** Month bucket for a session, from its best instant. Undated sessions collapse
 *  into one "Unscheduled" bucket that always sorts last. */
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
  months: MonthGroup[];
}

function statusClass(status: string): 'scheduled' | 'completed' | 'cancelled' | 'other' {
  const value = status.toLowerCase();
  if (value === 'completed') return 'completed';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  if (value === 'scheduled') return 'scheduled';
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
      moduleGroup = { key: moduleName, module: moduleName, count: 0, scheduled: 0, completed: 0, cancelled: 0, months: [] };
      modules.set(moduleName, moduleGroup);
    }
    moduleGroup.count += 1;
    const bucketClass = statusClass(session.status);
    if (bucketClass === 'completed') moduleGroup.completed += 1;
    else if (bucketClass === 'cancelled') moduleGroup.cancelled += 1;
    else if (bucketClass === 'scheduled') moduleGroup.scheduled += 1;

    const bucket = sessionMonthBucket(session.dateIso);
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
}: {
  session: DeliverySession;
  moduleHref: string;
  artifactState: ArtifactState | undefined;
  onToggle: () => void;
  expanded: boolean;
}) {
  const isCompleted = statusClass(session.status) === 'completed';
  const canExpand = session.kind === 'live' && isCompleted && Boolean(session.liveSessionId);
  const [copied, setCopied] = useState(false);

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
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${session.kind === 'live' ? 'bg-primary-50 text-primary-600' : 'bg-sky-50 text-sky-700'}`}>
          <AppIcon className={`${session.kind === 'live' ? 'ri-microsoft-teams-line' : 'ri-film-line'} text-[11px]`}></AppIcon>
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground-800">{session.title}</span>

        <span className="text-[11px] text-foreground-500">
          {session.kind === 'live'
            ? (formatSessionDate(session.dateIso, session.date || 'Date not set') + (session.time ? ` · ${session.time}` : ''))
            : (session.provider || 'Provider not set')}
        </span>
        {session.durationMinutes > 0 && (
          <span className="text-[11px] tabular-nums text-foreground-400">{session.durationMinutes}m</span>
        )}
        <StatusBadge status={session.status} />

        {session.url && (
          <a
            href={session.url}
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
}: {
  group: WeekGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
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
}: {
  group: MonthGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
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
  defaultOpen,
}: {
  group: ModuleGroup;
  moduleHrefFor: (session: DeliverySession) => string;
  artifacts: Map<string, ArtifactState>;
  expandedRows: Set<string>;
  onToggleRow: (session: DeliverySession) => void;
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
}: {
  sessions: DeliverySession[];
  moduleHrefFor: (session: DeliverySession) => string;
  empty: React.ReactNode;
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
          defaultOpen={tree.length === 1 || index === 0}
        />
      ))}
    </div>
  );
}
