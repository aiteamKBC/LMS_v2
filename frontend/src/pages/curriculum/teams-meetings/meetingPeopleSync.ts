import { coachFetch } from '@/lib/coachFetch';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';
import type { TeamsCalendarForm } from './createCalendarForm.helpers';

export interface TeamsPeopleSyncInfo { status: 'never' | 'synced' | 'failed'; checkedAt: string | null; message?: string }

async function peopleRequest(liveSessionId: string, method: 'GET' | 'POST') {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  try {
    const base = import.meta.env.VITE_API_BASE_URL || '/curriculum_api';
    const response = await coachFetch(`${base}/curriculum/teams-meetings/${encodeURIComponent(liveSessionId)}/refresh-people/`, {
      method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}), signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'People and roles could not be refreshed from Teams. Retry.');
    const form = result?.form;
    if (!form || typeof form.organizerEmail !== 'string'
      || !['attendees', 'presenters', 'coOrganizers'].every(key => Array.isArray(form[key]) && form[key].every((email: unknown) => typeof email === 'string'))) {
      throw new Error('Microsoft people and roles could not be read. The displayed form was preserved.');
    }
    if (method === 'POST') clearCurriculumGetCache();
    return { form: { organizerEmail: form.organizerEmail, attendees: form.attendees.join('\n'), presenters: form.presenters.join('\n'),
      coOrganizers: form.coOrganizers.join('\n') } as Partial<TeamsCalendarForm>, syncInfo: result.syncInfo as TeamsPeopleSyncInfo | undefined };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Reading people and roles from Teams timed out. Retry.');
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export async function refreshTeamsPeople(liveSessionId: string): Promise<Partial<TeamsCalendarForm>> {
  return (await peopleRequest(liveSessionId, 'POST')).form;
}

/** Local saved snapshot/status only: polling never calls Microsoft or writes. */
export async function readTeamsPeopleState(liveSessionId: string) {
  const result = await peopleRequest(liveSessionId, 'GET');
  if (!result.syncInfo || !['never', 'synced', 'failed'].includes(result.syncInfo.status)
    || (result.syncInfo.checkedAt !== null && !Number.isFinite(Date.parse(result.syncInfo.checkedAt)))
    || (result.syncInfo.message !== undefined && typeof result.syncInfo.message !== 'string')) {
    throw new Error('The saved Teams people sync status could not be read. Retry Sync.');
  }
  return { form: result.form, syncInfo: result.syncInfo };
}
