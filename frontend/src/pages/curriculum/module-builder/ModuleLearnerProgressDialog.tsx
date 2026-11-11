import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { formatHoursClock } from '@/lib/hoursClock';
import { learnerStatusLabel } from '../shared/entities/learnerStatusLabels';
import { moduleLearnerStatus, moduleLearnerStatuses } from './moduleLearnerStatus';
import { moduleProgressTotals } from './moduleProgressTotals';
import type {
  CurriculumLearnerKsbConsumption,
  CurriculumProgrammeAssignedLearner,
  CurriculumScopeLearnerKsbImpactResponse,
  CurriculumScopeOtjhLearner,
} from '@/lib/curriculumApi';

function learnerKey(value: string | number) {
  return String(value);
}

function percentage(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0) * 100) / 100));
}

function hoursPercentage(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function weight(value: number) {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
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

function ProgressBar({ value, tone }: { value: number; tone: 'primary' | 'emerald' }) {
  const safe = percentage(value);
  return (
    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-background-200">
      <span className={`block h-full rounded-full ${tone === 'emerald' ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${Math.max(safe, safe ? 2 : 0)}%` }} />
    </span>
  );
}

function profileKey(learner: CurriculumProgrammeAssignedLearner, roster: CurriculumProgrammeAssignedLearner[]) {
  if (learner.enrolmentId == null) return learnerKey(learner.id);
  const matches = roster.filter(row => row.enrolmentId != null && learnerKey(row.enrolmentId) === learnerKey(learner.enrolmentId!));
  return matches.length === 1 ? learnerKey(matches[0].id) : null;
}

function otjhFor(learners: CurriculumScopeOtjhLearner[], key: string | null) {
  return key == null ? undefined : learners.find(row => learnerKey(row.learnerId) === key);
}

/** Completion counted from learner_progress_entries by the module's moduleProgress read. */
interface ActivityLogProgressLearner {
  learnerId: string | number;
  totalActivities: number;
  completedActivities: number;
  inProgressActivities: number;
  /** Rows tagged with this module whose activity is no longer in its plan. */
  earlierRecords: number;
  earlierCompleted: number;
}

interface ActivityLogProgress {
  learners: ActivityLogProgressLearner[];
  completedActivities: number;
  totalActivities: number;
  earlierRecords: number;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** A figure whose meaning is explained on hover or keyboard focus. */
function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span title={text} tabIndex={0} className="cursor-help underline decoration-dotted decoration-foreground-300 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
      {children}
    </span>
  );
}

function otjhHint(achieved: number | null, planned: number, progress: number | null, whose: 'learner' | 'module') {
  if (achieved == null) {
    return whose === 'learner'
      ? 'N/A: accepted Activity Log hours are unavailable for this learner. Reload to retrieve the recorded total.'
      : 'N/A: accepted Activity Log hours are unavailable for this module. Reload to retrieve the recorded total.';
  }
  if (planned <= 0) {
    return whose === 'learner'
      ? 'N/A: this learner has no planned OTJH in this module, so there is no target to measure against.'
      : 'N/A: no planned OTJH is assigned to these learners in this module, so there is no target to measure against.';
  }
  if (progress == null) return 'N/A: accepted records have missing time. Known recorded hours are shown; complete the time allocation before measuring progress.';
  if (!progress) {
    return whose === 'learner'
      ? '0%: no accepted Activity Log hours are recorded for this learner in this module yet.'
      : '0%: no accepted Activity Log hours are recorded for any assigned learner in this module yet.';
  }
  return `${hoursPercentage(progress)}% of the planned OTJH, counted from accepted Activity Log hours.`;
}

function ksbHint(achieved: number, expected: number, whose: 'learner' | 'module') {
  if (expected <= 0) {
    return whose === 'learner'
      ? 'No KSB weight is expected from this module for this learner: no KSBs are mapped to the activities their group takes.'
      : 'No KSB weight is expected from this module: no KSBs are mapped to its activities.';
  }
  if (achieved <= 0) {
    return whose === 'learner'
      ? '0%: none of this learner’s activities in this module has KSB progress linked yet.'
      : '0%: no assigned learner has KSB progress linked to this module’s activities yet.';
  }
  return `${weight(achieved)} of ${weight(expected)} expected KSB weight earned.`;
}

function completionHint(completed: number, total: number) {
  if (total <= 0) return 'N/A: no activities in this module are planned for this learner’s group.';
  if (completed <= 0) return '0%: none of the planned activities has a completed progress record yet.';
  return `${completed} of ${total} planned activities have a completed progress record.`;
}

function ksbFor(learners: CurriculumLearnerKsbConsumption[], key: string | null) {
  return key == null ? undefined : learners.find(row => learnerKey(row.learnerId) === key);
}

export function ModuleLearnerProgressDialog({ moduleName, moduleId, impact, assignedLearners, initialStatus = 'all', onStatusChange, onClose, onAssignMore, onRemoveLearner }: {
  moduleName: string;
  moduleId?: string;
  impact: CurriculumScopeLearnerKsbImpactResponse;
  /**
   * Module membership comes from the assignment directory. The impact read is
   * intentionally only a progress enrichment, since it can omit a learner who
   * has no placement/progress record to aggregate yet.
   */
  assignedLearners?: CurriculumProgrammeAssignedLearner[];
  initialStatus?: string;
  onStatusChange?: (status: string) => void;
  onClose: () => void;
  onAssignMore: () => void;
  onRemoveLearner: (learner: CurriculumProgrammeAssignedLearner) => Promise<void>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const learners = useMemo(
    () => assignedLearners ?? impact.assignedLearners ?? [],
    [assignedLearners, impact.assignedLearners],
  );
  const otjhRows = impact.otjhAchievement?.learners || [];
  const ksbRows = impact.learnerKsbConsumption || [];
  const log = impact.activityLogOtjh;
  const activity = (impact as CurriculumScopeLearnerKsbImpactResponse & { activityLogProgress?: ActivityLogProgress }).activityLogProgress;
  const [removingLearnerId, setRemovingLearnerId] = useState<string | null>(null);
  const [status, setStatus] = useState(() => moduleLearnerStatus(initialStatus));
  const statusFor = (learner: CurriculumProgrammeAssignedLearner) => {
    const roster = impact.assignedLearners || [];
    const key = profileKey(learner, roster);
    const profile = key == null ? undefined : roster.find(row => learnerKey(row.id) === key);
    return moduleLearnerStatus(profile?.lifecycleStatus?.trim() || profile?.programmeStatus?.trim()
      || learner.lifecycleStatus?.trim() || learner.programmeStatus || '');
  };
  const statuses = [...moduleLearnerStatuses];
  for (const value of [status, ...learners.map(statusFor)]) {
    if (!statuses.some(option => option.value === value)) statuses.push({ value, label: learnerStatusLabel(value) });
  }
  const visibleLearners = learners.filter(learner => status === 'all' || statusFor(learner) === status);
  const totals = moduleProgressTotals(impact, visibleLearners.map(learner => profileKey(learner, impact.assignedLearners || [])));
  const activityPercent = totals.activity?.known && totals.activity.total > 0 ? totals.activity.completed / totals.activity.total * 100 : null;
  const totalHours = totals.hours;
  const plannedHours = totals.plannedHours;
  const totalPercent = totalHours != null && plannedHours > 0 && totals.unallocatedHours === 0 ? totalHours / plannedHours * 100 : null;
  const ksbPercent = totals.ksbsKnown && totals.expectedKsb > 0 ? totals.achievedKsb / totals.expectedKsb * 100 : null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

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
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-background-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Assignments &amp; progress</p>
            <h2 className="mt-1 truncate text-lg font-heading font-black text-foreground-950">{moduleName}</h2>
            <p className="mt-1 text-[11px] font-semibold text-foreground-500">{learners.length} learner{learners.length === 1 ? '' : 's'} assigned to this module</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onAssignMore} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-bold text-primary-700 hover:bg-primary-100">
              <AppIcon name="ri-user-add-line" size={15}></AppIcon>
              Assign more learners
            </button>
            <button type="button" onClick={onClose} aria-label="Close learner progress" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700">
              <AppIcon name="ri-close-line" size={17}></AppIcon>
            </button>
          </div>
        </header>

        <div role="group" aria-label="Shown learner progress totals" className={`grid gap-3 border-b border-background-200 bg-background-100/60 p-4 ${activity ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {activity && (
            <div className="rounded-xl border border-background-200 bg-background-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Activities completed</p>
              <p className="mt-1 text-lg font-black text-foreground-900">{totals.activity?.known ? totals.activity.completed : 'N/A'} <span className="text-[11px] font-bold text-foreground-400">/ {totals.activity?.known ? totals.activity.total : 'N/A'}</span></p>
              <ProgressBar value={activityPercent || 0} tone="emerald" />
              <p className="mt-1 text-[10px] font-semibold text-foreground-500">
                <Hint text={totals.activity?.known ? completionHint(totals.activity.completed, totals.activity.total) : 'Some learner activity records are unavailable. Reload to retrieve the complete total.'}>
                  {activityPercent == null ? 'N/A: no measurable activity target' : `${percentage(activityPercent)}% of current planned activities, shown learners`}
                </Hint>
                {totals.activity?.earlier ? ` · ${plural(totals.activity.earlier, 'historical record')} reported separately` : ''}
              </p>
            </div>
          )}
          <div className="rounded-xl border border-background-200 bg-background-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">OTJH progress</p>
            <p className="mt-1 text-lg font-black text-foreground-900"><Hint text={otjhHint(totalHours ?? null, plannedHours, totalPercent, 'module')}>{totalHours == null ? 'N/A' : formatHoursClock(totalHours)}</Hint> <span className="text-[11px] font-bold text-foreground-400">/ {totals.hoursTargetsKnown ? formatHoursClock(plannedHours) : 'N/A'}</span></p>
            <ProgressBar value={totalPercent || 0} tone="primary" />
            <p className="mt-1 text-[10px] font-semibold text-foreground-500"><Hint text={otjhHint(totalHours ?? null, plannedHours, totalPercent, 'module')}>{`${totalPercent == null ? 'N/A' : `${hoursPercentage(totalPercent)}%`} of assigned planned hours${log ? ' · Activity Log accepted hours' : ''}`}</Hint></p>
            {Boolean(totals.unallocatedHours) && <p className="mt-1 text-[10px] text-foreground-500">{plural(totals.unallocatedHours, 'accepted record')} without allocated time; recorded hours are included.</p>}
            {totals.historicalHours > 0 && <p className="mt-1 text-[10px] text-foreground-500">Historical OTJH: {formatHoursClock(totals.historicalHours)} · excluded from current progress.</p>}
            {totals.historicalUnallocatedHours > 0 && <p className="mt-1 text-[10px] text-foreground-500">{totals.historicalUnallocatedHours} historical accepted record(s) without allocated time.</p>}
          </div>
          <div className="rounded-xl border border-background-200 bg-background-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">KSB weights achieved</p>
            <p className="mt-1 text-lg font-black text-foreground-900">{totals.ksbsKnown ? weight(totals.achievedKsb) : 'N/A'} <span className="text-[11px] font-bold text-foreground-400">/ {totals.ksbsKnown ? weight(totals.expectedKsb) : 'N/A'}</span></p>
            <ProgressBar value={ksbPercent || 0} tone="emerald" />
            <p className="mt-1 text-[10px] font-semibold text-foreground-500"><Hint text={ksbHint(totals.achievedKsb, totals.expectedKsb, 'module')}>{ksbPercent == null ? 'N/A: no measurable KSB target' : `${percentage(ksbPercent)}% of current expected KSB weight`}</Hint></p>
            {totals.historicalKsb > 0 && <p className="mt-1 text-[10px] text-foreground-500">Historical KSB weight: {weight(totals.historicalKsb)} · excluded from current progress.</p>}
            {totals.unallocatedKsb > 0 && <p className="mt-1 text-[10px] text-foreground-500">{weight(totals.unallocatedKsb)} planned KSB weight is mapped without a current activity target.</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background-200 px-4 py-3">
          <p role="status" className="text-[11px] font-semibold text-foreground-500">{visibleLearners.length} of {learners.length} assigned learners shown</p>
          <label className="flex items-center gap-2 text-xs font-semibold text-foreground-600">Status
            <select aria-label="Learner status" value={status} disabled={Boolean(removingLearnerId)}
              onChange={event => { setStatus(event.target.value); onStatusChange?.(event.target.value); }}
              className="min-h-9 rounded-lg border border-background-300 bg-background-50 px-3 text-xs text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-200">
              {statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        {totals.unavailable > 0 && <p role="alert" className="px-4 pt-3 text-xs text-amber-800">Progress is unavailable for {totals.unavailable} shown learner(s). Missing records are not counted as zero.</p>}
        <div className="min-h-0 overflow-auto p-4">
          {learners.length === 0 ? (
            <p className="rounded-xl border border-dashed border-background-300 bg-background-100 px-4 py-8 text-center text-[12px] font-semibold text-foreground-500">No assigned learner progress was returned for this module.</p>
          ) : visibleLearners.length === 0 ? (
            <p className="rounded-xl border border-dashed border-background-300 bg-background-100 px-4 py-8 text-center text-[12px] font-semibold text-foreground-500">No assigned learners match this status.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleLearners.map(learner => {
                const name = learner.name || learner.email || `Learner ${learner.id}`;
                const key = profileKey(learner, impact.assignedLearners || []);
                const otjh = otjhFor(otjhRows, key);
                const logHours = log?.learners.find(row => learnerKey(row.learnerId) === key);
                const achieved = logHours ? logHours.achievedOtjh : otjh?.achievedOtjh ?? (impact.moduleProgressBasis ? null : 0);
                const planned = logHours?.plannedOtjh ?? otjh?.plannedOtjh ?? (impact.moduleProgressBasis ? null : 0);
                const ksb = ksbFor(ksbRows, key);
                const otjhProgress = achieved != null && planned > 0 && !logHours?.unallocatedAcceptedRecords ? achieved / planned * 100 : null;
                const cappedKsb = ksb?.cappedConsumedWeightTotal ?? ksb?.consumedWeightTotal ?? 0;
                const ksbProgress = ksb && ksb.expectedWeightTotal > 0 ? cappedKsb / ksb.expectedWeightTotal * 100 : null;
                const done = key == null ? undefined : activity?.learners.find(row => learnerKey(row.learnerId) === key);
                const doneProgress = done && done.totalActivities > 0 ? done.completedActivities / done.totalActivities * 100 : null;
                const id = learnerKey(learner.id);
                return (
                  <article key={id} className="rounded-xl border border-background-200 bg-background-50 p-3">
                    <div className="flex items-start gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${tint(learnerKey(learner.id))}`}>{initials(name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-bold text-foreground-900">{name}</p>
                        <p className="truncate text-[10px] text-foreground-500">{learner.email || 'No email on record'}</p>
                        <p className="mt-1 truncate text-[10px] font-semibold text-foreground-400">{[learner.cohort, learner.group].filter(Boolean).join(' · ') || 'No delivery group recorded'}</p>
                        <p className="mt-1 text-[10px] font-semibold text-primary-700">{statuses.find(option => option.value === statusFor(learner))?.label}</p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(removingLearnerId)}
                        className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={async () => {
                          const confirmed = await showCurriculumConfirm({
                            title: `Remove ${name} from this module?`,
                            text: 'The learner will lose current access to this module, but progress, submissions, attendance and audit history will be kept. You can add the learner again later.',
                            icon: 'warning',
                            confirmButtonText: 'Remove learner',
                            cancelButtonText: 'Keep learner',
                            onConfirm: async () => {
                              setRemovingLearnerId(id);
                              try {
                                await onRemoveLearner(learner);
                              } finally {
                                setRemovingLearnerId(null);
                              }
                            },
                          });
                          if (!confirmed) return;
                        }}
                      >
                        {removingLearnerId === id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                    {moduleId && (
                      <Link
                        to={`/curriculum/learner-module-progress?moduleId=${encodeURIComponent(moduleId)}&${learner.enrolmentId != null ? 'enrolmentId' : 'learnerId'}=${encodeURIComponent(String(learner.enrolmentId ?? id))}${status === 'all' ? '' : `&learnerStatus=${encodeURIComponent(status)}`}`}
                        // Tells the progress page that Back is one step in
                        // history: this catalogue, its filters and this dialog.
                        state={{ from: 'module-builder' }}
                        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[10px] font-bold text-primary-700 hover:bg-primary-100"
                      >
                        <AppIcon name="ri-bar-chart-2-line" size={14}></AppIcon>
                        View progress
                      </Link>
                    )}
                    {activity && (
                      <div className="mt-3">
                        <div className="flex items-baseline justify-between text-[10px] font-bold text-foreground-600">
                          <span>Activities completed</span>
                          <span>{done ? `${done.completedActivities} / ${done.totalActivities}` : 'No progress record'}</span>
                        </div>
                        <ProgressBar value={doneProgress || 0} tone="emerald" />
                        <p className="mt-1 text-[10px] font-semibold text-foreground-400">
                          {!done ? 'No progress record matched this learner' : (
                            <Hint text={completionHint(done.completedActivities, done.totalActivities)}>
                              {doneProgress == null ? 'No activities planned for this learner' : `${percentage(doneProgress)}% complete${done.inProgressActivities ? ` · ${done.inProgressActivities} in progress` : ''}`}
                            </Hint>
                          )}
                          {done && done.earlierRecords > 0 ? ` · ${plural(done.earlierRecords, 'earlier record')} (${done.earlierCompleted} completed)` : ''}
                        </p>
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="flex items-baseline justify-between text-[10px] font-bold text-foreground-600">
                          <span>OTJH</span>
                          <Hint text={otjhHint(achieved, planned, otjhProgress, 'learner')}>{`${achieved == null ? 'N/A' : formatHoursClock(achieved)} / ${planned == null ? 'N/A' : formatHoursClock(planned)}`}</Hint>
                        </div>
                        <ProgressBar value={otjhProgress || 0} tone="primary" />
                        <p className="mt-1 text-[10px] font-semibold text-foreground-400"><Hint text={otjhHint(achieved, planned, otjhProgress, 'learner')}>{`${otjhProgress == null ? 'N/A' : `${hoursPercentage(otjhProgress)}%`} complete`}</Hint></p>
                        {Boolean(logHours?.unallocatedAcceptedRecords) && <p className="mt-1 text-[10px] text-foreground-500">{plural(logHours!.unallocatedAcceptedRecords!, 'accepted record')} without allocated time.</p>}
                        {Boolean(logHours?.historicalOtjh) && <p className="mt-1 text-[10px] text-foreground-500">Historical OTJH: {formatHoursClock(logHours!.historicalOtjh!)} · excluded from current progress.</p>}
                        {Boolean(logHours?.historicalUnallocatedRecords) && <p className="mt-1 text-[10px] text-foreground-500">{logHours!.historicalUnallocatedRecords} historical accepted record(s) without allocated time.</p>}
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between text-[10px] font-bold text-foreground-600">
                          <span>KSB weight</span>
                          <span>{ksb ? `${weight(cappedKsb)} / ${weight(ksb.expectedWeightTotal)}` : 'N/A'}</span>
                        </div>
                        <ProgressBar value={ksbProgress || 0} tone="emerald" />
                        <p className="mt-1 text-[10px] font-semibold text-foreground-400"><Hint text={ksbHint(cappedKsb, ksb?.expectedWeightTotal || 0, 'learner')}>{ksbProgress == null ? 'N/A: no measurable KSB target' : `${percentage(ksbProgress)}% achieved`}</Hint></p>
                        {Boolean(ksb?.historicalConsumedWeightTotal) && <p className="mt-1 text-[10px] text-foreground-500">Historical KSB weight: {weight(ksb!.historicalConsumedWeightTotal!)} · excluded from current progress.</p>}
                        {Boolean(ksb && ksb.consumedWeightTotal > cappedKsb) && <p className="mt-1 text-[10px] text-foreground-500">Recorded KSB weight: {weight(ksb!.consumedWeightTotal)}; progress is capped per KSB target.</p>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
