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
      }))
      .filter(coach => Boolean(coach.email)),
    caseloadCountsAvailable: payload.caseloadCountsAvailable !== false,
  };
}
