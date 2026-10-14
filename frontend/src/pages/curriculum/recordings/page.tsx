import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { SessionRecordingPlayer } from '@/components/feature/SessionRecordingPlayer';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { formatSystemTimestamp } from '@/lib/format';
import {
  loadRecordingsLibrary, recordingDownloadUrl,
  type LibraryRecording, type LibraryRecordingStatus, type RecordingsAttention, type RecordingsDelivery,
  type RecordingsLibrary, type RecordingsWeek, type SessionFile,
} from '@/api/sessionResults';
import { EntityFilterBar, EntityHero, InlineError, WorkspacePanel } from '../shared/entities/ui';
import { matchesSearch } from '../shared/entities/model';

/**
 * Every saved live-session recording for the person who looks after them,
 * narrowed Programme -> Cohort -> Group -> Module -> Week. Each level shows
 * every recording under what is chosen so far. Read only: playing and
 * downloading go through the staff file route; nothing here syncs, contacts
 * Teams or storage, or touches a meeting. Every status comes from what the
 * last synchronization stored.
 */

type StatusFilter = '' | LibraryRecordingStatus | RecordingsAttention['status'] | 'archived';

const STATUS_LABELS: Record<Exclude<StatusFilter, ''>, string> = {
  available: 'Available',
  missingAzureFile: 'Missing Azure file',
  verificationRequired: 'Verification required',
  missingSync: 'Missing sync',
  notRecorded: 'Not recorded',
  archived: 'Archived',
};
const STATUS_ORDER = Object.keys(STATUS_LABELS) as Exclude<StatusFilter, ''>[];
const STATUS_TONES: Record<Exclude<StatusFilter, ''>, string> = {
  available: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  missingAzureFile: 'border-rose-200 bg-rose-50 text-rose-800',
  verificationRequired: 'border-amber-200 bg-amber-50 text-amber-900',
  missingSync: 'border-amber-200 bg-amber-50 text-amber-900',
  notRecorded: 'border-slate-200 bg-slate-100 text-slate-700',
  archived: 'border-slate-300 bg-slate-100 text-slate-700',
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const recordingsIn = (weeks: RecordingsWeek[]) => weeks.reduce((sum, week) => sum + week.recordings.length, 0);
const recordingsOf = (deliveries: RecordingsDelivery[]) => deliveries.flatMap(item => item.weeks.flatMap(week => week.recordings.map(recording => ({ item, recording }))));
// An archived module's recordings are counted as archived, never with running modules.
const recordingFilterStatus = (item: RecordingsDelivery, recording: LibraryRecording): Exclude<StatusFilter, ''> => (item.archived ? 'archived' : recording.status);

// An empty name is still a real bucket; the menu needs a non-empty value for it.
const NONE = '\u0000none';
const matches = (chosen: string, value: string) => !chosen || chosen === (value || NONE);

/** Distinct values of one level, in the order the server filed them, with how many recordings sit under each. */
function levelOptions(deliveries: RecordingsDelivery[], pick: (delivery: RecordingsDelivery) => string, all: string, missing: string) {
  const counts = new Map<string, number>();
  deliveries.forEach(delivery => counts.set(pick(delivery), (counts.get(pick(delivery)) ?? 0) + delivery.recordingCount));
  return [{ value: '', label: all }, ...[...counts].map(([value, count]) => ({ value: value || NONE, label: `${value || missing} (${count})` }))];
}

function weekLabel(week: Pick<RecordingsWeek, 'weekId' | 'weekNumber' | 'title'>) {
  if (!week.weekId) return 'Not matched to a week';
  const number = week.weekNumber ? `Week ${week.weekNumber}` : 'Week';
  return week.title ? `${number} · ${week.title}` : number;
}

const attentionWeekLabel = (session: RecordingsAttention) => weekLabel({ weekId: session.weekId, weekNumber: session.weekNumber, title: session.weekTitle });

function sessionLabel(session: { sessionNumber: number | null; startsAt: string | null }) {
  const when = session.startsAt
    ? formatSystemTimestamp(session.startsAt, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Session date not recorded';
  return session.sessionNumber ? `Session ${session.sessionNumber} · ${when}` : when;
}

function stateMessage(recording: LibraryRecording) {
  if (recording.status === 'missingAzureFile') return 'Saving a copy of this recording to storage failed, so there is no file to play or download. Request synchronization from the module\'s Sessions tab to retry.';
  return 'Teams has this recording, but no saved copy is confirmed yet, so it cannot be played or downloaded. A saved copy may still be being made; if this does not change, request synchronization from the module\'s Sessions tab.';
}

function StatusChip({ status }: { status: Exclude<StatusFilter, ''> }) {
  return <span className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-bold ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>;
}

function RecordingRow({ recording, playing, onTogglePlay }: {
  recording: LibraryRecording; playing: boolean; onTogglePlay: () => void;
}) {
  const ready = recording.state === 'ready';
  const file: SessionFile = { id: recording.id, type: 'recording', state: recording.state, createdAt: recording.recordedAt ?? undefined };
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold text-slate-900">{sessionLabel(recording)}</p>
            <StatusChip status={recording.status} />
          </div>
          {recording.hiddenFromLearners && <p className="text-[12px] text-amber-700">Hidden from learners</p>}
          {recording.duplicateCount > 0 && (
            <p className="text-[12px] text-slate-500">
              Teams listed this recording more than once; {plural(recording.duplicateCount, 'identical copy')} {recording.duplicateCount === 1 ? 'is' : 'are'} also stored and not shown.
            </p>
          )}
        </div>
        {ready && (
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onTogglePlay} aria-expanded={playing}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-white px-3 text-[12px] font-bold text-primary-800 hover:bg-primary-50">
              <AppIcon className={playing ? 'ri-close-line' : 'ri-play-line'} />
              {playing ? 'Close player' : 'Play'}
            </button>
            <a href={recordingDownloadUrl(recording.seriesId, recording.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[12px] font-bold text-white hover:bg-primary-700">
              <AppIcon className="ri-download-line" />
              Download
            </a>
          </div>
        )}
      </div>
      {!ready && <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-[12px] text-amber-900">{stateMessage(recording)}</p>}
      {ready && playing && (
        <div className="mt-3">
          <SessionRecordingPlayer seriesId={recording.seriesId} file={file} transcripts={[]} label={sessionLabel(recording)} />
        </div>
      )}
    </li>
  );
}

function AttentionList({ sessions }: { sessions: RecordingsAttention[] }) {
  return (
    <section aria-label="Sessions to check" className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <p className="text-[12px] font-bold text-amber-950">{plural(sessions.length, 'past session')} without a recording to check</p>
      <ul className="mt-2 space-y-2">
        {sessions.map(session => (
          <li key={session.occurrenceId} className="rounded-lg border border-amber-100 bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12px] font-semibold text-slate-900">{attentionWeekLabel(session)} · {sessionLabel(session)}</p>
              <StatusChip status={session.status} />
            </div>
            <p className="mt-1 text-[12px] text-slate-600">{session.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CurriculumRecordingsPage() {
  const [library, setLibrary] = useState<RecordingsLibrary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [programme, setProgramme] = useState('');
  const [cohort, setCohort] = useState('');
  const [group, setGroup] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [week, setWeek] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState('');

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    loadRecordingsLibrary(signal)
      .then(result => setLibrary(result))
      .catch(caught => { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'Recordings could not be loaded.'); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Each level is narrowed by the ones above it, so every menu offers only what has recordings under the choice so far.
  const levels = useMemo(() => {
    // Draft and archived programmes, and deleted (archived) modules, stay out unless asked for.
    const running = (library?.deliveries ?? []).filter(item => includeInactive || (item.programmeActive && !item.archived));
    const inProgramme = running.filter(item => matches(programme, item.programme));
    const inCohort = inProgramme.filter(item => matches(cohort, item.cohort));
    const inGroup = inCohort.filter(item => matches(group, item.group));
    const inModule = inGroup.filter(item => matches(moduleTitle, item.title));
    // Weeks are matched by their label: the same module title in two groups has different week records.
    const weekCounts = new Map<string, number>();
    inModule.forEach(item => {
      item.weeks.forEach(entry => weekCounts.set(weekLabel(entry), (weekCounts.get(weekLabel(entry)) ?? 0) + entry.recordings.length));
      item.attention.forEach(session => weekCounts.set(attentionWeekLabel(session), weekCounts.get(attentionWeekLabel(session)) ?? 0));
    });
    return {
      running, inModule,
      programmes: levelOptions(running, item => item.programme, includeInactive ? 'All programmes' : 'All active programmes', 'Programme not named'),
      cohorts: levelOptions(inProgramme, item => item.cohort, 'All cohorts', 'Cohort not named'),
      groups: levelOptions(inCohort, item => item.group, 'All groups', 'Group not named'),
      modules: levelOptions(inGroup, item => item.title, 'All modules', 'Untitled module'),
      weeks: [{ value: '', label: 'All weeks' }, ...[...weekCounts].map(([value, count]) => ({ value, label: `${value} (${count})` }))],
    };
  }, [library, includeInactive, programme, cohort, group, moduleTitle]);

  // Everything under the chosen levels, before the status filter, so the status menu can count each status.
  const scoped = useMemo(() => levels.inModule
    .filter(item => matchesSearch(search, [item.title, item.programme, item.cohort, item.group]))
    .map(item => ({
      ...item,
      weeks: week ? item.weeks.filter(entry => weekLabel(entry) === week) : item.weeks,
      attention: week ? item.attention.filter(session => attentionWeekLabel(session) === week) : item.attention,
    })), [levels, search, week]);

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    recordingsOf(scoped).forEach(({ item, recording }) => {
      const key = recordingFilterStatus(item, recording);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    scoped.forEach(item => item.attention.forEach(session => counts.set(session.status, (counts.get(session.status) ?? 0) + 1)));
    return [{ value: '', label: 'All statuses' }, ...STATUS_ORDER
      .filter(key => counts.get(key) || key === status)
      .map(key => ({ value: key, label: `${STATUS_LABELS[key]} (${counts.get(key) ?? 0})` }))];
  }, [scoped, status]);

  const deliveries = useMemo(() => scoped
    .map(item => {
      const weeks = status
        ? item.weeks.map(entry => ({ ...entry, recordings: entry.recordings.filter(recording => recordingFilterStatus(item, recording) === status) }))
          .filter(entry => entry.recordings.length)
        : item.weeks;
      const attention = status ? item.attention.filter(session => session.status === status) : item.attention;
      return { ...item, weeks, attention, recordingCount: recordingsIn(weeks) };
    })
    .filter(item => item.recordingCount > 0 || item.attention.length > 0), [scoped, status]);

  // Choosing a level clears every level below it, so a stale cohort or week can never hide recordings.
  const clearBelow = () => { setOpenWeeks(new Set()); setPlaying(''); };
  const chooseWeek = (value: string) => { setWeek(value); clearBelow(); };
  const chooseModule = (value: string) => { setModuleTitle(value); chooseWeek(''); };
  const chooseGroup = (value: string) => { setGroup(value); chooseModule(''); };
  const chooseCohort = (value: string) => { setCohort(value); chooseGroup(''); };
  const chooseProgramme = (value: string) => { setProgramme(value); chooseCohort(''); };
  const chooseStatus = (value: string) => { setStatus(value as StatusFilter); clearBelow(); };
  const toggleInactive = (value: boolean) => { setIncludeInactive(value); setStatus(''); chooseProgramme(''); };
  const reset = () => { setSearch(''); toggleInactive(false); };
  const toggleWeek = (key: string) => setOpenWeeks(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const shown = recordingsOf(deliveries);
  const total = shown.length;
  const available = shown.filter(({ item, recording }) => !item.archived && recording.status === 'available').length;
  const archived = shown.filter(({ item }) => item.archived).length;
  const sessionsToCheck = deliveries.reduce((sum, item) => sum + item.attention.length, 0);
  const needsAttention = shown.filter(({ item, recording }) => !item.archived && recording.status !== 'available').length + sessionsToCheck;
  const withRecordings = deliveries.filter(item => item.recordingCount > 0).length;
  const hasRecordings = Boolean(library?.deliveries.length);

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio"
      pageTitle="Session Recordings" pageSubtitle="Live-session recordings by programme, cohort, group, module and week" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="min-h-full space-y-4 bg-background-50 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Curriculum Studio"
          title="Session Recordings"
          description="Every saved Teams recording. Choose a programme, then a cohort, group, module and week; each choice shows every recording under it. Statuses come from the last results synchronization; this page never contacts Teams or storage by itself."
          loading={loading && !library}
          stats={[
            { icon: 'ri-vidicon-line', label: 'Recordings', value: total },
            { icon: 'ri-download-line', label: 'Available', value: available },
            { icon: 'ri-error-warning-line', label: 'Need attention', value: needsAttention },
            includeInactive
              ? { icon: 'ri-archive-line', label: 'Archived', value: archived }
              : { icon: 'ri-stack-line', label: 'Modules with recordings', value: withRecordings },
          ]}
        />

        {error && <InlineError message={error} onRetry={() => load()} />}

        {!error && library && !hasRecordings && (
          <WorkspacePanel title="No recordings yet">
            <p className="text-[13px] text-slate-600">No live session has a saved Teams recording yet. Recordings appear here after a recorded session ends and its results are synchronized.</p>
          </WorkspacePanel>
        )}

        {library && hasRecordings && (
          <>
            <EntityFilterBar
              search={search}
              onSearch={setSearch}
              placeholder="Search module, programme, cohort or group"
              selects={[
                { label: 'Programme', value: programme, onChange: chooseProgramme, options: levels.programmes },
                { label: 'Cohort', value: cohort, onChange: chooseCohort, options: levels.cohorts },
                { label: 'Group', value: group, onChange: chooseGroup, options: levels.groups },
                { label: 'Module', value: moduleTitle, onChange: chooseModule, options: levels.modules },
                {
                  label: 'Week', value: week, onChange: chooseWeek, options: levels.weeks,
                  disabled: !moduleTitle, disabledHint: 'Choose a module to pick one of its weeks.',
                },
                { label: 'Status', value: status, onChange: chooseStatus, options: statusOptions },
              ]}
              isDirty={Boolean(search || includeInactive || programme || cohort || group || moduleTitle || status)}
              onReset={reset}
              summary={`${plural(total, 'recording')} in ${plural(withRecordings, 'group module')}${sessionsToCheck ? ` · ${plural(sessionsToCheck, 'session')} to check` : ''}`}
              trailing={(
                <label className="inline-flex h-10 items-center gap-2 text-[12px] font-semibold text-foreground-600">
                  <input type="checkbox" checked={includeInactive} onChange={event => toggleInactive(event.target.checked)} />
                  Include draft and archived
                </label>
              )}
            />

            {!library.attentionChecked && (
              <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
                The check for past sessions without a recording could not be loaded. Every saved recording is still listed below.
              </p>
            )}

            {!deliveries.length && (
              <WorkspacePanel title="No recordings match">
                <p className="text-[13px] text-slate-600">
                  {levels.running.length
                    ? 'Nothing matches this search and status under the chosen programme, cohort, group, module and week.'
                    : 'Every recording belongs to a draft or archived programme or a deleted module. Tick "Include draft and archived" to see them.'}
                </p>
              </WorkspacePanel>
            )}

            {deliveries.map(item => (
              <WorkspacePanel key={item.moduleId} title={item.title}
                description={[item.programme, item.cohort && `Cohort: ${item.cohort}`, `Group: ${item.group || 'not named'}`,
                  item.archived && 'Archived / Deleted module',
                  !item.archived && !item.programmeActive && 'Programme is draft or archived', plural(item.recordingCount, 'recording')].filter(Boolean).join(' · ')}>
                {item.archived && (
                  <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[12px] text-slate-600">
                    Read only. This module was deleted; its recordings are kept here and can still be played or downloaded. Nothing on this page restores or changes the module.
                  </p>
                )}
                {item.weeks.length > 0 && (
                  <ul className="space-y-2">
                    {item.weeks.map(entry => {
                      const key = `${item.moduleId}:${entry.weekId ?? 'unmatched'}`;
                      // A chosen week is the answer, so it opens by itself.
                      const open = Boolean(week) || openWeeks.has(key);
                      return (
                        <li key={key} className="rounded-xl border border-slate-200 bg-slate-50/60">
                          <button type="button" onClick={() => toggleWeek(key)} aria-expanded={open} disabled={Boolean(week)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                            <span className="text-[13px] font-bold text-slate-900">{weekLabel(entry)}</span>
                            <span className="flex items-center gap-2 text-[12px] text-slate-500">
                              {plural(entry.recordings.length, 'recording')}
                              {!week && <AppIcon className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />}
                            </span>
                          </button>
                          {open && (
                            <div className="space-y-2 px-4 pb-4">
                              {!entry.weekId && <p className="text-[12px] text-slate-600">These recordings come from sessions that no live session in the course structure is linked to, so their week is unknown. The date shows when each one ran.</p>}
                              <ul className="space-y-2">
                                {entry.recordings.map(recording => (
                                  <RecordingRow key={recording.id} recording={recording} playing={playing === recording.id}
                                    onTogglePlay={() => setPlaying(current => current === recording.id ? '' : recording.id)} />
                                ))}
                              </ul>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {item.attention.length > 0 && <AttentionList sessions={item.attention} />}
              </WorkspacePanel>
            ))}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
