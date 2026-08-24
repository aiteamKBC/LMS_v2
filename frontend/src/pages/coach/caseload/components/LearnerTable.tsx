// ============================================================================
// Coach caseload — dense table.
//
// The view that has to survive a caseload of 100+. Design rules it follows:
//
//  - The learner column is sticky, so a coach scrolling right never loses track
//    of whose row they are reading.
//  - Numbers are tabular and right-aligned within their cell, so a column can be
//    scanned vertically for outliers without reading any of it.
//  - The Risk column carries the verdict and the top reason, because "At Risk"
//    with no reason just moves the question somewhere else.
//  - Columns Django cannot fill (Next Review, Employer) are absent rather than a
//    field of dashes.
//
// Each row is its own memoised component: with a hundred rows on screen, editing
// one learner's RAG should not re-render the other ninety-nine.
// ============================================================================
import { memo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { CoachRagSelector } from './CoachRagSelector';
import { ProgressBar, RiskBadge } from './primitives';
import { riskTierStyle } from '../lib/tone';
import {
  EMPTY_VALUE,
  displayValue,
  formatDayOffset,
  formatHours,
  formatPercent,
  formatRatio,
  learnerProgramme,
} from '../lib/format';
import { REASON_ICON, type InsightMap, type LearnerInsight } from '../lib/attention';
import type { Learner, QuickViewTab, SortDirection, SortKey } from '../types';

interface ColumnDefinition {
  key: string;
  label: string;
  sortKey?: SortKey;
  align?: 'left' | 'right' | 'center';
  widthClass: string;
}

const COLUMNS: ColumnDefinition[] = [
  { key: 'learner', label: 'Learner', sortKey: 'name', widthClass: 'w-[230px] min-w-[230px]' },
  { key: 'programme', label: 'Programme', widthClass: 'w-[190px] min-w-[160px]' },
  { key: 'progress', label: 'Progress', sortKey: 'progress', align: 'left', widthClass: 'w-[120px] min-w-[120px]' },
  { key: 'otjh', label: 'OTJH', sortKey: 'otjh', align: 'right', widthClass: 'w-[120px] min-w-[120px]' },
  { key: 'attendance', label: 'Attendance', sortKey: 'attendance', align: 'right', widthClass: 'w-[100px] min-w-[100px]' },
  { key: 'components', label: 'Components', sortKey: 'components', align: 'right', widthClass: 'w-[96px] min-w-[96px]' },
  { key: 'ksb', label: 'KSB', sortKey: 'ksb', align: 'right', widthClass: 'w-[88px] min-w-[88px]' },
  { key: 'gateway', label: 'Gateway', sortKey: 'gateway', widthClass: 'w-[118px] min-w-[118px]' },
  { key: 'rag', label: 'Coach RAG', align: 'center', widthClass: 'w-[96px] min-w-[96px]' },
  { key: 'risk', label: 'Risk', sortKey: 'risk', widthClass: 'w-[230px] min-w-[200px]' },
  { key: 'action', label: '', align: 'right', widthClass: 'w-[64px] min-w-[64px]' },
];

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function HeaderCell({
  column,
  sortKey,
  sortDir,
  onSort,
  sticky,
}: {
  column: ColumnDefinition;
  sortKey: SortKey;
  sortDir: SortDirection;
  onSort: (key: SortKey) => void;
  sticky?: boolean;
}) {
  const align = ALIGN_CLASS[column.align || 'left'];
  const isSorted = column.sortKey === sortKey;
  const base = `${column.widthClass} ${align} px-2.5 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground-400 whitespace-nowrap ${
    sticky ? 'sticky left-0 z-20 bg-background-100/80 pl-3.5' : ''
  }`;

  if (!column.sortKey) {
    return <th scope="col" className={base}>{column.label}</th>;
  }

  const sortableKey = column.sortKey;
  return (
    <th scope="col" className={base} aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortableKey)}
        className={`inline-flex items-center gap-1 transition hover:text-foreground-700 ${
          column.align === 'right' ? 'flex-row-reverse' : ''
        } ${isSorted ? 'text-primary-700' : ''}`}
      >
        {column.label}
        <AppIcon
          className={`text-[12px] ${
            isSorted
              ? sortDir === 'asc' ? 'ri-arrow-up-line text-primary-600' : 'ri-arrow-down-line text-primary-600'
              : 'ri-arrow-up-down-line text-foreground-300'
          }`}
        ></AppIcon>
      </button>
    </th>
  );
}

const LearnerRow = memo(function LearnerRow({
  learner,
  insight,
  selected,
  selectionMode,
  savingRag,
  onToggleSelect,
  onQuickView,
  onOpenProfile,
  onCoachRagChange,
}: {
  learner: Learner;
  insight: LearnerInsight;
  selected: boolean;
  selectionMode: boolean;
  savingRag: boolean;
  onToggleSelect: (learnerId: string) => void;
  onQuickView: (learner: Learner, tab?: QuickViewTab) => void;
  onOpenProfile: (learner: Learner) => void;
  onCoachRagChange: (learnerId: string, value: string) => void;
}) {
  const progress = learner.overallProgressAvailable ? learner.overallProgress : null;
  const delta = insight.otjhDeltaHours;
  const topReason = insight.reasons[0];
  const tierStyle = riskTierStyle(insight.tier);
  const stickyBg = selected ? 'bg-primary-50' : 'bg-white group-hover:bg-primary-50/40';

  return (
    <tr
      className={`group cursor-pointer border-b border-foreground-100 transition ${
        selected ? 'bg-primary-50/60' : 'hover:bg-primary-50/40'
      }`}
      onClick={() => onQuickView(learner)}
    >
      <td className={`sticky left-0 z-10 px-2.5 py-2 pl-3.5 ${stickyBg}`}>
        <div className="flex items-center gap-2">
          {selectionMode ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(learner.id)}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Select ${learner.name}`}
              className="h-3.5 w-3.5 shrink-0 rounded border-foreground-300 accent-primary-600"
            />
          ) : (
            <span className={`h-6 w-0.5 shrink-0 rounded-full ${tierStyle.dot}`} aria-hidden="true"></span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-foreground-900" title={learner.name}>
              {learner.name}
            </p>
            <p className="truncate text-[12px] text-foreground-400" title={learner.email || displayValue(learner.group)}>
              {learner.email || displayValue(learner.group)}
            </p>
          </div>
        </div>
      </td>

      <td className="px-2.5 py-2">
        <p className="truncate text-[12px] text-foreground-700" title={learnerProgramme(learner)}>
          {learnerProgramme(learner)}
        </p>
        <p className="truncate text-[12px] text-foreground-400">{displayValue(learner.rawProgramStatus)}</p>
      </td>

      <td className="px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="w-8 shrink-0 text-right text-[12px] font-semibold tabular-nums text-foreground-800">
            {progress === null ? EMPTY_VALUE : `${progress}%`}
          </span>
          <ProgressBar percent={progress} height="h-1" />
        </div>
      </td>

      <td className="px-2.5 py-2 text-right">
        <p className="text-[12px] font-semibold tabular-nums text-foreground-800">
          {learner.overallProgressAvailable
            ? `${formatHours(learner.otjhCompleted)}/${formatHours(learner.otjhTarget)}`
            : EMPTY_VALUE}
        </p>
        {delta !== null ? (
          <p className={`text-[12px] tabular-nums ${delta < -0.5 ? 'text-red-600' : delta > 0.5 ? 'text-emerald-600' : 'text-foreground-400'}`}>
            {delta < -0.5 ? `-${formatHours(Math.abs(delta))} hrs` : delta > 0.5 ? `+${formatHours(delta)} hrs` : 'On target'}
          </p>
        ) : null}
      </td>

      <td className="px-2.5 py-2 text-right">
        <p
          className={`text-[12px] font-semibold tabular-nums ${
            learner.attendanceRisk === 'red'
              ? 'text-red-700'
              : learner.attendanceRisk === 'amber'
                ? 'text-amber-700'
                : 'text-foreground-800'
          }`}
        >
          {formatPercent(learner.liveAttendanceRate)}
        </p>
        {learner.attendanceSessions ? (
          <p className="text-[12px] text-foreground-400 tabular-nums">{learner.attendanceSessions} ses.</p>
        ) : null}
      </td>

      <td className="px-2.5 py-2 text-right text-[12px] font-semibold tabular-nums text-foreground-800">
        {formatRatio(learner.componentsCompleted, learner.componentsPlanned)}
      </td>

      <td className="px-2.5 py-2 text-right text-[12px] font-semibold tabular-nums text-foreground-800">
        {formatRatio(learner.ksbCompleted, learner.ksbTarget)}
      </td>

      <td className="px-2.5 py-2">
        <p className="whitespace-nowrap text-[12px] font-medium tabular-nums text-foreground-800">
          {displayValue(learner.gatewayReviewDate)}
        </p>
        {insight.gatewayDaysAway !== null ? (
          <p
            className={`text-[12px] ${
              insight.gatewayDaysAway < 0
                ? 'text-red-600'
                : insight.gatewayDaysAway <= 30
                  ? 'text-amber-600'
                  : 'text-foreground-400'
            }`}
          >
            {formatDayOffset(insight.gatewayDaysAway)}
          </p>
        ) : null}
      </td>

      <td className="px-2.5 py-2 text-center">
        <CoachRagSelector
          value={learner.coachRag}
          learnerName={learner.name}
          saving={savingRag}
          onChange={(value) => onCoachRagChange(learner.id, value)}
        />
      </td>

      <td className="px-2.5 py-2">
        <RiskBadge tier={insight.tier} label={insight.riskLabel} size="xs" />
        {topReason ? (
          <p className="mt-1 flex items-start gap-1 text-[12px] leading-tight text-foreground-500">
            <AppIcon className={`${REASON_ICON[topReason.metric]} mt-[2px] shrink-0 text-[12px]`}></AppIcon>
            <span className="truncate" title={topReason.label}>{topReason.label}</span>
            {insight.reasons.length > 1 ? (
              <span className="shrink-0 font-semibold text-primary-600">+{insight.reasons.length - 1}</span>
            ) : null}
          </p>
        ) : null}
      </td>

      <td className="px-2.5 py-2 text-right">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProfile(learner);
          }}
          aria-label={`Open full profile for ${learner.name}`}
          title="Open full learner profile"
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-foreground-400 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
        >
          <AppIcon className="ri-arrow-right-line text-[14px]"></AppIcon>
        </button>
      </td>
    </tr>
  );
});

export const LearnerTable = memo(function LearnerTable({
  learners,
  insights,
  selectedLearnerIds,
  selectionMode,
  sortKey,
  sortDir,
  savingCoachRagId,
  onSort,
  onToggleSelect,
  onQuickView,
  onOpenProfile,
  onCoachRagChange,
}: {
  learners: Learner[];
  insights: InsightMap;
  selectedLearnerIds: Set<string>;
  selectionMode: boolean;
  sortKey: SortKey;
  sortDir: SortDirection;
  savingCoachRagId: string | null;
  onSort: (key: SortKey) => void;
  onToggleSelect: (learnerId: string) => void;
  onQuickView: (learner: Learner, tab?: QuickViewTab) => void;
  onOpenProfile: (learner: Learner) => void;
  onCoachRagChange: (learnerId: string, value: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1240px] border-collapse text-left">
        <thead className="bg-background-100/80">
          <tr className="border-b border-foreground-200">
            {COLUMNS.map((column, index) => (
              <HeaderCell
                key={column.key}
                column={column}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                sticky={index === 0}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {learners.map((learner) => {
            const insight = insights.get(learner.id);
            if (!insight) return null;
            return (
              <LearnerRow
                key={learner.id}
                learner={learner}
                insight={insight}
                selected={selectedLearnerIds.has(learner.id)}
                selectionMode={selectionMode}
                savingRag={savingCoachRagId === learner.id}
                onToggleSelect={onToggleSelect}
                onQuickView={onQuickView}
                onOpenProfile={onOpenProfile}
                onCoachRagChange={onCoachRagChange}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
