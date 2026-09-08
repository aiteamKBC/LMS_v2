// ============================================================================
// Coach caseload — quick view.
//
// Inspection without navigation. Deliberately makes no request of its own: the
// caseload and attendance payloads the page already holds contain the hour
// totals, the component and KSB breakdowns and the attendance counts, so opening
// this is free and the caseload behind it keeps its scroll position and filters.
//
// Anything needing more than these two payloads — evidence files, the audit
// trail, review notes — belongs to the full profile, which is one click away at
// the bottom, and per-tab so a coach arrives on the tab they were looking at.
// ============================================================================
import { memo, useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { CoachRagSelector } from './CoachRagSelector';
import {
  AttentionReasonLine,
  LearnerAvatar,
  ProgressBar,
  RiskBadge,
  SectionLabel,
  StatusPill,
} from './primitives';
import {
  EMPTY_VALUE,
  displayValue,
  formatDayOffset,
  formatHours,
  formatHoursRatio,
  formatPercent,
  formatRatio,
  hasValue,
  learnerProgramme,
} from '../lib/format';
import type { LearnerInsight } from '../lib/attention';
import type { Learner, QuickViewTab } from '../types';

const TABS: { id: QuickViewTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'otjh', label: 'OTJH' },
  { id: 'ksbs', label: 'KSBs' },
];

/** Which full-profile tab a quick-view tab continues into. */
const PROFILE_TAB: Record<QuickViewTab, string> = {
  overview: 'overview',
  attendance: 'attendance',
  otjh: 'progress',
  ksbs: 'progress',
};

function DataRow({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' | 'critical' | 'positive' }) {
  const valueClass = {
    default: 'text-foreground-900',
    warning: 'text-amber-700',
    critical: 'text-red-700',
    positive: 'text-emerald-700',
  }[tone];

  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-foreground-100 py-2 last:border-b-0">
      <span className="text-[12px] text-foreground-500">{label}</span>
      <span className={`text-[12px] font-semibold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

function MetricBar({ label, value, percent }: { label: string; value: string; percent: number | null }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-foreground-600">{label}</span>
        <span className="text-[12px] font-semibold tabular-nums text-foreground-900">{value}</span>
      </div>
      <ProgressBar percent={percent} height="h-1.5" />
    </div>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="rounded-md bg-background-100 px-3 py-2.5 text-[12px] leading-snug text-foreground-500">{children}</p>;
}

function OverviewTab({ learner, insight }: { learner: Learner; insight: LearnerInsight }) {
  const componentPercent = learner.attendanceRateAvailable ? learner.attendanceRate : null;

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Current status</SectionLabel>
        <div className="mt-1.5">
          <RiskBadge tier={insight.tier} label={insight.riskLabel} size="md" />
        </div>
      </div>

      <div>
        <SectionLabel>Why</SectionLabel>
        <div className="mt-1.5 space-y-2">
          {insight.reasons.length > 0
            ? insight.reasons.map((reason) => <AttentionReasonLine key={reason.id} reason={reason} />)
            : (
              <EmptyNote>
                {insight.tier === 'inactive'
                  ? 'Risk checks are paused while this learner is not active on programme.'
                  : 'Nothing is flagged against hours, attendance, components, KSBs or the gateway review date.'}
              </EmptyNote>
            )}
        </div>
      </div>

      <div className="space-y-3">
        <SectionLabel>Progress</SectionLabel>
        <MetricBar
          label="OTJH against expected hours"
          value={learner.overallProgressAvailable ? `${learner.overallProgress}%` : EMPTY_VALUE}
          percent={learner.overallProgressAvailable ? learner.overallProgress : null}
        />
        <MetricBar
          label="Components complete"
          value={componentPercent === null ? EMPTY_VALUE : `${componentPercent}%`}
          percent={componentPercent}
        />
        <MetricBar
          label="KSBs evidenced"
          value={learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE}
          percent={learner.ksbProgressAvailable ? learner.ksbProgress : null}
        />
      </div>

      <div>
        <SectionLabel>Key metrics</SectionLabel>
        <div className="mt-1">
          <DataRow
            label="Attendance"
            value={formatPercent(learner.liveAttendanceRate)}
            tone={learner.attendanceRisk === 'red' ? 'critical' : learner.attendanceRisk === 'amber' ? 'warning' : 'default'}
          />
          <DataRow
            label="Off-the-job hours"
            value={learner.overallProgressAvailable ? formatHoursRatio(learner.otjhCompleted, learner.otjhTarget) : EMPTY_VALUE}
          />
          <DataRow label="Components" value={formatRatio(learner.componentsCompleted, learner.componentsPlanned)} />
          <DataRow label="KSBs" value={formatRatio(learner.ksbCompleted, learner.ksbTarget)} />
          {learner.evidenceCountAvailable ? (
            <DataRow label="Evidence items" value={String(learner.evidenceCount)} />
          ) : null}
        </div>
      </div>

      <div>
        <SectionLabel>Dates</SectionLabel>
        <div className="mt-1">
          {hasValue(learner.startDate) ? <DataRow label="Start date" value={displayValue(learner.startDate)} /> : null}
          <DataRow
            label="Gateway review"
            value={
              insight.gatewayDaysAway === null
                ? displayValue(learner.gatewayReviewDate)
                : `${displayValue(learner.gatewayReviewDate)} · ${formatDayOffset(insight.gatewayDaysAway)}`
            }
            tone={
              insight.gatewayDaysAway === null
                ? 'default'
                : insight.gatewayDaysAway < 0
                  ? 'critical'
                  : insight.gatewayDaysAway <= 30
                    ? 'warning'
                    : 'default'
            }
          />
          {hasValue(learner.plannedEndDate) ? <DataRow label="Planned end" value={displayValue(learner.plannedEndDate)} /> : null}
        </div>
      </div>

      <div>
        <SectionLabel>Programme</SectionLabel>
        <div className="mt-1">
          <DataRow label="Cohort" value={displayValue(learner.cohortName)} />
          <DataRow label="Group" value={displayValue(learner.group)} />
          {hasValue(learner.employer) ? <DataRow label="Employer" value={displayValue(learner.employer)} /> : null}
          {hasValue(learner.coachName) ? <DataRow label="Coach" value={displayValue(learner.coachName)} /> : null}
        </div>
      </div>
    </div>
  );
}

function AttendanceTab({ learner, insight }: { learner: Learner; insight: LearnerInsight }) {
  if (!learner.liveAttendanceRateAvailable) {
    return (
      <EmptyNote>
        No attendance sessions have been recorded for this learner yet, so there is no rate to report.
      </EmptyNote>
    );
  }

  const missed = learner.attendanceConsecutiveMissed ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Attendance rate</SectionLabel>
        <div className="mt-1.5 flex items-end gap-3">
          <span
            className={`text-2xl font-bold tabular-nums ${
              learner.attendanceRisk === 'red'
                ? 'text-red-700'
                : learner.attendanceRisk === 'amber'
                  ? 'text-amber-700'
                  : 'text-emerald-700'
            }`}
          >
            {formatPercent(learner.liveAttendanceRate)}
          </span>
          <span className="pb-1 text-[12px] text-foreground-500">
            {learner.attendanceRisk === 'red'
              ? 'Below the 80% minimum threshold'
              : learner.attendanceRisk === 'amber'
                ? 'Below the 90% expected level'
                : 'At or above the 90% expected level'}
          </span>
        </div>
        <div className="mt-2">
          <ProgressBar percent={learner.liveAttendanceRate ?? null} />
        </div>
      </div>

      <div>
        <SectionLabel>Sessions</SectionLabel>
        <div className="mt-1">
          <DataRow label="Recorded sessions" value={String(learner.attendanceSessions ?? 0)} />
          <DataRow label="Present" value={String(learner.attendancePresent ?? 0)} tone="positive" />
          <DataRow label="Absent" value={String(learner.attendanceAbsent ?? 0)} tone={(learner.attendanceAbsent ?? 0) > 0 ? 'warning' : 'default'} />
          {learner.attendanceAuthorisedAbsent !== null && learner.attendanceAuthorisedAbsent !== undefined ? (
            <DataRow label="Authorised absence" value={String(learner.attendanceAuthorisedAbsent)} />
          ) : null}
          {learner.attendanceUnauthorisedAbsent !== null && learner.attendanceUnauthorisedAbsent !== undefined ? (
            <DataRow
              label="Unauthorised absence"
              value={String(learner.attendanceUnauthorisedAbsent)}
              tone={learner.attendanceUnauthorisedAbsent > 0 ? 'critical' : 'default'}
            />
          ) : null}
          {learner.attendanceLate !== null && learner.attendanceLate !== undefined ? (
            <DataRow label="Late" value={String(learner.attendanceLate)} />
          ) : null}
          {learner.attendanceCatchup ? <DataRow label="Catch-ups logged" value={String(learner.attendanceCatchup)} /> : null}
          {missed > 0 ? (
            <DataRow label="Consecutive missed" value={String(missed)} tone={missed >= 3 ? 'critical' : 'warning'} />
          ) : null}
        </div>
      </div>

      {insight.lastActivityDaysAgo !== null ? (
        <div>
          <SectionLabel>Last recorded session</SectionLabel>
          <div className="mt-1">
            <DataRow
              label={hasValue(learner.attendanceLastSession) ? displayValue(learner.attendanceLastSession) : 'Most recent session'}
              value={formatDayOffset(-insight.lastActivityDaysAgo)}
              tone={insight.lastActivityDaysAgo >= 28 ? 'warning' : 'default'}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OtjhTab({ learner, insight }: { learner: Learner; insight: LearnerInsight }) {
  if (!learner.overallProgressAvailable) {
    return <EmptyNote>No off-the-job hours target has been set for this learner yet.</EmptyNote>;
  }

  const delta = insight.otjhDeltaHours;

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Hours against the current-week target</SectionLabel>
        <div className="mt-1.5 flex items-end gap-3">
          <span className="text-2xl font-bold tabular-nums text-foreground-900">
            {formatHoursRatio(learner.otjhCompleted, learner.otjhTarget)}
          </span>
          {delta !== null ? (
            <span className={`pb-1 text-[12px] font-semibold ${delta < -0.5 ? 'text-red-700' : delta > 0.5 ? 'text-emerald-700' : 'text-foreground-500'}`}>
              {delta < -0.5
                ? `${formatHours(Math.abs(delta))} behind`
                : delta > 0.5
                  ? `${formatHours(delta)} ahead`
                  : 'On target'}
            </span>
          ) : null}
        </div>
        <div className="mt-2">
          <ProgressBar percent={learner.overallProgress} />
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-foreground-400">
          The target is the hours planned up to and including the current week, not the whole programme.
        </p>
      </div>

      <div>
        <SectionLabel>Breakdown</SectionLabel>
        <div className="mt-1">
          <DataRow label="Hours recorded" value={formatHours(learner.otjhCompleted)} />
          <DataRow label="Expected by now" value={formatHours(learner.otjhTarget)} />
          {learner.otjhPlanned ? <DataRow label="Planned for programme" value={formatHours(learner.otjhPlanned)} /> : null}
          {learner.otjhMinimum ? <DataRow label="Minimum required" value={formatHours(learner.otjhMinimum)} /> : null}
          {delta !== null ? (
            <DataRow
              label="Ahead / behind"
              value={`${delta > 0 ? '+' : ''}${formatHours(delta)}`}
              tone={delta < -0.5 ? 'critical' : delta > 0.5 ? 'positive' : 'default'}
            />
          ) : null}
          <DataRow label="Status" value={displayValue(learner.otjhStatus)} />
        </div>
      </div>
    </div>
  );
}

function KsbsTab({ learner }: { learner: Learner }) {
  if (!learner.ksbProgressAvailable || !learner.ksbTarget) {
    return <EmptyNote>No KSBs have been mapped to this learner's programme yet.</EmptyNote>;
  }

  const bands: { label: string; completed?: number; target?: number; progress?: number }[] = [
    { label: 'Knowledge', completed: learner.knowledgeCompleted, target: learner.knowledgeTarget, progress: learner.knowledgeProgress },
    { label: 'Skills', completed: learner.skillsCompleted, target: learner.skillsTarget, progress: learner.skillsProgress },
    { label: 'Behaviours', completed: learner.behavioursCompleted, target: learner.behavioursTarget, progress: learner.behavioursProgress },
  ];
  const hasBands = bands.some((band) => (band.target ?? 0) > 0);

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>KSBs evidenced</SectionLabel>
        <div className="mt-1.5 flex items-end gap-3">
          <span className="text-2xl font-bold tabular-nums text-foreground-900">
            {formatRatio(learner.ksbCompleted, learner.ksbTarget)}
          </span>
          <span className="pb-1 text-[12px] font-semibold text-foreground-500">{displayValue(learner.ksbStatus)}</span>
        </div>
        <div className="mt-2">
          <ProgressBar percent={learner.ksbProgress} />
        </div>
      </div>

      {hasBands ? (
        <div className="space-y-3">
          <SectionLabel>By type</SectionLabel>
          {bands
            .filter((band) => (band.target ?? 0) > 0)
            .map((band) => (
              <MetricBar
                key={band.label}
                label={band.label}
                value={formatRatio(band.completed, band.target)}
                percent={typeof band.progress === 'number' ? band.progress : null}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}

export const LearnerQuickViewDrawer = memo(function LearnerQuickViewDrawer({
  learner,
  insight,
  initialTab,
  savingCoachRag,
  onClose,
  onCoachRagChange,
  onOpenProfile,
}: {
  learner: Learner | null;
  insight: LearnerInsight | null;
  initialTab: QuickViewTab;
  savingCoachRag: boolean;
  onClose: () => void;
  onCoachRagChange: (learnerId: string, value: string) => void;
  onOpenProfile: (learner: Learner, tab: string) => void;
}) {
  const [tab, setTab] = useState<QuickViewTab>(initialTab);

  // Follow the caller: clicking an OTJH reason should land on the OTJH tab, and
  // re-opening on a different learner should not inherit the last tab silently.
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, learner?.id]);

  const isOpen = Boolean(learner && insight);

  return (
    <RightSlidePanel isOpen={isOpen} onClose={onClose} width="w-[460px]">
      {learner && insight ? (
        <div className="-m-5 flex h-full flex-col">
          <header className="shrink-0 border-b border-foreground-200 px-5 pb-3 pt-4">
            <div className="flex items-start gap-3">
              <LearnerAvatar initials={learner.initials} tier={insight.tier} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-heading text-[15px] font-bold text-foreground-950">{learner.name}</h2>
                <p className="mt-0.5 truncate text-[12px] text-foreground-500">{learnerProgramme(learner)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusPill value={learner.rawProgramStatus} />
                  <RiskBadge tier={insight.tier} label={insight.riskLabel} size="xs" />
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close quick view"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-400 transition hover:bg-background-100 hover:text-foreground-700"
              >
                <AppIcon className="ri-close-line text-[16px]"></AppIcon>
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground-400">Coach RAG</span>
                <CoachRagSelector
                  value={learner.coachRag}
                  learnerName={learner.name}
                  saving={savingCoachRag}
                  onChange={(value) => onCoachRagChange(learner.id, value)}
                />
              </div>
              {learner.email ? (
                <a
                  href={`mailto:${learner.email}`}
                  className="inline-flex items-center gap-1 truncate text-[12px] font-medium text-primary-600 transition hover:text-primary-800"
                >
                  <AppIcon className="ri-mail-line text-[12px]"></AppIcon>
                  Email
                </a>
              ) : null}
            </div>

            <nav aria-label="Quick view sections" className="-mb-3 mt-3 flex gap-1">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={tab === item.id}
                  className={`relative px-2 pb-2.5 pt-1 text-[12px] font-semibold transition ${
                    tab === item.id ? 'text-primary-700' : 'text-foreground-400 hover:text-foreground-700'
                  }`}
                >
                  {item.label}
                  {tab === item.id ? (
                    <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary-600"></span>
                  ) : null}
                </button>
              ))}
            </nav>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === 'overview' ? <OverviewTab learner={learner} insight={insight} /> : null}
            {tab === 'attendance' ? <AttendanceTab learner={learner} insight={insight} /> : null}
            {tab === 'otjh' ? <OtjhTab learner={learner} insight={insight} /> : null}
            {tab === 'ksbs' ? <KsbsTab learner={learner} /> : null}
          </div>

          <footer className="shrink-0 border-t border-foreground-200 px-5 py-3">
            <button
              type="button"
              onClick={() => onOpenProfile(learner, PROFILE_TAB[tab])}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 text-[12.5px] font-semibold text-white transition hover:bg-primary-700"
            >
              Open full learner profile
              <AppIcon className="ri-arrow-right-line text-[14px]"></AppIcon>
            </button>
          </footer>
        </div>
      ) : null}
    </RightSlidePanel>
  );
});
