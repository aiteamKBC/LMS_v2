import { coachFetch } from '@/lib/coachFetch';
import type { CaseloadApiResponse, EngagementLearnerStatus } from '../types/caseload.types';

const ENGAGEMENT_ANALYTICS_ENDPOINT = '/engagement_api/learner-analytics/';

async function fetchEngagementStatuses(signal: AbortSignal): Promise<EngagementLearnerStatus[]> {
  try {
    const response = await fetch(ENGAGEMENT_ANALYTICS_ENDPOINT, { credentials: 'include', signal });
    if (!response.ok) return [];
    const payload = await response.json() as { learners?: EngagementLearnerStatus[] };
    return Array.isArray(payload.learners) ? payload.learners : [];
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn('Unable to load engagement Student Status values for the caseload', error);
    return [];
  }
}

/** Sole request owner for a standalone Caseload load; both bulk reads start together. */
export async function loadCoachCaseload(caseloadUrl: string, signal: AbortSignal): Promise<{
  caseload: CaseloadApiResponse;
  analytics: EngagementLearnerStatus[];
}> {
  const analyticsRequest = fetchEngagementStatuses(signal);
  const caseloadResponse = await coachFetch(caseloadUrl, { signal });
  if (!caseloadResponse.ok) {
    const payload = await caseloadResponse.json().catch(() => ({})) as { detail?: string; message?: string };
    throw new Error(payload.detail || payload.message || `Request failed with status ${caseloadResponse.status}`);
  }
  const [caseload, analytics] = await Promise.all([
    caseloadResponse.json() as Promise<CaseloadApiResponse>,
    analyticsRequest,
  ]);
  return { caseload, analytics };
}
