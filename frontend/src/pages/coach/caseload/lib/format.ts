// ============================================================================
// Coach caseload — value formatting and normalisation.
//
// The generic formatters (dates, hours, percentages, initials, the attendance
// thresholds) used to be defined here and nowhere else; they now live in
// `@/lib/format` so every coach page can use them, and are re-exported below
// so nothing importing from here has to change.
//
// What stays local is genuinely caseload-specific: parsing the raw caseload
// payload, joining it against the attendance payload, and the programme-status
// vocabulary that only this page filters by.
// ============================================================================
import {
  ATTENDANCE_EXPECTED_RATE,
  ATTENDANCE_MINIMUM_RATE,
  EMPTY_VALUE,
  clampPercent,
  displayValue,
  formatCount,
  formatDayOffset,
  formatHours,
  formatHoursRatio,
  formatPercent,
  formatRatio,
  hasValue,
  normalizeIdentity,
  parseDisplayDate,
  parseNumeric,
  startOfToday,
  targetHoursAsOfToday,
  daysBetween,
} from '@/lib/format';
import { statusTone } from '@/lib/statusTone';
import type {
  AttendanceApiLearner,
  AttendanceRisk,
  CaseloadApiLearner,
  Learner,
} from '../types';

export {
  ATTENDANCE_EXPECTED_RATE,
  ATTENDANCE_MINIMUM_RATE,
  EMPTY_VALUE,
  clampPercent,
  displayValue,
  formatCount,
  formatDayOffset,
  formatHours,
  formatHoursRatio,
  formatPercent,
  formatRatio,
  hasValue,
  normalizeIdentity,
  parseDisplayDate,
  parseNumeric,
  startOfToday,
  targetHoursAsOfToday,
  daysBetween,
};

// --- programme status -------------------------------------------------------

export type ProgramStatusKey = 'active' | 'withdrawn' | 'break' | 'ready-to-enrol' | 'other';

export function getProgramStatusKey(value?: string | null): ProgramStatusKey {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'active' || normalized === 'delivery') return 'active';
  if (normalized === 'withdrawn') return 'withdrawn';
  if (normalized === 'break' || normalized === 'onbreak' || normalized === 'onabreak') return 'break';
  if (normalized === 'readytoenrol') return 'ready-to-enrol';
  return 'other';
}

/**
 * These programme states do not have a meaningful OTJH target to calculate.
 * Keep the status visible in the OTJH cell instead of showing a misleading
 * hours ratio when the learner is onboarding or has withdrawn.
 */
export function getOtjhStatusOverride(value?: string | null): 'Withdrawn' | 'Onboarding' | null {
  const normalized = displayValue(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'withdrawn') return 'Withdrawn';
  if (normalized === 'onboarding' || normalized.startsWith('onboarding')) return 'Onboarding';
  return null;
}

/**
 * Delegates to the shared semantic tone table (`active`→positive, `break`→
 * caution, `ready-to-enrol`→brand, `withdrawn`/`other`→neutral) so this page's
 * programme-status pill uses the same fills as every StatusBadge elsewhere.
 */
const PROGRAM_STATUS_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  positive: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  caution: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
  brand: { bg: 'bg-primary-50', border: 'border-primary-200', text: 'text-primary-700' },
  neutral: { bg: 'bg-foreground-100', border: 'border-foreground-200', text: 'text-foreground-500' },
};

export function getProgramStatusStyle(value?: string | null) {
  const key = getProgramStatusKey(value);
  const tone = key === 'active' ? statusTone('active')
    : key === 'break' ? statusTone('break')
    : key === 'ready-to-enrol' ? statusTone('readytoenrol')
    : statusTone('withdrawn');
  return PROGRAM_STATUS_STYLE[tone] || PROGRAM_STATUS_STYLE.neutral;
}

export function getOtjhStatusKey(value?: string | null): 'on-track' | 'need-attention' | 'at-risk' | 'other' {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'ontrack') return 'on-track';
  if (normalized === 'needattention') return 'need-attention';
  if (normalized === 'atrisk') return 'at-risk';
  return 'other';
}

export function getOtjhGapStatus(actual?: number | null, target?: number | null) {
  if (actual === null || actual === undefined || !Number.isFinite(actual)
    || target === null || target === undefined || !Number.isFinite(target) || target <= 0) {
    return { gapHours: null, status: 'unavailable' as const, available: false };
  }
  const gapHours = Math.max(target - actual, 0);
  const status = gapHours > 40 ? 'at-risk' as const
    : gapHours > 20 ? 'need-attention' as const
    : 'on-track' as const;
  return { gapHours, status, available: true };
}

export type OtjhRiskStatus = 'at-risk' | 'need-attention' | 'on-track' | 'unavailable';

export interface OtjhProgress {
  actualHours: number | null;
  targetHours: number | null;
  percent: number | null;
  gapHours: number | null;
  deltaHours: number | null;
  status: OtjhRiskStatus;
}

export type OtjhProgressInput = Partial<Pick<
  Learner,
  | 'otjhCompleted'
  | 'otjhTarget'
  | 'otjhPlanned'
  | 'otjhTargetAsOfToday'
  | 'otjhProgressAsOfToday'
  | 'otjhShortfallHours'
  | 'otjhDeltaHours'
  | 'otjhRagStatus'
  | 'startDate'
  | 'plannedEndDate'
>>;

/**
 * Resolve the one OTJH denominator used by the caseload cards, table and
 * dashboard risk distribution.  ``otjhPlanned`` is the whole-programme plan;
 * the risk question is how many of those hours should have been completed by
 * today.  When the programme window is unavailable, the API's current target
 * remains the explicit fallback rather than inventing a date.
 */
export function otjhProgressAsOfToday(
  learner: OtjhProgressInput,
  today: Date = startOfToday(),
): OtjhProgress {
  const actual = typeof learner.otjhCompleted === 'number' && Number.isFinite(learner.otjhCompleted)
    ? learner.otjhCompleted
    : null;
  const apiTargetAsOfToday = typeof learner.otjhTargetAsOfToday === 'number'
    && Number.isFinite(learner.otjhTargetAsOfToday)
    ? learner.otjhTargetAsOfToday
    : null;
  const apiStatus = learner.otjhRagStatus;
  if (apiTargetAsOfToday !== null && apiStatus) {
    const target = apiTargetAsOfToday;
    const available = target > 0 && actual !== null;
    const shortfall = typeof learner.otjhShortfallHours === 'number'
      && Number.isFinite(learner.otjhShortfallHours)
      ? Math.max(learner.otjhShortfallHours, 0)
      : available ? Math.max(target - actual!, 0) : null;
    const delta = typeof learner.otjhDeltaHours === 'number'
      && Number.isFinite(learner.otjhDeltaHours)
      ? learner.otjhDeltaHours
      : available ? actual! - target : null;
    const percent = typeof learner.otjhProgressAsOfToday === 'number'
      && Number.isFinite(learner.otjhProgressAsOfToday)
      ? Math.max(0, Math.min(100, learner.otjhProgressAsOfToday))
      : available ? Math.max(0, Math.min(100, (actual! / target) * 100)) : null;
    return {
      actualHours: actual,
      targetHours: target,
      percent,
      gapHours: shortfall,
      deltaHours: delta,
      status: apiStatus,
    };
  }
  const wholePlan = typeof learner.otjhPlanned === 'number' && Number.isFinite(learner.otjhPlanned)
    ? learner.otjhPlanned
    : null;
  const pacedTarget = wholePlan !== null
    ? targetHoursAsOfToday(wholePlan, learner.startDate, learner.plannedEndDate, today)
    : null;
  const apiTarget = typeof learner.otjhTarget === 'number' && Number.isFinite(learner.otjhTarget) && learner.otjhTarget > 0
    ? learner.otjhTarget
    : null;
  const target = pacedTarget !== null ? pacedTarget : apiTarget;
  const gap = getOtjhGapStatus(actual, target);
  const percent = gap.available && target !== null && target > 0 && actual !== null
    ? Math.max(0, Math.min(100, (actual / target) * 100))
    : null;
  return {
    actualHours: actual,
    targetHours: target,
    percent,
    gapHours: gap.gapHours,
    deltaHours: actual !== null && target !== null && target > 0 ? actual - target : null,
    status: gap.status,
  };
}

export function normalizeAttendanceRisk(value?: string | null): AttendanceRisk | null {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'green' || normalized === 'amber' || normalized === 'red') return normalized;
  return null;
}

// --- payload joining -------------------------------------------------------

export function findAttendanceRecord(
  learner: CaseloadApiLearner,
  attendanceLearners: AttendanceApiLearner[],
): AttendanceApiLearner | null {
  const learnerId = normalizeIdentity(learner.id);
  const learnerEmail = normalizeIdentity(learner.email);
  const learnerName = normalizeIdentity(learner.name);

  return attendanceLearners.find((attendance) => {
    const attendanceId = normalizeIdentity(attendance.id);
    const attendanceEmail = normalizeIdentity(attendance.email);
    const attendanceName = normalizeIdentity(attendance.learner);

    return Boolean(
      (learnerId && attendanceId && learnerId === attendanceId)
      || (learnerEmail && attendanceEmail && learnerEmail === attendanceEmail)
      || (learnerName && attendanceName && learnerName === attendanceName),
    );
  }) || null;
}

function toOptionalNumber(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeLearner(
  learner: CaseloadApiLearner,
  attendance?: AttendanceApiLearner | null,
): Learner {
  const startDate = displayValue(learner.startDate || learner.lastAttendanceDate);
  const gatewayReviewDate = displayValue(
    learner.gatewayReviewDate || learner.lastProgressReview || learner.lastReview || learner.nextReview,
  );
  const plannedEndDate = displayValue(
    learner.plannedEndDate || learner.nextCoaching || learner.lastCoachingSession,
  );
  const hasAttendance = Boolean(
    attendance
    && attendance.attendance !== null
    && attendance.attendance !== undefined
    && attendance.hasAttendance !== false,
  );
  const programme = displayValue(attendance?.programme);
  const learningActivityDate = learner.lastActivityDate || null;
  const attendanceActivityDate = attendance?.lastSessionDate || null;
  const attendanceIsLatest = Boolean(
    attendanceActivityDate
    && (!learningActivityDate || Date.parse(attendanceActivityDate) > Date.parse(learningActivityDate)),
  );

  return {
    ...learner,
    programmeName: programme !== EMPTY_VALUE ? programme : undefined,
    nextCoaching: displayValue(learner.nextCoaching),
    nextReview: displayValue(learner.nextReview),
    lastContact: displayValue(learner.lastContact),
    lastAttendanceDate: startDate,
    liveAttendanceRate: hasAttendance ? clampPercent(attendance?.attendance) : null,
    liveAttendanceRateAvailable: hasAttendance,
    attendanceSessions: hasAttendance ? toOptionalNumber(attendance?.sessions) : null,
    attendancePresent: toOptionalNumber(attendance?.present),
    attendanceAbsent: toOptionalNumber(attendance?.absent),
    attendanceLate: toOptionalNumber(attendance?.late),
    attendanceAuthorisedAbsent: toOptionalNumber(attendance?.authorisedAbsent),
    attendanceUnauthorisedAbsent: toOptionalNumber(attendance?.unauthorisedAbsent),
    attendanceCatchup: toOptionalNumber(attendance?.catchup),
    attendanceRisk: normalizeAttendanceRisk(attendance?.risk),
    attendanceConsecutiveMissed: toOptionalNumber(attendance?.consecutiveMissed),
    attendanceLastSession: displayValue(attendance?.lastSession),
    attendanceLastSessionDate: attendance?.lastSessionDate || null,
    lastActivity: attendanceIsLatest
      ? displayValue(attendance?.lastSession)
      : displayValue(learner.lastActivity),
    lastActivityDate: attendanceIsLatest ? attendanceActivityDate : learningActivityDate,
    lastActivityLabel: attendanceIsLatest ? 'Attendance' : displayValue(learner.lastActivityLabel),
    lastProgressReview: displayValue(learner.lastProgressReview),
    lastReview: displayValue(learner.lastReview),
    lastCoachingSession: plannedEndDate,
    lastSubmittedEvidence: displayValue(learner.lastSubmittedEvidence),
    progressVariance: displayValue(learner.progressVariance),
    startDate,
    gatewayReviewDate,
    plannedEndDate,
    coachName: displayValue(learner.coachName),
    coachEmail: displayValue(learner.coachEmail),
    rawProgramStatus: displayValue(learner.rawProgramStatus),
    otjhStatus: displayValue(learner.otjhStatus),
    ksbStatus: displayValue(learner.ksbStatus),
    email: learner.email || undefined,
    employerEmail: learner.employerEmail || undefined,
    employerPhone: learner.employerPhone || undefined,
  };
}

/** The programme label to show. Falls back through the fields that carry one. */
export function learnerProgramme(learner: Learner): string {
  if (hasValue(learner.programmeName)) return displayValue(learner.programmeName);
  if (hasValue(learner.cohortName)) return displayValue(learner.cohortName);
  return EMPTY_VALUE;
}
