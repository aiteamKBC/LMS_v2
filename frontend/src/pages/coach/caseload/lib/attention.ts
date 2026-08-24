// ============================================================================
// Coach caseload — the single risk model.
//
// Everything on the page that says "at risk", "needs attention" or "on track"
// reads from here: the status pills, the attention queue, the card badges, the
// table's Risk column and the quick-view drawer. One derivation means the tile
// that says "4 critical" and the pill that says "At Risk 4" can never disagree,
// and it means the answer to "why?" travels with the verdict instead of being
// re-guessed per component.
//
// Every reason is built from a field the API genuinely returns. Where a field is
// blank — employer, next review date, which Django currently hard-codes to "--"
// — no reason is produced, rather than a placeholder one.
// ============================================================================
import {
  ATTENDANCE_EXPECTED_RATE,
  ATTENDANCE_MINIMUM_RATE,
  daysBetween,
  displayValue,
  formatCount,
  formatDayOffset,
  formatHours,
  getOtjhStatusKey,
  getProgramStatusKey,
  hasValue,
  parseDisplayDate,
  parseNumeric,
} from './format';
import type { Learner } from '../types';

export type ReasonSeverity = 'critical' | 'warning' | 'info';

export type ReasonMetric = 'otjh' | 'attendance' | 'components' | 'ksb' | 'gateway' | 'rag' | 'engagement';

export interface AttentionReason {
  id: string;
  /** The headline a coach scans: "OTJH 12.8 hrs behind target". */
  label: string;
  /** The supporting number, shown when there is room for it. */
  detail?: string;
  severity: ReasonSeverity;
  metric: ReasonMetric;
}

/**
 * `critical` and `attention` are work to do now; `upcoming` is work to plan for.
 * `inactive` covers learners whose programme status means the risk questions do
 * not apply (on a break, withdrawn, not yet enrolled) — they stay visible and
 * filterable but never appear in the queue.
 */
export type AttentionTier = 'critical' | 'attention' | 'upcoming' | 'on-track' | 'inactive';

export interface LearnerInsight {
  tier: AttentionTier;
  /** Short verdict for a badge: "At Risk", "Needs Attention", … */
  riskLabel: string;
  reasons: AttentionReason[];
  criticalReasonCount: number;
  /** completed - current-week target. Negative means behind. */
  otjhDeltaHours: number | null;
  gatewayDate: Date | null;
  gatewayDaysAway: number | null;
  lastActivityDaysAgo: number | null;
  /** Sort weight, highest = deal with first. */
  urgency: number;
}

const TIER_LABEL: Record<AttentionTier, string> = {
  critical: 'At Risk',
  attention: 'Needs Attention',
  upcoming: 'Upcoming',
  'on-track': 'On Track',
  inactive: 'Inactive',
};

const SEVERITY_RANK: Record<ReasonSeverity, number> = { critical: 3, warning: 2, info: 1 };

/** Days out at which a gateway review starts appearing in the queue. */
const GATEWAY_SOON_DAYS = 30;
const GATEWAY_HORIZON_DAYS = 90;
/** No recorded session for this long is a coaching signal in its own right. */
const STALE_ACTIVITY_DAYS = 28;

function otjhReason(learner: Learner, delta: number | null): AttentionReason | null {
  const statusKey = getOtjhStatusKey(learner.otjhStatus);
  if (statusKey !== 'at-risk' && statusKey !== 'need-attention') return null;

  const behind = delta !== null && delta < 0 ? Math.abs(delta) : null;
  return {
    id: 'otjh',
    label: behind !== null
      ? `OTJH ${formatHours(behind)} hrs behind target`
      : 'Off-the-job hours behind target',
    detail: learner.overallProgressAvailable
      ? `${formatHours(learner.otjhCompleted)} recorded of ${formatHours(learner.otjhTarget)} hrs expected by now`
      : undefined,
    severity: statusKey === 'at-risk' ? 'critical' : 'warning',
    metric: 'otjh',
  };
}

function attendanceReasons(learner: Learner): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const rate = learner.liveAttendanceRateAvailable ? learner.liveAttendanceRate ?? null : null;
  const risk = learner.attendanceRisk;

  if (rate !== null && (risk === 'red' || risk === 'amber')) {
    reasons.push({
      id: 'attendance',
      label: `Attendance ${rate}%`,
      detail: risk === 'red'
        ? `Below the ${ATTENDANCE_MINIMUM_RATE}% minimum threshold`
        : `Below the ${ATTENDANCE_EXPECTED_RATE}% expected level`,
      severity: risk === 'red' ? 'critical' : 'warning',
      metric: 'attendance',
    });
  }

  const missed = learner.attendanceConsecutiveMissed ?? 0;
  if (missed >= 2) {
    reasons.push({
      id: 'attendance-streak',
      label: `${formatCount(missed, 'consecutive session')} missed`,
      detail: 'Catch-up support likely needed',
      severity: missed >= 3 ? 'critical' : 'warning',
      metric: 'attendance',
    });
  }

  return reasons;
}

function componentsReason(learner: Learner): AttentionReason | null {
  const planned = learner.componentsPlanned ?? 0;
  const completed = learner.componentsCompleted ?? 0;
  if (!learner.attendanceRateAvailable || planned <= 0) return null;
  if (learner.attendanceRate >= 25) return null;

  return {
    id: 'components',
    label: 'Components behind target',
    detail: `${completed} of ${planned} planned components complete`,
    severity: 'warning',
    metric: 'components',
  };
}

function ksbReason(learner: Learner): AttentionReason | null {
  const target = learner.ksbTarget ?? 0;
  if (!learner.ksbProgressAvailable || target <= 0) return null;
  const completed = learner.ksbCompleted ?? 0;

  if (displayValue(learner.ksbStatus).toLowerCase() === 'not started' || completed === 0) {
    return {
      id: 'ksb',
      label: 'KSBs not started',
      detail: `None of ${target} mapped KSBs evidenced yet`,
      severity: 'warning',
      metric: 'ksb',
    };
  }

  if (learner.ksbProgress < 25) {
    return {
      id: 'ksb',
      label: 'Low KSB coverage',
      detail: `${completed} of ${target} mapped KSBs evidenced`,
      severity: 'warning',
      metric: 'ksb',
    };
  }

  return null;
}

function gatewayReason(learner: Learner, daysAway: number | null): AttentionReason | null {
  if (daysAway === null) return null;

  const progressNote = learner.overallProgressAvailable
    ? `${learner.overallProgress}% of expected hours complete`
    : undefined;

  if (daysAway < 0) {
    return {
      id: 'gateway',
      label: 'Gateway review date has passed',
      detail: [formatDayOffset(daysAway), progressNote].filter(Boolean).join(' · '),
      severity: 'critical',
      metric: 'gateway',
    };
  }

  if (daysAway <= GATEWAY_SOON_DAYS) {
    return {
      id: 'gateway',
      label: `Gateway review ${formatDayOffset(daysAway)}`,
      detail: progressNote,
      severity: 'warning',
      metric: 'gateway',
    };
  }

  if (daysAway <= GATEWAY_HORIZON_DAYS) {
    return {
      id: 'gateway',
      label: `Gateway review ${formatDayOffset(daysAway)}`,
      detail: progressNote,
      severity: 'info',
      metric: 'gateway',
    };
  }

  return null;
}

function coachRagReason(learner: Learner): AttentionReason | null {
  const rag = displayValue(learner.coachRag);
  if (rag === 'Red') {
    return {
      id: 'rag',
      label: 'Coach RAG set to Red',
      detail: 'Flagged by a coach, not by the metrics',
      severity: 'critical',
      metric: 'rag',
    };
  }
  if (rag === 'Amber') {
    return {
      id: 'rag',
      label: 'Coach RAG set to Amber',
      detail: 'Flagged by a coach, not by the metrics',
      severity: 'warning',
      metric: 'rag',
    };
  }
  return null;
}

function engagementReason(daysAgo: number | null): AttentionReason | null {
  if (daysAgo === null || daysAgo < STALE_ACTIVITY_DAYS) return null;
  return {
    id: 'engagement',
    label: `No recorded session in ${daysAgo} days`,
    detail: 'Last attended session on record',
    severity: 'warning',
    metric: 'engagement',
  };
}

function resolveTier(reasons: AttentionReason[]): AttentionTier {
  if (reasons.some((reason) => reason.severity === 'critical')) return 'critical';
  if (reasons.some((reason) => reason.severity === 'warning')) return 'attention';
  if (reasons.length > 0) return 'upcoming';
  return 'on-track';
}

/**
 * Urgency drives the default sort. Tier dominates, then the number of critical
 * reasons, then how far behind on hours — so the learner a coach should open
 * first genuinely sits at the top of the list.
 */
function computeUrgency(tier: AttentionTier, reasons: AttentionReason[], otjhDeltaHours: number | null): number {
  const tierWeight: Record<AttentionTier, number> = {
    critical: 4000,
    attention: 3000,
    upcoming: 2000,
    'on-track': 1000,
    inactive: 0,
  };
  const criticalCount = reasons.filter((reason) => reason.severity === 'critical').length;
  const behind = otjhDeltaHours !== null && otjhDeltaHours < 0 ? Math.min(Math.abs(otjhDeltaHours), 400) : 0;
  return tierWeight[tier] + criticalCount * 100 + reasons.length * 10 + behind / 10;
}

export function buildLearnerInsight(learner: Learner, today: Date): LearnerInsight {
  const gatewayDate = parseDisplayDate(learner.gatewayReviewDate);
  const gatewayDaysAway = gatewayDate ? daysBetween(today, gatewayDate) : null;
  const lastSession = parseDisplayDate(learner.attendanceLastSessionDate);
  const lastActivityDaysAgo = lastSession ? Math.max(0, -daysBetween(today, lastSession)) : null;

  // `otjhProgressHours` is Django's own "completed - target" column. When it is
  // blank the same figure comes straight from the two hour totals.
  const reportedDelta = parseNumeric(learner.otjhProgressHours);
  const otjhDeltaHours = reportedDelta !== null
    ? reportedDelta
    : learner.overallProgressAvailable
      ? learner.otjhCompleted - learner.otjhTarget
      : null;

  const programStatus = getProgramStatusKey(learner.rawProgramStatus);
  if (programStatus === 'break' || programStatus === 'withdrawn' || programStatus === 'ready-to-enrol') {
    return {
      tier: 'inactive',
      riskLabel: hasValue(learner.rawProgramStatus) ? displayValue(learner.rawProgramStatus) : TIER_LABEL.inactive,
      reasons: [],
      criticalReasonCount: 0,
      otjhDeltaHours,
      gatewayDate,
      gatewayDaysAway,
      lastActivityDaysAgo,
      urgency: 0,
    };
  }

  const reasons = [
    otjhReason(learner, otjhDeltaHours),
    ...attendanceReasons(learner),
    componentsReason(learner),
    ksbReason(learner),
    gatewayReason(learner, gatewayDaysAway),
    coachRagReason(learner),
    engagementReason(lastActivityDaysAgo),
  ]
    .filter((reason): reason is AttentionReason => reason !== null)
    .sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]);

  const tier = resolveTier(reasons);

  return {
    tier,
    riskLabel: TIER_LABEL[tier],
    reasons,
    criticalReasonCount: reasons.filter((reason) => reason.severity === 'critical').length,
    otjhDeltaHours,
    gatewayDate,
    gatewayDaysAway,
    lastActivityDaysAgo,
    urgency: computeUrgency(tier, reasons, otjhDeltaHours),
  };
}

export type InsightMap = Map<string, LearnerInsight>;

export function buildInsightMap(learners: Learner[], today: Date): InsightMap {
  return new Map(learners.map((learner) => [learner.id, buildLearnerInsight(learner, today)]));
}

export interface CaseloadCounts {
  total: number;
  critical: number;
  attention: number;
  upcoming: number;
  onTrack: number;
  onBreak: number;
  withdrawn: number;
  readyToEnrol: number;
  needsAction: number;
}

export function countCaseload(learners: Learner[], insights: InsightMap): CaseloadCounts {
  const counts: CaseloadCounts = {
    total: learners.length,
    critical: 0,
    attention: 0,
    upcoming: 0,
    onTrack: 0,
    onBreak: 0,
    withdrawn: 0,
    readyToEnrol: 0,
    needsAction: 0,
  };

  for (const learner of learners) {
    switch (insights.get(learner.id)?.tier) {
      case 'critical': counts.critical += 1; break;
      case 'attention': counts.attention += 1; break;
      case 'upcoming': counts.upcoming += 1; break;
      case 'on-track': counts.onTrack += 1; break;
      default: break;
    }

    switch (getProgramStatusKey(learner.rawProgramStatus)) {
      case 'break': counts.onBreak += 1; break;
      case 'withdrawn': counts.withdrawn += 1; break;
      case 'ready-to-enrol': counts.readyToEnrol += 1; break;
      default: break;
    }
  }

  counts.needsAction = counts.critical + counts.attention + counts.upcoming;
  return counts;
}

/** Reason-metric to icon, so the same signal always looks the same. */
export const REASON_ICON: Record<ReasonMetric, string> = {
  otjh: 'ri-time-line',
  attendance: 'ri-calendar-check-line',
  components: 'ri-stack-line',
  ksb: 'ri-award-line',
  gateway: 'ri-flag-line',
  rag: 'ri-flag-2-line',
  engagement: 'ri-pulse-line',
};

/** Which quick-view tab answers a given reason. */
export const REASON_TAB: Record<ReasonMetric, 'overview' | 'attendance' | 'otjh' | 'ksbs'> = {
  otjh: 'otjh',
  attendance: 'attendance',
  components: 'overview',
  ksb: 'ksbs',
  gateway: 'overview',
  rag: 'overview',
  engagement: 'attendance',
};
