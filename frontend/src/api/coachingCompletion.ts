import type { AuthUser } from '@/api/auth';
import { coachFetch } from '@/lib/coachFetch';
import { createCachedResource } from './cachedRequest';

export interface CompletionNotification {
  id: string; reminderId: number; text: string; createdAt: string; unread: boolean; link: string;
}
const endpoint = '/coach_api/coach/completion-notifications';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
function isNotification(value: unknown): value is CompletionNotification {
  return record(value) && typeof value.id === 'string' && /^completion:\d+$/.test(value.id)
    && Number.isSafeInteger(value.reminderId) && Number(value.reminderId) > 0
    && typeof value.text === 'string' && typeof value.unread === 'boolean'
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.link === 'string' && value.link.startsWith('/coach/coaching-recordings?');
}

export function hasCoachAccess(account: AuthUser | null | undefined) {
  return (account?.role === 'staff' || account?.role === 'admin') && (account.access === 'coach' || account.accesses?.includes('coach'));
}

const resource = createCachedResource<CompletionNotification[]>('coaching-completion', async () => {
  const response = await coachFetch(endpoint, { signal: AbortSignal.timeout(15000) });
  const value: unknown = await response.json();
  if (!response.ok || !record(value) || !Array.isArray(value.items) || !value.items.every(isNotification)) {
    throw new Error(record(value) && typeof value.error === 'string' ? value.error : 'Completion reminders could not be loaded.');
  }
  return value.items;
}, 30000, 2);

export function loadCompletionNotifications(account: AuthUser, force = false) {
  return resource.read(String(account.id), { revalidate: force });
}

export async function updateCompletionNotifications(account: AuthUser, ids: number[], action: 'read' | 'dismiss') {
  const response = await coachFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, action }), signal: AbortSignal.timeout(15000) });
  const value = await response.json() as { error?: string };
  if (!response.ok) throw new Error(value.error || 'The reminder could not be updated.');
  resource.invalidate(String(account.id));
}
