import { coachFetch } from '@/lib/coachFetch';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';

export interface ActionSession {
  sessionNumber: number; startDateTimeUtc: string; endDateTimeUtc: string; joinUrl: string;
  newStartDateTimeUtc?: string; newEndDateTimeUtc?: string;
  calendarVerified?: boolean;
}
export interface ActionReview {
  reviewToken: string; title: string; organizer: string; timeZone: string; action: 'cancel' | 'reschedule';
  scope: 'series' | 'occurrence'; notificationRequired: boolean; calendarRequests: number; sessions: ActionSession[];
  warnings?: string[];
}
export interface ActionResult { status: 'done' | 'failed' | 'uncertain' | 'processing' | 'incomplete' | 'none'; completed?: number; total?: number; message: string }

export async function calendarAction<T extends ActionReview | ActionResult>(liveId: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120000);
  try {
    const base = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
    const response = await coachFetch(`${base}/curriculum/teams-meetings/${encodeURIComponent(liveId)}/actions/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The calendar action could not be completed.');
    const valid = body.stage === 'review'
      ? result && typeof result.reviewToken === 'string' && result.reviewToken.length > 0
        && typeof result.timeZone === 'string' && result.notificationRequired === true
        && ['cancel', 'reschedule'].includes(result.action) && ['series', 'occurrence'].includes(result.scope)
        && Number.isInteger(result.calendarRequests) && result.calendarRequests > 0
        && Array.isArray(result.sessions) && result.sessions.length > 0
        && result.sessions.every((session: ActionSession) => session && Number.isInteger(session.sessionNumber)
          && Number.isFinite(Date.parse(session.startDateTimeUtc)) && Number.isFinite(Date.parse(session.endDateTimeUtc)))
      : result && ['done', 'failed', 'uncertain', 'processing', 'incomplete', 'none'].includes(result.status)
        && typeof result.message === 'string';
    if (!valid) throw new Error('The calendar response could not be verified. Check action status before confirming again.');
    if (body.stage !== 'review') clearCurriculumGetCache();
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Confirmation timed out. Use Check action status before sending another request.');
    }
    throw error;
  } finally { window.clearTimeout(timeout); }
}
