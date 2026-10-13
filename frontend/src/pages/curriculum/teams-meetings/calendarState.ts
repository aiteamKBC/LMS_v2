import { coachFetch } from '@/lib/coachFetch';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';
import type { TeamsLeftoverSlot } from '../module-builder/moduleAuthoringData';

export interface CalendarSyncResult {
  changed: boolean;
  seriesStatus: string;
  cancelledSessions: number[];
  errors: string[];
  /** On Teams but not in the module plan. Reported only; never cancelled by the check. */
  leftovers?: TeamsLeftoverSlot[];
  /**
   * Sessions Microsoft shows cancelled (in Outlook, by anybody) that the LMS
   * still holds. Reported only: the check never cancels anything, and the
   * author records the cancellation with Cancel if it should stand.
   */
  cancelledInMicrosoft?: number[];
  /** The whole calendar shows cancelled in Microsoft; still active in the LMS. */
  seriesCancelledInMicrosoft?: boolean;
}

/** Reads Microsoft status and reports it; never cancels anything and sends no email. */
export async function syncTeamsCalendarState(liveSessionId: string): Promise<CalendarSyncResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  try {
    const base = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
    const response = await coachFetch(`${base}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/calendar-state/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{}', signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Calendar status could not be checked.');
    if (typeof result.changed !== 'boolean' || typeof result.seriesStatus !== 'string'
      || !Array.isArray(result.cancelledSessions) || !result.cancelledSessions.every((n: unknown) => Number.isInteger(n) && Number(n) > 0)
      || !Array.isArray(result.errors) || !result.errors.every((error: unknown) => typeof error === 'string')) {
      throw new Error('Microsoft calendar status could not be read.');
    }
    if (result.changed) clearCurriculumGetCache();
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Calendar status verification timed out. Retry to check its latest status.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
