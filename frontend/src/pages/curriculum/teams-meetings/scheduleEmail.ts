import { coachFetch } from '@/lib/coachFetch';

export interface ScheduleEmailStatus {
  total: number;
  accepted: number;
  queued: number;
  failed: number;
  uncertain: number;
  status: 'complete' | 'pending';
}

export async function sendScheduleEmailBatch(liveSessionId: string, retryFailed = false): Promise<ScheduleEmailStatus> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120000);
  try {
    const base = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
    // Reuse the existing session + CSRF transport; this URL receives no coach view-as parameter.
    const response = await coachFetch(`${base}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/schedule-email/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retryFailed }), signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Schedule emails could not be confirmed.');
    if (!['total', 'accepted', 'queued', 'failed', 'uncertain'].every(key => Number.isInteger(result[key]) && result[key] >= 0)
      || result.total !== result.accepted + result.queued + result.failed + result.uncertain) {
      throw new Error('Microsoft email submission status could not be read.');
    }
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The calendar is saved, but email submission timed out. Retry to check pending messages safely.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
