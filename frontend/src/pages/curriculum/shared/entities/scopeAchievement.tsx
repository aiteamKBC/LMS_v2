// ============================================================================
// Scope achievement — one panel, every level of the hierarchy.
//
// Programme -> Cohort -> Group -> Module -> Week. Each level was already able to
// show what curriculum *planned*: its modules, its components, its KSB weights,
// its expected OTJH. None of them could show what learners actually *did* with
// it, and the only roster that existed was the programme's.
//
// This is that missing half, and it is one component rather than four because
// the question is identical at every level: who is assigned here, how many OTJH
// have they really achieved here, and how much of each KSB's weight have they
// really earned here. Four copies of it would drift, and the whole point of the
// roll-up is that a cohort's number and its programme's number are computed the
// same way.
//
// Three rules the panel is built around, because breaking them is what made the
// old per-learner numbers unreadable:
//
//  - Planned, declared and achieved are three different figures and are never
//    merged. Planned is what curriculum authored; declared is what the learner
//    wrote in a reflection; achieved is the credited figure.
//  - A percentage always names its denominator, and the denominator is what a
//    learner is actually assigned. A module belongs to one group, so a cohort
//    running two groups holds two module instances and no learner is assigned
//    both: each is measured against their own group's modules.
//  - Achievement that happened somewhere else is reported, not hidden. A cohort
//    total that falls short of a learner's programme total should be explainable
//    on the page, not by reading the database.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  fetchCurriculumScopeLearnerKsbImpact,
  type CurriculumLearnerActivity,
  type CurriculumLearnerKsbConsumption,
  type CurriculumLearnerScope,
  type CurriculumScopeKsbAchievementRow,
  type CurriculumScopeLearnerKsbImpactResponse,
  type CurriculumScopeOtjhLearner,
} from '@/lib/curriculumApi';
import { EntityEmptyState, InlineError } from './ui';

type PanelTab = 'ksb' | 'learners' | 'activity';

const TABS: Array<{ key: PanelTab; label: string; icon: string }> = [
  { key: 'ksb', label: 'KSB heatmap', icon: 'ri-grid-line' },
  { key: 'learners', label: 'Learners', icon: 'ri-graduation-cap-line' },
  { key: 'activity', label: 'Activity', icon: 'ri-history-line' },
];

const SCOPE_NOUN: Record<string, string> = {
  programme: 'programme',
  cohort: 'cohort',
  group: 'group',
  module: 'module',
  week: 'week',
  component: 'component',
};

// ---------------------------------------------------------------- formatting

function hours(value: number | null | undefined) {
  const number = Number(value || 0);
  return `${Number.isInteger(number) ? number : number.toFixed(1)}h`;
}

function weight(value: number | null | undefined) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function percent(value: number | null | undefined) {
  return `${Math.round(Number(value || 0))}%`;
}

function normaliseText(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * The achieved-weight cell tint. Five steps, not a continuous gradient: a
 * reader compares bands, and a per-row unique shade reads as noise.
 */
function heatClass(percentage: number, planned: number) {
  if (!planned) return 'bg-background-100 text-foreground-400';
  if (percentage >= 100) return 'bg-emerald-600 text-white';
  if (percentage >= 75) return 'bg-emerald-400/90 text-emerald-950';
  if (percentage >= 40) return 'bg-amber-300/90 text-amber-950';
  if (percentage > 0) return 'bg-amber-200/70 text-amber-900';
  return 'bg-background-200 text-foreground-500';
}

function ksbTypeLabel(value: string) {
  if (value === 'skill') return 'Skill';
  if (value === 'behaviour') return 'Behaviour';
  return 'Knowledge';
}

/**
 * Two ways a KSB can carry no weight, and they mean opposite things: `unmapped`
 * is a curriculum gap to fix, `unplanned` is a learner earning something this
 * scope never asked for. Showing both as one grey row hid whichever mattered.
 */
const STATUS_MARK: Record<string, { icon: string; className: string; title: string }> = {
  unmapped: {
    icon: 'ri-error-warning-line',
    className: 'text-red-600',
    title: 'Required by the KSB source but taught nowhere in this scope',
  },
  unplanned: {
    icon: 'ri-alert-line',
    className: 'text-amber-600',
    title: 'A learner has consumed this KSB, but this scope never authored it',
  },
};

// ------------------------------------------------------------------- pieces

/** Achieved against planned, as one line. The bar is the comparison. */
function AchievementMeter({
  label,
  achievedLabel,
  plannedLabel,
  percentage,
  tone = 'primary',
  note,
}: {
  label: string;
  achievedLabel: string;
  plannedLabel: string;
  percentage: number;
  tone?: 'primary' | 'emerald' | 'amber';
  note?: string;
}) {
  const barColor = tone === 'emerald'
    ? 'bg-emerald-500'
    : tone === 'amber' ? 'bg-amber-500' : 'bg-primary-600';
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-lg font-heading font-bold text-foreground-950">{achievedLabel}</span>
        <span className="text-[12px] text-foreground-400">of {plannedLabel}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-200">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(Math.max(percentage, 0), 100)}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-foreground-500">
        {percent(percentage)}
        {note ? ` · ${note}` : ''}
      </p>
    </div>
  );
}

function CountStat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">{label}</p>
      <p className="mt-1 text-lg font-heading font-bold text-foreground-950">{value}</p>
      {note && <p className="mt-1 text-[11px] text-foreground-500">{note}</p>}
    </div>
  );
}

const KSB_GRID = 'grid grid-cols-[minmax(74px,.6fr)_minmax(160px,1.6fr)_86px_96px_minmax(120px,1fr)_96px]';

function KsbAchievementTable({
  rows,
  onSelectCode,
  selectedCode,
}: {
  rows: CurriculumScopeKsbAchievementRow[];
  onSelectCode: (code: string) => void;
  selectedCode: string;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className={`${KSB_GRID} gap-2 border-b border-background-200 px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
          <span>KSB</span>
          <span>Title</span>
          <span className="text-center">Weight</span>
          <span className="text-center">Learners</span>
          <span>Achieved of expected</span>
          <span className="text-center">Achieved</span>
        </div>
        <div className="divide-y divide-background-200/70">
          {rows.map(row => {
            const selected = normaliseText(row.code) === normaliseText(selectedCode);
            return (
              <button
                key={`${row.code}-${row.sourceId}`}
                type="button"
                onClick={() => onSelectCode(selected ? '' : row.code)}
                className={`${KSB_GRID} w-full gap-2 px-3 py-2 text-left transition-smooth hover:bg-background-100 ${selected ? 'bg-primary-50' : ''}`}
              >
                <span className="flex items-center gap-1.5 truncate text-[12px] font-bold text-foreground-900">
                  {row.code}
                  {STATUS_MARK[row.status] && (
                    <span title={STATUS_MARK[row.status].title} className={STATUS_MARK[row.status].className}>
                      <AppIcon className={`${STATUS_MARK[row.status].icon} text-[12px]`}></AppIcon>
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-foreground-700">{row.title || row.code}</span>
                  <span className="block truncate text-[10px] uppercase tracking-wider text-foreground-400">
                    {ksbTypeLabel(row.ksbType)}
                    {row.sourceLabel ? ` · ${row.sourceLabel}` : ''}
                  </span>
                </span>
                <span className="text-center text-[12px] tabular-nums text-foreground-700">{weight(row.plannedWeight)}</span>
                <span
                  className="text-center text-[12px] tabular-nums text-foreground-700"
                  title="Learners who have earned any of this KSB, out of the learners it is authored for in this scope"
                >
                  {row.learnersAchievedCount}/{row.learnerCount}
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background-200">
                    <span
                      className="block h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(row.achievementPercentage, 100)}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-foreground-500">
                    {weight(row.cappedAchievedWeightTotal)}/{weight(row.expectedWeightTotal)}
                  </span>
                </span>
                <span className={`rounded-md px-1.5 py-1 text-center text-[11px] font-bold tabular-nums ${heatClass(row.achievementPercentage, row.plannedWeight)}`}>
                  {percent(row.achievementPercentage)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const LEARNER_GRID = 'grid grid-cols-[minmax(160px,1.6fr)_minmax(110px,.9fr)_minmax(130px,1fr)_minmax(130px,1fr)_80px_80px]';

function LearnerAchievementTable({
  learners,
  consumptionByLearner,
  selectedCode,
  expandedLearner,
  onToggleLearner,
}: {
  learners: CurriculumScopeOtjhLearner[];
  consumptionByLearner: Map<string, CurriculumLearnerKsbConsumption>;
  selectedCode: string;
  expandedLearner: string;
  onToggleLearner: (learnerId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className={`${LEARNER_GRID} gap-2 border-b border-background-200 px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
          <span>Learner</span>
          <span>Group</span>
          <span>OTJH achieved</span>
          <span>KSB weight earned</span>
          <span className="text-center">Done</span>
          <span className="text-center">Logs</span>
        </div>
        <div className="divide-y divide-background-200/70">
          {learners.map(learner => {
            const key = String(learner.learnerId);
            const consumption = consumptionByLearner.get(key);
            const ksbPercentage = consumption?.progressPercentage || 0;
            const expanded = key === expandedLearner;
            const ksbRows = (consumption?.ksbs || []).filter(row => (
              !selectedCode || normaliseText(row.code) === normaliseText(selectedCode)
            ));
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => onToggleLearner(expanded ? '' : key)}
                  className={`${LEARNER_GRID} w-full gap-2 px-3 py-2 text-left transition-smooth hover:bg-background-100 ${expanded ? 'bg-background-100' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-foreground-900">
                      <AppIcon className={`${expanded ? 'ri-subtract-line' : 'ri-add-line'} text-[12px] text-foreground-400`}></AppIcon>
                      {learner.learnerName || learner.email || `Learner ${key}`}
                    </span>
                    <span className="block truncate pl-4 text-[10px] text-foreground-400">{learner.email}</span>
                  </span>
                  <span className="min-w-0 truncate text-[12px] text-foreground-600">
                    {learner.group || learner.cohort || '—'}
                    {learner.plannedBasis === 'none' && (
                      <span
                        className="ml-1 text-[10px] font-bold uppercase text-amber-600"
                        title="No module in this scope is delivered to this learner's group"
                      >
                        not delivered
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background-200">
                      <span className="block h-full rounded-full bg-primary-600" style={{ width: `${Math.min(learner.progressPercentage, 100)}%` }} />
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-foreground-500">
                      {hours(learner.achievedOtjh)}/{hours(learner.plannedOtjh)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background-200">
                      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(ksbPercentage, 100)}%` }} />
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-foreground-500">
                      {weight(consumption?.cappedConsumedWeightTotal)}/{weight(consumption?.expectedWeightTotal)}
                    </span>
                  </span>
                  <span className="text-center text-[12px] tabular-nums text-foreground-700">{learner.completedActivityCount}</span>
                  <span className="text-center text-[12px] tabular-nums text-foreground-700">{learner.reflectionCount}</span>
                </button>

                {expanded && (
                  <div className="border-t border-background-200 bg-background-100/50 px-3 py-2">
                    {ksbRows.length === 0 ? (
                      <p className="text-[11px] text-foreground-500">
                        No KSB weight recorded for this learner in this scope yet.
                      </p>
                    ) : (
                      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                        {ksbRows.map(row => (
                          <div key={row.code} className="flex items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-2 py-1.5">
                            <span className="truncate text-[11px] font-bold text-foreground-800">{row.code}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-foreground-500">
                              {weight(row.cappedConsumedWeight)}/{weight(row.expectedWeight)}
                            </span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${heatClass(row.progressPercentage, row.expectedWeight)}`}>
                              {percent(row.progressPercentage)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* The learner's own declared hours, next to the credited
                        figure rather than inside it. */}
                    <p className="mt-2 text-[11px] text-foreground-500">
                      Declared in reflections: {hours(learner.declaredOtjh)} · credited from component
                      expectations: {hours(Number(learner.achievedOtjh || 0) - Number(learner.declaredOtjh || 0))}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_GRID = 'grid grid-cols-[minmax(170px,1.5fr)_minmax(140px,1.1fr)_minmax(110px,.9fr)_92px_92px_92px_80px]';

function ActivityTable({ activities }: { activities: CurriculumLearnerActivity[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[820px]">
        <div className={`${ACTIVITY_GRID} gap-2 border-b border-background-200 px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
          <span>Component</span>
          <span>Module / week</span>
          <span>Learner</span>
          <span className="text-center">Expected</span>
          <span className="text-center">Declared</span>
          <span className="text-center">KSB weight</span>
          <span className="text-center">Status</span>
        </div>
        <div className="divide-y divide-background-200/70">
          {activities.map(activity => {
            const status = activity.progressStatus || 'incomplete';
            const outOfScope = (activity as { scopeStatus?: string }).scopeStatus === 'out_of_scope';
            return (
              <div key={activity.progressId} className={`${ACTIVITY_GRID} gap-2 px-3 py-2 ${outOfScope ? 'opacity-60' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-foreground-900">
                    {activity.componentTitle || activity.componentId || `Activity ${activity.progressId}`}
                  </span>
                  <span className="block truncate text-[10px] uppercase tracking-wider text-foreground-400">
                    {activity.componentType || activity.kind || '—'}
                    {activity.evidenceCount ? ` · ${activity.evidenceCount} evidence` : ''}
                  </span>
                </span>
                <span className="min-w-0 truncate text-[12px] text-foreground-600">
                  {activity.module || '—'}
                  {activity.week ? ` · ${activity.week}` : ''}
                </span>
                <span className="truncate text-[12px] text-foreground-600">{activity.learnerId ?? '—'}</span>
                <span className="text-center text-[12px] tabular-nums text-foreground-700">
                  {activity.expectedOtjh == null ? '—' : hours(activity.expectedOtjh)}
                </span>
                <span className="text-center text-[12px] tabular-nums text-foreground-700">
                  {activity.actualOtjh == null ? '—' : hours(activity.actualOtjh)}
                </span>
                <span className="text-center text-[12px] tabular-nums text-foreground-700">
                  {weight(activity.achievedKsbWeightTotal)}
                </span>
                <span className="text-center">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    outOfScope ? 'bg-foreground-100 text-foreground-500'
                      : status === 'achieved' ? 'bg-emerald-100 text-emerald-700'
                      : status === 'failed' ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {outOfScope ? 'elsewhere' : status}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- panel

/**
 * The achievement read for one curriculum scope.
 *
 * Give it a scope and an identifier and it owns the fetch, the empty states and
 * the drill-down. `title`/`description` are the caller's, because only the page
 * knows what it is calling this level.
 */
export function ScopeAchievementPanel({
  scope,
  identifier,
  title,
  description,
  learnerStatus,
  active = true,
}: {
  scope: CurriculumLearnerScope;
  identifier: string;
  title?: string;
  description?: string;
  /** Passed through to the roster read: 'active', 'all', or omitted. */
  learnerStatus?: string;
  /** False while the panel's tab is closed, so the read is not paid for. */
  active?: boolean;
}) {
  const [data, setData] = useState<CurriculumScopeLearnerKsbImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('ksb');
  const [search, setSearch] = useState('');
  const [hideNotStarted, setHideNotStarted] = useState(false);
  const [selectedCode, setSelectedCode] = useState('');
  const [expandedLearner, setExpandedLearner] = useState('');
  const requestedRef = useRef('');

  const load = useCallback((signal?: AbortSignal) => {
    if (!identifier) return;
    setLoading(true);
    setError(null);
    fetchCurriculumScopeLearnerKsbImpact(scope, identifier, { learnerStatus }, signal)
      .then(result => {
        if (signal?.aborted) return;
        setData(result);
        setError(null);
      })
      .catch(fetchError => {
        if (signal?.aborted) return;
        setData(null);
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load achievement for this scope.');
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, [identifier, learnerStatus, scope]);

  useEffect(() => {
    const key = `${scope}::${identifier}::${learnerStatus || ''}`;
    if (!active || !identifier || requestedRef.current === key) return;
    requestedRef.current = key;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [active, identifier, learnerStatus, load, scope]);

  const otjh = data?.otjhAchievement;
  const ksb = data?.ksbAchievement;
  const noun = SCOPE_NOUN[data?.scope || scope] || 'scope';

  const consumptionByLearner = useMemo(() => {
    const map = new Map<string, CurriculumLearnerKsbConsumption>();
    for (const row of data?.learnerKsbConsumption || []) map.set(String(row.learnerId), row);
    return map;
  }, [data]);

  const ksbRows = useMemo(() => {
    const query = normaliseText(search);
    return (ksb?.rows || []).filter(row => {
      if (hideNotStarted && !row.learnersAchievedCount) return false;
      if (!query) return true;
      return [row.code, row.title, row.sourceLabel].some(value => normaliseText(value).includes(query));
    });
  }, [hideNotStarted, ksb, search]);

  const learnerRows = useMemo(() => {
    const query = normaliseText(search);
    const rows = otjh?.learners || [];
    const byCode = selectedCode
      ? rows.filter(row => (consumptionByLearner.get(String(row.learnerId))?.ksbs || []).some(item => (
        normaliseText(item.code) === normaliseText(selectedCode) && Number(item.consumedWeight || 0) > 0
      )))
      : rows;
    if (!query) return byCode;
    return byCode.filter(row => [row.learnerName, row.email, row.group, row.cohort]
      .some(value => normaliseText(value).includes(query)));
  }, [consumptionByLearner, otjh, search, selectedCode]);

  const activities = useMemo(() => {
    const query = normaliseText(search);
    let rows = data?.learnerActivities || [];
    if (selectedCode) {
      rows = rows.filter(row => (row.ksbSnapshot || []).some(item => (
        normaliseText(item.code) === normaliseText(selectedCode)
      )));
    }
    if (expandedLearner) rows = rows.filter(row => String(row.learnerId) === expandedLearner);
    if (!query) return rows;
    return rows.filter(row => [row.componentTitle, row.module, row.week, row.componentType]
      .some(value => normaliseText(value).includes(query)));
  }, [data, expandedLearner, search, selectedCode]);

  const outOfScopeCount = data?.consumptionSources?.outOfScopeProgress?.length || 0;

  return (
    <section className="rounded-2xl border border-foreground-200/60 bg-background-50">
      <div className="flex flex-col gap-2 border-b border-background-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-[13px] font-heading font-bold text-foreground-950">
            {title || 'Learner achievement'}
          </h3>
          <p className="mt-0.5 text-[12px] text-foreground-500">
            {description || `What the learners assigned to this ${noun} have actually achieved against its own components. Planned figures come from curriculum; achieved figures come from learner activity.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
        >
          <AppIcon className="ri-refresh-line"></AppIcon>
          Refresh
        </button>
      </div>

      <div className="space-y-4 p-5">
        {loading && !data && <p className="text-[12px] text-foreground-500">Loading learner achievement…</p>}

        {error && <InlineError message={error} onRetry={() => load()} />}

        {!error && data && (
          <>
            {/* The three figures this panel exists to give. Achieved against
                planned, each naming its own denominator. */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <CountStat
                label="Learners assigned"
                value={data.assignedLearnerCount}
                note={
                  data.placementBasis && data.placementBasis !== data.scope
                    ? `Placed by enrolment into the ${data.placementBasis} that delivers this ${noun}`
                    : 'Placed by enrolment; curriculum only reads them'
                }
              />
              <AchievementMeter
                label="OTJH achieved"
                achievedLabel={hours(otjh?.achievedTotal)}
                plannedLabel={hours(otjh?.plannedTotal)}
                percentage={otjh?.progressPercentage || 0}
                note={`${hours(otjh?.plannedPerLearner)} per learner · ${hours(otjh?.authoredTotal)} authored here`}
              />
              <AchievementMeter
                label="KSB weight earned"
                achievedLabel={weight(ksb?.cappedAchievedWeightTotal)}
                plannedLabel={weight(ksb?.expectedWeightTotal)}
                percentage={ksb?.progressPercentage || 0}
                tone="emerald"
                note={`${weight(ksb?.plannedWeightTotal)} authored across this ${noun}`}
              />
              <CountStat
                label="KSBs started"
                value={`${ksb?.startedCount || 0}/${ksb?.ksbCount || 0}`}
                note={[
                  `${data.structure?.componentCount || 0} components`,
                  `${otjh?.completedActivityCount || 0} completed activities`,
                  ksb?.unmappedCount ? `${ksb.unmappedCount} taught nowhere` : '',
                ].filter(Boolean).join(' · ')}
              />
            </div>

            {/* Where the numbers came from, stated once. The alternative is a
                reader assuming a scope subtotal is the learner's whole
                programme figure, which is the mistake this replaced. */}
            <p className="rounded-lg border border-background-200 bg-background-100/60 px-3 py-2 text-[11px] leading-relaxed text-foreground-500">
              Achieved OTJH credits the learner&apos;s declared hours where a reflection exists
              ({hours(otjh?.declaredTotal)}) and the component&apos;s expected hours where the activity
              completed without one ({hours(otjh?.creditedFromExpectedTotal)}). Achieved KSB weight comes
              from the component progress snapshot; a reflection&apos;s KSB declaration is evidence about
              the same activity and is never added in.
              {outOfScopeCount ? ` ${outOfScopeCount} completed activities belong to another part of this programme and are not counted here.` : ''}
              {(data.structure?.groupCount || 0) > 1
                ? ` This ${noun} is delivered by ${data.structure.groupCount} groups, and a module belongs to one group — so each learner is measured against their own group's modules, not against everything authored here.`
                : ''}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-xl border border-background-200 bg-background-100/60 p-1">
                {TABS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition-smooth ${
                      tab === item.key ? 'bg-primary-600 text-white' : 'text-foreground-600 hover:bg-background-50'
                    }`}
                  >
                    <AppIcon className={item.icon}></AppIcon>
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="relative min-w-[180px] flex-1">
                <AppIcon className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-foreground-400"></AppIcon>
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={tab === 'ksb' ? 'Search KSB code or title' : tab === 'learners' ? 'Search learner' : 'Search component, module or week'}
                  className="h-8 w-full rounded-lg border border-background-200 bg-background-50 pl-8 pr-2 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-400"
                />
              </label>
              {tab === 'ksb' && (
                <button
                  type="button"
                  onClick={() => setHideNotStarted(value => !value)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-smooth ${
                    hideNotStarted
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
                  }`}
                >
                  <AppIcon className="ri-filter-3-line"></AppIcon>
                  Started only
                </button>
              )}
              {selectedCode && (
                <button
                  type="button"
                  onClick={() => setSelectedCode('')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-300 bg-primary-50 px-2.5 text-[11px] font-bold text-primary-700"
                >
                  {selectedCode}
                  <AppIcon className="ri-close-line"></AppIcon>
                </button>
              )}
            </div>

            {tab === 'ksb' && (
              ksbRows.length ? (
                <KsbAchievementTable
                  rows={ksbRows}
                  selectedCode={selectedCode}
                  onSelectCode={setSelectedCode}
                />
              ) : (
                <EntityEmptyState
                  icon="ri-grid-line"
                  title={ksb?.ksbCount ? 'No KSB matches this filter' : 'No KSBs mapped in this scope yet'}
                  message={ksb?.ksbCount
                    ? 'Clear the search or the started-only filter.'
                    : 'Map KSBs to this scope’s components in the Module Builder and learner consumption will roll up here.'}
                />
              )
            )}

            {tab === 'learners' && (
              learnerRows.length ? (
                <LearnerAchievementTable
                  learners={learnerRows}
                  consumptionByLearner={consumptionByLearner}
                  selectedCode={selectedCode}
                  expandedLearner={expandedLearner}
                  onToggleLearner={setExpandedLearner}
                />
              ) : (
                <EntityEmptyState
                  icon="ri-graduation-cap-line"
                  title={data.assignedLearnerCount ? 'No learner matches this filter' : 'No learners assigned here yet'}
                  message={data.assignedLearnerCount
                    ? 'Clear the search or the selected KSB.'
                    : 'The enrolment team places learners into cohorts and groups; curriculum reads those placements.'}
                />
              )
            )}

            {tab === 'activity' && (
              activities.length ? (
                <ActivityTable activities={activities} />
              ) : (
                <EntityEmptyState
                  icon="ri-history-line"
                  title={data.learnerActivityCount ? 'No activity matches this filter' : 'No learner activity recorded here yet'}
                  message={data.learnerActivityCount
                    ? 'Clear the search, the selected KSB or the selected learner.'
                    : 'Activity appears once a learner completes a component in this scope.'}
                />
              )
            )}
          </>
        )}
      </div>
    </section>
  );
}
