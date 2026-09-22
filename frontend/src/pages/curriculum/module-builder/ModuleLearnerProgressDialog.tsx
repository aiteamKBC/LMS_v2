import { useEffect, useMemo, useRef } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
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

function otjhFor(learners: CurriculumScopeOtjhLearner[], learner: CurriculumProgrammeAssignedLearner) {
  return learners.find(row => learnerKey(row.learnerId) === learnerKey(learner.id));
}

function ksbFor(learners: CurriculumLearnerKsbConsumption[], learner: CurriculumProgrammeAssignedLearner) {
  return learners.find(row => learnerKey(row.learnerId) === learnerKey(learner.id));
}

export function ModuleLearnerProgressDialog({ moduleName, impact, assignedLearners, onClose, onAssignMore }: {
  moduleName: string;
  impact: CurriculumScopeLearnerKsbImpactResponse;
  /**
   * Module membership comes from the assignment directory. The impact read is
   * intentionally only a progress enrichment, since it can omit a learner who
   * has no placement/progress record to aggregate yet.
   */
  assignedLearners?: CurriculumProgrammeAssignedLearner[];
  onClose: () => void;
  onAssignMore: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const learners = useMemo(
    () => assignedLearners ?? impact.assignedLearners ?? [],
    [assignedLearners, impact.assignedLearners],
  );
  const otjhRows = impact.otjhAchievement?.learners || [];
  const ksbRows = impact.learnerKsbConsumption || [];

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

        <div className="grid gap-3 border-b border-background-200 bg-background-100/60 p-4 sm:grid-cols-2">
          <div className="rounded-xl border border-background-200 bg-background-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">OTJH progress</p>
            <p className="mt-1 text-lg font-black text-foreground-900">{formatHoursMinutes(impact.otjhAchievement?.achievedTotal || 0)} <span className="text-[11px] font-bold text-foreground-400">/ {formatHoursMinutes(impact.otjhAchievement?.plannedTotal || 0)}</span></p>
            <ProgressBar value={impact.otjhAchievement?.progressPercentage || 0} tone="primary" />
            <p className="mt-1 text-[10px] font-semibold text-foreground-500">{percentage(impact.otjhAchievement?.progressPercentage || 0)}% of assigned planned hours</p>
          </div>
          <div className="rounded-xl border border-background-200 bg-background-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">KSB weights achieved</p>
            <p className="mt-1 text-lg font-black text-foreground-900">{weight(impact.ksbAchievement?.achievedWeightTotal || 0)} <span className="text-[11px] font-bold text-foreground-400">/ {weight(impact.ksbAchievement?.expectedWeightTotal || 0)}</span></p>
            <ProgressBar value={impact.ksbAchievement?.progressPercentage || 0} tone="emerald" />
            <p className="mt-1 text-[10px] font-semibold text-foreground-500">{percentage(impact.ksbAchievement?.progressPercentage || 0)}% of expected KSB weight</p>
          </div>
        </div>

        <div className="min-h-0 overflow-auto p-4">
          {learners.length === 0 ? (
            <p className="rounded-xl border border-dashed border-background-300 bg-background-100 px-4 py-8 text-center text-[12px] font-semibold text-foreground-500">No assigned learner progress was returned for this module.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {learners.map(learner => {
                const name = learner.name || learner.email || `Learner ${learner.id}`;
                const otjh = otjhFor(otjhRows, learner);
                const ksb = ksbFor(ksbRows, learner);
                const otjhProgress = otjh?.progressPercentage || 0;
                const ksbProgress = ksb?.progressPercentage || 0;
                return (
                  <article key={learnerKey(learner.id)} className="rounded-xl border border-background-200 bg-background-50 p-3">
                    <div className="flex items-start gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${tint(learnerKey(learner.id))}`}>{initials(name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-bold text-foreground-900">{name}</p>
                        <p className="truncate text-[10px] text-foreground-500">{learner.email || 'No email on record'}</p>
                        <p className="mt-1 truncate text-[10px] font-semibold text-foreground-400">{[learner.cohort, learner.group].filter(Boolean).join(' · ') || 'No delivery group recorded'}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="flex items-baseline justify-between text-[10px] font-bold text-foreground-600">
                          <span>OTJH</span>
                          <span>{formatHoursMinutes(otjh?.achievedOtjh || 0)} / {formatHoursMinutes(otjh?.plannedOtjh || 0)}</span>
                        </div>
                        <ProgressBar value={otjhProgress} tone="primary" />
                        <p className="mt-1 text-[10px] font-semibold text-foreground-400">{percentage(otjhProgress)}% complete</p>
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between text-[10px] font-bold text-foreground-600">
                          <span>KSB weight</span>
                          <span>{weight(ksb?.consumedWeightTotal || 0)} / {weight(ksb?.expectedWeightTotal || 0)}</span>
                        </div>
                        <ProgressBar value={ksbProgress} tone="emerald" />
                        <p className="mt-1 text-[10px] font-semibold text-foreground-400">{percentage(ksbProgress)}% achieved</p>
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
