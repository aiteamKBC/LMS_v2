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
  { key: 'ksb', label: 'KSBs', icon: 'ri-list-check-3' },
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
 * Achieved, or not. Two tones and no bands.
 *
 * The tab used to paint five shades and name them "Not started", "Under 40%",
 * "40-74%", "75-99%", "Complete" — a scale nobody acts on, and one that made a
 * KSB nobody has touched look like a milder version of a KSB half-earned. The
 * question this tab exists to answer is binary: is this KSB evidenced in this
 * programme, and by whom. Partial credit still shows as its own tone, because a
 * KSB one learner has half-earned is not the same as one nobody has started.
 */
function achievedTone(earned: number, expected: number) {
  if (earned <= 0) return 'bg-background-200 text-foreground-500';
  if (!expected || earned >= expected) return 'bg-emerald-600 text-white';
  return 'bg-emerald-100 text-emerald-800';
}

/**
 * One learner's standing on one KSB, rendered the same way everywhere it
 * appears.
 *
 * Three different facts compete for this one slot:
 *
 *  - the scope never asks this KSB of this learner, so there is nothing to be
 *    behind on;
 *  - the learner earned weight for a KSB the scope never asked them for — real,
 *    and worth seeing, but not progress toward anything here;
 *  - genuine earned weight against an expected weight.
 */
type KsbCellState = {
  /** The badge: "Achieved", "Part", "Extra", or an em dash. */
  text: string;
  /** The number pair spelled out, for the wider chip. */
  amount: string;
  /** The matrix square, where a word does not fit: "72%", "Extra" or an em dash. */
  short: string;
  className: string;
  title: string;
};

function ksbCellState(
  item: Pick<CurriculumLearnerKsbConsumptionItem, 'expectedWeight' | 'cappedConsumedWeight' | 'progressPercentage'> | null | undefined,
  context: string,
): KsbCellState {
  const expected = Number(item?.expectedWeight || 0);
  const earned = Number(item?.cappedConsumedWeight || 0);
  const notExpected = {
    text: '—',
    amount: 'not expected here',
    short: '—',
    className: 'bg-background-100 text-foreground-400',
    title: `${context}: this scope does not ask this learner for this KSB, so there is nothing for them to achieve.`,
  };
  if (!item) return notExpected;
  if (!expected) {
    if (earned <= 0) return notExpected;
    return {
      text: 'Extra',
      amount: `${weight(earned)} earned`,
      short: 'Extra',
      className: 'bg-sky-100 text-sky-800',
      title: `${context}: the learner earned ${weight(earned)} KSB weight, but this scope does not ask them for this KSB. It is reported as extra, not counted here.`,
    };
  }
  return {
    text: earned <= 0 ? 'Not achieved' : earned >= expected ? 'Achieved' : 'Part',
    amount: `${weight(earned)} of ${weight(expected)}`,
    short: `${Math.min(100, Math.round((earned / expected) * 100))}%`,
    className: achievedTone(earned, expected),
    title: `${context}: ${weight(earned)} of the ${weight(expected)} KSB weight expected of this learner earned.`,
  };
}

/**
 * Which of K/S/B a row belongs to. The backend sends `ksbTypeCode` for exactly
 * this, but `ksbType` is a word whose spelling varies by import ('Skill',
 * 'Skills', 'skill') and a row with neither still has a code — `S4` is a skill
 * whatever the metadata says. Same fallback chain as the server's.
 */
function ksbTypeCode(row: Pick<CurriculumScopeKsbAchievementRow, 'ksbTypeCode' | 'ksbType' | 'code'>) {
  const candidates = [row.ksbTypeCode, row.ksbType, row.code];
  for (const candidate of candidates) {
    const letter = String(candidate ?? '').trim().toUpperCase().slice(0, 1);
    if (letter === 'K' || letter === 'S' || letter === 'B') return letter;
  }
  return 'K';
}

const KSB_TYPE_META: Record<string, { label: string; plural: string; chip: string }> = {
  K: { label: 'Knowledge', plural: 'Knowledge', chip: 'bg-sky-100 text-sky-800' },
  S: { label: 'Skill', plural: 'Skills', chip: 'bg-violet-100 text-violet-800' },
  B: { label: 'Behaviour', plural: 'Behaviours', chip: 'bg-amber-100 text-amber-800' },
};

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

// ------------------------------------------------------------- derived shape

/**
 * Where a KSB stands in one scope. Three outcomes, not a percentage:
 *
 *  - `achieved` — at least one learner has earned weight for it here;
 *  - `missing`  — this scope asks for it and no learner has earned any yet;
 *  - `extra`    — a learner earned it, but this scope never authored it, so it
 *                 is neither achieved *here* nor a gap in this scope's design.
 */
type KsbStanding = 'achieved' | 'missing' | 'extra';

function ksbStanding(row: CurriculumScopeKsbAchievementRow): KsbStanding {
  if (row.status === 'unplanned') return 'extra';
  return row.learnersAchievedCount > 0 ? 'achieved' : 'missing';
}

const STANDING_BADGE: Record<KsbStanding, { label: string; className: string; title: string }> = {
  achieved: {
    label: 'Achieved',
    className: 'bg-emerald-600 text-white',
    title: 'At least one learner here has earned weight for this KSB.',
  },
  missing: {
    label: 'Missing',
    className: 'bg-amber-100 text-amber-800',
    title: 'This scope asks for this KSB and no learner has earned any of it yet.',
  },
  extra: {
    label: 'Extra',
    className: 'bg-sky-100 text-sky-800',
    title: 'A learner earned this KSB somewhere this scope never authored it. Reported, not counted here.',
  },
};

/** One learner who has earned weight for one KSB. */
type KsbAchiever = {
  learnerId: string;
  name: string;
  cohort: string;
  group: string;
  earned: number;
  expected: number;
};

/** One completed activity that credited one KSB. */
export type KsbCredit = {
  key: string;
  learnerName: string;
  component: string;
  module: string;
  week: string;
  weight: number;
  /** Whether the module behind this credit still exists in the catalogue.
   *  'deleted' or 'unknown' means a caller that can open a live preview
   *  should not offer to — there is nothing left to open. */
  moduleStatus?: string;
};

/** K / S / B rolled up, counted exactly the way the table below counts. */
type KsbFamily = {
  letter: string;
  label: string;
  achieved: number;
  missing: number;
  required: number;
  earnedWeight: number;
  expectedWeight: number;
};

function ksbFamilies(rows: CurriculumScopeKsbAchievementRow[]): KsbFamily[] {
  return ['K', 'S', 'B'].map(letter => {
    const family = rows.filter(row => ksbTypeCode(row) === letter);
    // 'unplanned' rows are a learner's extra credit, not one of this scope's
    // own KSBs — they can neither be achieved here nor missing from here.
    const own = family.filter(row => row.status !== 'unplanned');
    return {
      letter,
      label: KSB_TYPE_META[letter].plural,
      achieved: own.filter(row => row.learnersAchievedCount > 0).length,
      missing: own.filter(row => !row.learnersAchievedCount).length,
      required: own.length,
      earnedWeight: family.reduce((total, row) => total + Number(row.cappedAchievedWeightTotal || 0), 0),
      expectedWeight: own.reduce((total, row) => total + Number(row.expectedWeightTotal || 0), 0),
    };
  });
}

// ------------------------------------------------------------------- pieces

/** Achieved against planned, as one line. The bar is the comparison. */
function AchievementMeter({
  label,
  achievedLabel,
  plannedLabel,
  percentage,
  tone = 'primary',
  note,
  hint,
}: {
  label: string;
  achievedLabel: string;
  plannedLabel: string;
  percentage: number;
  tone?: 'primary' | 'emerald' | 'amber';
  note?: string;
  hint?: string;
}) {
  const barColor = tone === 'emerald'
    ? 'bg-emerald-500'
    : tone === 'amber' ? 'bg-amber-500' : 'bg-primary-600';
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/60 p-3">
      <p
        title={hint}
        className={`text-[10px] font-bold uppercase tracking-wider text-foreground-400 ${hint ? 'cursor-help decoration-dotted underline-offset-4 hover:underline' : ''}`}
      >
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-lg font-heading font-bold text-foreground-950">{achievedLabel}</span>
        <span className="text-[12px] text-foreground-400">of {plannedLabel}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-200">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(Math.max(percentage, 0), 100)}%` }} />
      </div>
      {note && <p className="mt-1 text-[11px] text-foreground-500">{note}</p>}
    </div>
  );
}

function CountStat({ label, value, note, hint }: { label: string; value: string | number; note?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/60 p-3">
      <p
        title={hint}
        className={`text-[10px] font-bold uppercase tracking-wider text-foreground-400 ${hint ? 'cursor-help decoration-dotted underline-offset-4 hover:underline' : ''}`}
      >
        {label}
      </p>
      <p className="mt-1 text-lg font-heading font-bold text-foreground-950">{value}</p>
      {note && <p className="mt-1 text-[11px] text-foreground-500">{note}</p>}
    </div>
  );
}

/**
 * Knowledge, Skills and Behaviours as three tiles: achieved against missing.
 *
 * The standard states a programme's KSBs as three families and a coach reads
 * them that way — "the behaviours are untouched" is a different conversation
 * from "B3 is short". A 70-row table cannot be read for that.
 *
 * Each tile is a filter, because the answer to "why are the behaviours at zero"
 * is the eleven rows behind the tile.
 */
function KsbFamilyStrip({
  families,
  selectedType,
  onSelectType,
}: {
  families: KsbFamily[];
  selectedType: string;
  onSelectType: (letter: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {families.map(family => {
        const selected = family.letter === selectedType;
        const share = family.required ? (family.achieved / family.required) * 100 : 0;
        return (
          <button
            key={family.letter}
            type="button"
            onClick={() => onSelectType(selected ? '' : family.letter)}
            title={`Show only the ${family.label.toLowerCase()} in the table below`}
            className={`rounded-xl border p-3 text-left transition-smooth ${
              selected
                ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-200'
                : 'border-background-200 bg-background-100/60 hover:bg-background-100'
            }`}
          >
            <p className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                {family.label}
              </span>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${KSB_TYPE_META[family.letter].chip}`}>
                {family.letter}
              </span>
            </p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-lg font-heading font-bold text-emerald-700">{family.achieved}</span>
              <span className="text-[12px] text-foreground-400">achieved of {family.required}</span>
            </p>
            {/* One bar, split: achieved fills from the left and the amber
                remainder is the gap. Nothing shaded in between — there are two
                outcomes here, not a gradient. */}
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-amber-200">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(Math.max(share, 0), 100)}%` }} />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-foreground-500">
              <span className={family.missing ? 'font-bold text-amber-700' : ''}>{family.missing} missing</span>
              {' · '}
              {weight(family.earnedWeight)} of {weight(family.expectedWeight)} weight
            </p>
          </button>
        );
      })}
    </div>
  );
}

// The standard's wording for a KSB. Coverage stores the outcome text in either
// field depending on how the source was authored, and both fall back to the code
// — which the row already shows above, so there is nothing to repeat.
function ksbDescription(row: CurriculumScopeKsbAchievementRow) {
  const text = String(row.description || '').trim() || String(row.title || '').trim();
  return normaliseText(text) === normaliseText(row.code) ? '' : text;
}

/**
 * The achievers spelled out one per line, for the cell's tooltip: the cell
 * truncates at whatever the column is wide enough for, and a reader who wants
 * the third name should not have to open the row to learn there is one.
 */
function achieverRoll(achievers: KsbAchiever[]) {
  return achievers
    .map(person => `${person.name} — ${person.expected
      ? `${weight(person.earned)} of ${weight(person.expected)}`
      : `${weight(person.earned)} extra`}`)
    .join('\n');
}

const KSB_GRID = 'grid grid-cols-[minmax(230px,2.6fr)_84px_104px_minmax(150px,1.1fr)_104px]';

const KSB_COLUMNS: Array<{ label: string; hint: string; align?: 'center' }> = [
  { label: 'KSB', hint: 'The outcome as the standard words it, and which of Knowledge / Skills / Behaviours it belongs to.' },
  { label: 'Total weight', hint: 'Every weight placed on this KSB by the components in this scope, added up. The size of the KSB here — not a mark.', align: 'center' },
  { label: 'Times achieved', hint: 'How many completed activities have credited this KSB here. One learner finishing two components that both carry it counts twice. Open the row to see who earned it and where.', align: 'center' },
  { label: 'Achieved by', hint: 'How many of the learners this KSB is authored for here have earned any of it, and which ones. Hover the names for how much each earned, or open the row for the full picture.' },
  { label: 'Status', hint: 'Achieved means at least one learner has evidenced it. Missing means this scope asks for it and nobody has yet.', align: 'center' },
];

/**
 * The KSB register: achieved against missing, who achieved it, and how often.
 *
 * This replaces a KSB × learner matrix. The matrix answered "how far along is
 * every learner on every KSB" with a wall of tinted percentages — a question
 * nobody was asking, in a grid nobody could read past forty columns. The three
 * facts actually wanted are a row each, and the names live one click down rather
 * than in a column that only ever fitted eight of them.
 */
function KsbAchievementTable({
  rows,
  achieversByCode,
  creditsByCode,
  onSelectCode,
  selectedCode,
  onPreviewCredit,
}: {
  rows: CurriculumScopeKsbAchievementRow[];
  achieversByCode: Map<string, KsbAchiever[]>;
  creditsByCode: Map<string, KsbCredit[]>;
  onSelectCode: (code: string) => void;
  selectedCode: string;
  /** Mirrors coverage's "preview this placement": clicking where a KSB was
   *  earned opens the same component, rather than the two lists behaving
   *  differently for what is the same underlying question. Omitted by callers
   *  that have no catalogue to resolve a component against. */
  onPreviewCredit?: (credit: KsbCredit, ksbCode: string) => void;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-background-200">
      <div className="min-w-[760px]">
        <div className={`${KSB_GRID} sticky top-0 z-20 gap-2 border-b border-background-200 bg-background-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
          {KSB_COLUMNS.map(column => (
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
          {rows.map(row => {
            const code = normaliseText(row.code);
            const expanded = code === normaliseText(selectedCode);
            const badge = STANDING_BADGE[ksbStanding(row)];
            const letter = ksbTypeCode(row);
            const achievers = achieversByCode.get(code) || [];
            const credits = creditsByCode.get(code) || [];
            return (
              <div key={`${row.code}-${row.sourceId}`} className={expanded ? 'bg-primary-50/40' : ''}>
                <button
                  type="button"
                  onClick={() => onSelectCode(expanded ? '' : row.code)}
                  className={`${KSB_GRID} w-full gap-2 px-3 py-2 text-left transition-smooth hover:bg-background-100`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[12px] font-bold text-foreground-900">
                      <AppIcon className={`${expanded ? 'ri-subtract-line' : 'ri-add-line'} text-[12px] text-foreground-400`}></AppIcon>
                      {row.code}
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${KSB_TYPE_META[letter].chip}`}>
                        {KSB_TYPE_META[letter].label}
                      </span>
                      {STATUS_MARK[row.status] && (
                        <span title={STATUS_MARK[row.status].title} className={STATUS_MARK[row.status].className}>
                          <AppIcon className={`${STATUS_MARK[row.status].icon} text-[12px]`}></AppIcon>
                        </span>
                      )}
                    </span>
                    {ksbDescription(row) && (
                      <span className="mt-0.5 block pl-4 text-[11px] leading-snug text-foreground-600 line-clamp-2">{ksbDescription(row)}</span>
                    )}
                  </span>
                  <span className="text-center text-[12px] tabular-nums text-foreground-700">{weight(row.plannedWeight)}</span>
                  {/* The count this tab was asked for: how often the KSB has
                      actually been evidenced here, not how far along it is. */}
                  <span className="text-center">
                    <span className={`block text-[13px] font-bold tabular-nums ${credits.length ? 'text-foreground-900' : 'text-foreground-300'}`}>
                      {credits.length ? `${credits.length}×` : '—'}
                    </span>
                    {(credits.length > 0 || achievers.length > 0) && (
                      <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wider text-primary-600">
                        {expanded ? 'Hide who' : 'See who'}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] tabular-nums text-foreground-700">
                      {row.learnersAchievedCount} of {row.learnerCount} learners
                    </span>
                    {/* The names, not only the count. "2 of 14 learners" answers
                        how many and then makes every reader open the row to ask
                        which two — so the two are here, and how much each of
                        them earned stays one click down. */}
                    {achievers.length > 0 && (
                      <span className="block truncate text-[11px] text-foreground-600" title={achieverRoll(achievers)}>
                        {achievers.map(person => person.name).join(' · ')}
                      </span>
                    )}
                    <span className="block truncate text-[10px] text-foreground-400">
                      {weight(row.cappedAchievedWeightTotal)} of {weight(row.expectedWeightTotal)} weight earned
                    </span>
                  </span>
                  <span className={`self-start rounded-md px-1.5 py-1 text-center text-[11px] font-bold ${badge.className}`} title={badge.title}>
                    {badge.label}
                  </span>
                </button>

                {expanded && (
                  <div className="grid gap-3 border-t border-background-200 bg-background-100/50 px-3 py-3 lg:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                        Who achieved it
                      </p>
                      {achievers.length === 0 ? (
                        <p className="mt-1 text-[11px] text-foreground-500">
                          No learner in this scope has earned any of {row.code} yet.
                        </p>
                      ) : (
                        <div className="mt-1.5 space-y-1">
                          {achievers.map(person => (
                            <div
                              key={person.learnerId}
                              className="flex items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-2 py-1.5"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-[11px] font-semibold text-foreground-900">{person.name}</span>
                                <span className="block truncate text-[10px] text-foreground-400">
                                  {[person.group, person.cohort].filter(Boolean).join(' · ') || 'No group'}
                                </span>
                              </span>
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${achievedTone(person.earned, person.expected)}`}>
                                {person.expected
                                  ? `${weight(person.earned)} of ${weight(person.expected)}`
                                  : `${weight(person.earned)} extra`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                        Where it was earned
                      </p>
                      {credits.length === 0 ? (
                        <p className="mt-1 text-[11px] text-foreground-500">
                          No completed activity has credited {row.code} in this scope yet.
                        </p>
                      ) : (
                        <div className="mt-1.5 space-y-1">
                          {credits.map(credit => {
                            const Tag = onPreviewCredit ? 'button' : 'div';
                            return (
                              <Tag
                                key={credit.key}
                                type={onPreviewCredit ? 'button' : undefined}
                                onClick={onPreviewCredit ? () => onPreviewCredit(credit, row.code) : undefined}
                                title={onPreviewCredit ? `Preview ${credit.component} — what it asks of the learner, and every KSB it carries` : undefined}
                                className={`group flex w-full items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-2 py-1.5 text-left transition-smooth ${
                                  onPreviewCredit ? 'hover:border-primary-300 hover:bg-primary-50/50' : ''
                                }`}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-[11px] font-semibold text-foreground-900">{credit.component}</span>
                                  <span className="block truncate text-[10px] text-foreground-400">
                                    {[credit.module, credit.week, credit.learnerName].filter(Boolean).join(' · ')}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5">
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-800">
                                    +{weight(credit.weight)}
                                  </span>
                                  {onPreviewCredit && (
                                    <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-300 transition-smooth group-hover:text-primary-600">
                                      <AppIcon className="ri-eye-line text-[11px]"></AppIcon>
                                      Preview
                                    </span>
                                  )}
                                </span>
                              </Tag>
                            );
                          })}
                        </div>
                      )}
                    </div>
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

/**
 * The KSB x learner grid, restored as a second reading of the same rows.
 *
 * The register above answers "is this KSB evidenced here, and by whom" one row
 * at a time, which is the question that gets asked. This answers the other one:
 * where a whole class stands across every KSB at once - which learner has
 * nothing on B2, which KSB has one achiever out of twelve. Every square is one
 * learner on one KSB and reads from ksbCellState, the same function the learner
 * chips use, so the two views cannot disagree.
 */
const KSB_MATRIX_BANDS: Array<{ label: string; className: string; title: string }> = [
  { label: '\u2014', className: 'bg-background-100 text-foreground-400', title: 'Not expected: this scope does not ask this learner for this KSB.' },
  { label: '0%', className: 'bg-background-200 text-foreground-500', title: 'Not started: expected of this learner, nothing earned yet.' },
  { label: '1\u201399%', className: 'bg-emerald-100 text-emerald-800', title: 'Part earned: some of the expected weight evidenced.' },
  { label: '100%', className: 'bg-emerald-600 text-white', title: 'Achieved: all of the weight expected of this learner earned.' },
  { label: 'Extra', className: 'bg-sky-100 text-sky-800', title: 'Earned somewhere this scope never asked them for it. Reported, not counted here.' },
];

function KsbMatrixLegend({ learnerCount, ksbCount }: { learnerCount: number; ksbCount: number }) {
  return (
    <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-background-200 bg-background-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <p className="max-w-2xl text-[11px] leading-snug text-foreground-600">
        One square is <span className="font-semibold text-foreground-800">one learner on one KSB</span>: the share of
        the weight expected of them that they have earned. Read across a row for how one KSB is going across the class,
        down a column for one learner&apos;s standing. {ksbCount} {ksbCount === 1 ? 'KSB' : 'KSBs'} &times;{' '}
        {learnerCount} {learnerCount === 1 ? 'learner' : 'learners'}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {KSB_MATRIX_BANDS.map(band => (
          <span
            key={band.label}
            title={band.title}
            className={`inline-flex cursor-help items-center rounded-full border border-transparent px-2.5 py-1 text-[10px] font-bold ${band.className}`}
          >
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Pick a learner or two, rather than reading the whole class's columns.
 *
 * Checkbox list rather than a live text filter, same reasoning as coverage's
 * component picker: the reader already knows which one or two learners they
 * want to sit with, side by side — not a box to narrow by typing.
 */
function LearnerPickerPanel({
  learners,
  pickedIds,
  onToggle,
  onClear,
  onClose,
}: {
  learners: CurriculumScopeOtjhLearner[];
  pickedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalisedQuery = normaliseText(query);
    if (!normalisedQuery) return learners;
    return learners.filter(learner => [learner.learnerName, learner.email, learner.group, learner.cohort]
      .some(value => normaliseText(value).includes(normalisedQuery)));
  }, [learners, query]);

  return (
    <div className="mb-3 rounded-xl border border-primary-200 bg-primary-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-foreground-700">
          Tick the learners to show. Leave none ticked to see every learner in the class.
        </p>
        <div className="flex items-center gap-2">
          {pickedIds.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] font-bold text-foreground-500 underline decoration-dotted hover:text-foreground-800"
            >
              Clear {pickedIds.length} picked
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary-600 px-3 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700"
          >
            Done
          </button>
        </div>
      </div>
      <label className="relative mt-2 block">
        <AppIcon className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-foreground-400"></AppIcon>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Find a learner to tick..."
          className="h-8 w-full rounded-lg border border-background-200 bg-background-50 pl-8 pr-2 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-300"
        />
      </label>
      <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-foreground-400">No learner matches this search.</p>
        ) : filtered.map(learner => {
          const id = String(learner.learnerId);
          const checked = pickedIds.includes(id);
          return (
            <label
              key={id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-smooth ${checked ? 'bg-primary-100/70' : 'hover:bg-background-50'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(id)}
                className="h-3.5 w-3.5 shrink-0 rounded border-background-300 text-primary-600 focus:ring-primary-400"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold text-foreground-900">
                  {learner.learnerName || learner.email || `Learner ${id}`}
                </span>
                <span className="block truncate text-[10px] text-foreground-400">
                  {[learner.group, learner.cohort].filter(Boolean).join(' · ')}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function KsbAchievementMatrix({
  rows,
  learners,
  consumptionByLearner,
}: {
  rows: CurriculumScopeKsbAchievementRow[];
  learners: CurriculumScopeOtjhLearner[];
  consumptionByLearner: Map<string, CurriculumLearnerKsbConsumption>;
}) {
  // code -> item, per learner, built once: looking a cell up inside the render
  // would be a scan of every KSB that learner holds, for every square in the
  // grid.
  const itemsByLearner = useMemo(() => {
    const map = new Map<string, Map<string, CurriculumLearnerKsbConsumptionItem>>();
    for (const learner of learners) {
      const key = String(learner.learnerId);
      const byCode = new Map<string, CurriculumLearnerKsbConsumptionItem>();
      for (const item of consumptionByLearner.get(key)?.ksbs || []) {
        const code = normaliseText(item.code);
        if (code) byCode.set(code, item);
      }
      map.set(key, byCode);
    }
    return map;
  }, [consumptionByLearner, learners]);

  const gridTemplateColumns = `minmax(200px, 1.4fr) repeat(${Math.max(learners.length, 1)}, minmax(78px, .4fr))`;

  if (!learners.length) {
    return (
      <EntityEmptyState
        icon="ri-graduation-cap-line"
        title="No learners to plot"
        message="The grid is one column per learner, and enrolment has nobody placed in this scope yet."
      />
    );
  }

  return (
    <>
      <KsbMatrixLegend learnerCount={learners.length} ksbCount={rows.length} />
      {/* Bounded in both directions and scrolling inside its own box: one column
          per learner outgrows the viewport sideways long before the page does,
          and with the page scrolling instead the horizontal bar sits below the
          last KSB - unreachable until you have scrolled past every row. */}
      <div className="max-h-[70vh] overflow-auto rounded-2xl border border-background-200 bg-background-50 shadow-sm">
        <div style={{ minWidth: `${240 + learners.length * 78}px` }}>
          <div
            className="sticky top-0 z-30 grid items-center gap-1 border-b border-background-200 bg-background-100 px-4 py-3"
            style={{ gridTemplateColumns }}
          >
            {/* Frozen both ways: the learner names have to survive scrolling
                down, and "KSB" has to survive scrolling right, or a square
                loses the row it belongs to. */}
            <span className="sticky left-0 z-10 -ml-4 bg-background-100 pl-4 text-[10px] font-bold uppercase tracking-wider text-foreground-400 shadow-[6px_0_8px_-8px_rgba(15,23,42,0.35)]">
              KSB
            </span>
            {learners.map(learner => (
              <span
                key={String(learner.learnerId)}
                title={[learner.learnerName || learner.email, learner.group, learner.cohort].filter(Boolean).join(' \u00b7 ')}
                className="cursor-help truncate text-center text-[9px] font-bold uppercase tracking-wide text-foreground-500"
              >
                {(learner.learnerName || learner.email || `#${learner.learnerId}`).split(' ')[0]}
              </span>
            ))}
          </div>
          <div className="divide-y divide-background-200">
            {rows.map(row => {
              const code = normaliseText(row.code);
              const letter = ksbTypeCode(row);
              return (
                <div
                  key={`${row.code}-${row.sourceId}`}
                  className="grid items-center gap-1 bg-background-50 px-4 py-2 transition-smooth hover:bg-background-100"
                  style={{ gridTemplateColumns }}
                >
                  {/* Opaque, and inheriting the row tint: the frozen column has
                      to hide the squares passing beneath it. */}
                  <span className="sticky left-0 z-10 -ml-4 min-w-0 bg-inherit pl-4 shadow-[6px_0_8px_-8px_rgba(15,23,42,0.35)]">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[12px] font-bold text-foreground-900">{row.code}</span>
                      <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${KSB_TYPE_META[letter].chip}`}>
                        {letter}
                      </span>
                    </span>
                    {ksbDescription(row) && (
                      <span className="block truncate text-[10px] text-foreground-500">{ksbDescription(row)}</span>
                    )}
                  </span>
                  {learners.map(learner => {
                    const learnerKey = String(learner.learnerId);
                    const item = itemsByLearner.get(learnerKey)?.get(code);
                    const state = ksbCellState(item, `${row.code} \u00b7 ${learner.learnerName || learnerKey}`);
                    return (
                      <span
                        key={`${row.code}-${learnerKey}`}
                        title={state.title}
                        className={`flex h-7 cursor-help items-center justify-center rounded text-[10px] font-bold tabular-nums ${state.className}`}
                      >
                        {state.short}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

const LEARNER_GRID = 'grid grid-cols-[minmax(160px,1.6fr)_minmax(110px,.9fr)_minmax(150px,1fr)_minmax(150px,1fr)]';

/**
 * One learner's KSB tiles, and where their credited hours came from.
 *
 * Shared by the Learners tab's expanded row and by the single-learner detail a
 * group's roster opens: the same two facts, computed and worded the same way,
 * because "what has this person earned here" is one question however it is
 * reached.
 *
 * It opens on what the learner has actually earned, and nothing else. A KSB
 * this scope never asks of them is not a milder version of one they have not
 * achieved — there is nothing there to achieve — and a wall of "not expected
 * here" tiles buried the handful that carried a figure. Those are never drawn.
 * The ones this scope does expect and they have not earned yet are one click
 * away, because that gap is the next thing worth seeing and hiding it for good
 * would be its own bug.
 */
function LearnerKsbBreakdown({
  ksbRows,
  learner,
}: {
  ksbRows: CurriculumLearnerKsbConsumptionItem[];
  learner: Pick<CurriculumScopeOtjhLearner, 'achievedOtjh' | 'declaredOtjh'>;
}) {
  const [showOutstanding, setShowOutstanding] = useState(false);
  /** Three piles: earned something, owes something, or was never asked. */
  const { earnedRows, outstandingRows, notAskedCount } = useMemo(() => {
    const earned: CurriculumLearnerKsbConsumptionItem[] = [];
    const outstanding: CurriculumLearnerKsbConsumptionItem[] = [];
    let notAsked = 0;
    for (const row of ksbRows) {
      if (Number(row.cappedConsumedWeight || 0) > 0) earned.push(row);
      else if (Number(row.expectedWeight || 0) > 0) outstanding.push(row);
      else notAsked += 1;
    }
    return { earnedRows: earned, outstandingRows: outstanding, notAskedCount: notAsked };
  }, [ksbRows]);
  const visibleRows = showOutstanding ? [...earnedRows, ...outstandingRows] : earnedRows;
  const outstandingCount = outstandingRows.length;
  /** Why the grid is empty, which is a different sentence in each case. */
  const emptyReason = outstandingCount > 0
    ? `Nothing earned here yet, out of the ${outstandingCount} KSB${outstandingCount === 1 ? '' : 's'} this scope expects of this learner.`
    : notAskedCount > 0
      ? `This scope does not ask this learner for any of its ${notAskedCount} KSBs, so there is nothing here for them to achieve.`
      : 'No KSB weight recorded for this learner in this scope yet.';
  return (
    <>
      {visibleRows.length === 0 ? (
        <p className="text-[11px] text-foreground-500">{emptyReason}</p>
      ) : (
        <>
          {/* A key on the chips, not a tooltip: this grid is the
              first thing a reader meets after expanding a learner,
              and "50/0 — 100%" is where they stopped. */}
          <p className="mb-1.5 text-[10px] leading-snug text-foreground-500">
            Each tile is one KSB this learner has earned weight for here: its code, the{' '}
            <span className="font-semibold text-foreground-700">weight earned of the weight expected</span>{' '}
            of them here, then how complete that is.{' '}
            <span className="font-semibold text-sky-700">Extra</span> means they earned it somewhere this
            scope never asked them for it, so it is not counted as progress here.
            {notAskedCount > 0 && (
              <>
                {' '}The {notAskedCount} KSB{notAskedCount === 1 ? '' : 's'} this scope never asks of them
                {notAskedCount === 1 ? ' is' : ' are'} not shown.
              </>
            )}
          </p>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {visibleRows.map(row => {
              const state = ksbCellState(row, row.code);
              return (
                <div
                  key={row.code}
                  title={state.title}
                  className="flex cursor-help items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-2 py-1.5"
                >
                  <span className="truncate text-[11px] font-bold text-foreground-800">{row.code}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-foreground-500">{state.amount}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${state.className}`}>
                    {state.text}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* The gap, reachable but never in the way: a KSB this scope expects and
          they have not earned yet is the one absence that means something. */}
      {outstandingCount > 0 && (
        <button
          type="button"
          onClick={() => setShowOutstanding(value => !value)}
          className="mt-1.5 text-[10px] font-semibold text-primary decoration-dotted underline-offset-4 hover:underline"
        >
          {showOutstanding
            ? `Hide the ${outstandingCount} expected but not earned yet`
            : `Show the ${outstandingCount} this scope expects but they have not earned yet`}
        </button>
      )}
      {/* The learner's own declared hours, next to the credited
          figure rather than inside it. */}
      <p className="mt-2 text-[11px] leading-relaxed text-foreground-500">
        Where their {hours(learner.achievedOtjh)} of credited hours came from:{' '}
        <span className="font-semibold text-foreground-700">{hours(learner.declaredOtjh)}</span> the learner
        wrote in their own reflections, and{' '}
        <span className="font-semibold text-foreground-700">
          {hours(Number(learner.achievedOtjh || 0) - Number(learner.declaredOtjh || 0))}
        </span>{' '}
        credited at the component’s planned hours, where they finished the work without writing one.
      </p>
    </>
  );
}

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
      <div className="min-w-[620px]">
        <div className={`${LEARNER_GRID} gap-2 border-b border-background-200 px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400`}>
          {/* What each column reports, on the header rather than in prose
              above the table: the question is asked while reading a row. Two
              of these are ratios and the label alone doesn't name the
              denominator. */}
          {([
            { label: 'Learner', hint: 'Who is placed here by enrolment. Curriculum only reads this roster.' },
            { label: 'Cohort / group', hint: 'Where enrolment placed them inside this programme. The group is what matters to the figures: a module belongs to one group, so a learner is measured against their own group’s modules.' },
            { label: 'OTJH achieved', hint: 'Off-the-job hours credited to this learner, out of the hours their own group is assigned in this scope. Reads as "credited of assigned".' },
            { label: 'KSB weight earned', hint: 'KSB weight this learner has earned, out of the weight expected of them in this scope. Reads as "earned of expected"; it is curriculum weight, not a mark or a percentage.' },
          ] as Array<{ label: string; hint: string }>).map(column => (
            <span
              key={column.label}
              title={column.hint}
              className="cursor-help decoration-dotted underline-offset-4 hover:underline"
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
                  {/* Group above cohort: the group is the denominator, the
                      cohort is the context it sits in. */}
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 truncate text-[12px] text-foreground-600">
                      {learner.group || '—'}
                      {learner.plannedBasis === 'none' && (
                        <span
                          className="shrink-0 text-[10px] font-bold uppercase text-amber-600"
                          title="No module in this scope is delivered to this learner's group"
                        >
                          not delivered
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-foreground-400">
                      {learner.cohort || 'No cohort'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background-200">
                      <span className="block h-full rounded-full bg-primary-600" style={{ width: `${Math.min(learner.progressPercentage, 100)}%` }} />
                    </span>
                    {/* "6h/38h" was read as a date, a ratio and a range in
                        turn. The word is three characters and settles it. */}
                    <span
                      className="shrink-0 text-[11px] tabular-nums text-foreground-500"
                      title={`${hours(learner.achievedOtjh)} of the ${hours(learner.plannedOtjh)} off-the-job hours assigned to this learner here have been credited.`}
                    >
                      {hours(learner.achievedOtjh)} of {hours(learner.plannedOtjh)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-background-200">
                      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(ksbPercentage, 100)}%` }} />
                    </span>
                    <span
                      className="shrink-0 text-[11px] tabular-nums text-foreground-500"
                      title={`${weight(consumption?.cappedConsumedWeightTotal)} of the ${weight(consumption?.expectedWeightTotal)} KSB weight expected of this learner here has been earned (${percent(ksbPercentage)}).`}
                    >
                      {weight(consumption?.cappedConsumedWeightTotal)} of {weight(consumption?.expectedWeightTotal)}
                    </span>
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-background-200 bg-background-100/50 px-3 py-2">
                    <LearnerKsbBreakdown ksbRows={ksbRows} learner={learner} />
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

const ACTIVITY_GRID = 'grid grid-cols-[minmax(170px,1.5fr)_minmax(140px,1.1fr)_minmax(110px,.9fr)_92px_92px_92px]';

// What each column of the Activity tab actually reports. On the header rather
// than in prose above the table: the question ("what is Declared?") is asked
// while reading a row, and more than one of these columns answers a different
// question than its one-word label suggests.
const ACTIVITY_COLUMNS: Array<{ label: string; hint: string; align?: 'center' }> = [
  {
    label: 'Component',
    hint: 'The component the learner completed, and its type. Any evidence they uploaded is counted underneath.',
  },
  {
    label: 'Module / week',
    hint: 'Where the component sits in the curriculum: the module that owns it and the week inside that module. Long names are cut to fit — hover the cell for the full module and week. Resolved live against the catalogue, so a module that has since been deleted is marked as such rather than named as though it were still there.',
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
      <div className="min-w-[760px]">
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
            // Neither of these has a column any more, but both are still true
            // of the row: an activity from another part of the programme, or a
            // repeat completion, is listed here and left out of the figures
            // above. Read together on the row's own tooltip so that a row which
            // does not count cannot read as though it does.
            const statusNote = status === 'achieved'
              ? 'The learner completed this activity.'
              : status === 'failed'
                ? 'The learner attempted this activity and did not pass it.'
                : 'Not completed yet.';
            const countedNote = outOfScope
              ? 'Completed in a part of this programme that this learner’s group is not delivered — reported here, excluded from the totals above.'
              : activity.countsTowardAchievement === false
                ? (activity.exclusionReason === 'repeat_completion'
                  ? 'The learner has completed this component before. The hours and KSB weight were earned once, so only the first completion counts — this one is kept as history.'
                  : 'In this scope, but the activity itself does not count toward achievement.')
                // A component that has since been deleted is not in the scope's
                // live content any more, so without saying this the row reads
                // as though it were counted by mistake.
                : activity.scopeBasis === 'lineage'
                  ? 'Counts toward the OTJH and KSB weight reported above. The component is no longer part of this scope’s content, so it was placed here by the programme/cohort/group the learner’s progress row was stamped with when they completed it.'
                  : 'Counts toward the OTJH and KSB weight reported above.';
            const moduleWeek = `${activity.module || '—'}${activity.week ? ` · ${activity.week}` : ''}`;
            return (
              <div
                key={activity.progressId}
                title={`${statusNote} ${countedNote}`}
                className={`${ACTIVITY_GRID} gap-2 px-3 py-2`}
              >
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
                  {/* Truncated to fit the column; the tooltip is the only place
                      the reader can see which module and week this actually is
                      when either name is long. */}
                  <span className="min-w-0 truncate" title={moduleWeek}>
                    {moduleWeek}
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
  onPreviewCredit,
}: {
  scope: CurriculumLearnerScope;
  identifier: string;
  title?: string;
  description?: string;
  /** Passed through to the roster read: 'active', 'all', or omitted. */
  learnerStatus?: string;
  /** False while the panel's tab is closed, so the read is not paid for. */
  active?: boolean;
  /** Lets a caller that holds the module catalogue open the same placement
   *  preview coverage uses, from "Where it was earned" here too. */
  onPreviewCredit?: (credit: KsbCredit, ksbCode: string) => void;
}) {
  const [data, setData] = useState<CurriculumScopeLearnerKsbImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('ksb');
  const [search, setSearch] = useState('');
  /** '' | 'achieved' | 'missing' — the segmented control above the table. */
  const [standing, setStanding] = useState<'' | KsbStanding>('');
  /** 'K' | 'S' | 'B' | '' — the family strip's filter. */
  const [selectedType, setSelectedType] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [expandedLearner, setExpandedLearner] = useState('');
  /** 'list' | 'matrix' — the KSB tab's two readings of the same filtered rows. */
  const [ksbView, setKsbView] = useState<'list' | 'matrix'>('list');
  /** Empty means "every learner in the class" — picking narrows the matrix to
   *  a learner or two, the same way coverage's "By component" picker narrows
   *  to a component or two rather than showing everyone at once. */
  const [pickedLearnerIds, setPickedLearnerIds] = useState<string[]>([]);
  const [learnerPickerOpen, setLearnerPickerOpen] = useState(false);
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

  /**
   * Who has earned each KSB, and how much. The per-KSB rows carry a count of
   * learners; the names behind that count only exist per learner, so the join
   * is made once here rather than inside a row that re-runs on every render.
   */
  const achieversByCode = useMemo(() => {
    const map = new Map<string, KsbAchiever[]>();
    for (const learner of data?.learnerKsbConsumption || []) {
      for (const item of learner.ksbs || []) {
        const earned = Number(item.cappedConsumedWeight || item.consumedWeight || 0);
        if (earned <= 0) continue;
        const key = normaliseText(item.code);
        if (!key) continue;
        const list = map.get(key) || [];
        list.push({
          learnerId: String(learner.learnerId),
          name: learner.learnerName || learner.email || `Learner ${learner.learnerId}`,
          cohort: learner.cohort || '',
          group: learner.group || '',
          earned,
          expected: Number(item.expectedWeight || 0),
        });
        map.set(key, list);
      }
    }
    for (const list of map.values()) list.sort((left, right) => right.earned - left.earned);
    return map;
  }, [data]);

  /**
   * Every completed activity that credited each KSB — the "how many times" the
   * table reports. One learner finishing two components that both carry K1
   * counts twice, because K1 was evidenced twice; a repeat completion of the
   * same component does not, because the backend already marked it as earned
   * once (`exclusionReason: 'repeat_completion'`).
   */
  const creditsByCode = useMemo(() => {
    const map = new Map<string, KsbCredit[]>();
    for (const row of data?.learnerActivities || []) {
      if (row.countsTowardAchievement === false) continue;
      if (row.scopeStatus && row.scopeStatus === 'out_of_scope') continue;
      const learnerName = learnerNames.get(String(row.learnerId))?.name
        || (row.learnerId == null ? '' : `Learner ${row.learnerId}`);
      for (const item of row.ksbSnapshot || []) {
        if (item.countsTowardAchievement === false) continue;
        const key = normaliseText(item.code);
        if (!key) continue;
        const list = map.get(key) || [];
        list.push({
          key: `${row.progressId}-${item.code}-${list.length}`,
          learnerName,
          component: row.componentTitle || row.componentType || 'Activity',
          module: row.module || '',
          week: row.week || '',
          weight: Number(item.weight || 0),
          moduleStatus: row.moduleStatus,
        });
        map.set(key, list);
      }
    }
    return map;
  }, [data, learnerNames]);

  const families = useMemo(() => ksbFamilies(ksb?.rows || []), [ksb]);

  // Achieved and missing counted here rather than read off the summary, so the
  // headline and the table can never disagree about what "missing" means.
  const achievedCount = useMemo(
    () => (ksb?.rows || []).filter(row => ksbStanding(row) === 'achieved').length,
    [ksb],
  );
  const missingCount = useMemo(
    () => (ksb?.rows || []).filter(row => ksbStanding(row) === 'missing').length,
    [ksb],
  );
  const ownKsbCount = achievedCount + missingCount;

  const ksbRows = useMemo(() => {
    const query = normaliseText(search);
    return (ksb?.rows || []).filter(row => {
      if (selectedType && ksbTypeCode(row) !== selectedType) return false;
      if (standing && ksbStanding(row) !== standing) return false;
      if (!query) return true;
      return [row.code, row.title, row.description, row.sourceLabel].some(value => normaliseText(value).includes(query));
    });
  }, [ksb, search, selectedType, standing]);

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

  /** The matrix's own learner columns — picked ids narrow it independently of
   *  the search box, which stays about finding a KSB in that view. */
  const matrixLearners = useMemo(() => {
    const all = otjh?.learners || [];
    if (!pickedLearnerIds.length) return all;
    return all.filter(learner => pickedLearnerIds.includes(String(learner.learnerId)));
  }, [otjh, pickedLearnerIds]);

  // A pick surviving a cohort/group change that dropped that learner would sit
  // invisibly in the count while the matrix shows nothing — dropped instead,
  // the moment they leave the roster.
  useEffect(() => {
    if (!pickedLearnerIds.length) return;
    const roster = otjh?.learners || [];
    const stillThere = pickedLearnerIds.filter(id => roster.some(learner => String(learner.learnerId) === id));
    if (stillThere.length !== pickedLearnerIds.length) setPickedLearnerIds(stillThere);
  }, [otjh, pickedLearnerIds]);

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

  const standingFilters: Array<{ key: '' | KsbStanding; label: string; count: number }> = [
    { key: '', label: 'All KSBs', count: ksb?.rows?.length || 0 },
    { key: 'achieved', label: 'Achieved', count: achievedCount },
    { key: 'missing', label: 'Missing', count: missingCount },
  ];

  return (
    <section className="rounded-2xl border border-foreground-200/60 bg-background-50">
      <div className="flex flex-col gap-2 border-b border-background-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-[13px] font-heading font-bold text-foreground-950">
            {title || 'Learner achievement'}
          </h3>
          <p className="mt-0.5 text-[12px] text-foreground-500">
            {description || `Which KSBs the learners in this ${noun} have actually achieved, who achieved them, and which are still missing.`}
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
            {/* Achieved against missing first, because that is the question.
                Hours and weight are the two supporting figures, each naming its
                own denominator. */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AchievementMeter
                label="KSBs achieved"
                achievedLabel={String(achievedCount)}
                plannedLabel={`${ownKsbCount} KSBs`}
                percentage={ownKsbCount ? (achievedCount / ownKsbCount) * 100 : 0}
                tone="emerald"
                hint={`How many of this ${noun}'s KSBs at least one learner has evidenced. The rest are missing until somebody earns weight for them.`}
                note={missingCount
                  ? `${missingCount} still missing`
                  : ownKsbCount ? 'Every KSB here has been evidenced' : 'No KSBs mapped here yet'}
              />
              <AchievementMeter
                label="KSB weight earned"
                achievedLabel={weight(ksb?.cappedAchievedWeightTotal)}
                plannedLabel={weight(ksb?.expectedWeightTotal)}
                percentage={ksb?.progressPercentage || 0}
                tone="emerald"
                hint={`KSB weight earned across every learner here, out of the weight expected of them. Weight is how much of a KSB this ${noun}'s components carry — not a mark.`}
                note={`${weight(ksb?.plannedWeightTotal)} authored across this ${noun}`}
              />
              <AchievementMeter
                label="OTJH achieved"
                achievedLabel={hours(otjh?.achievedTotal)}
                plannedLabel={hours(otjh?.plannedTotal)}
                percentage={otjh?.progressPercentage || 0}
                hint={`Off-the-job hours credited across every learner here, out of the hours assigned to them. Not the hours authored in the ${noun} — that figure is on the second line.`}
                note={`${hours(otjh?.plannedPerLearner)} per learner · ${hours(otjh?.authoredTotal)} authored here`}
              />
              <CountStat
                label="Learners assigned"
                hint="Everyone the enrolment team has placed here. Curriculum reads this roster and never edits it."
                value={data.assignedLearnerCount}
                note={`${otjh?.completedActivityCount || 0} completed activities`}
              />
            </div>

            {/* Knowledge / Skills / Behaviours, before the long table that
                cannot be read for them. */}
            {!!families.length && (
              <KsbFamilyStrip
                families={families}
                selectedType={selectedType}
                onSelectType={setSelectedType}
              />
            )}

            {/* One line of method, and only the caveats that apply to the scope
                being read. The five-paragraph explainer that used to sit here
                was read as decoration and skipped. */}
            {(outOfScopeCount > 0 || (data.structure?.groupCount || 0) > 1) && (
              <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                {(data.structure?.groupCount || 0) > 1 && (
                  <p>
                    This {noun} is delivered by {data.structure.groupCount} groups, and a module belongs to one group —
                    each learner is measured against their own group&apos;s modules. Pick a group above to read one
                    class on its own.
                  </p>
                )}
                {outOfScopeCount > 0 && (
                  <p>
                    {outOfScopeCount} completed {outOfScopeCount === 1 ? 'activity belongs' : 'activities belong'} to
                    another part of this programme, so {outOfScopeCount === 1 ? 'it is' : 'they are'} left out of these
                    figures. {outOfScopeCount === 1 ? 'It is' : 'They are'} still listed under Activity — hover a row
                    there to see whether it counts here.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-xl border border-background-200 bg-background-100/60 p-1">
                {TABS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    aria-pressed={tab === item.key}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition-smooth ${
                      tab === item.key ? 'bg-primary-600 text-white' : 'text-foreground-600 hover:bg-background-50'
                    }`}
                  >
                    <AppIcon className={item.icon}></AppIcon>
                    {item.label}
                  </button>
                ))}
              </div>
              {tab === 'ksb' && (
                <div className="flex items-center gap-1 rounded-xl border border-background-200 bg-background-100/60 p-1">
                  {standingFilters.map(item => (
                    <button
                      key={item.key || 'all'}
                      type="button"
                      onClick={() => setStanding(item.key)}
                      aria-pressed={standing === item.key}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition-smooth ${
                        standing === item.key
                          ? item.key === 'missing'
                            ? 'bg-amber-500 text-white'
                            : item.key === 'achieved'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-foreground-800 text-white'
                          : 'text-foreground-600 hover:bg-background-50'
                      }`}
                    >
                      {item.label}
                      <span className="rounded bg-black/10 px-1 text-[10px] tabular-nums">{item.count}</span>
                    </button>
                  ))}
                </div>
              )}
              <label className="relative min-w-[180px] flex-1">
                <AppIcon className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-foreground-400"></AppIcon>
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder={tab === 'ksb' ? 'Search KSB code or outcome' : tab === 'learners' ? 'Search learner' : 'Search component, module or week'}
                  className="h-8 w-full rounded-lg border border-background-200 bg-background-50 pl-8 pr-2 text-[12px] text-foreground-900 outline-none transition-smooth focus:border-primary-400"
                />
              </label>
              {tab === 'ksb' && (
                // Named for the view it switches to, the same toggle the KSB
                // coverage tab carries.
                <button
                  type="button"
                  onClick={() => setKsbView(value => (value === 'matrix' ? 'list' : 'matrix'))}
                  aria-pressed={ksbView === 'matrix'}
                  title={ksbView === 'matrix'
                    ? 'Back to the KSB register, where opening a row lists who earned it and where.'
                    : 'The KSB by learner grid: one column per learner, for a read across the whole class at once.'}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-smooth ${
                    ksbView === 'matrix'
                      ? 'border-primary-300 bg-primary-600 text-white hover:bg-primary-700'
                      : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
                  }`}
                >
                  <AppIcon className={ksbView === 'matrix' ? 'ri-list-check-3' : 'ri-grid-line'}></AppIcon>
                  {ksbView === 'matrix' ? 'List view' : 'Matrix view'}
                </button>
              )}
              {tab === 'ksb' && ksbView === 'matrix' && (
                <button
                  type="button"
                  onClick={() => setLearnerPickerOpen(value => !value)}
                  aria-pressed={learnerPickerOpen}
                  title="Show only a learner or two you pick, instead of every one in the class."
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-smooth ${
                    pickedLearnerIds.length || learnerPickerOpen
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-background-200 bg-background-50 text-foreground-600 hover:bg-background-100'
                  }`}
                >
                  <AppIcon className="ri-checkbox-multiple-line"></AppIcon>
                  Pick learners
                  {pickedLearnerIds.length > 0 && (
                    <span className="rounded-full bg-primary-600 px-1.5 text-[10px] font-bold text-white">{pickedLearnerIds.length}</span>
                  )}
                </button>
              )}
              {selectedType && tab === 'ksb' && (
                <button
                  type="button"
                  onClick={() => setSelectedType('')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-300 bg-primary-50 px-2.5 text-[11px] font-bold text-primary-700"
                >
                  {KSB_TYPE_META[selectedType]?.plural || selectedType}
                  <AppIcon className="ri-close-line"></AppIcon>
                </button>
              )}
              {selectedCode && tab !== 'ksb' && (
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

            {tab === 'ksb' && ksbView === 'matrix' && learnerPickerOpen && (
              <LearnerPickerPanel
                learners={otjh?.learners || []}
                pickedIds={pickedLearnerIds}
                onToggle={id => setPickedLearnerIds(ids => (
                  ids.includes(id) ? ids.filter(existing => existing !== id) : [...ids, id]
                ))}
                onClear={() => setPickedLearnerIds([])}
                onClose={() => setLearnerPickerOpen(false)}
              />
            )}

            {tab === 'ksb' && ksbView === 'matrix' && !learnerPickerOpen && pickedLearnerIds.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Showing only:</span>
                {pickedLearnerIds.map(id => {
                  const learner = (otjh?.learners || []).find(item => String(item.learnerId) === id);
                  if (!learner) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 py-0.5 pl-2.5 pr-1.5 text-[10px] font-bold text-primary-700"
                    >
                      {learner.learnerName || learner.email || `Learner ${id}`}
                      <button
                        type="button"
                        onClick={() => setPickedLearnerIds(ids => ids.filter(existing => existing !== id))}
                        title={`Stop showing ${learner.learnerName || 'this learner'} on their own`}
                        className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary-200"
                      >
                        <AppIcon className="ri-close-line text-[11px]"></AppIcon>
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setPickedLearnerIds([])}
                  className="text-[10px] font-bold text-foreground-400 underline decoration-dotted hover:text-foreground-700"
                >
                  Show all {(otjh?.learners || []).length}
                </button>
              </div>
            )}

            {tab === 'ksb' && (
              ksbRows.length ? (
                ksbView === 'matrix' ? (
                  <KsbAchievementMatrix
                    rows={ksbRows}
                    learners={matrixLearners}
                    consumptionByLearner={consumptionByLearner}
                  />
                ) : (
                  <KsbAchievementTable
                    rows={ksbRows}
                    achieversByCode={achieversByCode}
                    creditsByCode={creditsByCode}
                    selectedCode={selectedCode}
                    onSelectCode={setSelectedCode}
                    onPreviewCredit={onPreviewCredit}
                  />
                )
              ) : (
                <EntityEmptyState
                  icon="ri-list-check-3"
                  title={ksb?.ksbCount ? 'No KSB matches this filter' : 'No KSBs mapped in this scope yet'}
                  message={ksb?.ksbCount
                    ? 'Clear the search, the KSB family, or switch back to All KSBs.'
                    : 'Map KSBs to this scope’s components in the Module Builder and learner achievement will roll up here.'}
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

// --------------------------------------------------- one learner, one scope

/**
 * What a single learner has achieved inside one curriculum scope.
 *
 * The scope panel above answers "how is this class doing"; this answers "how is
 * this person doing here", which is the question a roster row asks when it is
 * clicked. It is the same read (`learner-ksb-impact` for the scope) narrowed to
 * one learner rather than a second endpoint, so the hours and KSB weight shown
 * here are the same figures the class table sums — a learner's row on the
 * Learners tab and this view can never disagree.
 *
 * Everything here is scope-local on purpose: a group shows what was earned in
 * that group, not the learner's whole programme. Work they did elsewhere on the
 * programme is still listed, and each row's tooltip says whether it counts here,
 * rather than being silently dropped.
 */
export function ScopeLearnerAchievementDetail({
  scope,
  identifier,
  learnerId,
  learnerName,
  learnerEmail,
  scopeLabel,
  onClose,
}: {
  scope: CurriculumLearnerScope;
  identifier: string;
  /** The enrolment learner id — what Learner, Coach and Curriculum match on. */
  learnerId: string;
  learnerName?: string;
  learnerEmail?: string;
  /** What to call this scope in prose, e.g. the group's name. */
  scopeLabel?: string;
  onClose?: () => void;
}) {
  const [data, setData] = useState<CurriculumScopeLearnerKsbImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same guard as the panel: an aborted read must not clear a newer read's
  // spinner or report its own abort as a failure.
  const generationRef = useRef(0);

  const load = useCallback((signal?: AbortSignal) => {
    if (!identifier) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    setError(null);
    // 'all' rather than the default: a learner whose placement has since been
    // paused or completed still earned what they earned here, and a roster row
    // the reader can see must not open onto "learner not found".
    fetchCurriculumScopeLearnerKsbImpact(scope, identifier, { learnerStatus: 'all' }, signal)
      .then(result => {
        if (signal?.aborted || generationRef.current !== generation) return;
        setData(result);
        setError(null);
      })
      .catch(fetchError => {
        if (signal?.aborted || generationRef.current !== generation) return;
        setData(null);
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load this learner’s achievement.');
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false);
      });
  }, [identifier, scope]);

  useEffect(() => {
    if (!identifier || !learnerId) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [identifier, learnerId, load]);

  const key = String(learnerId);
  const noun = SCOPE_NOUN[data?.scope || scope] || 'scope';
  const where = scopeLabel || `this ${noun}`;

  const otjhRow = useMemo(
    () => (data?.otjhAchievement?.learners || []).find(row => String(row.learnerId) === key) || null,
    [data, key],
  );
  const consumption = useMemo(
    () => (data?.learnerKsbConsumption || []).find(row => String(row.learnerId) === key) || null,
    [data, key],
  );
  const rosterRow = useMemo(
    () => (data?.assignedLearners || []).find(row => String(row.id) === key) || null,
    [data, key],
  );

  const displayName = learnerName
    || otjhRow?.learnerName || consumption?.learnerName || rosterRow?.name
    || learnerEmail || rosterRow?.email || `Learner ${key}`;
  const displayEmail = learnerEmail || otjhRow?.email || consumption?.email || rosterRow?.email || '';

  /** Only this learner's activity, newest first — the "how" behind the figures. */
  const activities = useMemo(() => {
    const rows = (data?.learnerActivities || []).filter(row => String(row.learnerId ?? '') === key);
    return [...rows].sort((left, right) => String(right.submittedAt || '').localeCompare(String(left.submittedAt || '')));
  }, [data, key]);

  // The activity table names people by id unless it is handed the roster's
  // names; one learner still needs the map, because that is its contract.
  const learnerNames = useMemo(
    () => new Map([[key, { name: displayName, email: displayEmail }]]),
    [displayEmail, displayName, key],
  );

  const ksbRows = useMemo(() => {
    const rows = [...(consumption?.ksbs || [])];
    // Earned first, then the rest: the reader is here to see what was achieved,
    // and a KSB with weight against it is the answer to that.
    rows.sort((left, right) => {
      const earned = Number(right.cappedConsumedWeight || 0) - Number(left.cappedConsumedWeight || 0);
      if (earned) return earned;
      return String(left.code).localeCompare(String(right.code), undefined, { numeric: true });
    });
    return rows;
  }, [consumption]);

  const otjhPercentage = otjhRow?.progressPercentage || 0;
  const ksbPercentage = consumption?.progressPercentage || 0;
  const earnedKsbCount = ksbRows.filter(row => Number(row.cappedConsumedWeight || 0) > 0).length;
  const found = Boolean(otjhRow || consumption || rosterRow);

  return (
    <section className="rounded-2xl border border-background-200 bg-background-50">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-background-200 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-heading font-bold text-foreground-950">{displayName}</h3>
          <p className="mt-0.5 text-[11px] text-foreground-500">
            {displayEmail ? `${displayEmail} · ` : ''}
            What this learner has achieved in {where} — off-the-job hours and KSB weight earned here, not across
            the whole programme.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
          >
            <AppIcon className="ri-refresh-line text-sm"></AppIcon>
            Refresh
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-3 text-[12px] font-bold text-foreground-600 transition-smooth hover:bg-background-100"
            >
              <AppIcon className="ri-close-line text-sm"></AppIcon>
              Close
            </button>
          )}
        </div>
      </header>

      <div className="space-y-4 p-4">
        {loading && !data && <p className="text-[12px] text-foreground-500">Loading this learner’s achievement…</p>}

        {error && <InlineError message={error} onRetry={() => load()} />}

        {!loading && !error && data && !found && (
          <EntityEmptyState
            icon="ri-user-search-line"
            title="This learner is not in this scope"
            message={`Enrolment does not place ${displayName} in ${where}, so nothing is credited to them here.`}
          />
        )}

        {data && found && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <AchievementMeter
                label="OTJH achieved here"
                achievedLabel={hours(otjhRow?.achievedOtjh)}
                plannedLabel={hours(otjhRow?.plannedOtjh)}
                percentage={otjhPercentage}
                note={percent(otjhPercentage)}
                hint={`Off-the-job hours credited to this learner in ${where}, out of the hours the modules of their own group assign them here.`}
              />
              <AchievementMeter
                label="KSB weight earned here"
                achievedLabel={weight(consumption?.cappedConsumedWeightTotal)}
                plannedLabel={weight(consumption?.expectedWeightTotal)}
                percentage={ksbPercentage}
                tone="emerald"
                note={percent(ksbPercentage)}
                hint="Curriculum weight this learner has earned, out of the weight expected of them here. Weight, not a mark."
              />
              <CountStat
                label="Components done"
                value={otjhRow?.completedActivityCount ?? 0}
                note={`${otjhRow?.reflectionCount ?? 0} reflection${(otjhRow?.reflectionCount ?? 0) === 1 ? '' : 's'} logged`}
                hint="How many components this learner has completed here, and how many of them they wrote a reflection for."
              />
              <CountStat
                label="KSBs with weight"
                value={`${earnedKsbCount} of ${ksbRows.length}`}
                note={consumption?.declaredReflectionWeightTotal
                  ? `${weight(consumption.declaredReflectionWeightTotal)} declared in reflections`
                  : undefined}
                hint="KSBs this learner has earned any weight against, out of the KSBs in play for them here. Reflection-declared weight is evidence about the same work and is never added on top."
              />
            </div>

            {otjhRow?.plannedBasis === 'none' && (
              <p className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                No module in {where} is delivered to this learner’s group, so there are no assigned hours to measure
                them against here.
              </p>
            )}

            <div className="rounded-xl border border-background-200 bg-background-100/50 p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                KSBs achieved in {where}
              </p>
              <LearnerKsbBreakdown
                ksbRows={ksbRows}
                learner={{
                  achievedOtjh: otjhRow?.achievedOtjh || 0,
                  declaredOtjh: otjhRow?.declaredOtjh || 0,
                }}
              />
            </div>

            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400">
                The work behind those figures
              </p>
              {activities.length ? (
                <ActivityTable activities={activities} learnerNames={learnerNames} />
              ) : (
                <EntityEmptyState
                  icon="ri-history-line"
                  title="No activity recorded here yet"
                  message={`Activity appears once ${displayName} completes a component in ${where}.`}
                />
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
