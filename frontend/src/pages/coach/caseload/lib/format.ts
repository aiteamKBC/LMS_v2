// ============================================================================
// Coach caseload — value formatting and normalisation.
//
// The generic formatters (dates, hours, percentages, initials, the attendance
// thresholds) used to be defined here and nowhere else; they now live in
// `@/lib/format` so every coach page can use them, and are re-exported below
// so nothing importing from here has to change.
//
// What stays local is genuinely caseload-specific: parsing the raw caseload
// payload, joining it against the attendance payload, and the coach-RAG and
// programme-status vocabularies that only this page edits or filters by.
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
  daysBetween,
};

export function formatCoachRagValue(value?: string | null): string {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'green') return 'Green';
  if (normalized === 'amber') return 'Amber';
  if (normalized === 'red') return 'Red';
  return EMPTY_VALUE;
}

export function getCoachRagOptionValue(value?: string | null): string {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'green' || normalized === 'amber' || normalized === 'red' ? normalized : '';
}

export function getCoachRagDotClass(value?: string | null): string {
  const normalized = displayValue(value).toLowerCase();
  if (normalized === 'green') return 'bg-emerald-500';
  if (normalized === 'amber') return 'bg-amber-500';
  if (normalized === 'red') return 'bg-red-500';
  return 'bg-foreground-300';
}

export function getCoachRagStyle(value?: string | null) {
  const normalized = displayValue(value).toLowerCase();
  if (normalized === 'red') return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' };
  if (normalized === 'amber') return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' };
  if (normalized === 'green') return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' };
  return { bg: 'bg-background-100', border: 'border-foreground-200', text: 'text-foreground-500' };
}

// --- programme status -------------------------------------------------------

export type ProgramStatusKey = 'active' | 'withdrawn' | 'break' | 'ready-to-enrol' | 'other';

export function getProgramStatusKey(value?: string | null): ProgramStatusKey {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'active') return 'active';
  if (normalized === 'withdrawn') return 'withdrawn';
  if (normalized === 'break' || normalized === 'onbreak' || normalized === 'onabreak') return 'break';
  if (normalized === 'readytoenrol') return 'ready-to-enrol';
  return 'other';
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
    lastProgressReview: gatewayReviewDate,
    lastReview: gatewayReviewDate,
    lastCoachingSession: plannedEndDate,
    lastSubmittedEvidence: displayValue(learner.lastSubmittedEvidence),
    progressVariance: displayValue(learner.progressVariance),
    startDate,
    gatewayReviewDate,
    plannedEndDate,
    coachName: displayValue(learner.coachName),
    coachEmail: displayValue(learner.coachEmail),
    rawProgramStatus: displayValue(learner.rawProgramStatus),
    coachRag: formatCoachRagValue(learner.coachRag),
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
