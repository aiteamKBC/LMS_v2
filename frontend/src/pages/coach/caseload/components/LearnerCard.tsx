// ============================================================================
// Coach caseload — learner card.
//
// Reading order is the point: who, what state, how far along, the four numbers,
// then why they need attention, then the way in. Hierarchy comes from type size
// and one hairline rule per band rather than from a box around every group.
//
// Every value is conditional. A learner with no attendance history shows a dash,
// not a zero, because 0% attendance and "no sessions recorded yet" are different
// facts and only one of them is a problem.
// ============================================================================
import { memo } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  EMPTY_VALUE,
  displayValue,
  formatHours,
  formatHoursRatio,
  formatPercent,
  formatRatio,
  hasValue,
  learnerProgramme,
} from '../lib/format';
import { REASON_TAB, type LearnerInsight } from '../lib/attention';
import {
  AttentionReasonLine,
  DateStatus,
  LearnerAvatar,
  Metric,
  ProgressBar,
  RiskBadge,
  SectionLabel,
  StatusPill,
} from './primitives';
import type { Learner, QuickViewTab } from '../types';

const MAX_REASONS_SHOWN = 2;

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
      note: `${formatHours(Math.abs(delta))} behind target`,
      tone: insight.tier === 'critical' ? 'critical' : 'warning',
    };
  }
  if (delta > 0.5) return { note: `${formatHours(delta)} ahead`, tone: 'positive' };
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
  const progress = learner.overallProgressAvailable ? learner.overallProgress : null;
  const visibleReasons = insight.reasons.slice(0, MAX_REASONS_SHOWN);
  const hiddenReasonCount = insight.reasons.length - visibleReasons.length;

  return (
    <article
      className={`group flex h-full flex-col rounded-lg border bg-white transition hover:border-primary-200 ${
        selected ? 'border-primary-400 ring-1 ring-primary-200' : 'border-foreground-200/70'
      }`}
    >
      {/* Identity */}
      <div className="flex items-start gap-2.5 p-3.5 pb-3">
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

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => onQuickView(learner)}
              className="min-w-0 truncate text-left text-[13.5px] font-bold leading-tight text-foreground-950 transition hover:text-primary-700"
            >
              {learner.name}
            </button>
            <RiskBadge tier={insight.tier} label={insight.riskLabel} size="xs" />
          </div>

          <p className="mt-1 truncate text-[12px] font-medium text-foreground-700" title={programme}>
            {programme}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-foreground-400">
            <StatusPill value={learner.rawProgramStatus} />
            {hasValue(learner.group) ? <span className="ml-1.5">{displayValue(learner.group)}</span> : null}
          </p>
          {hasValue(learner.employer) ? (
            <p className="mt-1 truncate text-[12px] text-foreground-500">
              <AppIcon className="ri-building-4-line mr-1 text-foreground-300"></AppIcon>
              {displayValue(learner.employer)}
            </p>
          ) : null}
        </div>
      </div>

      {/* Progress */}
      <div className="px-3.5 pb-3">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <SectionLabel>OTJH progress</SectionLabel>
          <span className="text-[12px] font-bold tabular-nums text-foreground-900">
            {progress === null ? EMPTY_VALUE : `${progress}%`}
          </span>
        </div>
        <ProgressBar percent={progress} />
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-foreground-100 px-3.5 py-3 sm:grid-cols-4">
        <Metric
          label="OTJH"
          value={learner.overallProgressAvailable ? formatHoursRatio(learner.otjhCompleted, learner.otjhTarget) : EMPTY_VALUE}
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
          note={learner.attendanceRateAvailable ? `${learner.attendanceRate}% complete` : null}
        />
        <Metric
          label="KSB"
          value={formatRatio(learner.ksbCompleted, learner.ksbTarget)}
          note={learner.ksbProgressAvailable ? displayValue(learner.ksbStatus) : null}
        />
      </div>

      {/* Why */}
      {visibleReasons.length > 0 ? (
        <div
          className={`space-y-1.5 border-t px-3.5 py-3 ${
            insight.tier === 'critical'
              ? 'border-red-100 bg-red-50/40'
              : insight.tier === 'attention'
                ? 'border-amber-100 bg-amber-50/40'
                : 'border-accent-100 bg-accent-50/30'
          }`}
        >
          <SectionLabel>
            {insight.reasons.length === 1 ? '1 action required' : `${insight.reasons.length} actions required`}
          </SectionLabel>
          {visibleReasons.map((reason) => (
            <AttentionReasonLine
              key={reason.id}
              reason={reason}
              onClick={() => onQuickView(learner, REASON_TAB[reason.metric])}
            />
          ))}
          {hiddenReasonCount > 0 ? (
            <button
              type="button"
              onClick={() => onQuickView(learner)}
              className="text-[12px] font-semibold text-primary-600 transition hover:text-primary-800"
            >
              +{hiddenReasonCount} more reason{hiddenReasonCount === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 border-t border-foreground-100 px-3.5 py-3 text-[12px] text-foreground-400">
          <AppIcon className="ri-check-line text-[12px] text-emerald-500"></AppIcon>
          {insight.tier === 'inactive'
            ? `Not currently active — ${displayValue(learner.rawProgramStatus)}`
            : 'No flags against hours, attendance, KSBs or gateway'}
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto flex items-end justify-between gap-3 border-t border-foreground-100 bg-background-50/60 px-3.5 py-2.5">
        <div className="flex min-w-0 items-end gap-4">
          {insight.gatewayDate ? (
            <DateStatus label="Gateway" date={learner.gatewayReviewDate} daysAway={insight.gatewayDaysAway} />
          ) : null}
          {insight.lastActivityDaysAgo !== null ? (
            <span className="min-w-0">
              <span className="block text-[12px] font-medium uppercase tracking-[0.06em] text-foreground-400">
                Last session
              </span>
              <span className="block text-[12px] font-semibold text-foreground-700">
                {insight.lastActivityDaysAgo === 0 ? 'Today' : `${insight.lastActivityDaysAgo}d ago`}
              </span>
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onQuickView(learner)}
            className="inline-flex h-7 items-center gap-1 rounded border border-foreground-200 bg-white px-2 text-[12px] font-semibold text-foreground-600 transition hover:border-primary-300 hover:text-primary-700"
          >
            <AppIcon className="ri-eye-line text-[12px]"></AppIcon>
            Quick view
          </button>
          <button
            type="button"
            onClick={() => onOpenProfile(learner)}
            className="inline-flex h-7 items-center gap-1 rounded bg-primary-600 px-2 text-[12px] font-semibold text-white transition hover:bg-primary-700"
          >
            Open
            <AppIcon className="ri-arrow-right-line text-[12px]"></AppIcon>
          </button>
        </div>
      </footer>
    </article>
  );
});
