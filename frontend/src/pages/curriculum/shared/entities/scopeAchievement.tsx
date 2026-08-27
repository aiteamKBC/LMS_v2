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
  type CurriculumLearnerKsbConsumptionItem,
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

const KSB_GRID = 'grid grid-cols-[minmax(220px,2.4fr)_86px_96px_minmax(120px,1fr)_96px]';

// The standard's wording for a KSB. Coverage stores the outcome text in either
// field depending on how the source was authored, and both fall back to the code
// — which the row already shows above, so there is nothing to repeat.
function ksbDescription(row: CurriculumScopeKsbAchievementRow) {
  const text = String(row.description || '').trim() || String(row.title || '').trim();
  return normaliseText(text) === normaliseText(row.code) ? '' : text;
}

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
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-background-200">
      <div className="min-w-[720px]">
        <div className={`${KSB_GRID} sticky top-0 z-20 gap-2 border-b border-background-200 bg-background-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
          <span>KSB</span>
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
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[12px] font-bold text-foreground-900">
                    {row.code}
                    {STATUS_MARK[row.status] && (
                      <span title={STATUS_MARK[row.status].title} className={STATUS_MARK[row.status].className}>
                        <AppIcon className={`${STATUS_MARK[row.status].icon} text-[12px]`}></AppIcon>
                      </span>
                    )}
                  </span>
                  {ksbDescription(row) && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-foreground-600 line-clamp-2">{ksbDescription(row)}</span>
                  )}
                  <span className="mt-0.5 block truncate text-[10px] uppercase tracking-wider text-foreground-400">
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

/**
 * The bands `heatClass` paints, named. A heatmap is unreadable without them: a
 * grid of tinted numbers otherwise leaves the reader to guess whether amber is
 * "behind" or "not planned for this learner at all", which are opposite facts.
 */
/** How many learner columns the matrix will draw before it says it stopped. */
const MAX_HEATMAP_LEARNER_COLUMNS = 40;

const ACHIEVEMENT_HEAT_LEGEND: Array<{ label: string; className: string }> = [
  { label: 'Not planned', className: 'bg-background-100 text-foreground-400' },
  { label: 'Not started', className: 'bg-background-200 text-foreground-500' },
  { label: 'Under 40%', className: 'bg-amber-200/70 text-amber-900' },
  { label: '40–74%', className: 'bg-amber-300/90 text-amber-950' },
  { label: '75–99%', className: 'bg-emerald-400/90 text-emerald-950' },
  { label: 'Complete', className: 'bg-emerald-600 text-white' },
];

/**
 * Achievement as a KSB × learner matrix, the same shape the KSB coverage tab
 * uses for KSB × module.
 *
 * The aggregate table this replaces could say "3/12 learners have started S4",
 * which is the one thing a coach cannot act on: it names a shortfall without
 * naming who has it. A row of per-learner cells answers both questions at once —
 * which KSBs the cohort is behind on (read across) and which learner is behind
 * (read down) — and the tint makes the outliers findable without reading a
 * single number.
 */
function KsbAchievementHeatmap({
  rows,
  learners: allLearners,
  onSelectCode,
  selectedCode,
  onSelectLearner,
  selectedLearner,
}: {
  rows: CurriculumScopeKsbAchievementRow[];
  learners: CurriculumLearnerKsbConsumption[];
  onSelectCode: (code: string) => void;
  selectedCode: string;
  onSelectLearner: (learnerId: string) => void;
  selectedLearner: string;
}) {
  // A programme-wide scope can hold hundreds of learners, and a cell per learner
  // per KSB is a cell count that janks the tab and a matrix nobody can read
  // across anyway. The cap is stated on screen rather than applied quietly, and
  // it names the way out: the scope picker directly above this panel.
  const learners = allLearners.slice(0, MAX_HEATMAP_LEARNER_COLUMNS);
  const hiddenLearnerCount = allLearners.length - learners.length;

  const consumptionByLearnerCode = useMemo(() => {
    const map = new Map<string, Map<string, CurriculumLearnerKsbConsumptionItem>>();
    for (const learner of learners) {
      const byCode = new Map<string, CurriculumLearnerKsbConsumptionItem>();
      for (const item of learner.ksbs || []) byCode.set(normaliseText(item.code), item);
      map.set(String(learner.learnerId), byCode);
    }
    return map;
  }, [learners]);

  // Learner columns are narrow on purpose: a name is a label here, not the
  // subject. The scope total keeps its own column so the row still reads as a
  // roll-up when the learner columns run off the side.
  const gridTemplateColumns = `minmax(240px, 1.5fr) 74px 92px repeat(${learners.length}, minmax(104px, 1fr))`;
  const minWidth = 240 + 74 + 92 + learners.length * 104 + 48;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-background-200 bg-background-100/60 px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Achieved of expected</span>
        {ACHIEVEMENT_HEAT_LEGEND.map(band => (
          <span key={band.label} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${band.className}`}>
            {band.label}
          </span>
        ))}
        <span className="text-[10px] text-foreground-400">
          Click a KSB or a learner to filter the Learners and Activity tabs.
        </span>
      </div>

      {hiddenLearnerCount > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
          Showing the first {learners.length} of {allLearners.length} learners, by name. Pick a cohort or a group
          in the scope above to see the rest as a matrix — the totals column and the Learners tab still cover
          everyone.
        </p>
      )}

      {/* Its own scroll box on both axes: one column per learner outgrows the
          viewport long before the rows do, and a horizontal bar parked below the
          last KSB cannot be reached until the reader has scrolled past every
          one of them. */}
      <div className="max-h-[70vh] overflow-auto rounded-2xl border border-background-200 bg-background-50">
        <div style={{ minWidth }}>
          <div
            className="sticky top-0 z-30 grid items-end gap-2 border-b border-background-200 bg-background-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400"
            style={{ gridTemplateColumns }}
          >
            {/* Frozen both ways. Scrolling down must keep the learner names, and
                scrolling right must keep the KSB the cells belong to. */}
            <span className="sticky left-0 z-10 -ml-3 bg-background-100 pl-3 shadow-[6px_0_8px_-8px_rgba(15,23,42,0.35)]">KSB</span>
            <span className="text-center">Weight</span>
            <span className="text-center">Scope</span>
            {learners.map(learner => {
              const learnerId = String(learner.learnerId);
              const isSelected = learnerId === selectedLearner;
              return (
                <button
                  key={learnerId}
                  type="button"
                  onClick={() => onSelectLearner(isSelected ? '' : learnerId)}
                  title={`${learner.learnerName}${learner.group ? ` · ${learner.group}` : ''} — ${percent(learner.progressPercentage)} of their expected weight`}
                  className={`truncate rounded-md px-1 py-0.5 text-center normal-case transition-smooth hover:bg-primary-100 hover:text-primary-800 ${
                    isSelected ? 'bg-primary-600 text-white' : ''
                  }`}
                >
                  {learner.learnerName || learnerId}
                </button>
              );
            })}
          </div>

          <div className="divide-y divide-background-200/70">
            {rows.map(row => {
              const codeKey = normaliseText(row.code);
              const isSelectedRow = codeKey === normaliseText(selectedCode);
              return (
                <div
                  key={`${row.code}-${row.sourceId}`}
                  // Opaque, because the frozen first cell inherits this
                  // background to hide the cells travelling under it.
                  className={`grid items-stretch gap-2 px-3 py-1.5 transition-smooth ${
                    isSelectedRow ? 'bg-primary-50' : 'bg-background-50 hover:bg-background-100'
                  }`}
                  style={{ gridTemplateColumns }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectCode(isSelectedRow ? '' : row.code)}
                    className="sticky left-0 z-10 -ml-3 min-w-0 bg-inherit pl-3 pr-1 text-left shadow-[6px_0_8px_-8px_rgba(15,23,42,0.35)]"
                  >
                    <span className="flex items-center gap-1.5 text-[12px] font-bold text-foreground-900">
                      {row.code}
                      {STATUS_MARK[row.status] && (
                        <span title={STATUS_MARK[row.status].title} className={STATUS_MARK[row.status].className}>
                          <AppIcon className={`${STATUS_MARK[row.status].icon} text-[12px]`}></AppIcon>
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[10px] uppercase tracking-wider text-foreground-400">
                      {ksbTypeLabel(row.ksbType)}
                      {ksbDescription(row) ? ` · ${ksbDescription(row)}` : ''}
                    </span>
                  </button>
                  <span className="self-center text-center text-[11px] tabular-nums text-foreground-600">{weight(row.plannedWeight)}</span>
                  <span
                    className={`self-center rounded-md px-1 py-1 text-center text-[11px] font-bold tabular-nums ${heatClass(row.achievementPercentage, row.plannedWeight)}`}
                    title={`${row.learnersAchievedCount} of ${row.learnerCount} learners started · ${weight(row.cappedAchievedWeightTotal)} of ${weight(row.expectedWeightTotal)} earned`}
                  >
                    {percent(row.achievementPercentage)}
                  </span>
                  {learners.map(learner => {
                    const learnerId = String(learner.learnerId);
                    const cell = consumptionByLearnerCode.get(learnerId)?.get(codeKey);
                    const expected = Number(cell?.expectedWeight || 0);
                    const achieved = Number(cell?.progressPercentage || 0);
                    const isSelectedColumn = learnerId === selectedLearner;
                    return (
                      <button
                        key={`${row.code}-${learnerId}`}
                        type="button"
                        onClick={() => { onSelectCode(row.code); onSelectLearner(learnerId); }}
                        title={cell
                          ? `${learner.learnerName} · ${row.code}: ${weight(cell.cappedConsumedWeight)} of ${weight(cell.expectedWeight)} earned (${percent(achieved)})`
                          : `${learner.learnerName} is not assigned ${row.code} anywhere in this scope`}
                        className={`self-center rounded-md px-1 py-1 text-center text-[11px] font-bold tabular-nums transition-smooth hover:ring-2 hover:ring-primary-400 ${heatClass(achieved, expected)} ${
                          isSelectedColumn ? 'ring-1 ring-primary-400' : ''
                        }`}
                      >
                        {expected ? percent(achieved) : '—'}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
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
          {/* Same reason as the Activity tab's headers: "Done" and "Logs" are
              counts of two different records and the labels alone don't say
              which. */}
          {([
            { label: 'Learner', hint: 'Who is placed here by enrolment. Curriculum only reads this roster.' },
            { label: 'Group', hint: 'The delivery group they are placed in — the group whose modules they are measured against.' },
            { label: 'OTJH achieved', hint: 'Credited off-the-job hours against what this learner’s own group is assigned in this scope.' },
            { label: 'KSB weight earned', hint: 'Capped KSB weight earned against the weight expected of this learner in this scope.' },
            { label: 'Done', hint: 'How many components this learner has completed in this scope.', align: 'center' },
            { label: 'Logs', hint: 'How many reflections this learner has submitted for those components.', align: 'center' },
          ] as Array<{ label: string; hint: string; align?: 'center' }>).map(column => (
            <span
              key={column.label}
              title={column.hint}
              className={`cursor-help decoration-dotted underline-offset-4 hover:underline ${column.align === 'center' ? 'text-center' : ''}`}
            >
              {column.label}
            </span>
          ))}
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

const ACTIVITY_GRID = 'grid grid-cols-[minmax(170px,1.5fr)_minmax(140px,1.1fr)_minmax(110px,.9fr)_92px_92px_92px_96px_96px]';

// What each column of the Activity tab actually reports. On the header rather
// than in prose above the table: the question ("what is Declared?") is asked
// while reading a row, and two of these columns answer different questions than
// their one-word label suggests.
const ACTIVITY_COLUMNS: Array<{ label: string; hint: string; align?: 'center' }> = [
  {
    label: 'Component',
    hint: 'The component the learner completed, and its type. Any evidence they uploaded is counted underneath.',
  },
  {
    label: 'Module / week',
    hint: 'Where the component sits in the curriculum: the module that owns it and the week inside that module. Resolved live against the catalogue, so a module that has since been deleted is marked as such rather than named as though it were still there.',
  },
  {
    label: 'Learner',
    hint: 'Who did the activity. Hover a name for their enrolment learner id and email.',
  },
  {
    label: 'Expected',
    hint: 'The off-the-job hours curriculum authored on the component — what this activity was planned to take.',
    align: 'center',
  },
  {
    label: 'Declared',
    hint: 'The hours the learner declared for this activity in their own reflection. A dash means no reflection was submitted, so nothing was declared.',
    align: 'center',
  },
  {
    label: 'KSB weight',
    hint: 'KSB weight credited by this activity, from the component progress snapshot. A reflection’s own KSB declaration is evidence about the same activity and is never added on top.',
    align: 'center',
  },
  {
    label: 'Status',
    hint: 'What happened to the activity: achieved, failed, or still incomplete. This says nothing about whether it counts here — see Counted.',
    align: 'center',
  },
  {
    label: 'Counted',
    hint: 'Whether this activity counts toward the figures above. "Elsewhere" means the learner completed it in a part of the programme their group is not delivered, so it is reported here but excluded from this scope’s totals.',
    align: 'center',
  },
];

function ActivityTable({
  activities,
  learnerNames,
}: {
  activities: CurriculumLearnerActivity[];
  /** learnerId -> the person's name, so the column names a learner not an id. */
  learnerNames: Map<string, { name: string; email: string }>;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[940px]">
        <div className={`${ACTIVITY_GRID} gap-2 border-b border-background-200 px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
          {ACTIVITY_COLUMNS.map(column => (
            <span
              key={column.label}
              title={column.hint}
              className={`cursor-help decoration-dotted underline-offset-4 hover:underline ${column.align === 'center' ? 'text-center' : ''}`}
            >
              {column.label}
            </span>
          ))}
        </div>
        <div className="divide-y divide-background-200/70">
          {activities.map(activity => {
            const status = activity.progressStatus || 'incomplete';
            const outOfScope = activity.scopeStatus === 'out_of_scope';
            const learnerKey = activity.learnerId == null ? '' : String(activity.learnerId);
            const learner = learnerKey ? learnerNames.get(learnerKey) : undefined;
            const moduleMark = activity.moduleStatus === 'deleted'
              ? {
                label: 'deleted',
                className: 'bg-red-100 text-red-700',
                hint: `This module has been deleted from the catalogue${activity.moduleCatalogueId ? ` (${activity.moduleCatalogueId})` : ''}, so searching for it in the Module Builder will not find it. The learner's completed work is kept.`,
              }
              : activity.moduleStatus === 'unknown'
                ? {
                  label: 'not in catalogue',
                  className: 'bg-amber-100 text-amber-700',
                  hint: 'This component no longer resolves to a module in the catalogue, so the module name shown is the label stored on the learner’s activity.',
                }
                : null;
            // Two separate facts, so a row can state both. Before, a completed
            // activity from another part of the programme reported "elsewhere"
            // in place of its status, and an in-scope row never said that it
            // counted at all.
            const counted = outOfScope
              ? { label: 'Elsewhere', className: 'bg-foreground-100 text-foreground-500', hint: 'Completed in a part of this programme that this learner’s group is not delivered — reported here, excluded from the totals above.' }
              : activity.countsTowardAchievement === false
                ? { label: 'Not counted', className: 'bg-amber-100 text-amber-700', hint: 'In this scope, but the activity itself does not count toward achievement.' }
                : { label: 'Counted', className: 'bg-emerald-100 text-emerald-700', hint: 'Counts toward the OTJH and KSB weight reported above.' };
            return (
              <div key={activity.progressId} className={`${ACTIVITY_GRID} gap-2 px-3 py-2`}>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-foreground-900">
                    {activity.componentTitle || activity.componentId || `Activity ${activity.progressId}`}
                  </span>
                  <span className="block truncate text-[10px] uppercase tracking-wider text-foreground-400">
                    {activity.componentType || activity.kind || '—'}
                    {activity.evidenceCount ? ` · ${activity.evidenceCount} evidence` : ''}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-foreground-600">
                  <span className="min-w-0 truncate">
                    {activity.module || '—'}
                    {activity.week ? ` · ${activity.week}` : ''}
                  </span>
                  {/* Where the module went, when it is no longer somewhere the
                      reader can open. Without this a deleted module reads like a
                      live one and the only way to find that out is to search the
                      catalogue for a title that is not there any more. */}
                  {moduleMark && (
                    <span
                      title={moduleMark.hint}
                      className={`shrink-0 cursor-help rounded px-1.5 py-0.5 text-[10px] font-bold ${moduleMark.className}`}
                    >
                      {moduleMark.label}
                    </span>
                  )}
                </span>
                <span
                  className="truncate text-[12px] text-foreground-600"
                  title={learnerKey ? `Learner id ${learnerKey}${learner?.email ? ` · ${learner.email}` : ''}` : undefined}
                >
                  {/* The roster carries the name; printing the raw enrolment id
                      made the column unreadable. The id stays on the tooltip
                      because it is what Learner, Coach and Curriculum match on. */}
                  {learner?.name || learner?.email || (learnerKey ? `Learner ${learnerKey}` : '—')}
                </span>
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
                  <span
                    title={status === 'achieved'
                      ? 'The learner completed this activity.'
                      : status === 'failed'
                        ? 'The learner attempted this activity and did not pass it.'
                        : 'Not completed yet.'}
                    className={`cursor-help rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      status === 'achieved' ? 'bg-emerald-100 text-emerald-700'
                        : status === 'failed' ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {status}
                  </span>
                </span>
                <span className="text-center">
                  <span title={counted.hint} className={`cursor-help rounded-full px-2 py-0.5 text-[10px] font-bold ${counted.className}`}>
                    {counted.label}
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
  // Which read owns the panel's state. An aborted read must not clear `loading`
  // that a newer one has since set, and it must not report its own abort as an
  // error — but the read that is still current always gets to finish the
  // spinner, however it settled.
  const generationRef = useRef(0);

  const load = useCallback((signal?: AbortSignal) => {
    if (!identifier) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    setError(null);
    fetchCurriculumScopeLearnerKsbImpact(scope, identifier, { learnerStatus }, signal)
      .then(result => {
        if (signal?.aborted || generationRef.current !== generation) return;
        setData(result);
        setError(null);
      })
      .catch(fetchError => {
        if (signal?.aborted || generationRef.current !== generation) return;
        setData(null);
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load achievement for this scope.');
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false);
      });
  }, [identifier, learnerStatus, scope]);

  // No per-scope "already asked" guard here. StrictMode runs this effect twice
  // on mount, and the cleanup between the two passes aborts the first read: a
  // guard keyed on scope+identifier made the second pass a no-op, so nothing
  // was ever in flight and nothing ever cleared `loading` — the panel sat on
  // "Loading learner achievement…" for good. The shared GET layer dedupes the
  // pair into one request anyway (see curriculumApi.fetchJson).
  useEffect(() => {
    if (!active || !identifier) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [active, identifier, load]);

  const otjh = data?.otjhAchievement;
  const ksb = data?.ksbAchievement;
  const noun = SCOPE_NOUN[data?.scope || scope] || 'scope';

  const consumptionByLearner = useMemo(() => {
    const map = new Map<string, CurriculumLearnerKsbConsumption>();
    for (const row of data?.learnerKsbConsumption || []) map.set(String(row.learnerId), row);
    return map;
  }, [data]);

  // Every name the payload knows for a learner id, collected once. The activity
  // rows carry the id only — it is the identifier Learner, Coach and Curriculum
  // share — so without this the Activity tab reported a person as "211".
  const learnerNames = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    const remember = (id: unknown, name: unknown, email: unknown) => {
      const key = id == null ? '' : String(id);
      if (!key) return;
      const existing = map.get(key);
      const resolvedName = String(name ?? '').trim() || existing?.name || '';
      const resolvedEmail = String(email ?? '').trim() || existing?.email || '';
      map.set(key, { name: resolvedName, email: resolvedEmail });
    };
    for (const row of data?.assignedLearners || []) remember(row.id, row.name, row.email);
    for (const row of data?.otjhAchievement?.learners || []) remember(row.learnerId, row.learnerName, row.email);
    for (const row of data?.learnerKsbConsumption || []) remember(row.learnerId, row.learnerName, row.email);
    return map;
  }, [data]);

  // Columns for the KSB heatmap: every learner placed in this scope, in a stable
  // order. Deliberately not `learnerRows` — that list is narrowed by the selected
  // KSB, so the matrix would drop the very columns that explain the selection.
  const heatmapLearners = useMemo(
    () => [...(data?.learnerKsbConsumption || [])].sort((left, right) => (
      String(left.learnerName || '').localeCompare(String(right.learnerName || ''))
    )),
    [data],
  );

  const ksbRows = useMemo(() => {
    const query = normaliseText(search);
    return (ksb?.rows || []).filter(row => {
      if (hideNotStarted && !row.learnersAchievedCount) return false;
      if (!query) return true;
      return [row.code, row.title, row.description, row.sourceLabel].some(value => normaliseText(value).includes(query));
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
                // The matrix needs learner columns to be a matrix. With no
                // learners placed here yet there is nothing to read across, so
                // the aggregate table carries the same rows instead of an empty
                // grid claiming a shortfall nobody has.
                heatmapLearners.length ? (
                  <KsbAchievementHeatmap
                    rows={ksbRows}
                    learners={heatmapLearners}
                    selectedCode={selectedCode}
                    onSelectCode={setSelectedCode}
                    selectedLearner={expandedLearner}
                    onSelectLearner={setExpandedLearner}
                  />
                ) : (
                  <KsbAchievementTable
                    rows={ksbRows}
                    selectedCode={selectedCode}
                    onSelectCode={setSelectedCode}
                  />
                )
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
                <ActivityTable activities={activities} learnerNames={learnerNames} />
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
