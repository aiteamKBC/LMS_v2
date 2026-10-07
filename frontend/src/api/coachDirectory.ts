/**
 * The accounts that hold Coach access — `/coach_api/coaches`.
 *
 * Read by the coach workspace when an administrator opens it, to offer a card
 * per coach instead of the empty dashboard an admin would otherwise get. The
 * endpoint is admin-only: a coach has no reason to enumerate their colleagues.
 */
import { coachFetch } from '@/lib/coachFetch';

export interface DirectoryCoach {
  id: number;
  name: string;
  email: string;
  caseloadCount: number;
  activeLearnerCount: number;
  performance?: CoachPerformanceMetrics | null;
}

export interface ReviewPerformanceMetrics {
  required: number;
  completed: number;
  overdue: number;
}

export interface CoachPerformanceMetrics {
  available: boolean;
  attendanceRate: number | null;
  progressReviewRate: number | null;
  pendingMarking: number;
  completedReviews: number;
  otjh: {
    onTrack: number;
    needAttention: number;
    atRisk: number;
  };
  progressReviews: ReviewPerformanceMetrics;
  monthlyCoaching: ReviewPerformanceMetrics;
}

export interface CoachDirectory {
  coaches: DirectoryCoach[];
  /**
   * False when the caseload database could not be reached — the coaches are
   * real, their counts are not, so the cards show no numbers rather than zeros.
   */
  caseloadCountsAvailable: boolean;
}

interface CoachDirectoryPayload {
  coaches?: Array<Partial<DirectoryCoach>>;
  caseloadCountsAvailable?: boolean;
  message?: string;
  error?: string;
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function toRate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null;
}

function reviewMetrics(value: unknown): ReviewPerformanceMetrics {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    required: toCount(source.required),
    completed: toCount(source.completed),
    overdue: toCount(source.overdue),
  };
}

function performanceMetrics(value: unknown): CoachPerformanceMetrics | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const otjh = source.otjh && typeof source.otjh === 'object'
    ? source.otjh as Record<string, unknown>
    : {};
  return {
    available: source.available !== false,
    attendanceRate: toRate(source.attendanceRate),
    progressReviewRate: toRate(source.progressReviewRate),
    pendingMarking: toCount(source.pendingMarking),
    completedReviews: toCount(source.completedReviews),
    otjh: {
      onTrack: toCount(otjh.onTrack),
      needAttention: toCount(otjh.needAttention),
      atRisk: toCount(otjh.atRisk),
    },
    progressReviews: reviewMetrics(source.progressReviews),
    monthlyCoaching: reviewMetrics(source.monthlyCoaching),
  };
}

export async function fetchCoachDirectory(signal?: AbortSignal): Promise<CoachDirectory> {
  const response = await coachFetch('/coach_api/coaches', { signal });
  const payload = await response.json().catch(() => ({})) as CoachDirectoryPayload;

  if (!response.ok) {
    throw new Error(payload.message || payload.error || 'Unable to load the coach list.');
  }

  return {
    coaches: (payload.coaches || [])
      .map(coach => ({
        id: toCount(coach.id),
        name: String(coach.name || '').trim(),
        email: String(coach.email || '').trim().toLowerCase(),
        caseloadCount: toCount(coach.caseloadCount),
        activeLearnerCount: toCount(coach.activeLearnerCount),
        performance: performanceMetrics(coach.performance),
      }))
      .filter(coach => Boolean(coach.email)),
    caseloadCountsAvailable: payload.caseloadCountsAvailable !== false,
  };
}
