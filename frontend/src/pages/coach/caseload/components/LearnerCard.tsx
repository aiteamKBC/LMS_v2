// ============================================================================
// Coach caseload — learner card.
//
// Reading order is the point: who, what state, how far along, the four numbers,
// then the key dates and the way in. Hierarchy comes from type size and one
// hairline rule per band rather than from a box around every group.
//
// Every value is conditional. A learner with no attendance history shows a dash,
// not a zero, because 0% attendance and "no sessions recorded yet" are different
// facts and only one of them is a problem.
// ============================================================================
import { memo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  EMPTY_VALUE,
  clampPercent,
  displayValue,
  formatHours,
  formatHoursRatio,
  formatPercent,
  formatRatio,
  hasValue,
  learnerProgramme,
} from '../lib/format';
import type { LearnerInsight } from '../lib/attention';
import {
  DateStatus,
  LearnerAvatar,
  Metric,
  ProgressBar,
  RiskBadge,
  SectionLabel,
  StatusPill,
} from './primitives';
import type { Learner, QuickViewTab } from '../types';

function attendanceNote(learner: Learner): { note: string | null; tone: 'muted' | 'warning' | 'critical' | 'positive' } {
  if (!learner.liveAttendanceRateAvailable) return { note: 'No sessions recorded', tone: 'muted' };
  if (learner.attendanceRisk === 'red') return { note: 'Below threshold', tone: 'critical' };
  if (learner.attendanceRisk === 'amber') return { note: 'Below expected', tone: 'warning' };
  const sessions = learner.attendanceSessions;
  return { note: sessions ? `${sessions} session${sessions === 1 ? '' : 's'}` : null, tone: 'muted' };
}

function otjhNote(insight: LearnerInsight): { note: string | null; tone: 'muted' | 'warning' | 'critical' | 'positive' } {
  const delta = insight.otjhDeltaHours;
  if (delta === null) return { note: null, tone: 'muted' };
  if (delta < -0.5) {
    return {
      note: `${formatHours(Math.abs(delta))} hrs behind target`,
      tone: insight.tier === 'critical' ? 'critical' : 'warning',
    };
  }
  if (delta > 0.5) return { note: `${formatHours(delta)} hrs ahead`, tone: 'positive' };
  return { note: 'On target', tone: 'positive' };
}

export const LearnerCard = memo(function LearnerCard({
  learner,
  insight,
  selected,
  selectionMode,
  onToggleSelect,
  onQuickView,
  onOpenProfile,
}: {
  learner: Learner;
  insight: LearnerInsight;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (learnerId: string) => void;
  onQuickView: (learner: Learner, tab?: QuickViewTab) => void;
  onOpenProfile: (learner: Learner) => void;
}) {
  const programme = learnerProgramme(learner);
  const attendance = attendanceNote(learner);
  const otjh = otjhNote(insight);
  const otjhProgress = learner.overallProgressAvailable ? learner.overallProgress : null;
  const otjhProgrammeTarget = learner.otjhPlanned || learner.otjhMinimum || learner.otjhTarget;
  const componentProgrammeProgress = learner.attendanceRateAvailable ? learner.attendanceRate : null;
  // Against components expected by now (same pacing as otjhTarget), not
  // componentsPlanned's whole-plan total -- see OTJH's own to-date tile above.
  const componentsProgress = learner.componentsTargetToDate && learner.componentsTargetToDate > 0
    ? clampPercent(((learner.componentsCompleted ?? 0) / learner.componentsTargetToDate) * 100)
    : null;

  return (
    <article
      className={`group flex h-full flex-col rounded-lg border bg-white transition hover:border-primary-200 ${
        selected ? 'border-primary-400 ring-1 ring-primary-200' : 'border-foreground-200/70'
      }`}
    >
      {/* Identity */}
      <div className="flex items-start gap-3 p-3.5 pb-3">
        {selectionMode ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(learner.id)}
            aria-label={`Select ${learner.name}`}
            className="mt-2.5 h-3.5 w-3.5 shrink-0 rounded border-foreground-300 accent-primary-600"
          />
        ) : null}

        <LearnerAvatar
          initials={learner.initials}
          tier={insight.tier}
          onClick={() => onQuickView(learner)}
          title={`Quick view: ${learner.name}`}
        />

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => onQuickView(learner)}
              className="min-w-0 truncate text-left text-[14px] font-bold leading-5 text-foreground-950 transition hover:text-primary-700"
            >
              {learner.name}
            </button>
            <span className="shrink-0 pt-0.5">
              <RiskBadge tier={insight.tier} label={insight.riskLabel} size="xs" />
            </span>
          </div>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            <StatusPill value={learner.rawProgramStatus} />
            <span className="min-w-0 truncate font-medium text-foreground-700" title={programme}>{programme}</span>
            {hasValue(learner.group) ? (
              <span className="min-w-0 truncate text-foreground-400" title={displayValue(learner.group)}>
                {displayValue(learner.group)}
              </span>
            ) : null}
          </div>
          {hasValue(learner.employer) ? (
            <p className="mt-1.5 truncate text-[12px] text-foreground-500">
              <AppIcon className="ri-building-4-line mr-1 text-foreground-300"></AppIcon>
              {displayValue(learner.employer)}
            </p>
          ) : null}
        </div>
      </div>

      {/* Progress to current target */}
      <div className="space-y-3 px-3.5 pb-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <SectionLabel>OTJH target progress</SectionLabel>
            <span className="text-[12px] font-bold tabular-nums text-foreground-900">
              {otjhProgress === null ? EMPTY_VALUE : `${otjhProgress}% - ${formatHoursRatio(learner.otjhCompleted, learner.otjhTarget)}`}
            </span>
          </div>
          <ProgressBar percent={otjhProgress} />
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <SectionLabel>Components target progress</SectionLabel>
            <span className="text-[12px] font-bold tabular-nums text-foreground-900">
              {componentsProgress === null ? EMPTY_VALUE : `${componentsProgress}% - ${formatRatio(learner.componentsCompleted, learner.componentsTargetToDate)}`}
            </span>
          </div>
          <ProgressBar percent={componentsProgress} />
        </div>
      </div>

      {/* Whole programme metrics */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-foreground-100 px-3.5 py-3 sm:grid-cols-4">
        <Metric
          label="OTJH"
          value={learner.overallProgressAvailable ? formatHoursRatio(learner.otjhCompleted, otjhProgrammeTarget) : EMPTY_VALUE}
          note={otjh.note}
          noteTone={otjh.tone}
        />
        <Metric
          label="Attendance"
          value={formatPercent(learner.liveAttendanceRate)}
          note={attendance.note}
          noteTone={attendance.tone}
        />
        <Metric
          label="Components"
          value={formatRatio(learner.componentsCompleted, learner.componentsPlanned)}
          note={componentProgrammeProgress === null ? null : `${componentProgrammeProgress}% complete`}
        />
        <Metric
          label="KSB"
          value={formatRatio(learner.ksbCompleted, learner.ksbTarget)}
          note={learner.ksbProgressAvailable ? displayValue(learner.ksbStatus) : null}
        />
      </div>

      {/* Footer */}
      <footer className="mt-auto flex items-end justify-between gap-3 border-t border-foreground-100 bg-background-50/60 px-3.5 py-2.5">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
          {hasValue(learner.startDate) ? (
            <DateStatus label="Start date" date={learner.startDate} daysAway={null} />
          ) : null}
          {insight.gatewayDate ? (
            <DateStatus label="Gateway" date={learner.gatewayReviewDate} daysAway={insight.gatewayDaysAway} />
          ) : null}
          {hasValue(learner.plannedEndDate) ? (
            <DateStatus label="End date" date={learner.plannedEndDate} daysAway={null} />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenProfile(learner)}
            className="inline-flex h-7 items-center gap-1 rounded bg-primary-600 px-2 text-[12px] font-semibold text-white transition hover:bg-primary-700"
          >
            Open profile
            <AppIcon className="ri-arrow-right-line text-[12px]"></AppIcon>
          </button>
        </div>
      </footer>
    </article>
  );
});
