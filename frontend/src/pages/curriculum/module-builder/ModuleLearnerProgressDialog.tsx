import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { formatHoursMinutes } from '@/lib/format';
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
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
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
  if (!progress) {
    return whose === 'learner'
      ? '0%: no accepted Activity Log hours are recorded for this learner in this module yet.'
      : '0%: no accepted Activity Log hours are recorded for any assigned learner in this module yet.';
  }
  return `${percentage(progress)}% of the planned OTJH, counted from accepted Activity Log hours.`;
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

export function ModuleLearnerProgressDialog({ moduleName, moduleId, impact, assignedLearners, onClose, onAssignMore, onRemoveLearner }: {
  moduleName: string;
  moduleId?: string;
  impact: CurriculumScopeLearnerKsbImpactResponse;
  /**
   * Module membership comes from the assignment directory. The impact read is
   * intentionally only a progress enrichment, since it can omit a learner who
   * has no placement/progress record to aggregate yet.
   */
  assignedLearners?: CurriculumProgrammeAssignedLearner[];
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
  const activityPercent = activity && activity.totalActivities > 0 ? Math.round(activity.completedActivities / activity.totalActivities * 100) : null;
  const totalHours = log ? log.achievedTotal : impact.otjhAchievement?.achievedTotal || 0;
  const plannedHours = log ? log.plannedTotal : impact.otjhAchievement?.plannedTotal || 0;
  const totalPercent = totalHours != null && plannedHours > 0 ? Math.round(totalHours / plannedHours * 100) : null;
  const [removingLearnerId, setRemovingLearnerId] = useState<string | null>(null);

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
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Assigned learners</p>
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

        <div className={`grid gap-3 border-b border-background-200 bg-background-100/60 p-4 ${activity ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {activity && (
            <div className="rounded-xl border border-background-200 bg-background-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Activities completed</p>
              <p className="mt-1 text-lg font-black text-foreground-900">{activity.completedActivities} <span className="text-[11px] font-bold text-foreground-400">/ {activity.totalActivities}</span></p>
              <ProgressBar value={activityPercent || 0} tone="emerald" />
              <p className="mt-1 text-[10px] font-semibold text-foreground-500">
                <Hint text={activity.totalActivities > 0 ? completionHint(activity.completedActivities, activity.totalActivities) : 'N/A: no activities in this module are planned for the assigned learners.'}>
                  {activityPercent == null ? 'No activities planned for these learners' : `${percentage(activityPercent)}% of planned activities, all assigned learners`}
                </Hint>
                {activity.earlierRecords > 0 ? ` · ${plural(activity.earlierRecords, 'record')} from activities no longer in this module also counted in hours` : ''}
              </p>
            </div>
          )}
          <div className="rounded-xl border border-background-200 bg-background-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">OTJH progress</p>
            <p className="mt-1 text-lg font-black text-foreground-900"><Hint text={otjhHint(totalHours ?? null, plannedHours, totalPercent, 'module')}>{totalHours == null ? 'N/A' : formatHoursMinutes(totalHours)}</Hint> <span className="text-[11px] font-bold text-foreground-400">/ {formatHoursMinutes(plannedHours)}</span></p>
            <ProgressBar value={totalPercent || 0} tone="primary" />
            <p className="mt-1 text-[10px] font-semibold text-foreground-500"><Hint text={otjhHint(totalHours ?? null, plannedHours, totalPercent, 'module')}>{`${totalPercent == null ? 'N/A' : `${percentage(totalPercent)}%`} of assigned planned hours${log ? ' · Activity Log accepted hours' : ''}`}</Hint></p>
            {Boolean(log?.unallocatedAcceptedRecords) && <p className="mt-1 text-[10px] text-foreground-500">{plural(log!.unallocatedAcceptedRecords!, 'accepted record')} without allocated time; recorded hours are included.</p>}
          </div>
          <div className="rounded-xl border border-background-200 bg-background-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">KSB weights achieved</p>
            <p className="mt-1 text-lg font-black text-foreground-900">{weight(impact.ksbAchievement?.achievedWeightTotal || 0)} <span className="text-[11px] font-bold text-foreground-400">/ {weight(impact.ksbAchievement?.expectedWeightTotal || 0)}</span></p>
            <ProgressBar value={impact.ksbAchievement?.progressPercentage || 0} tone="emerald" />
            <p className="mt-1 text-[10px] font-semibold text-foreground-500"><Hint text={ksbHint(impact.ksbAchievement?.achievedWeightTotal || 0, impact.ksbAchievement?.expectedWeightTotal || 0, 'module')}>{`${percentage(impact.ksbAchievement?.progressPercentage || 0)}% of expected KSB weight`}</Hint></p>
          </div>
        </div>

        <div className="min-h-0 overflow-auto p-4">
          {learners.length === 0 ? (
            <p className="rounded-xl border border-dashed border-background-300 bg-background-100 px-4 py-8 text-center text-[12px] font-semibold text-foreground-500">No assigned learner progress was returned for this module.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {learners.map(learner => {
                const name = learner.name || learner.email || `Learner ${learner.id}`;
                const key = profileKey(learner, impact.assignedLearners || []);
                const otjh = otjhFor(otjhRows, key);
                const logHours = log?.learners.find(row => learnerKey(row.learnerId) === key);
                const achieved = logHours ? logHours.achievedOtjh : otjh?.achievedOtjh || 0;
                const planned = logHours?.plannedOtjh ?? otjh?.plannedOtjh ?? 0;
                const ksb = ksbFor(ksbRows, key);
                const otjhProgress = achieved != null && planned > 0 ? Math.round(achieved / planned * 100) : null;
                const ksbProgress = ksb?.progressPercentage || 0;
                const done = key == null ? undefined : activity?.learners.find(row => learnerKey(row.learnerId) === key);
                const doneProgress = done && done.totalActivities > 0 ? Math.round(done.completedActivities / done.totalActivities * 100) : null;
                const id = learnerKey(learner.id);
                return (
                  <article key={id} className="rounded-xl border border-background-200 bg-background-50 p-3">
                    <div className="flex items-start gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${tint(learnerKey(learner.id))}`}>{initials(name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-bold text-foreground-900">{name}</p>
                        <p className="truncate text-[10px] text-foreground-500">{learner.email || 'No email on record'}</p>
                        <p className="mt-1 truncate text-[10px] font-semibold text-foreground-400">{[learner.cohort, learner.group].filter(Boolean).join(' · ') || 'No delivery group recorded'}</p>
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
                        to={`/curriculum/learner-module-progress?moduleId=${encodeURIComponent(moduleId)}&${learner.enrolmentId != null ? 'enrolmentId' : 'learnerId'}=${encodeURIComponent(String(learner.enrolmentId ?? id))}`}
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
                          <Hint text={otjhHint(achieved, planned, otjhProgress, 'learner')}>{`${achieved == null ? 'N/A' : formatHoursMinutes(achieved)} / ${formatHoursMinutes(planned)}`}</Hint>
                        </div>
                        <ProgressBar value={otjhProgress || 0} tone="primary" />
                        <p className="mt-1 text-[10px] font-semibold text-foreground-400"><Hint text={otjhHint(achieved, planned, otjhProgress, 'learner')}>{`${otjhProgress == null ? 'N/A' : `${percentage(otjhProgress)}%`} complete`}</Hint></p>
                        {Boolean(logHours?.unallocatedAcceptedRecords) && <p className="mt-1 text-[10px] text-foreground-500">{plural(logHours!.unallocatedAcceptedRecords!, 'accepted record')} without allocated time.</p>}
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between text-[10px] font-bold text-foreground-600">
                          <span>KSB weight</span>
                          <span>{weight(ksb?.consumedWeightTotal || 0)} / {weight(ksb?.expectedWeightTotal || 0)}</span>
                        </div>
                        <ProgressBar value={ksbProgress} tone="emerald" />
                        <p className="mt-1 text-[10px] font-semibold text-foreground-400"><Hint text={ksbHint(ksb?.consumedWeightTotal || 0, ksb?.expectedWeightTotal || 0, 'learner')}>{`${percentage(ksbProgress)}% achieved`}</Hint></p>
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
