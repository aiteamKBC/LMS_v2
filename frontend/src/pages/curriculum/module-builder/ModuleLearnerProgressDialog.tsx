import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';
import {
  fetchCurriculumScopeLearnerKsbImpact,
  type CurriculumProgrammeAssignedLearner,
  type CurriculumScopeLearnerKsbImpactResponse,
} from '@/lib/curriculumApi';
import { formatSystemTimestamp } from '@/lib/format';
import { formatHoursClock } from '@/lib/hoursClock';
import {
  averagePercent, daysAgo, learnerKey, learnerProgressSummary, moduleBreakdown, profileKey, recentActivity, systemDay,
  type LearnerProgressSummary, type ModuleStatus, type RecentActivityItem,
} from './moduleLearnersView';

type Tone = 'primary' | 'emerald' | 'amber' | 'muted';

const BAR_TONES: Record<Tone, string> = {
  primary: 'bg-primary-600',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  muted: 'bg-foreground-300',
};

const MODULE_STATUS: Record<ModuleStatus, { label: string; tone: Tone; pill: string }> = {
  complete: { label: 'Complete', tone: 'emerald', pill: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  attention: { label: 'Needs attention', tone: 'amber', pill: 'border-amber-200 bg-amber-50 text-amber-700' },
  'in-progress': { label: 'In progress', tone: 'primary', pill: 'border-primary-200 bg-primary-50 text-primary-700' },
  'not-started': { label: 'Not started', tone: 'muted', pill: 'border-background-300 bg-background-100 text-foreground-500' },
};

const ACTIVITY_ICON: Record<RecentActivityItem['kind'], string> = {
  completed: 'ri-checkbox-circle-line',
  attention: 'ri-error-warning-line',
  started: 'ri-time-line',
  evidence: 'ri-file-upload-line',
};

function weight(value: number) {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function hours(value: number | null) {
  return value == null ? 'N/A' : String(Math.round(value * 10) / 10);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '--';
  return `${parts[0][0] || ''}${parts.length > 1 ? parts.at(-1)?.[0] || '' : ''}`.toUpperCase();
}

function tint(key: string) {
  const colors = ['bg-primary-100 text-primary-800', 'bg-secondary-100 text-secondary-800', 'bg-accent-100 text-accent-800', 'bg-emerald-100 text-emerald-800', 'bg-sky-100 text-sky-800'];
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return colors[hash % colors.length];
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function normalise(value: string | undefined) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** "today, 09:14", "yesterday", "27 days ago", then a date. UK time throughout. */
function lastActiveLabel(value?: string) {
  if (!value) return 'No activity yet';
  const days = daysAgo(value);
  if (days == null) return 'No activity yet';
  if (days <= 0) {
    const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? '' : formatSystemTimestamp(value, { hour: '2-digit', minute: '2-digit' });
    return time ? `today, ${time}` : 'today';
  }
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return formatSystemTimestamp(value, { day: 'numeric', month: 'short', year: 'numeric' });
}

function shortDate(value: string) {
  const days = daysAgo(value);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatSystemTimestamp(value, { day: 'numeric', month: 'short', year: 'numeric' });
}

function ProgressBar({ value, tone = 'primary', thick = false, label }: { value: number | null; tone?: Tone; thick?: boolean; label?: string }) {
  const safe = Math.max(0, Math.min(100, value || 0));
  return (
    <span
      className={`block w-full overflow-hidden rounded-full bg-background-200 ${thick ? 'h-2' : 'h-1.5'}`}
      role={label ? 'progressbar' : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label && value != null ? safe : undefined}
    >
      <span className={`block h-full rounded-full ${BAR_TONES[tone]}`} style={{ width: `${Math.max(safe, safe ? 2 : 0)}%` }} />
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const value = status.trim();
  if (!value) return null;
  const key = value.toLowerCase();
  const tone = key === 'active' || key === 'in learning' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : /withdraw|cancel|left|terminated/.test(key) ? 'border-red-200 bg-red-50 text-red-700'
      : /break|pause|hold|suspend/.test(key) ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-background-300 bg-background-100 text-foreground-600';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${tone}`}>
      {key === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />}
      {value.replace(/_/g, ' ')}
    </span>
  );
}

function Avatar({ name, id, size }: { name: string; id: string; size: 'sm' | 'lg' }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-bold ${tint(id)} ${size === 'lg' ? 'h-14 w-14 text-[17px]' : 'h-9 w-9 text-[11px]'}`}>
      {initials(name)}
    </span>
  );
}

function Tile({ label, value, detail, state = 'ready', title }: { label: string; value: string; detail: string; state?: 'ready' | 'loading' | 'error'; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-background-200 bg-white px-3 py-2.5" title={title}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-500">{label}</p>
      {state === 'loading' ? (
        <>
          <span className="mt-1.5 block h-5 w-14 animate-pulse rounded bg-background-200" />
          <span className="mt-1.5 block h-3 w-20 animate-pulse rounded bg-background-100" />
        </>
      ) : (
        <>
          <p className="mt-0.5 truncate text-[17px] font-bold text-foreground-950">{state === 'error' ? '—' : value}</p>
          <p className="truncate text-[10.5px] text-foreground-500">{state === 'error' ? 'Unavailable' : detail}</p>
        </>
      )}
    </div>
  );
}

function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between gap-3">
      <h4 className="text-[12.5px] font-semibold text-foreground-800">{children}</h4>
      {action}
    </div>
  );
}

type Read<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

/** One learner's programme-wide progress and attendance, read when they are selected. */
function useLearnerReads(programmeId: string | null, key: string | null, enrolmentId: string | null) {
  const [reads, setReads] = useState<Record<string, Read<unknown>>>({});
  const [retry, setRetry] = useState(0);
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const programmeKey = programmeId && key ? `programme:${programmeId}:${key}` : '';
  const attendanceKey = enrolmentId ? `attendance:${enrolmentId}` : '';

  useEffect(() => {
    const load = <T,>(cacheKey: string, read: () => Promise<T>) => {
      if (!cacheKey || requested.current.has(cacheKey)) return;
      requested.current.add(cacheKey);
      setReads(current => ({ ...current, [cacheKey]: { status: 'loading' } }));
      read().then(data => {
        if (mounted.current) setReads(current => ({ ...current, [cacheKey]: { status: 'ready', data } }));
      }).catch(error => {
        requested.current.delete(cacheKey);
        if (mounted.current) setReads(current => ({ ...current, [cacheKey]: { status: 'error', message: error instanceof Error ? error.message : 'Unable to load.' } }));
      });
    };
    load(programmeKey, () => fetchCurriculumScopeLearnerKsbImpact('programme', programmeId!, { learnerStatus: 'all', learnerId: key! }));
    load(attendanceKey, () => fetchLearnerAttendance('apprenticeship', enrolmentId!));
  }, [programmeKey, attendanceKey, programmeId, key, enrolmentId, retry]);

  return {
    programme: (programmeKey ? reads[programmeKey] || { status: 'loading' } : null) as Read<CurriculumScopeLearnerKsbImpactResponse> | null,
    attendance: (attendanceKey ? reads[attendanceKey] || { status: 'loading' } : null) as Read<LearnerAttendance | null> | null,
    retry: () => setRetry(value => value + 1),
  };
}

export interface ModuleLearnerProgrammeOption {
  id: string;
  sourceId?: string;
  name: string;
}

export function ModuleLearnerProgressDialog({ moduleName, moduleId, impact, assignedLearners, programmes = [], onClose, onAssignMore, onRemoveLearner }: {
  moduleName: string;
  moduleId?: string;
  /** Null when the module has no learners yet, so there is no progress to read. */
  impact: CurriculumScopeLearnerKsbImpactResponse | null;
  /**
   * Module membership comes from the assignment directory. The impact read is
   * intentionally only a progress enrichment, since it can omit a learner who
   * has no placement/progress record to aggregate yet.
   */
  assignedLearners?: CurriculumProgrammeAssignedLearner[];
  /** Used to find each learner's programme for their programme-wide progress. */
  programmes?: ModuleLearnerProgrammeOption[];
  onClose: () => void;
  onAssignMore: () => void;
  onRemoveLearner: (learner: CurriculumProgrammeAssignedLearner) => Promise<void>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLElement>(null);
  const learners = useMemo(
    () => assignedLearners ?? impact?.assignedLearners ?? [],
    [assignedLearners, impact?.assignedLearners],
  );
  const roster = useMemo(() => impact?.assignedLearners || [], [impact?.assignedLearners]);
  const summaries = useMemo(() => new Map(learners.map(learner => [
    learnerKey(learner.id),
    learnerProgressSummary(impact, profileKey(learner, roster)),
  ])), [learners, impact, roster]);
  const averageProgress = averagePercent([...summaries.values()].map(summary => summary.overall));

  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removingLearnerId, setRemovingLearnerId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return learners.filter(learner => {
      const text = `${learner.name} ${learner.email}`.toLocaleLowerCase();
      if (!terms.every(term => text.includes(term))) return false;
      if (!from && !to) return true;
      const last = summaries.get(learnerKey(learner.id))?.lastActivity;
      const day = last ? systemDay(last) : '';
      return Boolean(day) && (!from || day >= from) && (!to || day <= to);
    });
  }, [learners, summaries, query, from, to]);

  const selected = learners.find(learner => learnerKey(learner.id) === selectedId) || visible[0] || learners[0] || null;
  const selectedSummary = selected ? summaries.get(learnerKey(selected.id))! : null;
  const selectedKey = selectedSummary?.key ?? null;
  const rosterRow = selectedKey == null ? undefined : roster.find(row => learnerKey(row.id) === selectedKey);
  const programmeId = useMemo(() => {
    if (!selected) return null;
    const wanted = normalise(selected.programme || rosterRow?.programme);
    const match = wanted ? programmes.find(programme => normalise(programme.name) === wanted) : undefined;
    return (match ? match.sourceId || match.id : impact?.lineage?.programmeId) || null;
  }, [selected, rosterRow, programmes, impact?.lineage?.programmeId]);
  const enrolmentId = selected?.enrolmentId ?? rosterRow?.enrolmentId;
  const reads = useLearnerReads(programmeId, selectedKey, enrolmentId == null ? null : learnerKey(enrolmentId));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  const select = (learner: CurriculumProgrammeAssignedLearner) => {
    setSelectedId(learnerKey(learner.id));
    // Stacked layout: bring the details into view instead of leaving them below the list.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches) {
      detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const clearFilters = () => { setQuery(''); setFrom(''); setTo(''); };
  const summaryLine = `${plural(learners.length, 'learner')}${averageProgress == null ? '' : ` · average progress ${averageProgress}%`}`;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`${moduleName} learner progress`}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Escape') onClose(); }}
        className="flex h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-foreground-950">
              <AppIcon name="ri-team-line" size={18} />
              Module learners
            </h2>
            <p className="mt-1 truncate text-[12px] text-foreground-500">{moduleName} · {summaryLine}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close learner progress" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foreground-500 hover:bg-background-100 hover:text-foreground-800">
            <AppIcon name="ri-close-line" size={18} />
          </button>
        </header>

        {learners.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="max-w-sm rounded-xl border border-dashed border-background-300 bg-background-50 px-6 py-10 text-center">
              <AppIcon name="ri-user-add-line" size={26} className="text-foreground-400" />
              <p className="mt-2 text-[13px] font-semibold text-foreground-700">No learners are assigned to this module yet.</p>
              <p className="mt-1 text-[12px] text-foreground-500">Add learners to start tracking their progress here.</p>
              <button type="button" onClick={onAssignMore} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-[12px] font-semibold text-white hover:bg-primary-700">
                <AppIcon name="ri-user-add-line" size={15} />
                Add learners
              </button>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,390px)_minmax(0,1fr)] lg:overflow-hidden">
            <aside className="border-b border-background-200 lg:flex lg:min-h-0 lg:flex-col lg:border-b-0 lg:border-r">
              <div className="space-y-2.5 p-3">
                <label className="relative block">
                  <span className="sr-only">Search learners</span>
                  <AppIcon name="ri-search-line" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" />
                  <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search learners..." style={{ paddingLeft: 36 }} className="h-10 w-full rounded-lg border border-background-300 bg-white pr-3 text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none" />
                </label>
                <fieldset className="rounded-xl border border-background-200 bg-background-50 p-3">
                  <legend className="sr-only">Last activity date</legend>
                  <div className="flex items-center justify-between gap-2">
                    <p aria-hidden="true" className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-foreground-600">
                      <AppIcon name="ri-calendar-line" size={13} />
                      Last activity date
                    </p>
                    {(from || to) && <button type="button" onClick={() => { setFrom(''); setTo(''); }} className="text-[11px] font-semibold text-primary-700 hover:underline">Clear</button>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block text-[11px] text-foreground-600">From
                      <input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-background-300 bg-white px-2 text-[12px] text-foreground-900" />
                    </label>
                    <label className="block text-[11px] text-foreground-600">To
                      <input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-background-300 bg-white px-2 text-[12px] text-foreground-900" />
                    </label>
                  </div>
                </fieldset>
                <button type="button" onClick={onAssignMore} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-background-300 bg-white text-[13px] font-medium text-foreground-800 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800">
                  <AppIcon name="ri-user-add-line" size={16} />
                  Add learner manually
                </button>
              </div>
              <p aria-live="polite" className="border-t border-background-200 px-3 py-2.5 text-[11.5px] text-foreground-500">
                Showing <strong className="text-foreground-800">{visible.length}</strong> of {learners.length} · select a learner to see their full progress.
              </p>
              <ul aria-label="Learners" className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {visible.length === 0 ? (
                  <li className="px-4 py-8 text-center text-[12px] text-foreground-500">
                    No learners match these filters.
                    <button type="button" onClick={clearFilters} className="mt-2 block w-full font-semibold text-primary-700 hover:underline">Clear filters</button>
                  </li>
                ) : visible.map(learner => {
                  const id = learnerKey(learner.id);
                  const name = learner.name || learner.email || `Learner ${learner.id}`;
                  const summary = summaries.get(id)!;
                  const active = selected != null && learnerKey(selected.id) === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => select(learner)}
                        className={`flex w-full items-start gap-3 border-b border-background-100 px-3 py-3 text-left transition-colors ${active ? 'bg-primary-50/70' : 'hover:bg-background-50'}`}
                      >
                        <Avatar name={name} id={id} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-semibold text-foreground-900">{name}</span>
                            <StatusPill status={learner.programmeStatus || learner.lifecycleStatus || ''} />
                            <span className="ml-auto shrink-0 text-[12px] font-semibold text-foreground-800">{summary.overall == null ? '—' : `${summary.overall}%`}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-foreground-500">{learner.email || 'No email on record'}</span>
                          <span className="mt-2 block"><ProgressBar value={summary.overall} tone={summary.overall === 100 ? 'emerald' : 'primary'} /></span>
                          <span className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-foreground-500">
                            <span>{summary.ksbComplete}/{summary.ksbTotal} KSBs · {hours(summary.hoursAchieved)} hrs</span>
                            <span className="truncate">Last active {lastActiveLabel(summary.lastActivity)}</span>
                          </span>
                        </span>
                        <AppIcon name="ri-arrow-right-s-line" size={16} className="mt-2 shrink-0 text-foreground-400" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <section ref={detail} aria-label={selected ? `${selected.name || 'Learner'} progress` : 'Learner progress'} className="p-4 lg:min-h-0 lg:overflow-y-auto lg:p-5">
              {selected && selectedSummary && (
                <LearnerDetail
                  learner={selected}
                  summary={selectedSummary}
                  rosterRow={rosterRow}
                  impact={impact}
                  moduleName={moduleName}
                  moduleId={moduleId}
                  thisModuleId={impact?.lineage?.moduleCatalogueId || moduleId || ''}
                  programmeAvailable={Boolean(programmeId && selectedKey)}
                  reads={reads}
                  removing={removingLearnerId === learnerKey(selected.id)}
                  removeDisabled={Boolean(removingLearnerId)}
                  onRemove={async () => {
                    const name = selected.name || selected.email || `Learner ${selected.id}`;
                    await showCurriculumConfirm({
                      title: `Remove ${name} from this module?`,
                      text: 'The learner will lose current access to this module, but progress, submissions, attendance and audit history will be kept. You can add the learner again later.',
                      icon: 'warning',
                      confirmButtonText: 'Remove learner',
                      cancelButtonText: 'Keep learner',
                      onConfirm: async () => {
                        setRemovingLearnerId(learnerKey(selected.id));
                        try {
                          await onRemoveLearner(selected);
                          setSelectedId(null);
                        } finally {
                          setRemovingLearnerId(null);
                        }
                      },
                    });
                  }}
                />
              )}
            </section>
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-background-200 px-5 py-3">
          <p className="text-[12px] text-foreground-600">{plural(learners.length, 'learner')} on this module{averageProgress == null ? '' : <> · average progress <strong className="text-foreground-900">{averageProgress}%</strong></>}</p>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-background-300 bg-white px-4 text-[13px] font-medium text-foreground-800 hover:bg-background-100">Close</button>
        </footer>
      </div>
    </div>
  );
}

function LearnerDetail({ learner, summary, rosterRow, impact, moduleName, moduleId, thisModuleId, programmeAvailable, reads, removing, removeDisabled, onRemove }: {
  learner: CurriculumProgrammeAssignedLearner;
  summary: LearnerProgressSummary;
  rosterRow?: CurriculumProgrammeAssignedLearner;
  impact: CurriculumScopeLearnerKsbImpactResponse | null;
  moduleName: string;
  moduleId?: string;
  thisModuleId: string;
  programmeAvailable: boolean;
  reads: ReturnType<typeof useLearnerReads>;
  removing: boolean;
  removeDisabled: boolean;
  onRemove: () => Promise<void>;
}) {
  const id = learnerKey(learner.id);
  const name = learner.name || learner.email || `Learner ${learner.id}`;
  const programmeRead = reads.programme;
  const programmeImpact = programmeRead?.status === 'ready' ? programmeRead.data : null;
  const programme = useMemo(() => learnerProgressSummary(programmeImpact, summary.key), [programmeImpact, summary.key]);
  // This module's row takes the module read's own figures: it carries the
  // Activity Log accepted hours, which the programme read does not.
  const modules = useMemo(() => moduleBreakdown(programme.rows).map(row => row.id !== thisModuleId || !summary.rows.length ? row : {
    ...row,
    completed: summary.completed,
    total: summary.rows.length,
    percent: summary.activityPercent,
    hoursAchieved: summary.hoursAchieved ?? row.hoursAchieved,
    hoursPlanned: summary.hoursPlanned || row.hoursPlanned,
  }), [programme.rows, thisModuleId, summary]);
  const recent = useMemo(() => recentActivity(programmeImpact ? programme.rows : summary.rows), [programmeImpact, programme.rows, summary.rows]);
  const attendanceRead = reads.attendance;
  const attendance = attendanceRead?.status === 'ready' ? attendanceRead.data : null;
  const programmeState = !programmeAvailable ? 'error' : programmeRead?.status === 'ready' ? 'ready' : programmeRead?.status === 'error' ? 'error' : 'loading';
  const attendanceState = !attendanceRead ? 'error' : attendanceRead.status === 'ready' ? 'ready' : attendanceRead.status === 'error' ? 'error' : 'loading';
  const titles = new Map((impact?.coverage?.items || []).map(item => [item.code, item.title || item.description]));
  const ksbs = summary.consumption?.ksbs || [];
  const placement = [learner.programme || rosterRow?.programme, learner.cohort, learner.group].filter(Boolean).join(' · ');
  const progressLink = moduleId
    ? `/curriculum/learner-module-progress?moduleId=${encodeURIComponent(moduleId)}&${learner.enrolmentId != null ? 'enrolmentId' : 'learnerId'}=${encodeURIComponent(String(learner.enrolmentId ?? id))}`
    : '';

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={name} id={id} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[17px] font-semibold text-foreground-950">{name}</h3>
            <StatusPill status={learner.programmeStatus || learner.lifecycleStatus || ''} />
          </div>
          <p className="truncate text-[12.5px] text-foreground-600">{learner.email || 'No email on record'}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-foreground-500">{placement || 'No programme placement recorded'}</p>
        </div>
        <button
          type="button"
          disabled={removeDisabled}
          onClick={() => { void onRemove(); }}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-[11.5px] font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <AppIcon name="ri-user-unfollow-line" size={14} />
          {removing ? 'Removing…' : 'Remove from module'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Programme" state={programmeState}
          value={programme.overall == null ? '—' : `${programme.overall}%`}
          detail={`${programme.completed} of ${programme.rows.length} ${programme.rows.length === 1 ? 'activity' : 'activities'}`}
          title="Average of OTJH, KSB and activity completion across the learner’s programme" />
        <Tile label="KSBs" state={programmeState}
          value={`${programme.ksbComplete}/${programme.ksbTotal}`}
          detail={programme.ksbPercent == null ? 'No KSB weight expected' : `${programme.ksbPercent}% of KSB weight`}
          title="KSBs fully evidenced across the programme" />
        <Tile label="Hours" state={programmeState}
          value={hours(programme.hoursAchieved)}
          detail={`of ${hours(programme.hoursPlanned)} planned${rosterRow?.otjhStatus ? ` · ${rosterRow.otjhStatus}` : ''}`}
          title={programme.hoursAchieved == null ? undefined : `${formatHoursClock(programme.hoursAchieved)} of ${formatHoursClock(programme.hoursPlanned)} OTJH across the programme`} />
        <Tile label="Attendance" state={attendanceState}
          value={attendance && attendance.sessions > 0 ? `${attendance.attendanceRate}%` : '—'}
          detail={attendance && attendance.sessions > 0 ? `${attendance.present} of ${plural(attendance.sessions, 'session')}` : 'No sessions recorded'}
          title={attendance?.lastSessionDate ? `Last session ${shortDate(attendance.lastSessionDate)}` : undefined} />
      </div>

      <div className="mt-4 rounded-xl border border-background-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-[12.5px] font-semibold text-foreground-800">Progress in this module</h4>
          <span className="truncate text-[11px] text-foreground-400">{moduleName}</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="flex-1"><ProgressBar thick value={summary.overall} label={`${name} progress in ${moduleName}`} /></span>
          <strong className="text-[13px] font-semibold text-foreground-900" title="Average of OTJH, KSB and activity completion in this module">{summary.overall == null ? 'N/A' : `${summary.overall}%`}</strong>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-500">
          <span className="inline-flex items-center gap-1"><AppIcon name="ri-shield-check-line" size={13} />{summary.ksbComplete} of {summary.ksbTotal} KSBs evidenced</span>
          <span className="inline-flex items-center gap-1" title={summary.hoursAchieved == null ? undefined : `${formatHoursClock(summary.hoursAchieved)} / ${formatHoursClock(summary.hoursPlanned)}`}>
            <AppIcon name="ri-timer-line" size={13} />{hours(summary.hoursAchieved)} of {hours(summary.hoursPlanned)} hrs
          </span>
          <span className="inline-flex items-center gap-1"><AppIcon name="ri-calendar-line" size={13} />Last activity {lastActiveLabel(summary.lastActivity)}</span>
          {progressLink && (
            <Link to={progressLink} state={{ from: 'module-builder' }} className="ml-auto inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline">
              View full progress
              <AppIcon name="ri-arrow-right-line" size={13} />
            </Link>
          )}
        </div>
        {summary.unallocatedRecords > 0 && (
          <p className="mt-2 text-[11px] text-foreground-500">{plural(summary.unallocatedRecords, 'accepted record')} without allocated time; recorded hours are included.</p>
        )}
      </div>

      <SectionHeading action={programmeState === 'error' && programmeAvailable
        ? <button type="button" onClick={reads.retry} className="text-[11px] font-semibold text-primary-700 hover:underline">Try again</button>
        : undefined}>All modules</SectionHeading>
      <div className="overflow-hidden rounded-xl border border-background-200 bg-white">
        {programmeState === 'loading' ? (
          <p role="status" className="px-4 py-6 text-center text-[12px] text-foreground-500">Loading programme progress…</p>
        ) : programmeState === 'error' ? (
          <p className="px-4 py-6 text-center text-[12px] text-foreground-500">
            {programmeAvailable ? `Programme progress could not be loaded. ${programmeRead?.status === 'error' ? programmeRead.message : ''}` : 'This learner’s programme could not be identified, so programme progress is unavailable.'}
          </p>
        ) : modules.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-foreground-500">No modules are planned for this learner yet.</p>
        ) : modules.map(row => {
          const status = MODULE_STATUS[row.status];
          const current = row.id === thisModuleId;
          return (
            <div key={row.id} className={`border-b border-background-100 px-4 py-3 last:border-0 ${current ? 'bg-primary-50/40' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground-900">{row.title}</span>
                {current && <span className="shrink-0 rounded-full border border-primary-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-primary-700">This module</span>}
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.pill}`}>{status.label}</span>
                <span className="w-10 shrink-0 text-right text-[12px] font-semibold text-foreground-800" title="Activities completed">{row.percent == null ? '—' : `${row.percent}%`}</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span className="flex-1"><ProgressBar value={row.percent} tone={status.tone} /></span>
                <span className="shrink-0 text-[10.5px] text-foreground-500">{row.completed}/{row.total} activities · {hours(row.hoursAchieved)}/{hours(row.hoursPlanned)} hrs</span>
              </div>
            </div>
          );
        })}
      </div>

      <SectionHeading>KSB evidence</SectionHeading>
      {ksbs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-background-300 px-4 py-5 text-center text-[12px] text-foreground-500">No KSBs are mapped to this module’s activities for this learner.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {ksbs.map(ksb => (
            <div key={ksb.code} className="flex items-center gap-2.5 rounded-lg border border-background-200 bg-white px-3 py-2">
              <span className="shrink-0 rounded-md border border-background-200 bg-background-50 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-700">{ksb.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] text-foreground-800" title={titles.get(ksb.code) || ksb.code}>{titles.get(ksb.code) || ksb.code}</span>
                <span className="mt-1 block"><ProgressBar value={ksb.progressPercentage} tone={ksb.status === 'complete' ? 'emerald' : 'primary'} /></span>
              </span>
              <span className="shrink-0 text-[10.5px] text-foreground-500" title="Achieved / expected KSB weight">{weight(ksb.consumedWeight)}/{weight(ksb.expectedWeight)}</span>
            </div>
          ))}
        </div>
      )}

      <SectionHeading>Recent activity</SectionHeading>
      {recent.length === 0 ? (
        <p className="rounded-xl border border-dashed border-background-300 px-4 py-5 text-center text-[12px] text-foreground-500">No recorded activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {recent.map(item => (
            <li key={item.id} className="flex items-start gap-3 rounded-xl border border-background-200 bg-white px-3 py-2.5">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${item.kind === 'attention' ? 'bg-amber-50 text-amber-700' : item.kind === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-600'}`}>
                <AppIcon name={ACTIVITY_ICON[item.kind]} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-foreground-900">{item.title}</span>
                {item.detail && <span className="block truncate text-[11px] text-foreground-500">{item.detail}</span>}
              </span>
              <span className="shrink-0 text-[10.5px] text-foreground-500">{shortDate(item.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
